import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  HIGHLIGHT_COLOR_PALETTE,
  TEXT_COLOR_PALETTE,
  measureNativeTextBox,
} from "./nativeMarkdown";
import {
  applyBlockFormat,
  applyFormatToWholeText,
  applyInlineColor,
  applyInlineFormat,
  applyInlineHighlight,
  clearMarkdownFormatting,
  detectActiveFormats,
} from "./textFormatting";

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

const EMPTY_ACTIVE = {
  block: null,
  bold: false,
  italic: false,
  strike: false,
  code: false,
  color: null,
  highlight: null,
};

function getSelectedTextElements(api) {
  if (!api) return [];
  const appState = api.getAppState();
  const selectedIds = appState?.selectedElementIds || {};
  const elements = api.getSceneElementsIncludingDeleted();
  const byId = new Map(elements.map((el) => [el.id, el]));
  const result = [];
  const seen = new Set();

  for (const id of Object.keys(selectedIds)) {
    if (!selectedIds[id]) continue;
    const el = byId.get(id);
    if (!el || el.isDeleted) continue;
    if (el.type === "text") {
      if (!seen.has(el.id)) {
        seen.add(el.id);
        result.push(el);
      }
    } else if (Array.isArray(el.boundElements)) {
      for (const b of el.boundElements) {
        if (b.type === "text") {
          const textEl = byId.get(b.id);
          if (textEl && !textEl.isDeleted && !seen.has(textEl.id)) {
            seen.add(textEl.id);
            result.push(textEl);
          }
        }
      }
    }
  }
  return result;
}

function findPanelColumn() {
  return (
    document.querySelector(".App-menu__left .panelColumn") ||
    document.querySelector(".App-mobile-menu .panelColumn")
  );
}

function findInsertionAnchor(panelCol) {
  // Prefer placing right after Excalidraw's own text controls (Vertical Align / Text Align / Font Size / Font Family)
  const selectors = [
    '[name="vertical-align"]',
    '[name="text-align"]',
    '[name="font-size"]',
    '[name="font-family"]',
  ];
  for (const sel of selectors) {
    const ctrl = panelCol.querySelector(sel);
    if (ctrl) {
      const fs = ctrl.closest("fieldset");
      if (fs && fs.parentElement === panelCol) return { after: fs };
    }
  }
  // Fallback when editing text inside a brand-new container before text controls mount
  const wysiwyg = document.querySelector("textarea.excalidraw-wysiwyg");
  if (wysiwyg) {
    const range = panelCol.querySelector('input[type="range"]');
    const opacityFs = range?.closest("fieldset");
    if (opacityFs && opacityFs.parentElement === panelCol) {
      return { before: opacityFs };
    }
    return { append: true };
  }
  return null;
}

export default function TextStylePanel({
  api,
  langCode,
  nativeMd,
  onToggleNativeMd,
  onEnsureNativeMd,
  readOnly,
}) {
  const [hostEl, setHostEl] = useState(null);
  const [active, setActive] = useState(EMPTY_ACTIVE);
  const [isEditingText, setIsEditingText] = useState(false);

  const hostRef = useRef(null);
  const lastSelRef = useRef({ start: 0, end: 0 });
  const isZh = langCode === "zh-CN";

  const refreshActiveState = useCallback(() => {
    const ta = document.querySelector("textarea.excalidraw-wysiwyg");
    if (ta) {
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? start;
      lastSelRef.current = { start, end };
      setIsEditingText(true);
      setActive(detectActiveFormats(ta.value, start, end));
      return;
    }
    setIsEditingText(false);
    const textEls = getSelectedTextElements(api);
    if (textEls.length > 0) {
      const raw = textEls[0].originalText ?? textEls[0].text ?? "";
      setActive(detectActiveFormats(raw, 0, raw.length));
    } else {
      setActive(EMPTY_ACTIVE);
    }
  }, [api]);

  // Mount/unmount our portal container inside Excalidraw's left .panelColumn
  const syncPortalHost = useCallback(() => {
    if (readOnly) {
      if (hostRef.current) {
        hostRef.current.remove();
        hostRef.current = null;
        setHostEl(null);
      }
      return;
    }

    const panelCol = findPanelColumn();
    if (!panelCol) {
      if (hostRef.current) {
        hostRef.current.remove();
        hostRef.current = null;
        setHostEl(null);
      }
      return;
    }

    const anchor = findInsertionAnchor(panelCol);
    if (!anchor) {
      if (hostRef.current) {
        hostRef.current.remove();
        hostRef.current = null;
        setHostEl(null);
      }
      return;
    }

    let el = hostRef.current;
    if (!el) {
      el = document.createElement("div");
      el.className = "md-style-panel-host";
      hostRef.current = el;
    }

    if (anchor.after) {
      if (el.previousElementSibling !== anchor.after || el.parentElement !== panelCol) {
        anchor.after.insertAdjacentElement("afterend", el);
      }
    } else if (anchor.before) {
      if (el.nextElementSibling !== anchor.before || el.parentElement !== panelCol) {
        panelCol.insertBefore(el, anchor.before);
      }
    } else if (el.parentElement !== panelCol) {
      panelCol.appendChild(el);
    }

    setHostEl((prev) => (prev === el ? prev : el));
  }, [readOnly]);

  useEffect(() => {
    syncPortalHost();
    let rafId = 0;
    const scheduleSync = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        syncPortalHost();
        refreshActiveState();
      });
    };

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });

    const onSelEvent = () => refreshActiveState();
    document.addEventListener("selectionchange", onSelEvent);
    document.addEventListener("keyup", onSelEvent, true);
    document.addEventListener("mouseup", onSelEvent, true);
    document.addEventListener("input", onSelEvent, true);
    document.addEventListener("focusin", scheduleSync, true);

    const unsubApi = api?.onChange?.(() => {
      scheduleSync();
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
      document.removeEventListener("selectionchange", onSelEvent);
      document.removeEventListener("keyup", onSelEvent, true);
      document.removeEventListener("mouseup", onSelEvent, true);
      document.removeEventListener("input", onSelEvent, true);
      document.removeEventListener("focusin", scheduleSync, true);
      unsubApi?.();
      if (hostRef.current) {
        hostRef.current.remove();
        hostRef.current = null;
      }
    };
  }, [api, syncPortalHost, refreshActiveState]);

  const applyAction = useCallback(
    (action) => {
      if (readOnly) return;
      if (action.type !== "clear" && !nativeMd) {
        onEnsureNativeMd?.();
      }

      // Mode A: Currently editing inside Excalidraw's live wysiwyg textarea
      const ta = document.querySelector("textarea.excalidraw-wysiwyg");
      if (ta) {
        const start =
          document.activeElement === ta
            ? ta.selectionStart ?? lastSelRef.current.start
            : lastSelRef.current.start;
        const end =
          document.activeElement === ta
            ? ta.selectionEnd ?? lastSelRef.current.end
            : lastSelRef.current.end;
        const clampedStart = Math.max(0, Math.min(start, ta.value.length));
        const clampedEnd = Math.max(clampedStart, Math.min(end, ta.value.length));

        let res;
        if (action.type === "block") {
          res = applyBlockFormat(ta.value, clampedStart, clampedEnd, action.kind);
        } else if (action.type === "inline") {
          res = applyInlineFormat(ta.value, clampedStart, clampedEnd, action.kind);
        } else if (action.type === "color") {
          res = applyInlineColor(ta.value, clampedStart, clampedEnd, action.color);
        } else if (action.type === "highlight") {
          res = applyInlineHighlight(ta.value, clampedStart, clampedEnd, action.color);
        } else if (action.type === "clear") {
          res = clearMarkdownFormatting(ta.value, clampedStart, clampedEnd);
        } else {
          return;
        }

        ta.value = res.text;
        lastSelRef.current = { start: res.start, end: res.end };
        ta.focus();
        ta.setSelectionRange(res.start, res.end);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        // Preserve selection after Excalidraw's pointerup refocus cycle
        requestAnimationFrame(() => {
          if (document.contains(ta)) {
            ta.focus();
            ta.setSelectionRange(res.start, res.end);
            refreshActiveState();
          }
        });
        setActive(detectActiveFormats(res.text, res.start, res.end));
        return;
      }

      // Mode B: Text element(s) or shape(s) with bound text selected on canvas
      if (!api) return;
      const targetTextEls = getSelectedTextElements(api);
      if (targetTextEls.length === 0) return;

      const targetIds = new Set(targetTextEls.map((el) => el.id));
      const allElements = api.getSceneElementsIncludingDeleted();
      const byId = new Map(allElements.map((el) => [el.id, el]));
      const touchedContainers = new Set();
      let changed = false;

      const nextElements = allElements.map((el) => {
        if (!targetIds.has(el.id) || el.isDeleted) return el;
        const currentRaw = el.originalText ?? el.text ?? "";
        const nextRaw = applyFormatToWholeText(currentRaw, action);
        if (nextRaw === currentRaw) return el;

        changed = true;
        const fontFamilyStr =
          FONT_FAMILY_NAMES[el.fontFamily] || FONT_FAMILY_NAMES[5];
        const measured = measureNativeTextBox(
          nextRaw,
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
          touchedContainers.add(container.id);
          const pad = 10;
          nextW = Math.min(measured.width, Math.max(20, container.width - pad * 2));
          nextX = container.x + (container.width - nextW) / 2;
          if (el.verticalAlign === "top") {
            nextY = container.y + pad;
          } else if (el.verticalAlign === "bottom") {
            nextY = container.y + container.height - nextH - pad;
          } else {
            nextY = container.y + (container.height - nextH) / 2;
          }
        } else {
          if (el.textAlign === "center") {
            nextX = el.x + (el.width - nextW) / 2;
          } else if (el.textAlign === "right") {
            nextX = el.x + (el.width - nextW);
          }
        }

        return {
          ...el,
          text: nextRaw,
          originalText: nextRaw,
          x: nextX,
          y: nextY,
          width: nextW,
          height: nextH,
          version: (el.version || 0) + 1,
          versionNonce: Math.floor(Math.random() * 2147483647),
          updated: Date.now(),
        };
      });

      if (!changed) return;

      const finalElements =
        touchedContainers.size > 0
          ? nextElements.map((el) =>
              touchedContainers.has(el.id)
                ? {
                    ...el,
                    version: (el.version || 0) + 1,
                    versionNonce: Math.floor(Math.random() * 2147483647),
                    updated: Date.now(),
                  }
                : el
            )
          : nextElements;

      api.updateScene({ elements: finalElements });
      requestAnimationFrame(refreshActiveState);
    },
    [api, nativeMd, onEnsureNativeMd, readOnly, refreshActiveState]
  );

  // Rich-text keyboard shortcuts while typing inside textarea.excalidraw-wysiwyg
  useEffect(() => {
    if (readOnly) return;
    const onKeyDown = (e) => {
      const ta = document.activeElement;
      if (
        !(ta instanceof HTMLTextAreaElement) ||
        !ta.classList.contains("excalidraw-wysiwyg")
      ) {
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (!e.shiftKey && key === "b") {
        e.preventDefault();
        e.stopPropagation();
        applyAction({ type: "inline", kind: "bold" });
      } else if (!e.shiftKey && key === "i") {
        e.preventDefault();
        e.stopPropagation();
        applyAction({ type: "inline", kind: "italic" });
      } else if (!e.shiftKey && key === "e") {
        e.preventDefault();
        e.stopPropagation();
        applyAction({ type: "inline", kind: "code" });
      } else if (e.shiftKey && key === "x") {
        e.preventDefault();
        e.stopPropagation();
        applyAction({ type: "inline", kind: "strike" });
      } else if (e.shiftKey && key === "h") {
        e.preventDefault();
        e.stopPropagation();
        applyAction({ type: "highlight", color: "yellow" });
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [readOnly, applyAction]);

  if (!hostEl || readOnly) return null;

  const preventBlur = (e) => {
    e.preventDefault();
  };

  return createPortal(
    <fieldset className="md-style-panel">
      <legend className="md-style-legend">
        <span>{isZh ? "文本样式" : "Text style"}</span>
        <button
          type="button"
          className={`md-style-switch ${nativeMd ? "active" : ""}`}
          title={
            isZh
              ? "开关原生文字 Markdown / 富文本渲染"
              : "Toggle native Markdown / rich text rendering"
          }
          onMouseDown={preventBlur}
          onClick={onToggleNativeMd}
        >
          <span className="md-style-switch-dot" />
          MD
        </button>
      </legend>

      {/* Block styles: H1, H2, H3, Bullet, Task, Quote */}
      <div className="md-style-btn-grid">
        <button
          type="button"
          className={`md-style-btn ${active.block === "h1" ? "active" : ""}`}
          title={isZh ? "一级标题 (# )" : "Heading 1 (# )"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "block", kind: "h1" })}
        >
          H1
        </button>
        <button
          type="button"
          className={`md-style-btn ${active.block === "h2" ? "active" : ""}`}
          title={isZh ? "二级标题 (## )" : "Heading 2 (## )"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "block", kind: "h2" })}
        >
          H2
        </button>
        <button
          type="button"
          className={`md-style-btn ${active.block === "h3" ? "active" : ""}`}
          title={isZh ? "三级标题 (### )" : "Heading 3 (### )"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "block", kind: "h3" })}
        >
          H3
        </button>
        <button
          type="button"
          className={`md-style-btn ${active.block === "bullet" ? "active" : ""}`}
          title={isZh ? "无序列表 (- )" : "Bullet list (- )"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "block", kind: "bullet" })}
        >
          •
        </button>
        <button
          type="button"
          className={`md-style-btn ${active.block === "task" ? "active" : ""}`}
          title={isZh ? "待办清单 (- [ ] )" : "Checklist (- [ ] )"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "block", kind: "task" })}
        >
          ☑
        </button>
        <button
          type="button"
          className={`md-style-btn ${active.block === "quote" ? "active" : ""}`}
          title={isZh ? "引用 (> )" : "Quote (> )"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "block", kind: "quote" })}
        >
          ”
        </button>
      </div>

      {/* Inline styles: Bold, Italic, Strike, Code, Quick Highlight, Clear */}
      <div className="md-style-btn-grid">
        <button
          type="button"
          className={`md-style-btn ${active.bold ? "active" : ""}`}
          title={isZh ? "加粗 **文字** (Ctrl+B)" : "Bold **text** (Ctrl+B)"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "inline", kind: "bold" })}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className={`md-style-btn ${active.italic ? "active" : ""}`}
          title={isZh ? "斜体 *文字* (Ctrl+I)" : "Italic *text* (Ctrl+I)"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "inline", kind: "italic" })}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className={`md-style-btn ${active.strike ? "active" : ""}`}
          title={
            isZh
              ? "删除线 ~~文字~~ (Ctrl+Shift+X)"
              : "Strikethrough ~~text~~ (Ctrl+Shift+X)"
          }
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "inline", kind: "strike" })}
        >
          <span className="md-strike-icon">S</span>
        </button>
        <button
          type="button"
          className={`md-style-btn md-code-btn ${active.code ? "active" : ""}`}
          title={isZh ? "行内代码 `code` (Ctrl+E)" : "Inline code `code` (Ctrl+E)"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "inline", kind: "code" })}
        >
          {"</>"}
        </button>
        <button
          type="button"
          className={`md-style-btn ${active.highlight === "yellow" ? "active" : ""}`}
          title={
            isZh
              ? "荧光高亮 ==文字== (Ctrl+Shift+H)"
              : "Highlight ==text== (Ctrl+Shift+H)"
          }
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "highlight", color: "yellow" })}
        >
          <span className="md-hl-icon">A</span>
        </button>
        <button
          type="button"
          className="md-style-btn"
          title={isZh ? "清除富文本格式" : "Clear formatting"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "clear" })}
        >
          <span className="md-clear-icon">Tx</span>
        </button>
      </div>

      {/* Partial Text Color Swatches */}
      <div className="md-style-sublabel">
        {isZh ? "局部字体颜色" : "Inline text color"}
      </div>
      <div className="md-swatch-row">
        {TEXT_COLOR_PALETTE.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`md-swatch ${active.color === c.id ? "active" : ""}`}
            style={{ "--swatch-color": c.hex }}
            title={
              isZh
                ? `局部${c.zh}色 ({c:${c.id}}文字{/c})`
                : `${c.en} text ({c:${c.id}}text{/c})`
            }
            aria-label={isZh ? `局部${c.zh}色` : `${c.en} text`}
            onMouseDown={preventBlur}
            onClick={() => applyAction({ type: "color", color: c.id })}
          />
        ))}
        <button
          type="button"
          className="md-swatch md-swatch-clear"
          title={isZh ? "清除局部字色" : "Clear text color"}
          aria-label={isZh ? "清除局部字色" : "Clear text color"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "color", color: null })}
        >
          ×
        </button>
      </div>

      {/* Partial Highlight Color Swatches */}
      <div className="md-style-sublabel">
        {isZh ? "局部高亮底色" : "Inline highlight"}
      </div>
      <div className="md-swatch-row">
        {HIGHLIGHT_COLOR_PALETTE.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`md-swatch md-swatch-hl ${active.highlight === c.id ? "active" : ""}`}
            style={{ "--swatch-color": c.swatch }}
            title={
              isZh
                ? c.id === "yellow"
                  ? `${c.zh} (==文字==)`
                  : `${c.zh} ({bg:${c.id}}文字{/bg})`
                : c.id === "yellow"
                  ? `${c.en} (==text==)`
                  : `${c.en} ({bg:${c.id}}text{/bg})`
            }
            aria-label={isZh ? c.zh : c.en}
            onMouseDown={preventBlur}
            onClick={() => applyAction({ type: "highlight", color: c.id })}
          />
        ))}
        <button
          type="button"
          className="md-swatch md-swatch-clear"
          title={isZh ? "清除局部高亮" : "Clear highlight"}
          aria-label={isZh ? "清除局部高亮" : "Clear highlight"}
          onMouseDown={preventBlur}
          onClick={() => applyAction({ type: "highlight", color: null })}
        >
          ×
        </button>
      </div>

      <div className="md-style-hint">
        {isEditingText
          ? isZh
            ? "已进入编辑：拖选部分文字可单独改色或高亮"
            : "Editing: select any text to style or color it"
          : isZh
            ? "双击选中部分文字可局部改色/高亮"
            : "Double-click & select text for partial color"}
      </div>
    </fieldset>,
    hostEl
  );
}
