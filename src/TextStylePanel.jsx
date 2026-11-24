import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import LiveMarkdownEditor from "./LiveMarkdownEditor";
import {
  CJK_FONTS,
  ensureCjkFontLoaded,
  getCjkFontById,
  getDefaultCjkFontId,
  getElementFontFamilyStr,
  resolveCjkFontId,
  setDefaultCjkFontId,
  unmarkLegacyTextId,
} from "./cjkFonts";
import {
  HIGHLIGHT_COLOR_PALETTE,
  TEXT_COLOR_PALETTE,
  appendMarkdownTableCol,
  appendMarkdownTableRow,
  hasMarkdownTable,
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
import {
  TABLE_CELL_BG_PALETTE,
  TABLE_CELL_TEXT_PALETTE,
  canMergeRange,
  canSplitRange,
  deleteColAt,
  deleteRowAt,
  expandSelectionForMerges,
  getTableSelection,
  insertColAt,
  insertRowAt,
  mergeCells,
  normalizeTableData,
  onTableSelectionChange,
  setTableSelection,
  splitCells,
  tableToMarkdown,
} from "./tableData";

const EMPTY_ACTIVE = {
  block: null,
  bold: false,
  italic: false,
  strike: false,
  code: false,
  color: null,
  highlight: null,
};

function getTargetTextElements(api) {
  if (!api) return [];
  const appState = api.getAppState();
  const elements = api.getSceneElementsIncludingDeleted();
  const byId = new Map(elements.map((el) => [el.id, el]));
  const result = [];
  const seen = new Set();

  const editingId = appState?.editingTextElement?.id;
  if (editingId) {
    const ed = byId.get(editingId);
    if (ed && !ed.isDeleted && ed.type === "text") {
      seen.add(ed.id);
      result.push(ed);
    }
  }

  const selectedIds = appState?.selectedElementIds || {};
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

const BLANK_MD_TABLE = "|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |";
const BLANK_CODE_BLOCK = "```javascript\n\n```";

function getSelectedNativeMdTableOverlay(api, nativeMd) {
  if (!api || !nativeMd) return null;
  const appState = api.getAppState();
  if (
    !appState ||
    appState.viewModeEnabled ||
    appState.editingTextElement ||
    appState.draggingElement ||
    appState.resizingElement ||
    appState.selectionElement
  ) {
    return null;
  }
  const selectedIds = Object.entries(appState.selectedElementIds || {})
    .filter(([, selected]) => Boolean(selected))
    .map(([id]) => id);
  if (selectedIds.length !== 1) return null;

  const elements = api.getSceneElementsIncludingDeleted();
  const el = elements.find((item) => item.id === selectedIds[0]);
  if (!el || el.isDeleted || el.type !== "text") return null;
  if (Math.abs(el.angle || 0) > 0.01) return null;

  const raw = el.originalText ?? el.text ?? "";
  if (!hasMarkdownTable(raw)) return null;

  const zoom = appState.zoom?.value || 1;
  const left = (el.x + (appState.scrollX || 0)) * zoom + (appState.offsetLeft || 0);
  const top = (el.y + (appState.scrollY || 0)) * zoom + (appState.offsetTop || 0);
  const width = (el.width || 0) * zoom;
  const height = (el.height || 0) * zoom;

  if (
    width < 28 ||
    height < 24 ||
    left + width < 0 ||
    top + height < 0 ||
    left > window.innerWidth ||
    top > window.innerHeight
  ) {
    return null;
  }

  return {
    elementId: el.id,
    left,
    top,
    width,
    height,
  };
}

function getSelectedTableElement(api) {
  if (!api) return null;
  const appState = api.getAppState();
  const elements = api.getSceneElementsIncludingDeleted();
  const byId = new Map(elements.map((el) => [el.id, el]));

  const activeEmb = appState?.activeEmbeddable?.element;
  if (activeEmb?.id) {
    const cur = byId.get(activeEmb.id);
    if (
      cur &&
      !cur.isDeleted &&
      (cur.customData?.type === "table" || cur.link?.startsWith("table://"))
    ) {
      return cur;
    }
  }

  const selectedIds = appState?.selectedElementIds || {};
  for (const id of Object.keys(selectedIds)) {
    if (!selectedIds[id]) continue;
    const el = byId.get(id);
    if (
      el &&
      !el.isDeleted &&
      (el.customData?.type === "table" || el.link?.startsWith("table://"))
    ) {
      return el;
    }
  }
  return null;
}

function findPanelColumn() {
  return (
    document.querySelector(".App-menu__left .panelColumn") ||
    document.querySelector(".App-mobile-menu .panelColumn")
  );
}

function findStyleAnchor(panelCol) {
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

function findTablePanelAnchor(panelCol) {
  const range = panelCol.querySelector('input[type="range"]');
  const opacityFs = range?.closest("fieldset");
  if (opacityFs && opacityFs.parentElement === panelCol) {
    return { before: opacityFs };
  }
  return { append: true };
}

function mountHostAtAnchor(panelCol, hostRef, className, anchor) {
  if (!panelCol || !anchor) {
    if (hostRef.current) {
      hostRef.current.remove();
      hostRef.current = null;
    }
    return null;
  }
  let el = hostRef.current;
  if (!el) {
    el = document.createElement("div");
    el.className = className;
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
  return el;
}

export default function TextStylePanel({
  api,
  langCode,
  nativeMd,
  onToggleNativeMd,
  onEnsureNativeMd,
  onUpdateTable,
  readOnly,
}) {
  // 1. Fused Chinese font button inside native .FontPicker__container
  const [cjkBtnHostEl, setCjkBtnHostEl] = useState(null);
  // 2. Native text Markdown style panel
  const [styleHostEl, setStyleHostEl] = useState(null);
  // 3. Table controls panel (when a Table Card is selected/active)
  const [tableHostEl, setTableHostEl] = useState(null);
  const [selectedTableEl, setSelectedTableEl] = useState(null);
  const [tableSel, setTableSel] = useState(() => getTableSelection());
  const [copiedTableMd, setCopiedTableMd] = useState(false);

  const [active, setActive] = useState(EMPTY_ACTIVE);
  const [isEditingText, setIsEditingText] = useState(false);
  const [activeCjkFont, setActiveCjkFont] = useState(() => getDefaultCjkFontId());
  const [cjkPopover, setCjkPopover] = useState(null); // { top, left } | null
  const [mdTableState, setMdTableState] = useState({
    hasTable: false,
    outerBorder: true,
  });
  const [mdTableOverlay, setMdTableOverlay] = useState(null);

  const cjkBtnHostRef = useRef(null);
  const styleHostRef = useRef(null);
  const tableHostRef = useRef(null);
  const popoverRef = useRef(null);
  const lastSelRef = useRef({ start: 0, end: 0 });
  const isZh = langCode === "zh-CN";

  useEffect(() => onTableSelectionChange(setTableSel), []);

  const refreshActiveState = useCallback(() => {
    const tblEl = getSelectedTableElement(api);
    setSelectedTableEl(tblEl);

    const textEls = getTargetTextElements(api);
    if (tblEl) {
      setActiveCjkFont(resolveCjkFontId(tblEl.customData?.cjkFont, tblEl.id));
    } else if (textEls.length > 0) {
      setActiveCjkFont(resolveCjkFontId(textEls[0].customData?.cjkFont, textEls[0].id));
    } else {
      setActiveCjkFont(getDefaultCjkFontId());
    }

    const ta = document.querySelector("textarea.excalidraw-wysiwyg");
    if (ta) {
      const liveEd = globalThis.__EXCALIDRAW_LIVE_EDITOR__;
      setIsEditingText(true);
      if (liveEd) {
        const md = liveEd.getMarkdown();
        setActive(liveEd.getActiveFormats());
        setMdTableState({
          hasTable: hasMarkdownTable(md),
          outerBorder:
            textEls.length > 0
              ? textEls[0].customData?.tableOuterBorder !== false
              : true,
        });
      } else {
        const start = ta.selectionStart ?? 0;
        const end = ta.selectionEnd ?? start;
        lastSelRef.current = { start, end };
        setActive(detectActiveFormats(ta.value, start, end));
        setMdTableState({
          hasTable: hasMarkdownTable(ta.value),
          outerBorder:
            textEls.length > 0
              ? textEls[0].customData?.tableOuterBorder !== false
              : true,
        });
      }
      setMdTableOverlay(null);
      return;
    }
    setIsEditingText(false);
    if (textEls.length > 0) {
      const raw = textEls[0].originalText ?? textEls[0].text ?? "";
      setActive(detectActiveFormats(raw, 0, raw.length));
      const anyTable = textEls.some((el) =>
        hasMarkdownTable(el.originalText ?? el.text ?? "")
      );
      setMdTableState({
        hasTable: anyTable,
        outerBorder: textEls[0].customData?.tableOuterBorder !== false,
      });
    } else {
      setActive(EMPTY_ACTIVE);
      setMdTableState({ hasTable: false, outerBorder: true });
    }
    setMdTableOverlay(
      readOnly ? null : getSelectedNativeMdTableOverlay(api, nativeMd)
    );
  }, [api, nativeMd, readOnly]);

  const syncPortalHosts = useCallback(() => {
    if (readOnly) {
      cjkBtnHostRef.current?.remove();
      cjkBtnHostRef.current = null;
      styleHostRef.current?.remove();
      styleHostRef.current = null;
      tableHostRef.current?.remove();
      tableHostRef.current = null;
      setCjkBtnHostEl(null);
      setStyleHostEl(null);
      setTableHostEl(null);
      return;
    }

    const panelCol = findPanelColumn();
    if (!panelCol) {
      cjkBtnHostRef.current?.remove();
      cjkBtnHostRef.current = null;
      styleHostRef.current?.remove();
      styleHostRef.current = null;
      tableHostRef.current?.remove();
      tableHostRef.current = null;
      setCjkBtnHostEl(null);
      setStyleHostEl(null);
      setTableHostEl(null);
      return;
    }

    // 1. Mount compact Chinese font button directly inside Excalidraw's .FontPicker__container
    const fontContainer = panelCol.querySelector(".FontPicker__container");
    if (fontContainer) {
      let btnHost = cjkBtnHostRef.current;
      if (!btnHost) {
        btnHost = document.createElement("div");
        btnHost.className = "md-cjk-btn-host";
        cjkBtnHostRef.current = btnHost;
      }
      if (btnHost.parentElement !== fontContainer) {
        fontContainer.appendChild(btnHost);
      }
      setCjkBtnHostEl((prev) => (prev === btnHost ? prev : btnHost));
    } else {
      cjkBtnHostRef.current?.remove();
      cjkBtnHostRef.current = null;
      setCjkBtnHostEl(null);
    }

    // 2. Mount native text style panel (only when text controls or wysiwyg exist)
    const nextStyle = mountHostAtAnchor(
      panelCol,
      styleHostRef,
      "md-style-panel-host",
      findStyleAnchor(panelCol)
    );
    setStyleHostEl((prev) => (prev === nextStyle ? prev : nextStyle));

    // 3. Mount Table style & structure panel when a Table Card is selected/active
    const tblEl = getSelectedTableElement(api);
    setSelectedTableEl(tblEl);
    const nextTable = mountHostAtAnchor(
      panelCol,
      tableHostRef,
      "md-table-panel-host",
      tblEl ? findTablePanelAnchor(panelCol) : null
    );
    setTableHostEl((prev) => (prev === nextTable ? prev : nextTable));
  }, [api, readOnly]);

  useEffect(() => {
    syncPortalHosts();
    let rafId = 0;
    const scheduleSync = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        syncPortalHosts();
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
    const unsubScroll = api?.onScrollChange?.(() => {
      setMdTableOverlay(
        readOnly ? null : getSelectedNativeMdTableOverlay(api, nativeMd)
      );
    });
    const onResize = () => {
      setMdTableOverlay(
        readOnly ? null : getSelectedNativeMdTableOverlay(api, nativeMd)
      );
    };
    window.addEventListener("resize", onResize);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
      document.removeEventListener("selectionchange", onSelEvent);
      document.removeEventListener("keyup", onSelEvent, true);
      document.removeEventListener("mouseup", onSelEvent, true);
      document.removeEventListener("input", onSelEvent, true);
      document.removeEventListener("focusin", scheduleSync, true);
      window.removeEventListener("resize", onResize);
      unsubApi?.();
      unsubScroll?.();
      cjkBtnHostRef.current?.remove();
      cjkBtnHostRef.current = null;
      styleHostRef.current?.remove();
      styleHostRef.current = null;
      tableHostRef.current?.remove();
      tableHostRef.current = null;
    };
  }, [api, nativeMd, readOnly, syncPortalHosts, refreshActiveState]);

  // Close floating Chinese font popover on outside click or Escape
  useEffect(() => {
    if (!cjkPopover) return;
    for (const f of CJK_FONTS) {
      if (f.cssUrl) ensureCjkFontLoaded(f.id, f.zh);
    }
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target)) return;
      if (e.target.closest?.(".md-cjk-inline-btn, .md-cjk-table-trigger")) return;
      setCjkPopover(null);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setCjkPopover(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [cjkPopover]);

  const toggleCjkPopover = useCallback((triggerEl) => {
    setCjkPopover((prev) => {
      if (prev) return null;
      const panel = document.querySelector(".App-menu__left") || triggerEl;
      const panelRect = panel?.getBoundingClientRect();
      const trigRect = triggerEl?.getBoundingClientRect();
      const left = Math.min(
        window.innerWidth - 236,
        (panelRect ? panelRect.right : trigRect?.right || 200) + 10
      );
      const top = Math.max(
        56,
        Math.min(window.innerHeight - 380, (trigRect?.top || 140) - 24)
      );
      return { top, left };
    });
  }, []);

  const applyCjkFont = useCallback(
    (fontId) => {
      if (readOnly) return;
      setDefaultCjkFontId(fontId);
      setActiveCjkFont(fontId);

      if (!api) {
        ensureCjkFontLoaded(fontId);
        return;
      }

      // Case 1: Selected Table Card
      const tblEl = getSelectedTableElement(api);
      if (tblEl) {
        const allElements = api.getSceneElementsIncludingDeleted();
        let updatedCard = null;
        const nextElements = allElements.map((el) => {
          if (el.id !== tblEl.id) return el;
          updatedCard = {
            ...el,
            version: (el.version || 0) + 1,
            versionNonce: Math.floor(Math.random() * 2147483647),
            updated: Date.now(),
            customData: { ...(el.customData || {}), cjkFont: fontId },
          };
          return updatedCard;
        });
        if (updatedCard) {
          const curAppState = api.getAppState();
          const keepActive =
            curAppState.activeEmbeddable?.element?.id === tblEl.id &&
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
        ensureCjkFontLoaded(fontId).then(() => api.refresh?.());
        return;
      }

      // Case 2: Text element(s) or shape-bound text
      const targetTextEls = getTargetTextElements(api);
      const sampleText =
        targetTextEls.map((el) => el.text || el.originalText || "").join("") ||
        "中文手写字体预览";

      if (targetTextEls.length === 0) {
        ensureCjkFontLoaded(fontId, sampleText);
        return;
      }

      const targetIds = new Set(targetTextEls.map((el) => el.id));
      const allElements = api.getSceneElementsIncludingDeleted();
      const byId = new Map(allElements.map((el) => [el.id, el]));
      const touchedContainers = new Set();

      const nextElements = allElements.map((el) => {
        if (!targetIds.has(el.id) || el.isDeleted) return el;
        unmarkLegacyTextId(el.id);
        const updatedEl = {
          ...el,
          customData: { ...(el.customData || {}), cjkFont: fontId },
        };
        const fontFamilyStr = getElementFontFamilyStr(updatedEl);
        const measured = measureNativeTextBox(
          updatedEl.text ?? updatedEl.originalText ?? "",
          updatedEl.fontSize || 20,
          fontFamilyStr,
          updatedEl.lineHeight || 1.25
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
          if (el.verticalAlign === "top") nextY = container.y + pad;
          else if (el.verticalAlign === "bottom") nextY = container.y + container.height - nextH - pad;
          else nextY = container.y + (container.height - nextH) / 2;
        } else {
          if (el.textAlign === "center") nextX = el.x + (el.width - nextW) / 2;
          else if (el.textAlign === "right") nextX = el.x + (el.width - nextW);
        }

        return {
          ...updatedEl,
          x: nextX,
          y: nextY,
          width: nextW,
          height: nextH,
          version: (el.version || 0) + 1,
          versionNonce: Math.floor(Math.random() * 2147483647),
          updated: Date.now(),
        };
      });

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

      const ta = document.querySelector("textarea.excalidraw-wysiwyg");
      if (ta && targetTextEls[0]) {
        const updatedFirst = finalElements.find((el) => el.id === targetTextEls[0].id);
        if (updatedFirst) {
          ta.style.fontFamily = getElementFontFamilyStr(updatedFirst);
        }
      }

      ensureCjkFontLoaded(fontId, sampleText).then(() => {
        api.refresh?.();
      });
    },
    [api, readOnly]
  );

  // ===== Native Text Box Formatting =====
  const applyTextAction = useCallback(
    (action) => {
      if (readOnly) return;
      if (action.type !== "clear" && !nativeMd) {
        onEnsureNativeMd?.();
      }

      const liveEd = globalThis.__EXCALIDRAW_LIVE_EDITOR__;
      if (liveEd && nativeMd) {
        liveEd.applyAction(action);
        requestAnimationFrame(refreshActiveState);
        return;
      }

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
        if (action.type === "insert-codeblock") {
          const tpl = BLANK_CODE_BLOCK;
          const before = ta.value.slice(0, clampedStart);
          const after = ta.value.slice(clampedEnd);
          const prefixNl = before && !before.endsWith("\n") ? "\n" : "";
          const suffixNl = after && !after.startsWith("\n") ? "\n" : "";
          const inserted = `${prefixNl}${tpl}${suffixNl}`;
          const caret = clampedStart + prefixNl.length + "```javascript\n".length;
          res = {
            text: before + inserted + after,
            start: caret,
            end: caret,
          };
        } else if (action.type === "insert-md-table") {
          const tpl = BLANK_MD_TABLE;
          const before = ta.value.slice(0, clampedStart);
          const after = ta.value.slice(clampedEnd);
          const prefixNl = before && !before.endsWith("\n") ? "\n" : "";
          const suffixNl = after && !after.startsWith("\n") ? "\n" : "";
          const inserted = `${prefixNl}${tpl}${suffixNl}`;
          res = {
            text: before + inserted + after,
            start: clampedStart + prefixNl.length + 2,
            end: clampedStart + prefixNl.length + 2,
          };
        } else if (action.type === "md-table-add-row") {
          const next = appendMarkdownTableRow(ta.value);
          res = { text: next, start: next.length, end: next.length };
        } else if (action.type === "md-table-add-col") {
          const next = appendMarkdownTableCol(ta.value);
          res = { text: next, start: next.length, end: next.length };
        } else if (action.type === "block") {
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

      if (!api) return;
      const targetTextEls = getTargetTextElements(api);
      if (targetTextEls.length === 0) return;

      const targetIds = new Set(targetTextEls.map((el) => el.id));
      const allElements = api.getSceneElementsIncludingDeleted();
      const byId = new Map(allElements.map((el) => [el.id, el]));
      const touchedContainers = new Set();
      let changed = false;

      const nextElements = allElements.map((el) => {
        if (!targetIds.has(el.id) || el.isDeleted) return el;
        const currentRaw = el.originalText ?? el.text ?? "";
        let nextRaw;
        if (action.type === "insert-codeblock") {
          nextRaw = currentRaw.trim()
            ? `${currentRaw}\n${BLANK_CODE_BLOCK}`
            : BLANK_CODE_BLOCK;
        } else if (action.type === "insert-md-table") {
          nextRaw = currentRaw.trim()
            ? `${currentRaw}\n${BLANK_MD_TABLE}`
            : BLANK_MD_TABLE;
        } else if (action.type === "md-table-add-row") {
          nextRaw = appendMarkdownTableRow(currentRaw);
        } else if (action.type === "md-table-add-col") {
          nextRaw = appendMarkdownTableCol(currentRaw);
        } else {
          nextRaw = applyFormatToWholeText(currentRaw, action);
        }
        if (nextRaw === currentRaw) return el;

        changed = true;
        const fontFamilyStr = getElementFontFamilyStr(el);
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
          if (el.verticalAlign === "top") nextY = container.y + pad;
          else if (el.verticalAlign === "bottom") nextY = container.y + container.height - nextH - pad;
          else nextY = container.y + (container.height - nextH) / 2;
        } else {
          if (el.textAlign === "center") nextX = el.x + (el.width - nextW) / 2;
          else if (el.textAlign === "right") nextX = el.x + (el.width - nextW);
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
      refreshActiveState();
      requestAnimationFrame(refreshActiveState);
    },
    [api, nativeMd, onEnsureNativeMd, readOnly, refreshActiveState]
  );

  const toggleNativeMdTableOuterBorder = useCallback(() => {
    if (readOnly || !api) return;
    const targetTextEls = getTargetTextElements(api);
    if (targetTextEls.length === 0) return;
    const nextOuter = targetTextEls[0].customData?.tableOuterBorder === false;
    const targetIds = new Set(targetTextEls.map((el) => el.id));
    const allElements = api.getSceneElementsIncludingDeleted();
    const nextElements = allElements.map((el) => {
      if (!targetIds.has(el.id) || el.isDeleted) return el;
      return {
        ...el,
        customData: { ...(el.customData || {}), tableOuterBorder: nextOuter },
        version: (el.version || 0) + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
        updated: Date.now(),
      };
    });
    api.updateScene({ elements: nextElements });
    api.refresh?.();
    globalThis.__EXCALIDRAW_LIVE_EDITOR__?.setTableOuterBorder?.(nextOuter);
    setMdTableState((prev) => ({ ...prev, outerBorder: nextOuter }));
    requestAnimationFrame(refreshActiveState);
  }, [api, readOnly, refreshActiveState]);

  // ===== Table Panel Actions (act on selected Table Card & its active range) =====
  const activeTable = selectedTableEl
    ? normalizeTableData(selectedTableEl.customData?.table)
    : null;
  const currentRange =
    activeTable && tableSel?.elementId === selectedTableEl?.id && tableSel?.range
      ? expandSelectionForMerges(activeTable, tableSel.range)
      : activeTable
        ? { r1: 0, c1: 0, r2: 0, c2: 0 }
        : null;

  const commitTable = useCallback(
    (nextTable, nextRange) => {
      if (!selectedTableEl || !onUpdateTable) return;
      onUpdateTable(selectedTableEl.id, nextTable);
      if (nextRange !== undefined) {
        setTableSelection({
          elementId: selectedTableEl.id,
          range: nextRange,
          editingCell: null,
        });
      }
      refreshActiveState();
      requestAnimationFrame(refreshActiveState);
    },
    [selectedTableEl, onUpdateTable, refreshActiveState]
  );

  const patchSelectedTableCells = useCallback(
    (patchOrFn) => {
      if (!activeTable || !currentRange) return;
      const nextRows = activeTable.rows.map((row, ri) =>
        row.map((cell, ci) => {
          if (
            ri >= currentRange.r1 &&
            ri <= currentRange.r2 &&
            ci >= currentRange.c1 &&
            ci <= currentRange.c2 &&
            !cell.mergedInto
          ) {
            const patch =
              typeof patchOrFn === "function" ? patchOrFn(cell) : patchOrFn;
            return { ...cell, ...patch };
          }
          return cell;
        })
      );
      commitTable({ ...activeTable, rows: nextRows });
    },
    [activeTable, currentRange, commitTable]
  );

  const applyTableCellMarkdown = useCallback(
    (action) => {
      if (!activeTable || !currentRange) return;

      // If user is actively editing a live WYSIWYG table cell, apply directly to its DOM selection!
      const liveCell = globalThis.__EXCALIDRAW_LIVE_CELL_EDITOR__;
      if (liveCell && tableSel?.editingCell) {
        liveCell.applyAction(action);
        return;
      }

      // Fallback for raw textarea if present
      const cellTa = document.querySelector("textarea.tbl-cell-editor");
      if (cellTa && tableSel?.editingCell) {
        const s = cellTa.selectionStart ?? 0;
        const e = cellTa.selectionEnd ?? s;
        let res;
        if (action.type === "inline") res = applyInlineFormat(cellTa.value, s, e, action.kind);
        else if (action.type === "color") res = applyInlineColor(cellTa.value, s, e, action.color);
        else if (action.type === "highlight") res = applyInlineHighlight(cellTa.value, s, e, action.color);
        else if (action.type === "clear") res = clearMarkdownFormatting(cellTa.value, s, e);
        else if (action.type === "block") res = applyBlockFormat(cellTa.value, s, e, action.kind);
        if (!res) return;

        const { r, c } = tableSel.editingCell;
        const nextRows = activeTable.rows.map((row, ri) =>
          ri !== r
            ? row
            : row.map((cell, ci) => (ci !== c ? cell : { ...cell, text: res.text }))
        );
        commitTable({ ...activeTable, rows: nextRows });
        requestAnimationFrame(() => {
          const curTa = document.querySelector("textarea.tbl-cell-editor");
          if (curTa) {
            curTa.focus();
            curTa.setSelectionRange(res.start, res.end);
          }
        });
        return;
      }

      // Otherwise apply to all selected anchor cells' text
      patchSelectedTableCells((cell) => ({
        text: applyFormatToWholeText(cell.text, action),
      }));
    },
    [activeTable, currentRange, tableSel, commitTable, patchSelectedTableCells]
  );

  // Rich-text keyboard shortcuts inside native Excalidraw wysiwyg textarea
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
        applyTextAction({ type: "inline", kind: "bold" });
      } else if (!e.shiftKey && key === "i") {
        e.preventDefault();
        e.stopPropagation();
        applyTextAction({ type: "inline", kind: "italic" });
      } else if (!e.shiftKey && key === "e") {
        e.preventDefault();
        e.stopPropagation();
        applyTextAction({ type: "inline", kind: "code" });
      } else if (e.shiftKey && key === "x") {
        e.preventDefault();
        e.stopPropagation();
        applyTextAction({ type: "inline", kind: "strike" });
      } else if (e.shiftKey && key === "h") {
        e.preventDefault();
        e.stopPropagation();
        applyTextAction({ type: "highlight", color: "yellow" });
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [readOnly, applyTextAction]);

  if (readOnly) return null;

  const preventBlur = (e) => {
    e.preventDefault();
  };

  const currentCjkObj = getCjkFontById(activeCjkFont);
  const standardFonts = CJK_FONTS.filter((f) => f.group === "standard");
  const handwritingFonts = CJK_FONTS.filter((f) => f.group === "handwriting");
  const isDarkTheme = api?.getAppState()?.theme === "dark";

  const canMerge = activeTable && currentRange ? canMergeRange(activeTable, currentRange) : false;
  const canSplit = activeTable && currentRange ? canSplitRange(activeTable, currentRange) : false;
  const anchorCell =
    activeTable && currentRange
      ? activeTable.rows[currentRange.r1]?.[currentRange.c1]
      : null;
  const activeColAlign =
    activeTable && currentRange
      ? activeTable.colAligns[currentRange.c1] || "left"
      : "left";

  return (
    <>
      {/* 0. Real-time WYSIWYG Markdown & Table Editor overlaying Excalidraw's wysiwyg textarea */}
      <LiveMarkdownEditor
        api={api}
        nativeMd={nativeMd}
        readOnly={readOnly}
        langCode={langCode}
        onFormatsChange={(fmts, md) => {
          setActive(fmts);
          setMdTableState((prev) => ({
            ...prev,
            hasTable: hasMarkdownTable(md),
          }));
        }}
      />

      {/* 1. Compact Chinese font toggle button fused right inside Excalidraw's native Font row */}
      {cjkBtnHostEl &&
        createPortal(
          <button
            type="button"
            className={`properties-trigger md-cjk-inline-btn ${
              cjkPopover ? "active" : ""
            } ${activeCjkFont !== "lxgw-wenkai" ? "has-custom" : ""}`}
            title={
              isZh
                ? `中文字体：${currentCjkObj.zh}（点击切换，与英文字体独立）`
                : `Chinese font: ${currentCjkObj.en} (independent from Latin font)`
            }
            aria-label={isZh ? "切换中文字体" : "Switch Chinese font"}
            aria-expanded={Boolean(cjkPopover)}
            onMouseDown={preventBlur}
            onClick={(e) => toggleCjkPopover(e.currentTarget)}
          >
            <span>中</span>
          </button>,
          cjkBtnHostEl
        )}

      {/* Floating Chinese Font Popover (anchored beside left panel, zero vertical clutter) */}
      {cjkPopover &&
        createPortal(
          <div
            ref={popoverRef}
            className={`Island properties-content md-cjk-popover ${
              isDarkTheme ? "is-dark" : ""
            }`}
            style={{ top: `${cjkPopover.top}px`, left: `${cjkPopover.left}px` }}
            role="listbox"
            aria-label={isZh ? "选择中文字体" : "Choose Chinese font"}
            onMouseDown={preventBlur}
          >
            <div className="md-cjk-pop-head">
              <span>{isZh ? "中文字体" : "Chinese font"}</span>
              <span className="md-cjk-pop-sub">
                {isZh ? "与英文字体独立" : "Independent CJK"}
              </span>
            </div>

            <div className="md-cjk-pop-scroll">
              <div className="md-cjk-group-label">
                {isZh ? "常用中文字体" : "Standard"}
              </div>
              {standardFonts.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="option"
                  aria-selected={activeCjkFont === f.id}
                  className={`md-cjk-option ${activeCjkFont === f.id ? "active" : ""}`}
                  onMouseDown={preventBlur}
                  onClick={() => {
                    applyCjkFont(f.id);
                    setCjkPopover(null);
                  }}
                >
                  <span className="md-cjk-opt-name" style={{ fontFamily: f.stack }}>
                    {isZh ? f.zh : f.en}
                  </span>
                  <span className="md-cjk-opt-tag">
                    {isZh ? f.tagZh : f.tagEn}
                  </span>
                </button>
              ))}

              <div className="md-cjk-group-label">
                {isZh ? "中文手写体" : "Handwriting"}
              </div>
              {handwritingFonts.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="option"
                  aria-selected={activeCjkFont === f.id}
                  className={`md-cjk-option ${activeCjkFont === f.id ? "active" : ""}`}
                  onMouseDown={preventBlur}
                  onClick={() => {
                    applyCjkFont(f.id);
                    setCjkPopover(null);
                  }}
                >
                  <span className="md-cjk-opt-name" style={{ fontFamily: f.stack }}>
                    {isZh ? f.zh : f.en}
                  </span>
                  <span className="md-cjk-opt-tag">
                    {isZh ? f.tagZh : f.tagEn}
                  </span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}

      {/* 2. Native Text Box Markdown & Rich-Text Controls */}
      {styleHostEl &&
        createPortal(
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

            <div className="md-style-btn-grid">
              <button
                type="button"
                className={`md-style-btn ${active.block === "h1" ? "active" : ""}`}
                title={isZh ? "一级标题 (# )" : "Heading 1 (# )"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "block", kind: "h1" })}
              >
                H1
              </button>
              <button
                type="button"
                className={`md-style-btn ${active.block === "h2" ? "active" : ""}`}
                title={isZh ? "二级标题 (## )" : "Heading 2 (## )"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "block", kind: "h2" })}
              >
                H2
              </button>
              <button
                type="button"
                className={`md-style-btn ${active.block === "h3" ? "active" : ""}`}
                title={isZh ? "三级标题 (### )" : "Heading 3 (### )"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "block", kind: "h3" })}
              >
                H3
              </button>
              <button
                type="button"
                className={`md-style-btn ${active.block === "bullet" ? "active" : ""}`}
                title={isZh ? "无序列表 (- )" : "Bullet list (- )"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "block", kind: "bullet" })}
              >
                •
              </button>
              <button
                type="button"
                className={`md-style-btn ${active.block === "task" ? "active" : ""}`}
                title={isZh ? "待办清单 (- [ ] )" : "Checklist (- [ ] )"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "block", kind: "task" })}
              >
                ☑
              </button>
              <button
                type="button"
                className={`md-style-btn ${active.block === "quote" ? "active" : ""}`}
                title={isZh ? "引用 (> )" : "Quote (> )"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "block", kind: "quote" })}
              >
                ”
              </button>
            </div>

            <div className="md-style-btn-grid">
              <button
                type="button"
                className={`md-style-btn ${active.bold ? "active" : ""}`}
                title={isZh ? "加粗 **文字** (Ctrl+B)" : "Bold **text** (Ctrl+B)"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "inline", kind: "bold" })}
              >
                <strong>B</strong>
              </button>
              <button
                type="button"
                className={`md-style-btn ${active.italic ? "active" : ""}`}
                title={isZh ? "斜体 *文字* (Ctrl+I)" : "Italic *text* (Ctrl+I)"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "inline", kind: "italic" })}
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
                onClick={() => applyTextAction({ type: "inline", kind: "strike" })}
              >
                <span className="md-strike-icon">S</span>
              </button>
              <button
                type="button"
                className={`md-style-btn md-code-btn ${active.code ? "active" : ""}`}
                title={isZh ? "行内代码 `code` (Ctrl+E)" : "Inline code `code` (Ctrl+E)"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "inline", kind: "code" })}
              >
                {"`c`"}
              </button>
              <button
                type="button"
                className={`md-style-btn ${active.highlight === "yellow" ? "active" : ""}`}
                title={isZh ? "荧光高亮 ==文字== (Ctrl+Shift+H)" : "Highlight ==text== (Ctrl+Shift+H)"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "highlight", color: "yellow" })}
              >
                <span className="md-hl-icon">A</span>
              </button>
              <button
                type="button"
                className="md-style-btn"
                title={isZh ? "清除富文本格式" : "Clear formatting"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "clear" })}
              >
                <span className="md-clear-icon">Tx</span>
              </button>
            </div>

            <div className="md-tbl-grid-2">
              <button
                type="button"
                className="md-style-btn"
                title={isZh ? "插入 Markdown 表格" : "Insert Markdown table"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "insert-md-table" })}
              >
                {isZh ? "⊞ 表格" : "⊞ Table"}
              </button>
              <button
                type="button"
                className="md-style-btn"
                title={isZh ? "插入语法高亮代码块 (```)" : "Insert syntax-highlighted code block (```)"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "insert-codeblock" })}
              >
                {isZh ? "</> 代码块" : "</> Code"}
              </button>
            </div>

            <div className="md-style-sublabel">
              {isZh ? "局部字色" : "Inline text color"}
            </div>
            <div className="md-swatch-row">
              {TEXT_COLOR_PALETTE.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`md-swatch ${active.color === c.id ? "active" : ""}`}
                  style={{ "--swatch-color": c.hex }}
                  title={isZh ? `局部${c.zh}色` : `${c.en} text`}
                  aria-label={isZh ? `局部${c.zh}色` : `${c.en} text`}
                  onMouseDown={preventBlur}
                  onClick={() => applyTextAction({ type: "color", color: c.id })}
                />
              ))}
              <button
                type="button"
                className="md-swatch md-swatch-clear"
                title={isZh ? "清除局部字色" : "Clear text color"}
                aria-label={isZh ? "清除局部字色" : "Clear text color"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "color", color: null })}
              >
                ×
              </button>
            </div>

            <div className="md-style-sublabel">
              {isZh ? "局部高亮" : "Inline highlight"}
            </div>
            <div className="md-swatch-row">
              {HIGHLIGHT_COLOR_PALETTE.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`md-swatch md-swatch-hl ${active.highlight === c.id ? "active" : ""}`}
                  style={{ "--swatch-color": c.swatch }}
                  title={isZh ? c.zh : c.en}
                  aria-label={isZh ? c.zh : c.en}
                  onMouseDown={preventBlur}
                  onClick={() => applyTextAction({ type: "highlight", color: c.id })}
                />
              ))}
              <button
                type="button"
                className="md-swatch md-swatch-clear"
                title={isZh ? "清除局部高亮" : "Clear highlight"}
                aria-label={isZh ? "清除局部高亮" : "Clear highlight"}
                onMouseDown={preventBlur}
                onClick={() => applyTextAction({ type: "highlight", color: null })}
              >
                ×
              </button>
            </div>

            {mdTableState.hasTable && (
              <>
                <div className="md-style-sublabel">
                  {isZh ? "Markdown 表格" : "Markdown table"}
                </div>
                <div className="md-tbl-grid-3">
                  <button
                    type="button"
                    className={`md-style-btn ${mdTableState.outerBorder ? "active" : ""}`}
                    title={
                      isZh
                        ? "显示或隐藏表格最外圈边框线"
                        : "Show or hide outer table border"
                    }
                    onMouseDown={preventBlur}
                    onClick={toggleNativeMdTableOuterBorder}
                  >
                    {isZh ? "外框" : "Border"}
                  </button>
                  <button
                    type="button"
                    className="md-style-btn"
                    title={isZh ? "表格底部加一行" : "Add row to table"}
                    onMouseDown={preventBlur}
                    onClick={() => applyTextAction({ type: "md-table-add-row" })}
                  >
                    {isZh ? "+行" : "+Row"}
                  </button>
                  <button
                    type="button"
                    className="md-style-btn"
                    title={isZh ? "表格右侧加一列" : "Add column to table"}
                    onMouseDown={preventBlur}
                    onClick={() => applyTextAction({ type: "md-table-add-col" })}
                  >
                    {isZh ? "+列" : "+Col"}
                  </button>
                </div>
              </>
            )}

            {isEditingText && (
              <div className="md-style-hint">
                {isZh ? "拖选部分文字可单独改色/高亮" : "Select text to color or highlight"}
              </div>
            )}
          </fieldset>,
          styleHostEl
        )}

      {/* 3. Left-Panel Table Structure, Merge/Split & Cell Styling (replaces bulky card toolbar!) */}
      {tableHostEl &&
        activeTable &&
        currentRange &&
        createPortal(
          <fieldset className="md-style-panel md-table-panel">
            <legend className="md-style-legend">
              <span>
                {isZh ? "表格" : "Table"}{" "}
                <small className="md-tbl-dim">
                  {activeTable.rows.length}×{activeTable.colWidths.length}
                </small>
              </span>
              <button
                type="button"
                className="md-style-switch"
                title={isZh ? "复制为 Markdown 表格" : "Copy as Markdown table"}
                onMouseDown={preventBlur}
                onClick={async () => {
                  const md = tableToMarkdown(activeTable);
                  try {
                    await navigator.clipboard.writeText(md);
                  } catch {}
                  setCopiedTableMd(true);
                  setTimeout(() => setCopiedTableMd(false), 1600);
                }}
              >
                {copiedTableMd ? (isZh ? "已复制" : "Copied") : "MD"}
              </button>
            </legend>

            {/* Row / Column Structure */}
            <div className="md-tbl-grid-4">
              <button
                type="button"
                className="md-style-btn"
                title={isZh ? "在下方插入行" : "Insert row below"}
                onMouseDown={preventBlur}
                onClick={() => {
                  const next = insertRowAt(activeTable, currentRange.r2 + 1);
                  commitTable(next, {
                    r1: currentRange.r2 + 1,
                    c1: currentRange.c1,
                    r2: currentRange.r2 + 1,
                    c2: currentRange.c1,
                  });
                }}
              >
                {isZh ? "+行" : "+Row"}
              </button>
              <button
                type="button"
                className="md-style-btn md-btn-danger"
                disabled={activeTable.rows.length <= 1}
                title={isZh ? "删除当前行" : "Delete current row"}
                onMouseDown={preventBlur}
                onClick={() => {
                  const next = deleteRowAt(activeTable, currentRange.r1);
                  const r = Math.min(currentRange.r1, next.rows.length - 1);
                  commitTable(next, { r1: r, c1: currentRange.c1, r2: r, c2: currentRange.c1 });
                }}
              >
                {isZh ? "-行" : "-Row"}
              </button>
              <button
                type="button"
                className="md-style-btn"
                title={isZh ? "在右侧插入列" : "Insert column right"}
                onMouseDown={preventBlur}
                onClick={() => {
                  const colIdx = currentRange.c2 + 1;
                  const next = insertColAt(activeTable, colIdx, "");
                  commitTable(next, {
                    r1: currentRange.r1,
                    c1: colIdx,
                    r2: currentRange.r1,
                    c2: colIdx,
                  });
                }}
              >
                {isZh ? "+列" : "+Col"}
              </button>
              <button
                type="button"
                className="md-style-btn md-btn-danger"
                disabled={activeTable.colWidths.length <= 1}
                title={isZh ? "删除当前列" : "Delete current column"}
                onMouseDown={preventBlur}
                onClick={() => {
                  const next = deleteColAt(activeTable, currentRange.c1);
                  const c = Math.min(currentRange.c1, next.colWidths.length - 1);
                  commitTable(next, { r1: currentRange.r1, c1: c, r2: currentRange.r1, c2: c });
                }}
              >
                {isZh ? "-列" : "-Col"}
              </button>
            </div>

            {/* Merge / Split Cells (Feishu-style) */}
            <div className="md-tbl-grid-2">
              <button
                type="button"
                className={`md-style-btn ${canMerge ? "md-btn-accent" : ""}`}
                disabled={!canMerge}
                title={
                  isZh
                    ? "合并框选的多个单元格 (Ctrl+Shift+M)"
                    : "Merge selected cells (Ctrl+Shift+M)"
                }
                onMouseDown={preventBlur}
                onClick={() => {
                  const next = mergeCells(activeTable, currentRange);
                  commitTable(next, {
                    r1: currentRange.r1,
                    c1: currentRange.c1,
                    r2: currentRange.r1,
                    c2: currentRange.c1,
                  });
                }}
              >
                {isZh ? "合并单元格" : "Merge"}
              </button>
              <button
                type="button"
                className={`md-style-btn ${canSplit ? "md-btn-accent" : ""}`}
                disabled={!canSplit}
                title={
                  isZh
                    ? "拆分已合并的单元格 (Ctrl+Shift+M)"
                    : "Split merged cell (Ctrl+Shift+M)"
                }
                onMouseDown={preventBlur}
                onClick={() => {
                  const next = splitCells(activeTable, currentRange);
                  commitTable(next, currentRange);
                }}
              >
                {isZh ? "拆分单元格" : "Split"}
              </button>
            </div>

            {/* Outer Border / Header / Stripe */}
            <div className="md-tbl-grid-3">
              <button
                type="button"
                className={`md-style-btn ${activeTable.outerBorder !== false ? "active" : ""}`}
                title={
                  isZh
                    ? "显示或隐藏表格最外圈边框线"
                    : "Show or hide outer table border"
                }
                onMouseDown={preventBlur}
                onClick={() =>
                  commitTable({
                    ...activeTable,
                    outerBorder: activeTable.outerBorder === false,
                  })
                }
              >
                {isZh ? "外框" : "Border"}
              </button>
              <button
                type="button"
                className={`md-style-btn ${activeTable.headerRow ? "active" : ""}`}
                title={isZh ? "首行作为表头" : "Header row"}
                onMouseDown={preventBlur}
                onClick={() =>
                  commitTable({ ...activeTable, headerRow: !activeTable.headerRow })
                }
              >
                {isZh ? "表头" : "Head"}
              </button>
              <button
                type="button"
                className={`md-style-btn ${activeTable.striped ? "active" : ""}`}
                title={isZh ? "隔行斑马纹" : "Striped rows"}
                onMouseDown={preventBlur}
                onClick={() =>
                  commitTable({ ...activeTable, striped: !activeTable.striped })
                }
              >
                {isZh ? "斑马" : "Alt"}
              </button>
            </div>

            {/* Column Alignment */}
            <div className="md-tbl-grid-3">
              {[
                { id: "left", zh: "左对齐", en: "Left" },
                { id: "center", zh: "居中", en: "Center" },
                { id: "right", zh: "右对齐", en: "Right" },
              ].map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`md-style-btn ${activeColAlign === a.id ? "active" : ""}`}
                  title={isZh ? `列${a.zh}` : `Align ${a.id}`}
                  onMouseDown={preventBlur}
                  onClick={() => {
                    const nextAligns = activeTable.colAligns.map((cur, ci) =>
                      ci >= currentRange.c1 && ci <= currentRange.c2 ? a.id : cur
                    );
                    commitTable({ ...activeTable, colAligns: nextAligns });
                  }}
                >
                  {isZh ? a.zh : a.en}
                </button>
              ))}
            </div>

            {/* Table Chinese Font */}
            <button
              type="button"
              className="properties-trigger md-cjk-table-trigger"
              onMouseDown={preventBlur}
              onClick={(e) => toggleCjkPopover(e.currentTarget)}
            >
              <span>{isZh ? "中文字体" : "CJK font"}</span>
              <span
                className="md-cjk-table-val"
                style={{ fontFamily: currentCjkObj.stack }}
              >
                {isZh ? currentCjkObj.zh : currentCjkObj.en} ▾
              </span>
            </button>

            {/* Cell Markdown Quick Formatting */}
            <div className="md-style-sublabel">
              {isZh ? "单元格 Markdown" : "Cell Markdown"}
            </div>
            <div className="md-style-btn-grid">
              <button
                type="button"
                className="md-style-btn"
                title={isZh ? "加粗 **文字**" : "Bold"}
                onMouseDown={preventBlur}
                onClick={() => applyTableCellMarkdown({ type: "inline", kind: "bold" })}
              >
                <strong>B</strong>
              </button>
              <button
                type="button"
                className="md-style-btn"
                title={isZh ? "斜体 *文字*" : "Italic"}
                onMouseDown={preventBlur}
                onClick={() => applyTableCellMarkdown({ type: "inline", kind: "italic" })}
              >
                <em>I</em>
              </button>
              <button
                type="button"
                className="md-style-btn"
                title={isZh ? "删除线 ~~文字~~" : "Strikethrough"}
                onMouseDown={preventBlur}
                onClick={() => applyTableCellMarkdown({ type: "inline", kind: "strike" })}
              >
                <span className="md-strike-icon">S</span>
              </button>
              <button
                type="button"
                className="md-style-btn md-code-btn"
                title={isZh ? "行内代码 `code`" : "Code"}
                onMouseDown={preventBlur}
                onClick={() => applyTableCellMarkdown({ type: "inline", kind: "code" })}
              >
                {"</>"}
              </button>
              <button
                type="button"
                className="md-style-btn"
                title={isZh ? "荧光高亮 ==文字==" : "Highlight"}
                onMouseDown={preventBlur}
                onClick={() =>
                  applyTableCellMarkdown({ type: "highlight", color: "yellow" })
                }
              >
                <span className="md-hl-icon">A</span>
              </button>
              <button
                type="button"
                className="md-style-btn"
                title={isZh ? "待办清单 - [ ]" : "Checklist"}
                onMouseDown={preventBlur}
                onClick={() => applyTableCellMarkdown({ type: "block", kind: "task" })}
              >
                ☑
              </button>
            </div>

            {/* Cell Fill Color */}
            <div className="md-style-sublabel">
              {isZh ? "单元格底色" : "Cell fill"}
            </div>
            <div className="md-swatch-row md-swatch-row-7">
              {TABLE_CELL_BG_PALETTE.filter((c) => c.id !== null).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`md-swatch ${anchorCell?.bg === c.id ? "active" : ""}`}
                  style={{ "--swatch-color": c.swatch }}
                  title={isZh ? `单元格${c.zh}色底` : `${c.en} fill`}
                  onMouseDown={preventBlur}
                  onClick={() => patchSelectedTableCells({ bg: c.id })}
                />
              ))}
              <button
                type="button"
                className="md-swatch md-swatch-clear"
                title={isZh ? "清除单元格底色" : "Clear fill"}
                onMouseDown={preventBlur}
                onClick={() => patchSelectedTableCells({ bg: null })}
              >
                ×
              </button>
            </div>

            {/* Cell Text Color */}
            <div className="md-style-sublabel">
              {isZh ? "单元格字色" : "Cell text"}
            </div>
            <div className="md-swatch-row md-swatch-row-7">
              {TABLE_CELL_TEXT_PALETTE.filter((c) => c.id !== null).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`md-swatch ${anchorCell?.color === c.id ? "active" : ""}`}
                  style={{ "--swatch-color": c.swatch }}
                  title={isZh ? `单元格${c.zh}字` : `${c.en} text`}
                  onMouseDown={preventBlur}
                  onClick={() => patchSelectedTableCells({ color: c.id })}
                />
              ))}
              <button
                type="button"
                className="md-swatch md-swatch-clear"
                title={isZh ? "清除单元格字色" : "Clear text color"}
                onMouseDown={preventBlur}
                onClick={() => patchSelectedTableCells({ color: null })}
              >
                ×
              </button>
            </div>

            <div className="md-style-hint">
              {isZh
                ? "拖选多格可合并 · 单元格支持完整 Markdown"
                : "Drag cells to merge · Markdown supported"}
            </div>
          </fieldset>,
          tableHostEl
        )}

      {/* 4. Feishu-style bottom '+' & right '+' edge rails for selected Native Markdown Table */}
      {mdTableOverlay &&
        createPortal(
          <>
            <button
              type="button"
              className={`md-tbl-edge-btn is-row ${isDarkTheme ? "is-dark" : ""}`}
              style={{
                left: `${mdTableOverlay.left}px`,
                top: `${mdTableOverlay.top + mdTableOverlay.height + 14}px`,
                width: `${Math.max(44, mdTableOverlay.width)}px`,
              }}
              title={isZh ? "在 Markdown 表格底部添加一行" : "Add row to Markdown table"}
              aria-label={isZh ? "Markdown 表格底部添加行" : "Add row to Markdown table"}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={preventBlur}
              onClick={(e) => {
                e.stopPropagation();
                applyTextAction({ type: "md-table-add-row" });
              }}
            >
              +
            </button>
            <button
              type="button"
              className={`md-tbl-edge-btn is-col ${isDarkTheme ? "is-dark" : ""}`}
              style={{
                left: `${mdTableOverlay.left + mdTableOverlay.width + 14}px`,
                top: `${mdTableOverlay.top}px`,
                height: `${Math.max(36, mdTableOverlay.height)}px`,
              }}
              title={isZh ? "在 Markdown 表格右侧添加一列" : "Add column to Markdown table"}
              aria-label={isZh ? "Markdown 表格右侧添加列" : "Add column to Markdown table"}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={preventBlur}
              onClick={(e) => {
                e.stopPropagation();
                applyTextAction({ type: "md-table-add-col" });
              }}
            >
              +
            </button>
          </>,
          document.body
        )}
    </>
  );
}
