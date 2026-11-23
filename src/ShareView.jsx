import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Excalidraw,
  MainMenu,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { loadSharedBoard } from "./share";
import { createBoardWithData, stripAppState } from "./storage";
import { scheduleAutoSync } from "./webdav";
import MarkdownCard from "./MarkdownCard";
import TableCard from "./TableCard";
import {
  markLegacyTextIds,
  onCjkFontLoaded,
  preloadSceneCjkFonts,
} from "./cjkFonts";

const LANG_KEY = "excalidraw-multi:lang";

function getSavedLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

export default function ShareView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [api, setApi] = useState(null);
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const [copying, setCopying] = useState(false);
  const [langCode, setLangCode] = useState(getSavedLang);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", data: null, error: "" });
    loadSharedBoard(id, window.location.hash)
      .then((data) => {
        if (cancelled) return;
        markLegacyTextIds(data.elements);
        preloadSceneCjkFonts(data.elements);
        document.title = `${data.title} · Shared · Excalidraw`;
        setState({ status: "ready", data, error: "" });
      })
      .catch((err) => {
        if (cancelled) return;
        document.title = "Shared Board · Excalidraw";
        setState({
          status: "error",
          data: null,
          error: err?.message || String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!api) return;
    return onCjkFontLoaded(() => {
      api.refresh?.();
    });
  }, [api]);

  const toggleLang = useCallback(() => {
    setLangCode((prev) => {
      const next = prev === "zh-CN" ? "en" : "zh-CN";
      try {
        localStorage.setItem(LANG_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  const initialData = useMemo(() => {
    if (!state.data) return null;
    const { elements, appState, files } = state.data;
    return {
      elements,
      appState: {
        ...stripAppState(appState || {}),
        collaborators: new Map(),
        viewModeEnabled: true,
      },
      files,
      scrollToContent: true,
    };
  }, [state.data]);

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
      if (
        element.customData?.type === "markdown" ||
        element.link?.startsWith("markdown://")
      ) {
        return (
          <MarkdownCard
            element={element}
            theme={appState.theme}
            isActive={false}
            readOnly={true}
            onUpdate={() => {}}
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
            isActive={false}
            readOnly={true}
            langCode={langCode}
            onUpdate={() => {}}
          />
        );
      }
      return null;
    },
    [langCode]
  );

  const handleCopyToMyBoards = useCallback(async () => {
    if (!state.data || copying) return;
    setCopying(true);
    try {
      const { title, elements, appState, files } = state.data;
      const board = await createBoardWithData(
        title || "Shared Board",
        { elements, appState: stripAppState(appState || {}) },
        files || {}
      );
      scheduleAutoSync(2000);
      navigate(`/board/${board.id}`);
    } catch (err) {
      alert((langCode === "zh-CN" ? "复制失败：" : "Copy failed: ") + (err?.message || err));
      setCopying(false);
    }
  }, [state.data, copying, navigate, langCode]);

  const handleExport = useCallback(() => {
    if (!api || !state.data) return;
    const json = serializeAsJSON(
      api.getSceneElements(),
      api.getAppState(),
      api.getFiles()
    );
    const blob = new Blob([json], { type: "application/vnd.excalidraw+json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(state.data.title || "shared").replace(/[\\/:*?"<>|]/g, "_")}.excalidraw`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [api, state.data]);

  if (state.status === "loading") {
    return (
      <div className="canvas-page share-state-page">
        <div className="island share-state-card">
          <div className="share-spinner" aria-hidden="true" />
          <h2>{langCode === "zh-CN" ? "正在解密画板…" : "Decrypting shared board…"}</h2>
          <p>
            {langCode === "zh-CN"
              ? "密钥仅保存在链接 # 后，内容在本地浏览器解密"
              : "Decryption happens locally in your browser"}
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="canvas-page share-state-page">
        <div className="island share-state-card">
          <h2>{langCode === "zh-CN" ? "无法打开分享链接" : "Unable to open shared board"}</h2>
          <p className="share-state-err">{state.error}</p>
          <button
            type="button"
            className="tool-btn primary"
            onClick={() => navigate("/")}
          >
            {langCode === "zh-CN" ? "返回我的画板" : "Go to my boards"}
          </button>
        </div>
      </div>
    );
  }

  const isZh = langCode === "zh-CN";

  return (
    <div className="board">
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        langCode={langCode}
        viewModeEnabled={true}
        validateEmbeddable={validateEmbeddable}
        renderEmbeddable={renderEmbeddable}
        UIOptions={{ canvasActions: { toggleTheme: true } }}
        renderTopRightUI={() => (
          <div className="topbar share-topbar">
            <span className="share-badge">{isZh ? "只读分享" : "Read-only"}</span>
            <span className="share-title" title={state.data.title}>
              {state.data.title}
            </span>
            <button
              className="btn small share-copy-btn"
              disabled={copying}
              onClick={handleCopyToMyBoards}
            >
              {copying
                ? isZh
                  ? "复制中…"
                  : "Copying…"
                : isZh
                  ? "复制到我的画板"
                  : "Copy to my boards"}
            </button>
            <button
              className="btn small"
              onClick={() => navigate("/")}
            >
              {isZh ? "← 列表" : "← Boards"}
            </button>
          </div>
        )}
      >
        <MainMenu>
          <MainMenu.Item onSelect={handleCopyToMyBoards}>
            {isZh ? "复制到我的画板" : "Copy to my boards"}
          </MainMenu.Item>
          <MainMenu.Item onSelect={() => navigate("/")}>
            {isZh ? "← 返回画板列表" : "← Back to boards"}
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.Item onSelect={handleExport}>
            {isZh ? "导出 .excalidraw 文件" : "Export .excalidraw file"}
          </MainMenu.Item>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.Item onSelect={toggleLang}>
            {isZh ? "语言 / Language：中文 → English" : "Language / 语言: English → 中文"}
          </MainMenu.Item>
        </MainMenu>
      </Excalidraw>
    </div>
  );
}
