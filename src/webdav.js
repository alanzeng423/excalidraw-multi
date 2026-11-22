import {
  mergeLibraryItems,
  restoreLibraryItems,
  serializeLibraryAsJSON,
} from "@excalidraw/excalidraw";
import {
  deleteBoardFromRemote,
  listBoards,
  listTombstones,
  loadBoard,
  loadLibraryData,
  saveLibraryData,
  stripAppState,
  upsertBoardFromRemote,
} from "./storage";

const CONFIG_KEY = "excalidraw-multi:webdav-config";
const LAST_SYNC_KEY = "excalidraw-multi:webdav-last-sync";

export const DEFAULT_WEBDAV_CONFIG = {
  enabled: false,
  url: "",
  username: "",
  password: "",
  folder: "excalidraw",
  useProxy: true,
  autoSync: true,
};

export function getWebDAVConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_WEBDAV_CONFIG };
    return { ...DEFAULT_WEBDAV_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_WEBDAV_CONFIG };
  }
}

export function saveWebDAVConfig(config) {
  const next = { ...DEFAULT_WEBDAV_CONFIG, ...config };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}

export function getLastSyncAt() {
  try {
    const val = Number(localStorage.getItem(LAST_SYNC_KEY));
    return Number.isFinite(val) && val > 0 ? val : null;
  } catch {
    return null;
  }
}

function setLastSyncAt(ts) {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(ts));
  } catch {}
}

function encodeBasicAuth(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

function normalizeBaseUrl(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) throw new Error("Server URL is required.");
  const u = new URL(trimmed);
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return u.toString();
}

function cleanFolderSegments(folder) {
  return (folder || "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinUrl(base, ...segments) {
  const root = normalizeBaseUrl(base);
  const encoded = segments
    .flatMap((s) => s.split("/"))
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return encoded ? `${root}${encoded}` : root;
}

async function davFetch(config, targetUrl, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    Authorization: encodeBasicAuth(config.username || "", config.password || ""),
    ...(options.headers || {}),
  };

  if (config.useProxy) {
    // Use POST to /api/webdav with X-WebDAV-Method so exotic DAV methods
    // (PROPFIND/MKCOL) always pass through cleanly.
    const res = await fetch("/api/webdav", {
      method: "POST",
      headers: {
        ...headers,
        "X-WebDAV-URL": targetUrl,
        "X-WebDAV-Method": method,
      },
      body: options.body,
    });
    return res;
  }

  return fetch(targetUrl, {
    method,
    headers,
    body: options.body,
  });
}

async function formatDavError(res, context) {
  if (res.status === 401) {
    return `${context}: Authentication failed (401). Check your username and password.`;
  }
  if (res.status === 403) {
    return `${context}: Access forbidden (403). Check WebDAV permissions or path.`;
  }
  if (res.status === 429 || res.status === 503) {
    return `${context}: Rate limited by server (${res.status}). Try again shortly.`;
  }
  const text = await res.text().catch(() => "");
  const snippet = text.replace(/<[^>]+>/g, " ").trim().slice(0, 140);
  return `${context}: HTTP ${res.status}${snippet ? ` — ${snippet}` : ""}`;
}

async function ensureDirectories(config) {
  const base = normalizeBaseUrl(config.url);
  const segments = [...cleanFolderSegments(config.folder), "boards"];
  const built = [];

  for (const seg of segments) {
    built.push(seg);
    const dirUrl = `${joinUrl(base, ...built)}/`;
    const res = await davFetch(config, dirUrl, { method: "MKCOL" });
    // 201 Created, 200/204 OK, 405 Already Exists (standard WebDAV)
    if (
      res.status === 200 ||
      res.status === 201 ||
      res.status === 204 ||
      res.status === 405
    ) {
      continue;
    }
    throw new Error(await formatDavError(res, `Create folder /${built.join("/")}`));
  }
}

export async function testWebDAVConnection(config) {
  const base = normalizeBaseUrl(config.url);
  if (!config.username?.trim() || !config.password?.trim()) {
    throw new Error("Username and password are required.");
  }

  const propfindBody =
    '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
  const res = await davFetch(config, base, {
    method: "PROPFIND",
    headers: {
      Depth: "0",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: propfindBody,
  });

  if (res.status !== 207 && res.status !== 200) {
    throw new Error(await formatDavError(res, "Connection test"));
  }

  await ensureDirectories(config);
  return { ok: true };
}

function getRemotePaths(config) {
  const base = normalizeBaseUrl(config.url);
  const folderSegs = cleanFolderSegments(config.folder);
  const indexUrl = joinUrl(base, ...folderSegs, "index.json");
  const libraryUrl = joinUrl(base, ...folderSegs, "library.excalidrawlib");
  const boardUrl = (id) =>
    joinUrl(base, ...folderSegs, "boards", `${id}.excalidraw`);
  return { indexUrl, libraryUrl, boardUrl };
}

let inFlightSync = null;

export function syncWithWebDAV(overrideConfig) {
  if (inFlightSync) return inFlightSync;
  const config = overrideConfig || getWebDAVConfig();
  if (!config.url || !config.username || !config.password) {
    return Promise.reject(new Error("WebDAV is not configured."));
  }

  inFlightSync = runSync(config).finally(() => {
    inFlightSync = null;
  });
  return inFlightSync;
}

async function runSync(config) {
  await ensureDirectories(config);
  const { indexUrl, libraryUrl, boardUrl } = getRemotePaths(config);

  // 1. Fetch remote index.json
  let remoteIndex = { version: 1, boards: {}, libraryUpdatedAt: 0 };
  let remoteIndexExists = false;
  const idxRes = await davFetch(config, indexUrl, { method: "GET" });
  if (idxRes.status === 200) {
    remoteIndexExists = true;
    try {
      const parsed = await idxRes.json();
      if (parsed && typeof parsed === "object" && parsed.boards) {
        remoteIndex = {
          version: 1,
          boards: { ...parsed.boards },
          libraryUpdatedAt: Number(parsed.libraryUpdatedAt) || 0,
        };
      }
    } catch {
      remoteIndex = { version: 1, boards: {}, libraryUpdatedAt: 0 };
    }
  } else if (idxRes.status !== 404) {
    throw new Error(await formatDavError(idxRes, "Read index.json"));
  }

  // 2. Load local boards & tombstones
  const [localBoards, localTombstones] = await Promise.all([
    listBoards(),
    listTombstones(),
  ]);
  const localMap = new Map(localBoards.map((b) => [b.id, b]));
  const tombstoneMap = new Map(localTombstones.map((t) => [t.id, t]));

  const allIds = new Set([
    ...localMap.keys(),
    ...tombstoneMap.keys(),
    ...Object.keys(remoteIndex.boards || {}),
  ]);

  const nextRemoteBoards = { ...(remoteIndex.boards || {}) };
  let pulled = 0;
  let pushed = 0;
  let deletedLocal = 0;
  let deletedRemote = 0;
  let remoteDirty = !remoteIndexExists;

  // 3. Two-way LWW merge per board (sequential to respect server rate limits)
  for (const id of allIds) {
    const localBoard = localMap.get(id) || null;
    const localTomb = tombstoneMap.get(id) || null;
    const remoteEntry = remoteIndex.boards?.[id] || null;

    const localTs = localBoard
      ? localBoard.updatedAt || 0
      : localTomb
        ? localTomb.deletedAt || 0
        : 0;
    const localDeleted = !localBoard && Boolean(localTomb);

    const remoteTs = remoteEntry
      ? remoteEntry.deletedAt
        ? remoteEntry.deletedAt
        : remoteEntry.updatedAt || 0
      : 0;
    const remoteDeleted = Boolean(remoteEntry?.deletedAt);

    if (remoteEntry && remoteTs > localTs) {
      if (remoteDeleted) {
        await deleteBoardFromRemote(id, remoteTs);
        deletedLocal += 1;
      } else {
        const res = await davFetch(config, boardUrl(id), { method: "GET" });
        if (res.status === 200) {
          const payload = await res.json();
          const meta = {
            id,
            title: remoteEntry.title || "Untitled",
            createdAt: remoteEntry.createdAt || remoteTs,
            updatedAt: remoteEntry.updatedAt || remoteTs,
          };
          const scene = {
            elements: Array.isArray(payload?.elements) ? payload.elements : [],
            appState: stripAppState(payload?.appState || {}),
          };
          const files =
            payload?.files && typeof payload.files === "object"
              ? payload.files
              : {};
          await upsertBoardFromRemote(meta, scene, files);
          pulled += 1;
        } else if (res.status !== 404) {
          throw new Error(await formatDavError(res, `Download board ${id}`));
        }
      }
    } else if ((localBoard || localTomb) && localTs > remoteTs) {
      if (localDeleted) {
        const delRes = await davFetch(config, boardUrl(id), {
          method: "DELETE",
        });
        if (
          delRes.status !== 200 &&
          delRes.status !== 204 &&
          delRes.status !== 404
        ) {
          throw new Error(await formatDavError(delRes, `Delete remote ${id}`));
        }
        nextRemoteBoards[id] = { id, deletedAt: localTs };
        deletedRemote += 1;
        remoteDirty = true;
      } else if (localBoard) {
        const { scene, files } = await loadBoard(id);
        const excalidrawFile = {
          type: "excalidraw",
          version: 2,
          source:
            typeof window !== "undefined" ? window.location.origin : "excalidraw-multi",
          elements: scene?.elements || [],
          appState: stripAppState(scene?.appState || {}),
          files: files || {},
        };
        const putRes = await davFetch(config, boardUrl(id), {
          method: "PUT",
          headers: {
            "Content-Type": "application/vnd.excalidraw+json; charset=utf-8",
          },
          body: JSON.stringify(excalidrawFile),
        });
        if (!putRes.ok && putRes.status !== 201 && putRes.status !== 204) {
          throw new Error(await formatDavError(putRes, `Upload board ${id}`));
        }
        nextRemoteBoards[id] = {
          id: localBoard.id,
          title: localBoard.title,
          createdAt: localBoard.createdAt,
          updatedAt: localBoard.updatedAt,
        };
        pushed += 1;
        remoteDirty = true;
      }
    }
  }

  // 4. Two-way sync for Excalidraw library (library.excalidrawlib)
  const localLib = await loadLibraryData();
  const localLibItems = localLib.libraryItems || [];
  const localLibTs = localLib.updatedAt || 0;
  const remoteLibTs = remoteIndex.libraryUpdatedAt || 0;
  let nextLibraryUpdatedAt = remoteLibTs;
  let librarySynced = false;

  if (remoteLibTs > localLibTs) {
    const libRes = await davFetch(config, libraryUrl, { method: "GET" });
    if (libRes.status === 200) {
      let remoteItems = [];
      try {
        const parsed = await libRes.json();
        const raw = parsed?.libraryItems || parsed?.library || [];
        remoteItems = restoreLibraryItems(raw, "published");
      } catch {
        remoteItems = [];
      }
      const merged = mergeLibraryItems(localLibItems, remoteItems);
      const remoteIdSet = new Set(remoteItems.map((it) => it.id));
      const localAdded = merged.some((it) => !remoteIdSet.has(it.id));

      if (localAdded) {
        const now = Date.now();
        await saveLibraryData(merged, now);
        const putLib = await davFetch(config, libraryUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "application/vnd.excalidrawlib+json; charset=utf-8",
          },
          body: serializeLibraryAsJSON(merged),
        });
        if (!putLib.ok && putLib.status !== 201 && putLib.status !== 204) {
          throw new Error(await formatDavError(putLib, "Upload library"));
        }
        nextLibraryUpdatedAt = now;
        remoteDirty = true;
      } else {
        await saveLibraryData(merged, remoteLibTs);
      }
      librarySynced = true;
    } else if (libRes.status !== 404) {
      throw new Error(await formatDavError(libRes, "Download library"));
    }
  } else if (localLibTs > remoteLibTs && (localLibItems.length > 0 || remoteLibTs > 0)) {
    const putLib = await davFetch(config, libraryUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/vnd.excalidrawlib+json; charset=utf-8",
      },
      body: serializeLibraryAsJSON(localLibItems),
    });
    if (!putLib.ok && putLib.status !== 201 && putLib.status !== 204) {
      throw new Error(await formatDavError(putLib, "Upload library"));
    }
    nextLibraryUpdatedAt = localLibTs;
    remoteDirty = true;
    librarySynced = true;
  }

  // 5. Write merged index.json if anything changed remotely
  if (remoteDirty) {
    const putIdx = await davFetch(config, indexUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(
        {
          version: 1,
          updatedAt: Date.now(),
          libraryUpdatedAt: nextLibraryUpdatedAt,
          boards: nextRemoteBoards,
        },
        null,
        2
      ),
    });
    if (!putIdx.ok && putIdx.status !== 201 && putIdx.status !== 204) {
      throw new Error(await formatDavError(putIdx, "Save index.json"));
    }
  }

  const timestamp = Date.now();
  setLastSyncAt(timestamp);
  return { pulled, pushed, deletedLocal, deletedRemote, librarySynced, timestamp };
}

let autoSyncTimer = null;
const autoSyncListeners = new Set();

export function onAutoSyncState(fn) {
  autoSyncListeners.add(fn);
  return () => autoSyncListeners.delete(fn);
}

function emitAutoSync(event) {
  for (const fn of autoSyncListeners) {
    try {
      fn(event);
    } catch {}
  }
}

export function scheduleAutoSync(delayMs = 4000) {
  const config = getWebDAVConfig();
  if (!config.enabled || !config.autoSync) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(async () => {
    emitAutoSync({ state: "syncing" });
    try {
      const result = await syncWithWebDAV(config);
      emitAutoSync({ state: "synced", result });
    } catch (err) {
      emitAutoSync({ state: "error", error: err?.message || String(err) });
    }
  }, delayMs);
}
