import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Excalidraw,
  MainMenu,
  loadFromBlob,
  restoreElements,
  serializeAsJSON,
  useHandleLibrary,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  channel,
  ensureBoard,
  getBoardMeta,
  loadBoard,
  loadLibraryData,
  newId,
  renameBoard,
  saveBoard,
  saveLibraryData,
  stripAppState,
} from "./storage";
import { scheduleAutoSync } from "./webdav";
import { createShareLink } from "./share";
import { DEFAULT_MARKDOWN, MARKDOWN_LINK } from "./markdown";
import MarkdownCard from "./MarkdownCard";
import { TABLE_LINK, createDefaultTable } from "./tableData";
import TableCard from "./TableCard";
import TextStylePanel from "./TextStylePanel";
import {
  getNativeMarkdownEnabled,
  measureNativeTextBox,
  setNativeMarkdownEnabled,
} from "./nativeMarkdown";

const LANG_KEY = "excalidraw-multi:lang";

function getSavedLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

const SHARE_TTL_OPTIONS = [
  { value: 604800, zh: "7 天", en: "7 days" },
  { value: 2592000, zh: "30 天", en: "30 days" },
  { value: 7776000, zh: "90 天", en: "90 days" },
  { value: 0, zh: "永久", en: "Never" },
];

const FONT_FAMILY_NAMES = {
  1: "Virgil, Segoe UI Emoji",
  2: "Helvetica, Segoe UI Emoji",
  3: "Cascadia, Segoe UI Emoji",
  5: "Excalifont, Xiaolai, Segoe UI Emoji",
  6: "Nunito, Segoe UI Emoji",
  7: "Lilita One, Segoe UI Emoji",
  8: "Comic Shanns, Segoe UI Emoji",
  9: "Liberation Sans, Segoe UI Emoji",
  10: "Shantell Sans, Xiaolai, Segoe UI Emoji",
  11: "Google Sans, Xiaolai, Segoe UI Emoji",
  12: "Open Sans, Xiaolai, Segoe UI Emoji",
  13: "Playwrite AR Guides, Xiaolai, Segoe UI Emoji",
  14: "Bentham, Xiaolai, Segoe UI Emoji",
};

const SAVE_DEBOUNCE_MS = 600;

export default function Board() {
  const { id } = useParams();
  return <BoardCanvas key={id} id={id} />;
}

function BoardCanvas({ id }) {
  const navigate = useNavigate();
  const [api, setApi] = useState(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [nativeMd, setNativeMd] = useState(() => getNativeMarkdownEnabled());
  const [langCode, setLangCode] = useState(getSavedLang);
  const [shareOpen, setShareOpen] = useState(false);

  const readyRef = useRef(false);
  const readOnlyRef = useRef(false);
  const librarySyncingRef = useRef(false);
  const timerRef = useRef(null);
  const pendingRef = useRef(null);
  const versionHashRef = useRef(-1);
  const fileIdsRef = useRef(new Set());
  const fileInputRef = useRef(null);

  const libraryAdapter = useMemo(
    () => ({
      async load() {
        const { libraryItems } = await loadLibraryData();
        return { libraryItems };
      },
      async save({ libraryItems }) {
        if (librarySyncingRef.current) return;
        await saveLibraryData(libraryItems);
        scheduleAutoSync(4000);
      },
    }),
    []
  );

  useHandleLibrary({ excalidrawAPI: api, adapter: libraryAdapter });

  const toggleLang = useCallback(() => {
    setLangCode((prev) => {
      const next = prev === "zh-CN" ? "en" : "zh-CN";
      try {
        localStorage.setItem(LANG_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  const initialData = useMemo(
    () =>
      (async () => {
        const meta = await ensureBoard(id);
        setTitle(meta.title);
        document.title = `${meta.title} · Excalidraw`;
        const { scene, files } = await loadBoard(id);
        fileIdsRef.current = new Set(Object.keys(files));
        versionHashRef.current = hashElements(scene?.elements || []);
        setTimeout(() => {
          readyRef.current = true;
        }, 0);
        return {
          elements: scene?.elements || [],
          appState: { ...(scene?.appState || {}), collaborators: new Map() },
          files,
          scrollToContent: !scene?.appState,
        };
      })(),
    [id]
  );

  useEffect(() => {
    if (!navigator.locks) return;
    let release;
    navigator.locks.request(
      `excalidraw-multi:board:${id}`,
      { ifAvailable: true },
      (lock) => {
        if (!lock) {
          readOnlyRef.current = true;
          setReadOnly(true);
          return;
        }
        return new Promise((resolve) => {
          release = resolve;
        });
      }
    );
    return () => release?.();
  }, [id]);

  const flushSave = useCallback(async () => {
    clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending || readOnlyRef.current) return;
    setStatus("保存中…");
    const ok = await saveBoard(id, pending.scene, pending.files, pending.touch);
    if (!ok) {
      setDeleted(true);
      setStatus("");
      return;
    }
    setStatus("已保存");
    if (pending.touch) scheduleAutoSync(4000);
  }, [id]);

  const handleChange = useCallback(
    (elements, appState, files) => {
      if (!readyRef.current || readOnlyRef.current) return;
      const hash = hashElements(elements);
      const elementsChanged = hash !== versionHashRef.current;
      versionHashRef.current = hash;

      const hasNewFiles = Object.keys(files).some(
        (fid) => !fileIdsRef.current.has(fid)
      );
      let filesToSave = pendingRef.current?.files || null;
      if (hasNewFiles) {
        filesToSave = { ...files };
        Object.keys(files).forEach((fid) => fileIdsRef.current.add(fid));
      }

      pendingRef.current = {
        scene: { elements, appState: stripAppState(appState) },
        files: filesToSave,
        touch: elementsChanged || hasNewFiles || !!pendingRef.current?.touch,
      };

      if (elementsChanged || hasNewFiles) {
        setStatus("未保存");
      }
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    },
    [flushSave]
  );

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    window.addEventListener("pagehide", flushSave);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushSave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushSave();
    };
  }, [flushSave]);

  useEffect(() => {
    if (!channel) return;
    const onMessage = async ({ data }) => {
      if (data?.type === "library" && api) {
        const { libraryItems } = await loadLibraryData();
        librarySyncingRef.current = true;
        try {
          await api.updateLibrary({ libraryItems, merge: false });
        } finally {
          setTimeout(() => {
            librarySyncingRef.current = false;
          }, 50);
        }
        return;
      }
      if (data?.id !== id) return;
      if (data.type === "deleted") {
        setDeleted(true);
      }
      if (data.type === "list") {
        const meta = await getBoardMeta(id);
        if (meta) {
          setTitle(meta.title);
          document.title = `${meta.title} · Excalidraw`;
        }
      }
      if (data.type === "saved" && readOnlyRef.current && api) {
        const { scene, files } = await loadBoard(id);
        if (scene) {
          api.addFiles(Object.values(files));
          api.updateScene({ elements: scene.elements });
        }
      }
    };
    channel.addEventListener("message", onMessage);
    return () => channel.removeEventListener("message", onMessage);
  }, [id, api]);

  const handleToggleNativeMd = useCallback(() => {
    const next = setNativeMarkdownEnabled(!getNativeMarkdownEnabled());
    setNativeMd(next);
    if (!api) return;

    const elements = api.getSceneElementsIncludingDeleted();
    const byId = new Map(elements.map((el) => [el.id, el]));
    const touchedContainers = new Set();
    for (const el of elements) {
      if (!el.isDeleted && el.type === "text" && el.containerId) {
        touchedContainers.add(el.containerId);
      }
    }

    const nextElements = elements.map((el) => {
      if (el.isDeleted) return el;
      if (el.type === "text") {
        const fontFamilyStr =
          FONT_FAMILY_NAMES[el.fontFamily] || FONT_FAMILY_NAMES[5];
        const measured = measureNativeTextBox(
          el.text,
          el.fontSize || 20,
          fontFamilyStr,
          el.lineHeight || 1.25
        );
        const container = el.containerId ? byId.get(el.containerId) : null;
        let nextX = el.x;
        let nextY = el.y;
        let nextW = measured.width;
        let nextH = measured.height;
        if (container && container.type !== "arrow" && container.type !== "line") {
          const pad = 10;
          nextW = Math.min(measured.width, Math.max(20, container.width - pad * 2));
          nextX = container.x + (container.width - nextW) / 2;
          nextY = container.y + (container.height - nextH) / 2;
        }
        return {
          ...el,
          x: nextX,
          y: nextY,
          width: nextW,
          height: nextH,
          version: (el.version || 0) + 1,
          versionNonce: Math.floor(Math.random() * 2147483647),
        };
      }
      if (touchedContainers.has(el.id)) {
        return {
          ...el,
          version: (el.version || 0) + 1,
          versionNonce: Math.floor(Math.random() * 2147483647),
        };
      }
      return el;
    });

    api.updateScene({ elements: nextElements });
  }, [api]);

  const handleEnsureNativeMd = useCallback(() => {
    if (!getNativeMarkdownEnabled()) {
      handleToggleNativeMd();
    }
  }, [handleToggleNativeMd]);

  const handleInsertMarkdownCard = useCallback(() => {
    if (!api || readOnlyRef.current) return;
    const appState = api.getAppState();
    const zoom = appState.zoom?.value || 1;
    const cardW = 420;
    const cardH = 340;
    const centerX = -appState.scrollX + appState.width / (2 * zoom);
    const centerY = -appState.scrollY + appState.height / (2 * zoom);

    const [card] = restoreElements(
      [
        {
          type: "embeddable",
          id: `md_${newId()}`,
          x: Math.round(centerX - cardW / 2),
          y: Math.round(centerY - cardH / 2),
          width: cardW,
          height: cardH,
          link: MARKDOWN_LINK,
          strokeColor: appState.theme === "dark" ? "#4a4a5a" : "#d0d0dc",
          backgroundColor: "transparent",
          strokeWidth: 1,
          roughness: 0,
          roundness: { type: 3, value: 12 },
          customData: {
            type: "markdown",
            markdown: DEFAULT_MARKDOWN,
          },
        },
      ],
      null
    );

    const current = api.getSceneElementsIncludingDeleted();
    api.updateScene({
      elements: [...current, card],
      appState: {
        selectedElementIds: { [card.id]: true },
        activeEmbeddable: { element: card, state: "active" },
      },
    });
  }, [api]);

  const handleUpdateMarkdown = useCallback(
    (elementId, nextMarkdown) => {
      if (!api || readOnlyRef.current) return;
      const elements = api.getSceneElementsIncludingDeleted();
      let updatedCard = null;
      const nextElements = elements.map((el) => {
        if (el.id !== elementId) return el;
        updatedCard = {
          ...el,
          version: (el.version || 0) + 1,
          versionNonce: Math.floor(Math.random() * 2147483647),
          updated: Date.now(),
          customData: {
            ...(el.customData || {}),
            type: "markdown",
            markdown: nextMarkdown,
          },
        };
        return updatedCard;
      });
      if (updatedCard) {
        const curAppState = api.getAppState();
        const keepActive =
          curAppState.activeEmbeddable?.element?.id === elementId &&
          curAppState.activeEmbeddable?.state === "active";
        api.updateScene({
          elements: nextElements,
          ...(keepActive
            ? {
                appState: {
                  activeEmbeddable: { element: updatedCard, state: "active" },
                },
              }
            : {}),
        });
      }
    },
    [api]
  );

  const handleInsertTableCard = useCallback(() => {
    if (!api || readOnlyRef.current) return;
    const appState = api.getAppState();
    const zoom = appState.zoom?.value || 1;
    const cardW = 480;
    const cardH = 240;
    const centerX = -appState.scrollX + appState.width / (2 * zoom);
    const centerY = -appState.scrollY + appState.height / (2 * zoom);

    const [card] = restoreElements(
      [
        {
          type: "embeddable",
          id: `tbl_${newId()}`,
          x: Math.round(centerX - cardW / 2),
          y: Math.round(centerY - cardH / 2),
          width: cardW,
          height: cardH,
          link: TABLE_LINK,
          strokeColor: appState.theme === "dark" ? "#4a4a5a" : "#d0d0dc",
          backgroundColor: "transparent",
          strokeWidth: 1,
          roughness: 0,
          roundness: { type: 3, value: 10 },
          customData: {
            type: "table",
            table: createDefaultTable(langCode === "zh-CN"),
          },
        },
      ],
      null
    );

    const current = api.getSceneElementsIncludingDeleted();
    api.updateScene({
      elements: [...current, card],
      appState: {
        selectedElementIds: { [card.id]: true },
        activeEmbeddable: { element: card, state: "active" },
      },
    });
  }, [api, langCode]);

  const handleUpdateTable = useCallback(
    (elementId, nextTable) => {
      if (!api || readOnlyRef.current) return;
      const elements = api.getSceneElementsIncludingDeleted();
      let updatedCard = null;
      const nextElements = elements.map((el) => {
        if (el.id !== elementId) return el;
        const prevRowCount = el.customData?.table?.rows?.length || 0;
        const nextRowCount = nextTable?.rows?.length || 0;
        const neededH = Math.min(720, nextRowCount * 40 + 82);
        const nextHeight =
          nextRowCount > prevRowCount
            ? Math.max(el.height || 240, neededH)
            : el.height;
        updatedCard = {
          ...el,
          height: nextHeight,
          version: (el.version || 0) + 1,
          versionNonce: Math.floor(Math.random() * 2147483647),
          updated: Date.now(),
          customData: {
            ...(el.customData || {}),
            type: "table",
            table: nextTable,
          },
        };
        return updatedCard;
      });
      if (updatedCard) {
        const curAppState = api.getAppState();
        const keepActive =
          curAppState.activeEmbeddable?.element?.id === elementId &&
          curAppState.activeEmbeddable?.state === "active";
        api.updateScene({
          elements: nextElements,
          ...(keepActive
            ? {
                appState: {
                  activeEmbeddable: { element: updatedCard, state: "active" },
                },
              }
            : {}),
        });
      }
    },
    [api]
  );

  // Alt+M shortcut to insert a Markdown card, Alt+T to insert a Table card
  useEffect(() => {
    const onKeyDown = (e) => {
      if (
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        const key = e.key.toLowerCase();
        if (key === "m") {
          e.preventDefault();
          handleInsertMarkdownCard();
        } else if (key === "t") {
          e.preventDefault();
          handleInsertTableCard();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleInsertMarkdownCard, handleInsertTableCard]);

  const validateEmbeddable = useCallback((link) => {
    if (
      typeof link === "string" &&
      (link.startsWith("markdown://") || link.startsWith("table://"))
    ) {
      return true;
    }
    return undefined;
  }, []);

  const renderEmbeddable = useCallback(
    (element, appState) => {
      const isActive =
        appState.activeEmbeddable?.element?.id === element.id &&
        appState.activeEmbeddable?.state === "active";
      if (
        element.customData?.type === "markdown" ||
        element.link?.startsWith("markdown://")
      ) {
        return (
          <MarkdownCard
            element={element}
            theme={appState.theme}
            isActive={isActive}
            readOnly={readOnly}
            onUpdate={handleUpdateMarkdown}
          />
        );
      }
      if (
        element.customData?.type === "table" ||
        element.link?.startsWith("table://")
      ) {
        return (
          <TableCard
            element={element}
            theme={appState.theme}
            isActive={isActive}
            readOnly={readOnly}
            langCode={langCode}
            onUpdate={handleUpdateTable}
          />
        );
      }
      return null;
    },
    [readOnly, langCode, handleUpdateMarkdown, handleUpdateTable]
  );

  const handleTitleBlur = async () => {
    const nextTitle = title.trim() || "Untitled";
    setTitle(nextTitle);
    document.title = `${nextTitle} · Excalidraw`;
    await renameBoard(id, nextTitle);
    scheduleAutoSync(2000);
  };

  const handleExport = () => {
    if (!api) return;
    const json = serializeAsJSON(
      api.getSceneElements(),
      api.getAppState(),
      api.getFiles()
    );
    const blob = new Blob([json], { type: "application/vnd.excalidraw+json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(title || "board").replace(/[\\/:*?"<>|]/g, "_")}.excalidraw`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const handleImport = async (file) => {
    if (!api || !file) return;
    if (
      api.getSceneElements().length &&
      !confirm("导入将替换当前画板的内容，确定继续吗？")
    ) {
      return;
    }
    try {
      const data = await loadFromBlob(
        file,
        api.getAppState(),
        api.getSceneElements()
      );
      api.addFiles(Object.values(data.files || {}));
      api.updateScene({
        elements: data.elements,
        appState: {
          viewBackgroundColor:
            data.appState?.viewBackgroundColor ??
            api.getAppState().viewBackgroundColor,
        },
      });
      api.scrollToContent(undefined, { fitToContent: true });
      setStatus("已导入");
    } catch (err) {
      alert("导入失败：" + (err?.message || err));
    }
  };

  const isZh = langCode === "zh-CN";
  const libraryReturnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}`
      : undefined;

  return (
    <div className="board">
      {(readOnly || deleted) && (
        <div className={`banner ${deleted ? "danger" : ""}`}>
          {deleted
            ? isZh
              ? "此画板已在其他标签页中被删除，当前修改不会再保存。"
              : "This board was deleted in another tab; edits will not be saved."
            : isZh
              ? "此画板已在另一个标签页中打开，本页为只读（会自动同步显示）。关闭另一个标签页后刷新即可编辑。"
              : "This board is open in another tab (read-only live mirror). Close the other tab and refresh to edit."}
        </div>
      )}

      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={handleChange}
        langCode={langCode}
        libraryReturnUrl={libraryReturnUrl}
        viewModeEnabled={readOnly || undefined}
        validateEmbeddable={validateEmbeddable}
        renderEmbeddable={renderEmbeddable}
        UIOptions={{ canvasActions: { toggleTheme: true } }}
        renderTopRightUI={() => (
          <div className="topbar">
            <button
              className="btn small"
              title={isZh ? "返回画板列表" : "Back to boards"}
              onClick={() => {
                flushSave();
                navigate("/");
              }}
            >
              {isZh ? "← 列表" : "← Boards"}
            </button>
            {!readOnly && (
              <>
                <button
                  className={`btn small md-toggle-btn ${nativeMd ? "active" : ""}`}
                  title={
                    isZh
                      ? `原生文字 Markdown 排版：${nativeMd ? "已开启" : "已关闭"}（点击切换，支持自由文字与图形内文字）`
                      : `Native text Markdown: ${nativeMd ? "ON" : "OFF"} (click to toggle)`
                  }
                  aria-pressed={nativeMd}
                  onClick={handleToggleNativeMd}
                >
                  <span className="md-dot" aria-hidden="true" />
                  MD
                </button>
                <button
                  className="btn small md-insert-btn"
                  title={isZh ? "插入 Markdown 卡片 (Alt+M)" : "Insert Markdown card (Alt+M)"}
                  onClick={handleInsertMarkdownCard}
                >
                  +MD
                </button>
                <button
                  className="btn small tbl-insert-btn"
                  title={isZh ? "插入交互表格 (Alt+T)" : "Insert interactive table (Alt+T)"}
                  onClick={handleInsertTableCard}
                >
                  {isZh ? "+表格" : "+Table"}
                </button>
              </>
            )}
            <button
              className="btn small share-open-btn"
              title={isZh ? "生成端到端加密只读分享链接" : "Create encrypted read-only share link"}
              onClick={() => setShareOpen(true)}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98" />
              </svg>
              <span>{isZh ? "分享" : "Share"}</span>
            </button>
            <input
              className="title-input"
              value={title}
              aria-label={isZh ? "画板名称" : "Board title"}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              disabled={readOnly}
            />
            <span className="status" data-testid="save-status">
              {status}
            </span>
          </div>
        )}
      >
        <MainMenu>
          <MainMenu.Item
            onSelect={() => {
              flushSave();
              navigate("/");
            }}
          >
            {isZh ? "← 返回画板列表" : "← Back to boards"}
          </MainMenu.Item>
          <MainMenu.Item onSelect={() => window.open("/", "_blank")}>
            {isZh ? "在新标签页打开列表" : "Open boards in new tab"}
          </MainMenu.Item>
          <MainMenu.Separator />
          {!readOnly && (
            <>
              <MainMenu.Item onSelect={handleToggleNativeMd}>
                {isZh
                  ? `原生文字 Markdown 排版：${nativeMd ? "已开启" : "已关闭"}`
                  : `Native text Markdown: ${nativeMd ? "ON" : "OFF"}`}
              </MainMenu.Item>
              <MainMenu.Item onSelect={handleInsertMarkdownCard}>
                {isZh ? "插入 Markdown 卡片 (Alt+M)" : "Insert Markdown card (Alt+M)"}
              </MainMenu.Item>
              <MainMenu.Item onSelect={handleInsertTableCard}>
                {isZh ? "插入交互表格 (Alt+T)" : "Insert interactive table (Alt+T)"}
              </MainMenu.Item>
            </>
          )}
          <MainMenu.Item onSelect={() => setShareOpen(true)}>
            {isZh ? "生成只读分享链接" : "Create read-only share link"}
          </MainMenu.Item>
          <MainMenu.Item onSelect={handleExport}>
            {isZh ? "导出 .excalidraw 文件" : "Export .excalidraw file"}
          </MainMenu.Item>
          <MainMenu.Item onSelect={() => fileInputRef.current?.click()}>
            {isZh ? "导入 .excalidraw 文件" : "Import .excalidraw file"}
          </MainMenu.Item>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.CommandPalette />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.Item onSelect={toggleLang}>
            {isZh ? "语言 / Language：中文 → English" : "Language / 语言: English → 中文"}
          </MainMenu.Item>
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>

      <TextStylePanel
        api={api}
        langCode={langCode}
        nativeMd={nativeMd}
        onToggleNativeMd={handleToggleNativeMd}
        onEnsureNativeMd={handleEnsureNativeMd}
        readOnly={readOnly}
      />

      {shareOpen && (
        <ShareModal
          api={api}
          title={title}
          langCode={langCode}
          dark={api?.getAppState()?.theme === "dark"}
          onClose={() => setShareOpen(false)}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".excalidraw,.json,application/json"
        hidden
        onChange={(e) => {
          handleImport(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ShareModal({ api, title, langCode, dark, onClose }) {
  const isZh = langCode === "zh-CN";
  const [ttl, setTtl] = useState(7776000);
  const [creating, setCreating] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCreate = async () => {
    if (!api || creating) return;
    setCreating(true);
    setError("");
    setCopied(false);
    try {
      const elements = api.getSceneElements().filter((el) => !el.isDeleted);
      const appState = stripAppState(api.getAppState());
      const allFiles = api.getFiles() || {};
      const usedFileIds = new Set(
        elements.filter((el) => el.fileId).map((el) => el.fileId)
      );
      const files = {};
      for (const fid of usedFileIds) {
        if (allFiles[fid]) files[fid] = allFiles[fid];
      }
      const url = await createShareLink({
        title: title || "Untitled",
        elements,
        appState,
        files,
        ttl,
      });
      setShareUrl(url);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.querySelector(".share-url-input");
      input?.select();
      document.execCommand?.("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className={`modal-backdrop ${dark ? "theme-dark" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={isZh ? "只读分享链接" : "Read-only share link"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="island modal-card share-modal">
        <div className="modal-head">
          <div>
            <h3>{isZh ? "生成只读分享链接" : "Read-only share link"}</h3>
            <p className="modal-sub">
              {isZh
                ? "创建当前画板的端到端加密只读快照"
                : "Create an end-to-end encrypted read-only snapshot"}
            </p>
          </div>
          <button
            className="tile-icon-btn"
            type="button"
            aria-label={isZh ? "关闭" : "Close"}
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

        <div className="share-ttl-section">
          <span className="share-field-label">
            {isZh ? "链接有效期" : "Expires after"}
          </span>
          <div className="share-ttl-group">
            {SHARE_TTL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`preset-chip ${ttl === opt.value ? "active" : ""}`}
                onClick={() => {
                  setTtl(opt.value);
                  setShareUrl("");
                  setError("");
                }}
              >
                {isZh ? opt.zh : opt.en}
              </button>
            ))}
          </div>
        </div>

        {shareUrl && (
          <div className="share-result">
            <input
              className="share-url-input"
              type="text"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className="tool-btn primary"
              onClick={handleCopy}
            >
              {copied
                ? isZh
                  ? "已复制"
                  : "Copied"
                : isZh
                  ? "复制"
                  : "Copy"}
            </button>
          </div>
        )}

        {error && <div className="modal-feedback err">{error}</div>}

        <p className="share-e2e-note">
          {isZh
            ? "端到端加密：内容在浏览器内使用 AES-GCM 加密，解密密钥仅保存在链接 # 片段中，不会发送到服务器。"
            : "End-to-end encrypted: content is AES-GCM encrypted in your browser. The key lives only in the URL #fragment and is never sent to the server."}
        </p>

        <div className="modal-foot">
          <div className="modal-foot-left">
            {shareUrl && (
              <a
                className="tool-btn outline"
                href={shareUrl}
                target="_blank"
                rel="noreferrer"
              >
                {isZh ? "打开预览" : "Open link"}
              </a>
            )}
          </div>
          <div className="modal-foot-right">
            <button
              type="button"
              className="tool-btn outline"
              onClick={onClose}
            >
              {isZh ? "关闭" : "Close"}
            </button>
            <button
              type="button"
              className="tool-btn primary"
              disabled={creating}
              onClick={handleCreate}
            >
              {creating
                ? isZh
                  ? "加密上传中…"
                  : "Creating…"
                : shareUrl
                  ? isZh
                    ? "重新生成"
                    : "Regenerate"
                  : isZh
                    ? "生成链接"
                    : "Create link"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function hashElements(elements) {
  let hash = elements.length;
  for (const el of elements) {
    hash += el.version * 31 + (el.versionNonce % 997);
  }
  return hash;
}
