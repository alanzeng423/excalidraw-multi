import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Excalidraw,
  MainMenu,
  loadFromBlob,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import {
  channel,
  ensureBoard,
  getBoardMeta,
  loadBoard,
  renameBoard,
  saveBoard,
  stripAppState,
} from "./storage";
import { scheduleAutoSync } from "./webdav";

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

  const readyRef = useRef(false);
  const readOnlyRef = useRef(false);
  const timerRef = useRef(null);
  const pendingRef = useRef(null);
  const versionHashRef = useRef(-1);
  const fileIdsRef = useRef(new Set());
  const fileInputRef = useRef(null);

  const initialData = useMemo(
    () =>
      (async () => {
        const meta = await ensureBoard(id);
        setTitle(meta.title);
        document.title = `${meta.title} · 画板`;
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
      if (data?.id !== id) return;
      if (data.type === "deleted") {
        setDeleted(true);
      }
      if (data.type === "list") {
        const meta = await getBoardMeta(id);
        if (meta) {
          setTitle(meta.title);
          document.title = `${meta.title} · 画板`;
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
    a.download = `${(title || "画板").replace(/[\\/:*?"<>|]/g, "_")}.excalidraw`;
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

  return (
    <div className="board">
      {(readOnly || deleted) && (
        <div className={`banner ${deleted ? "danger" : ""}`}>
          {deleted
            ? "此画板已在其他标签页中被删除，当前修改不会再保存。"
            : "此画板已在另一个标签页中打开，本页为只读（会自动同步显示）。关闭另一个标签页后刷新即可编辑。"}
        </div>
      )}

      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        onChange={handleChange}
        langCode="zh-CN"
        viewModeEnabled={readOnly || undefined}
        UIOptions={{ canvasActions: { toggleTheme: true } }}
        renderTopRightUI={() => (
          <div className="topbar">
            <button
              className="btn small"
              title="返回画板列表"
              onClick={() => {
                flushSave();
                navigate("/");
              }}
            >
              ← 列表
            </button>
            <input
              className="title-input"
              value={title}
              aria-label="画板名称"
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
            ← 返回画板列表
          </MainMenu.Item>
          <MainMenu.Item onSelect={() => window.open("/", "_blank")}>
            在新标签页打开列表
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.Item onSelect={handleExport}>
            导出 .excalidraw 文件
          </MainMenu.Item>
          <MainMenu.Item onSelect={() => fileInputRef.current?.click()}>
            导入 .excalidraw 文件
          </MainMenu.Item>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
          <MainMenu.DefaultItems.Help />
        </MainMenu>
      </Excalidraw>

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

function hashElements(elements) {
  let hash = elements.length;
  for (const el of elements) {
    hash += el.version * 31 + (el.versionNonce % 997);
  }
  return hash;
}
