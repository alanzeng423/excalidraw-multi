import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  exportToCanvas,
  exportToSvg,
  loadFromBlob,
} from "@excalidraw/excalidraw";
import {
  channel,
  createBoard,
  createBoardWithData,
  deleteBoard,
  listBoards,
  loadBoard,
  renameBoard,
  stripAppState,
} from "./storage";
import {
  JIANGUOYUN_URL,
  getLastSyncAt,
  getWebDAVConfig,
  saveWebDAVConfig,
  scheduleAutoSync,
  syncWithWebDAV,
  testWebDAVConnection,
} from "./webdav";

const THEME_KEY = "excalidraw-multi:home-theme";

const formatShortDate = (ts) =>
  new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const formatBoardDate = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `Board ${y}-${m}-${day}`;
};

let fontsBootstrapped = false;
function bootstrapExcalidrawFonts() {
  if (fontsBootstrapped) return Promise.resolve();
  fontsBootstrapped = true;
  return exportToCanvas({
    elements: [],
    appState: {},
    files: null,
  }).catch(() => {});
}

function BoardPreview({ boardId, updatedAt, dark }) {
  const hostRef = useRef(null);
  const [state, setState] = useState("loading");
  const [bgColor, setBgColor] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { scene, files } = await loadBoard(boardId);
        if (cancelled) return;
        const elements = (scene?.elements || []).filter((el) => !el.isDeleted);
        if (elements.length === 0) {
          setBgColor(null);
          setState("empty");
          return;
        }
        const rawBg = scene?.appState?.viewBackgroundColor;
        setBgColor(!dark && rawBg && rawBg !== "#ffffff" ? rawBg : null);
        const svg = await exportToSvg({
          elements,
          appState: {
            ...(scene?.appState || {}),
            exportWithDarkMode: dark,
            exportBackground: false,
          },
          files: files || null,
          exportPadding: 18,
        });
        if (cancelled) return;
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svg.classList.add("preview-svg");
        if (hostRef.current) {
          hostRef.current.replaceChildren(svg);
        }
        setState("ready");
      } catch {
        if (!cancelled) setState("empty");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, updatedAt, dark]);

  return (
    <div
      className={`card-preview ${state}`}
      style={bgColor ? { backgroundColor: bgColor } : undefined}
    >
      <div className="preview-canvas" ref={hostRef} />
      {state === "empty" && (
        <div className="preview-empty">
          <svg
            width="32"
            height="32"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect
              x="7"
              y="10"
              width="20"
              height="16"
              rx="3"
              strokeDasharray="3 3"
            />
            <circle cx="33" cy="30" r="8" strokeDasharray="3 3" />
          </svg>
          <span>Blank</span>
        </div>
      )}
    </div>
  );
}

function WebDAVModal({ config, onClose, onSavedAndSync }) {
  const [form, setForm] = useState(() => ({
    ...config,
    url: config.url || JIANGUOYUN_URL,
    folder: config.folder || "excalidraw",
  }));
  const [showPwd, setShowPwd] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const update = (key, val) => {
    setForm((prev) => ({ ...prev, [key]: val }));
    setFeedback(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      await testWebDAVConnection(form);
      setFeedback({
        ok: true,
        text: "Connected! Remote folder is ready.",
      });
    } catch (err) {
      setFeedback({ ok: false, text: err?.message || String(err) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await testWebDAVConnection(form);
      const saved = saveWebDAVConfig({ ...form, enabled: true });
      await onSavedAndSync(saved);
      onClose();
    } catch (err) {
      setFeedback({ ok: false, text: err?.message || String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = () => {
    const saved = saveWebDAVConfig({ ...form, enabled: false });
    onSavedAndSync(saved, true);
    onClose();
  };

  const isJianguoyun = (form.url || "").includes("jianguoyun.com");

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="WebDAV Sync Settings"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="island modal-card" onSubmit={handleSave}>
        <div className="modal-head">
          <div>
            <h3>WebDAV Sync</h3>
            <p className="modal-sub">
              Sync standard <code>.excalidraw</code> files across devices
            </p>
          </div>
          <button
            className="tile-icon-btn"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="preset-row">
          <button
            type="button"
            className={`preset-chip ${isJianguoyun ? "active" : ""}`}
            onClick={() => update("url", JIANGUOYUN_URL)}
          >
            Jianguoyun (坚果云)
          </button>
          <span className="preset-hint">
            Use account email + App Password (安全选项 → 第三方应用管理)
          </span>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Server URL</span>
            <input
              type="url"
              required
              placeholder="https://dav.jianguoyun.com/dav/"
              value={form.url}
              onChange={(e) => update("url", e.target.value)}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Username / Email</span>
              <input
                type="text"
                required
                autoComplete="username"
                placeholder="you@example.com"
                value={form.username}
                onChange={(e) => update("username", e.target.value)}
              />
            </label>

            <label className="field">
              <span>App Password</span>
              <div className="pwd-wrap">
                <input
                  type={showPwd ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  value={form.password}
                  onChange={(e) => update("password", e.target.value)}
                />
                <button
                  type="button"
                  className="pwd-toggle"
                  onClick={() => setShowPwd((v) => !v)}
                >
                  {showPwd ? "Hide" : "Show"}
                </button>
              </div>
            </label>
          </div>

          <label className="field">
            <span>Remote Folder</span>
            <input
              type="text"
              placeholder="excalidraw"
              value={form.folder}
              onChange={(e) => update("folder", e.target.value)}
            />
          </label>
        </div>

        <div className="check-group">
          <label className="check-item">
            <input
              type="checkbox"
              checked={form.autoSync}
              onChange={(e) => update("autoSync", e.target.checked)}
            />
            <span>Auto-sync on open & after edits</span>
          </label>
          <label className="check-item">
            <input
              type="checkbox"
              checked={form.useProxy}
              onChange={(e) => update("useProxy", e.target.checked)}
            />
            <span>Use built-in CORS proxy (required for Jianguoyun)</span>
          </label>
        </div>

        {feedback && (
          <div className={`modal-feedback ${feedback.ok ? "ok" : "err"}`}>
            {feedback.text}
          </div>
        )}

        <div className="modal-foot">
          <div className="modal-foot-left">
            {config.enabled && (
              <button
                type="button"
                className="tool-btn danger-text"
                onClick={handleDisable}
              >
                Disable
              </button>
            )}
          </div>
          <div className="modal-foot-right">
            <button
              type="button"
              className="tool-btn outline"
              disabled={testing || saving}
              onClick={handleTest}
            >
              {testing ? "Testing…" : "Test"}
            </button>
            <button
              type="submit"
              className="tool-btn primary"
              disabled={testing || saving}
            >
              {saving ? "Syncing…" : "Save & Sync"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function Home() {
  const [boards, setBoards] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [query, setQuery] = useState("");
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem(THEME_KEY) === "dark";
    } catch {
      return false;
    }
  });
  const [davConfig, setDavConfig] = useState(() => getWebDAVConfig());
  const [davModalOpen, setDavModalOpen] = useState(false);
  const [syncState, setSyncState] = useState("idle"); // idle | syncing | ok | error
  const [syncMsg, setSyncMsg] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState(() => getLastSyncAt());

  const searchRef = useRef(null);
  const fileInputRef = useRef(null);
  const navigate = useNavigate();

  const refresh = useCallback(() => listBoards().then(setBoards), []);

  const runManualSync = useCallback(
    async (overrideCfg) => {
      const cfg = overrideCfg || getWebDAVConfig();
      if (!cfg.enabled) {
        setDavModalOpen(true);
        return;
      }
      setSyncState("syncing");
      setSyncMsg("Syncing…");
      try {
        const res = await syncWithWebDAV(cfg);
        setLastSyncAt(res.timestamp);
        setSyncState("ok");
        const parts = [];
        if (res.pulled) parts.push(`↓${res.pulled}`);
        if (res.pushed) parts.push(`↑${res.pushed}`);
        if (res.deletedLocal || res.deletedRemote) {
          parts.push(`×${res.deletedLocal + res.deletedRemote}`);
        }
        setSyncMsg(parts.length ? `Synced ${parts.join(" ")}` : "Up to date");
        await refresh();
      } catch (err) {
        setSyncState("error");
        setSyncMsg(err?.message || "Sync failed");
      }
    },
    [refresh]
  );

  useEffect(() => {
    document.title = "Boards · Excalidraw";
    bootstrapExcalidrawFonts();
    refresh();

    const cfg = getWebDAVConfig();
    if (cfg.enabled && cfg.autoSync) {
      runManualSync(cfg);
    }

    const onUpdate = () => refresh();
    channel?.addEventListener("message", onUpdate);
    window.addEventListener("focus", onUpdate);
    return () => {
      channel?.removeEventListener("message", onUpdate);
      window.removeEventListener("focus", onUpdate);
    };
  }, [refresh, runManualSync]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {}
  }, [dark]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (
        e.key === "/" &&
        !davModalOpen &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [davModalOpen]);

  const handleCreate = async (inNewTab) => {
    const board = await createBoard(formatBoardDate());
    scheduleAutoSync(2000);
    if (inNewTab) {
      window.open(`/board/${board.id}`, "_blank");
      refresh();
    } else {
      navigate(`/board/${board.id}`);
    }
  };

  const handleImportNewBoard = async (file) => {
    if (!file) return;
    try {
      const data = await loadFromBlob(file, null, null);
      const baseName = file.name.replace(/\.(excalidraw|json)$/i, "").trim();
      const scene = {
        elements: data.elements || [],
        appState: stripAppState(data.appState || {}),
      };
      const board = await createBoardWithData(
        baseName || "Imported Board",
        scene,
        data.files || {}
      );
      scheduleAutoSync(2000);
      navigate(`/board/${board.id}`);
    } catch (err) {
      alert("Import failed: " + (err?.message || err));
    }
  };

  const handleRenameSubmit = async (id) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      await renameBoard(id, trimmed);
      scheduleAutoSync(2000);
    }
    setEditingId(null);
    refresh();
  };

  const handleDelete = async (board) => {
    if (confirm(`Delete "${board.title}"? This cannot be undone.`)) {
      await deleteBoard(board.id);
      scheduleAutoSync(2000);
      refresh();
    }
  };

  const filtered = (boards || []).filter(
    (b) => !query || b.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className={`canvas-page ${dark ? "theme-dark" : ""}`}>
      <header className="canvas-topbar">
        <div className="island bar-island">
          <div className="brand-group">
            <span className="brand-mark" aria-hidden="true">
              <svg
                width="17"
                height="17"
                viewBox="0 0 28 28"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 20.5 18.8 6.7a2.2 2.2 0 0 1 3.1 3.1L8.1 23.6 4 24.5l1-4Z" />
                <path d="m16.2 9.3 3.1 3.1" />
              </svg>
            </span>
            <span className="brand-title">Excalidraw</span>
            <span className="brand-count">
              {boards === null ? "…" : boards.length}
            </span>
          </div>

          <span className="toolbar-divider" aria-hidden="true" />

          <div className="search-wrap">
            <svg
              className="search-icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchRef}
              className="canvas-search"
              placeholder="Search boards…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button
                className="icon-clear"
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                ×
              </button>
            ) : (
              <kbd className="search-kbd">/</kbd>
            )}
          </div>

          <span className="toolbar-divider" aria-hidden="true" />

          <div className="tool-group">
            <button
              className="tool-btn icon-only"
              type="button"
              title="Import .excalidraw"
              aria-label="Import .excalidraw"
              onClick={() => fileInputRef.current?.click()}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
            </button>

            {davConfig.enabled ? (
              <>
                <button
                  className={`tool-btn sync-btn ${syncState}`}
                  type="button"
                  disabled={syncState === "syncing"}
                  title={
                    syncMsg ||
                    (lastSyncAt
                      ? `Last synced ${formatShortDate(lastSyncAt)}`
                      : "Sync with WebDAV")
                  }
                  onClick={() => runManualSync()}
                >
                  <svg
                    className={syncState === "syncing" ? "spin" : ""}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                    <path d="M16 16h5v5" />
                  </svg>
                  <span className="tool-label">
                    {syncState === "syncing" ? "Syncing" : "Sync"}
                  </span>
                </button>
                <button
                  className="tool-btn icon-only"
                  type="button"
                  title="WebDAV settings"
                  aria-label="WebDAV settings"
                  onClick={() => setDavModalOpen(true)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                  </svg>
                </button>
              </>
            ) : (
              <button
                className="tool-btn"
                type="button"
                title="Configure WebDAV sync (Jianguoyun)"
                onClick={() => setDavModalOpen(true)}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                </svg>
                <span className="tool-label">WebDAV</span>
              </button>
            )}

            <button
              className="tool-btn icon-only"
              type="button"
              title={dark ? "Light theme" : "Dark theme"}
              aria-label={dark ? "Light theme" : "Dark theme"}
              onClick={() => setDark((d) => !d)}
            >
              {dark ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
                </svg>
              )}
            </button>

            <span className="toolbar-divider" aria-hidden="true" />

            <button
              className="tool-btn primary"
              type="button"
              onClick={() => handleCreate(false)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>New</span>
            </button>

            <button
              className="tool-btn icon-only"
              type="button"
              title="New board in tab"
              aria-label="New board in tab"
              onClick={() => handleCreate(true)}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {syncState === "error" && syncMsg && (
        <div className="sync-alert" role="status">
          <span>{syncMsg}</span>
          <button type="button" onClick={() => setDavModalOpen(true)}>
            Settings
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setSyncState("idle")}
          >
            ×
          </button>
        </div>
      )}

      <main className="canvas-main">
        {boards === null ? (
          <div className="welcome-center">
            <p className="sketch-hint">Loading…</p>
          </div>
        ) : boards.length === 0 ? (
          <section className="welcome-center">
            <div className="welcome-logo">
              <svg
                width="40"
                height="40"
                viewBox="0 0 48 48"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="6" y="8" width="36" height="28" rx="5" />
                <path d="M14 26c3-7 7-10 10-4s7 3 10-6" />
                <circle cx="16" cy="16" r="2" fill="currentColor" />
                <path d="M18 41h12" />
              </svg>
              <h1>No boards yet</h1>
              <p>Create a canvas or import an .excalidraw file</p>
            </div>

            <div className="welcome-actions">
              <button
                className="welcome-item primary-item"
                type="button"
                onClick={() => handleCreate(false)}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>New board</span>
              </button>

              <button
                className="welcome-item"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
                <span>Import file</span>
              </button>
            </div>
          </section>
        ) : filtered.length === 0 ? (
          <section className="welcome-center compact">
            <p className="sketch-hint">No boards matching “{query}”</p>
            <button
              className="tool-btn outline"
              type="button"
              onClick={() => setQuery("")}
            >
              Clear search
            </button>
          </section>
        ) : (
          <section className="boards-section">
            <ul className="board-grid" data-testid="board-list">
              {filtered.map((board) => (
                <li className="board-tile" key={board.id}>
                  <a
                    className="tile-preview-link"
                    href={`/board/${board.id}`}
                    onClick={(e) => {
                      if (
                        !e.metaKey &&
                        !e.ctrlKey &&
                        !e.shiftKey &&
                        e.button === 0
                      ) {
                        e.preventDefault();
                        navigate(`/board/${board.id}`);
                      }
                    }}
                  >
                    <BoardPreview
                      boardId={board.id}
                      updatedAt={board.updatedAt}
                      dark={dark}
                    />
                  </a>

                  <div className="tile-body">
                    {editingId === board.id ? (
                      <input
                        className="tile-rename"
                        autoFocus
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => handleRenameSubmit(board.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRenameSubmit(board.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                    ) : (
                      <a
                        className="tile-title"
                        href={`/board/${board.id}`}
                        onClick={(e) => {
                          if (
                            !e.metaKey &&
                            !e.ctrlKey &&
                            !e.shiftKey &&
                            e.button === 0
                          ) {
                            e.preventDefault();
                            navigate(`/board/${board.id}`);
                          }
                        }}
                      >
                        {board.title}
                      </a>
                    )}

                    <div className="tile-footer">
                      <span
                        className="tile-meta"
                        title={`Created ${formatShortDate(board.createdAt)}`}
                      >
                        {formatShortDate(board.updatedAt)}
                      </span>

                      <div className="tile-actions">
                        <a
                          className="tile-icon-btn"
                          href={`/board/${board.id}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Open in new tab"
                          aria-label="Open in new tab"
                        >
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M15 3h6v6" />
                            <path d="M10 14 21 3" />
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          </svg>
                        </a>
                        <button
                          className="tile-icon-btn"
                          type="button"
                          title="Rename"
                          aria-label="Rename"
                          onClick={() => {
                            setEditingId(board.id);
                            setEditingTitle(board.title);
                          }}
                        >
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                        <button
                          className="tile-icon-btn danger"
                          type="button"
                          title="Delete"
                          aria-label="Delete"
                          onClick={() => handleDelete(board)}
                        >
                          <svg
                            width="13"
                            height="13"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M19 6l-1 14H6L5 6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <footer className="canvas-footer">
        <span>Local IndexedDB</span>
        <span aria-hidden="true">·</span>
        {davConfig.enabled ? (
          <button
            type="button"
            className="footer-link"
            onClick={() => setDavModalOpen(true)}
          >
            {syncMsg ||
              (lastSyncAt
                ? `WebDAV synced ${formatShortDate(lastSyncAt)}`
                : "WebDAV enabled")}
          </button>
        ) : (
          <button
            type="button"
            className="footer-link"
            onClick={() => setDavModalOpen(true)}
          >
            Set up WebDAV sync
          </button>
        )}
      </footer>

      {davModalOpen && (
        <WebDAVModal
          config={davConfig}
          onClose={() => setDavModalOpen(false)}
          onSavedAndSync={async (saved, disabledOnly) => {
            setDavConfig(saved);
            if (disabledOnly) {
              setSyncState("idle");
              setSyncMsg("");
              return;
            }
            await runManualSync(saved);
          }}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".excalidraw,.json,application/json"
        hidden
        onChange={(e) => {
          handleImportNewBoard(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
