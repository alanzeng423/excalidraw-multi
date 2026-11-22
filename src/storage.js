import { createStore, delMany, get, getMany, keys, set } from "idb-keyval";

const store = createStore("excalidraw-multi", "kv");

export const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("excalidraw-multi")
    : null;

const metaKey = (id) => `meta:${id}`;
const sceneKey = (id) => `scene:${id}`;
const filesKey = (id) => `files:${id}`;
const tombstoneKey = (id) => `tombstone:${id}`;
const LIBRARY_KEY = "library:items";

export async function loadLibraryData() {
  const saved = await get(LIBRARY_KEY, store);
  if (!saved || !Array.isArray(saved.libraryItems)) {
    return { libraryItems: [], updatedAt: 0 };
  }
  return {
    libraryItems: saved.libraryItems,
    updatedAt: Number(saved.updatedAt) || 0,
  };
}

export async function saveLibraryData(libraryItems, updatedAt = Date.now()) {
  const record = {
    libraryItems: Array.isArray(libraryItems) ? libraryItems : [],
    updatedAt,
  };
  await set(LIBRARY_KEY, record, store);
  notify("library");
  return record;
}

export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}

export async function listBoards() {
  const metaKeys = (await keys(store)).filter(
    (k) => typeof k === "string" && k.startsWith("meta:")
  );
  return (await getMany(metaKeys, store))
    .filter(Boolean)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listTombstones() {
  const tKeys = (await keys(store)).filter(
    (k) => typeof k === "string" && k.startsWith("tombstone:")
  );
  return (await getMany(tKeys, store)).filter(Boolean);
}

export const getBoardMeta = (id) => get(metaKey(id), store);

export async function createBoard(title = "Untitled", id = newId()) {
  const now = Date.now();
  const meta = { id, title, createdAt: now, updatedAt: now };
  await store(
    "readwrite",
    (objectStore) =>
      new Promise((resolve, reject) => {
        objectStore.put(meta, metaKey(id));
        objectStore.delete(tombstoneKey(id));
        objectStore.transaction.oncomplete = () => resolve();
        objectStore.transaction.onerror = () =>
          reject(objectStore.transaction.error);
      })
  );
  notify("list");
  return meta;
}

export async function createBoardWithData(title, scene, files, id = newId()) {
  const now = Date.now();
  const meta = { id, title: title || "Untitled", createdAt: now, updatedAt: now };
  await store(
    "readwrite",
    (objectStore) =>
      new Promise((resolve, reject) => {
        objectStore.put(meta, metaKey(id));
        objectStore.delete(tombstoneKey(id));
        if (scene) objectStore.put(scene, sceneKey(id));
        if (files && Object.keys(files).length > 0) {
          objectStore.put(files, filesKey(id));
        }
        objectStore.transaction.oncomplete = () => resolve();
        objectStore.transaction.onerror = () =>
          reject(objectStore.transaction.error);
      })
  );
  notify("list");
  return meta;
}

export function ensureBoard(id, title = "Untitled") {
  return store(
    "readwrite",
    (objectStore) =>
      new Promise((resolve, reject) => {
        const req = objectStore.get(metaKey(id));
        req.onsuccess = () => {
          if (req.result) return resolve(req.result);
          const now = Date.now();
          const meta = { id, title, createdAt: now, updatedAt: now };
          objectStore.put(meta, metaKey(id));
          objectStore.delete(tombstoneKey(id));
          resolve(meta);
          notify("list");
        };
        req.onerror = () => reject(req.error);
      })
  );
}

export function renameBoard(id, title) {
  return store(
    "readwrite",
    (objectStore) =>
      new Promise((resolve, reject) => {
        const req = objectStore.get(metaKey(id));
        req.onsuccess = () => {
          if (!req.result) return resolve(false);
          objectStore.put(
            { ...req.result, title, updatedAt: Date.now() },
            metaKey(id)
          );
          resolve(true);
          notify("list", id);
        };
        req.onerror = () => reject(req.error);
      })
  );
}

export async function deleteBoard(id) {
  const deletedAt = Date.now();
  await store(
    "readwrite",
    (objectStore) =>
      new Promise((resolve, reject) => {
        objectStore.delete(metaKey(id));
        objectStore.delete(sceneKey(id));
        objectStore.delete(filesKey(id));
        objectStore.put({ id, deletedAt }, tombstoneKey(id));
        objectStore.transaction.oncomplete = () => resolve();
        objectStore.transaction.onerror = () =>
          reject(objectStore.transaction.error);
      })
  );
  notify("deleted", id);
}

export async function upsertBoardFromRemote(meta, scene, files) {
  await store(
    "readwrite",
    (objectStore) =>
      new Promise((resolve, reject) => {
        objectStore.put(meta, metaKey(meta.id));
        objectStore.delete(tombstoneKey(meta.id));
        if (scene) objectStore.put(scene, sceneKey(meta.id));
        if (files && Object.keys(files).length > 0) {
          objectStore.put(files, filesKey(meta.id));
        } else {
          objectStore.delete(filesKey(meta.id));
        }
        objectStore.transaction.oncomplete = () => resolve();
        objectStore.transaction.onerror = () =>
          reject(objectStore.transaction.error);
      })
  );
  notify("list", meta.id);
  notify("saved", meta.id);
}

export async function deleteBoardFromRemote(id, deletedAt) {
  await store(
    "readwrite",
    (objectStore) =>
      new Promise((resolve, reject) => {
        objectStore.delete(metaKey(id));
        objectStore.delete(sceneKey(id));
        objectStore.delete(filesKey(id));
        objectStore.put({ id, deletedAt }, tombstoneKey(id));
        objectStore.transaction.oncomplete = () => resolve();
        objectStore.transaction.onerror = () =>
          reject(objectStore.transaction.error);
      })
  );
  notify("deleted", id);
  notify("list", id);
}

export async function loadBoard(id) {
  const [scene, files] = await getMany([sceneKey(id), filesKey(id)], store);
  return { scene: scene || null, files: files || {} };
}

export function saveBoard(id, scene, files, touch = true) {
  return store(
    "readwrite",
    (objectStore) =>
      new Promise((resolve, reject) => {
        const req = objectStore.get(metaKey(id));
        req.onsuccess = () => {
          if (!req.result) return resolve(false);
          if (touch) {
            objectStore.put(
              { ...req.result, updatedAt: Date.now() },
              metaKey(id)
            );
          }
          objectStore.put(scene, sceneKey(id));
          if (files) {
            objectStore.put(files, filesKey(id));
          }
          resolve(true);
        };
        req.onerror = () => reject(req.error);
      })
  ).then((saved) => {
    if (saved) notify("saved", id);
    return saved;
  });
}

function notify(type, id) {
  try {
    channel?.postMessage({ type, id });
  } catch {}
}

const TRANSIENT_APP_STATE_KEYS = [
  "collaborators",
  "openDialog",
  "openMenu",
  "openPopup",
  "openSidebar",
  "contextMenu",
  "editingTextElement",
  "editingElement",
  "newElement",
  "resizingElement",
  "multiElement",
  "selectionElement",
  "draggingElement",
  "editingLinearElement",
  "selectedLinearElement",
  "isResizing",
  "isRotating",
  "cursorButton",
  "pasteDialog",
  "toast",
  "errorMessage",
  "isLoading",
  "snapLines",
  "originSnapOffset",
  "activeEmbeddable",
  "fileHandle",
  "width",
  "height",
  "offsetTop",
  "offsetLeft",
  "startBoundElement",
  "suggestedBindings",
  "frameToHighlight",
  "elementsToHighlight",
  "userToFollow",
  "followedBy",
  "searchMatches",
  "showHyperlinkPopup",
  "isCropping",
  "croppingElementId",
  "viewModeEnabled",
  "hoveredElementIds",
  "selectedGroupIds",
  "editingGroupId",
  "previousSelectedElementIds",
  "shouldCacheIgnoreZoom",
];

export function stripAppState(appState) {
  const clean = {};
  for (const [key, value] of Object.entries(appState)) {
    if (
      !TRANSIENT_APP_STATE_KEYS.includes(key) &&
      typeof value !== "function"
    ) {
      clean[key] = value;
    }
  }
  return clean;
}
