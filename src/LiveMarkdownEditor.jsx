import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  appendColToLiveTable,
  appendRowToLiveTable,
  applyDomRichAction,
  detectActiveDomFormats,
  domToMarkdown,
  getClosestCellEl,
  getClosestLineEl,
  markdownToHtml,
  placeCaretIn,
  setLineBlockType,
  tryLiveMarkdownRule,
} from "./richMarkdownDom";

function getEditingElement(api) {
  if (!api) return null;
  const appState = api.getAppState();
  const id = appState?.editingTextElement?.id;
  if (!id) return null;
  const elements = api.getSceneElementsIncludingDeleted();
  return elements.find((el) => el.id === id && !el.isDeleted) || null;
}

function isCaretAtStartOf(container, range) {
  if (!container || !range || !range.collapsed) return false;
  try {
    const pre = document.createRange();
    pre.setStart(container, 0);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().replace(/\u200B/g, "").length === 0;
  } catch {
    return false;
  }
}

function splitContainerAtRange(container, range) {
  const afterRange = document.createRange();
  afterRange.setStart(range.endContainer, range.endOffset);
  afterRange.selectNodeContents(container);
  afterRange.setStart(range.endContainer, range.endOffset);
  const frag = afterRange.extractContents();
  if (!container.innerHTML || container.innerHTML === "\u200B") {
    container.innerHTML = "<br>";
  }
  return frag;
}

function makeLineDiv(blockKind, indent = 0, fragment = null) {
  const div = document.createElement("div");
  div.className = "md-live-line";
  div.setAttribute("data-block", blockKind);
  if (indent > 0 && (blockKind === "bullet" || blockKind === "task")) {
    div.setAttribute("data-indent", String(indent));
    div.style.paddingLeft = `${indent * 1.1}em`;
  }

  let bodyTarget = div;
  if (blockKind === "bullet") {
    div.classList.add("md-live-bullet");
  } else if (blockKind === "quote") {
    div.classList.add("md-live-quote");
  } else if (blockKind === "task") {
    div.classList.add("md-live-task");
    div.setAttribute("data-checked", "0");
    const chk = document.createElement("span");
    chk.className = "md-live-check";
    chk.setAttribute("contenteditable", "false");
    chk.setAttribute("data-md-check", "1");
    chk.setAttribute("role", "checkbox");
    chk.setAttribute("aria-checked", "false");
    const body = document.createElement("span");
    body.className = "md-live-task-body";
    div.appendChild(chk);
    div.appendChild(body);
    bodyTarget = body;
  }

  if (fragment && fragment.childNodes.length > 0) {
    bodyTarget.appendChild(fragment);
  }
  if (!bodyTarget.textContent?.replace(/\u200B/g, "") && !bodyTarget.querySelector("br")) {
    bodyTarget.innerHTML = "<br>";
  }
  return { lineEl: div, caretTarget: bodyTarget };
}

export default function LiveMarkdownEditor({
  api,
  nativeMd,
  readOnly,
  langCode = "zh-CN",
  onFormatsChange,
}) {
  const isZh = langCode === "zh-CN";
  const [taEl, setTaEl] = useState(null);
  const [mirrorStyle, setMirrorStyle] = useState(null);
  const editorRef = useRef(null);
  const rootRef = useRef(null);
  const composingRef = useRef(false);
  const savedRangeRef = useRef(null);
  const savedExpandedRangeRef = useRef(null);
  const tableOuterBorderRef = useRef(true);
  const taRef = useRef(null);
  const onFormatsChangeRef = useRef(onFormatsChange);
  onFormatsChangeRef.current = onFormatsChange;
  const isZhRef = useRef(isZh);
  isZhRef.current = isZh;
  const apiRef = useRef(api);
  apiRef.current = api;

  // Sync live editor availability flag for Excalidraw wysiwyg hook
  useEffect(() => {
    if (globalThis.__EXCALIDRAW_MD__) {
      globalThis.__EXCALIDRAW_MD__.liveEdit = Boolean(nativeMd && !readOnly);
    }
  }, [nativeMd, readOnly]);

  // Detect textarea.excalidraw-wysiwyg mount / unmount
  useEffect(() => {
    if (!nativeMd || readOnly) {
      setTaEl(null);
      return;
    }

    const scan = () => {
      const found = document.querySelector("textarea.excalidraw-wysiwyg");
      setTaEl((prev) => (prev === found ? prev : found));
    };

    scan();
    const obs = new MutationObserver(scan);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => {
      obs.disconnect();
    };
  }, [nativeMd, readOnly]);

  const computeMirrorStyle = useCallback((ta) => {
    if (!ta) return null;
    const editingEl = getEditingElement(apiRef.current);
    const isBound = Boolean(editingEl?.containerId);
    const st = ta.style;
    return {
      left: st.left || "0px",
      top: st.top || "0px",
      transform: st.transform || "none",
      transformOrigin: st.transformOrigin || "top left",
      fontFamily: st.fontFamily || undefined,
      fontSize: st.fontSize || "20px",
      lineHeight: st.lineHeight || "1.25",
      textAlign: st.textAlign || "left",
      color: st.color || "#1e1e1e",
      opacity: st.opacity || "1",
      filter: st.filter || "var(--theme-filter)",
      minWidth: st.width || "24px",
      minHeight: st.height || "1.25em",
      width: isBound ? st.width : "auto",
      whiteSpace: isBound ? "pre-wrap" : "pre",
      wordBreak: isBound ? "break-word" : "normal",
    };
  }, []);

  const syncToTextarea = useCallback(() => {
    const ta = taRef.current;
    const editor = editorRef.current;
    if (!ta || !editor) return "";
    const md = domToMarkdown(editor);
    if (ta.value !== md) {
      ta.value = md;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return md;
  }, []);

  const commitAndExit = useCallback(() => {
    const ta = taRef.current;
    syncToTextarea();
    if (ta && document.contains(ta)) {
      ta.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        })
      );
    }
  }, [syncToTextarea]);

  const emitFormats = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    onFormatsChangeRef.current?.(detectActiveDomFormats(editor), domToMarkdown(editor));
  }, []);

  // Attach to active textarea ONCE per textarea instance: hide raw textarea, mirror style, hydrate live DOM, focus
  useEffect(() => {
    taRef.current = taEl;
    if (!taEl) {
      setMirrorStyle(null);
      if (globalThis.__EXCALIDRAW_LIVE_EDITOR__) {
        globalThis.__EXCALIDRAW_LIVE_EDITOR__ = null;
      }
      return;
    }

    taEl.classList.add("md-live-hidden-ta");
    setMirrorStyle(computeMirrorStyle(taEl));

    const styleObs = new MutationObserver(() => {
      setMirrorStyle(computeMirrorStyle(taEl));
    });
    styleObs.observe(taEl, { attributes: true, attributeFilter: ["style"] });

    const editingEl = getEditingElement(apiRef.current);
    tableOuterBorderRef.current = editingEl?.customData?.tableOuterBorder !== false;

    // Hydrate editor DOM once when this textarea mounts (never re-hydrate while typing!)
    const rafId = requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.innerHTML = markdownToHtml(taEl.value, {
        tableOuterBorder: tableOuterBorderRef.current,
        isZh: isZhRef.current,
      });
      editor.focus({ preventScroll: true });

      const firstTableCell =
        editor.children.length === 1 &&
        editor.firstElementChild?.getAttribute("data-md-table") === "1"
          ? editor.querySelector("th, td")
          : null;

      if (firstTableCell) {
        placeCaretIn(firstTableCell, false);
      } else {
        const lastLine = editor.querySelector(":scope > .md-live-line:last-of-type");
        const target =
          lastLine?.getAttribute("data-block") === "task"
            ? lastLine.querySelector(".md-live-task-body")
            : lastLine || editor;
        placeCaretIn(target, false);
      }
      emitFormats();
    });

    return () => {
      cancelAnimationFrame(rafId);
      styleObs.disconnect();
      taEl.classList.remove("md-live-hidden-ta");
      if (document.contains(taEl) && !globalThis.__EXCALIDRAW_MD__?.liveEdit) {
        taEl.focus();
      }
    };
  }, [taEl, computeMirrorStyle, emitFormats]);

  // Keep savedRange & last non-collapsed range updated on selectionchange inside editor
  useEffect(() => {
    if (!taEl) return;
    const onSel = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const sel = window.getSelection();
      if (
        sel &&
        sel.rangeCount > 0 &&
        editor.contains(sel.getRangeAt(0).commonAncestorContainer)
      ) {
        const cloned = sel.getRangeAt(0).cloneRange();
        savedRangeRef.current = cloned;
        if (!cloned.collapsed) {
          savedExpandedRangeRef.current = cloned.cloneRange();
        } else if (document.activeElement === editor) {
          // Only clear expanded range when user actively collapsed caret inside the editor
          savedExpandedRangeRef.current = null;
        }
        emitFormats();
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [taEl, emitFormats]);

  // Flush markdown before outside clicks; commit if clicking non-panel chrome
  useEffect(() => {
    if (!taEl) return;
    const onPointerDownCapture = (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (rootRef.current?.contains(target)) return;

      if (
        target.closest(
          ".App-menu__left, .App-mobile-menu, .properties-content, .properties-trigger, .md-cjk-popover, .zoom-actions, .undo-redo-buttons"
        )
      ) {
        // Don't disturb active selection when clicking left-panel style controls
        return;
      }

      // Always flush latest markdown before Excalidraw's own canvas handler runs
      syncToTextarea();

      if (target instanceof HTMLCanvasElement) {
        // Excalidraw's own M handler commits cleanly on canvas click
        return;
      }
      // Clicking other topbar / unrelated UI commits cleanly
      commitAndExit();
    };

    window.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => window.removeEventListener("pointerdown", onPointerDownCapture, true);
  }, [taEl, syncToTextarea, commitAndExit]);

  const applyAction = useCallback(
    (action) => {
      const editor = editorRef.current;
      if (!editor) return false;

      // Capture active selection BEFORE calling editor.focus() so focus changes can't collapse it
      const selBefore = window.getSelection();
      let preferredRange = null;
      if (
        selBefore &&
        selBefore.rangeCount > 0 &&
        editor.contains(selBefore.getRangeAt(0).commonAncestorContainer) &&
        !selBefore.getRangeAt(0).collapsed
      ) {
        preferredRange = selBefore.getRangeAt(0).cloneRange();
      } else if (
        savedExpandedRangeRef.current &&
        editor.contains(savedExpandedRangeRef.current.commonAncestorContainer) &&
        !savedExpandedRangeRef.current.collapsed
      ) {
        preferredRange = savedExpandedRangeRef.current.cloneRange();
      } else if (
        selBefore &&
        selBefore.rangeCount > 0 &&
        editor.contains(selBefore.getRangeAt(0).commonAncestorContainer)
      ) {
        preferredRange = selBefore.getRangeAt(0).cloneRange();
      } else if (
        savedRangeRef.current &&
        editor.contains(savedRangeRef.current.commonAncestorContainer)
      ) {
        preferredRange = savedRangeRef.current.cloneRange();
      }

      editor.focus({ preventScroll: true });
      if (preferredRange) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(preferredRange);
      }

      const changed = applyDomRichAction(editor, action, {
        savedRange: preferredRange,
        tableOuterBorder: tableOuterBorderRef.current,
        isZh,
      });
      if (changed) {
        syncToTextarea();
        const sel = window.getSelection();
        if (
          sel &&
          sel.rangeCount > 0 &&
          editor.contains(sel.getRangeAt(0).commonAncestorContainer)
        ) {
          const nextCloned = sel.getRangeAt(0).cloneRange();
          savedRangeRef.current = nextCloned;
          savedExpandedRangeRef.current = nextCloned.collapsed ? null : nextCloned.cloneRange();
        }
        emitFormats();
      }
      return changed;
    },
    [isZh, syncToTextarea, emitFormats]
  );

  // Register global bridge so TextStylePanel can invoke live rich commands directly
  useEffect(() => {
    if (!taEl) {
      globalThis.__EXCALIDRAW_LIVE_EDITOR__ = null;
      return;
    }
    const bridge = {
      applyAction,
      getActiveFormats: () => detectActiveDomFormats(editorRef.current),
      getMarkdown: () => domToMarkdown(editorRef.current),
      setTableOuterBorder: (showOuter) => {
        tableOuterBorderRef.current = Boolean(showOuter);
        const editor = editorRef.current;
        if (!editor) return;
        editor.querySelectorAll("table.md-live-table").forEach((tbl) => {
          tbl.classList.toggle("no-outer-border", !showOuter);
        });
      },
      focus: () => editorRef.current?.focus({ preventScroll: true }),
      commit: commitAndExit,
    };
    globalThis.__EXCALIDRAW_LIVE_EDITOR__ = bridge;
    return () => {
      if (globalThis.__EXCALIDRAW_LIVE_EDITOR__ === bridge) {
        globalThis.__EXCALIDRAW_LIVE_EDITOR__ = null;
      }
    };
  }, [taEl, applyAction, commitAndExit]);

  const handleInput = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (composingRef.current) return;

    // Ensure root always has at least one block child
    if (editor.childNodes.length === 0) {
      editor.innerHTML = `<div class="md-live-line" data-block="normal"><br></div>`;
      placeCaretIn(editor.firstElementChild, true);
    }

    tryLiveMarkdownRule(editor);
    syncToTextarea();
    emitFormats();
  }, [syncToTextarea, emitFormats]);

  const handleKeyDown = useCallback(
    (e) => {
      const editor = editorRef.current;
      if (!editor) return;

      // Commit on Escape or Ctrl/Cmd + Enter
      if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
        if (e.isComposing || composingRef.current || e.keyCode === 229) return;
        e.preventDefault();
        e.stopPropagation();
        commitAndExit();
        return;
      }

      // Stop Excalidraw global canvas shortcuts while editing
      e.stopPropagation();

      if (e.isComposing || composingRef.current || e.keyCode === 229) {
        return;
      }

      // Rich-text keyboard shortcuts
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (!e.shiftKey && key === "b") {
          e.preventDefault();
          applyAction({ type: "inline", kind: "bold" });
          return;
        }
        if (!e.shiftKey && key === "i") {
          e.preventDefault();
          applyAction({ type: "inline", kind: "italic" });
          return;
        }
        if (!e.shiftKey && key === "e") {
          e.preventDefault();
          applyAction({ type: "inline", kind: "code" });
          return;
        }
        if (e.shiftKey && key === "x") {
          e.preventDefault();
          applyAction({ type: "inline", kind: "strike" });
          return;
        }
        if (e.shiftKey && key === "h") {
          e.preventDefault();
          applyAction({ type: "highlight", color: "yellow" });
          return;
        }
      }

      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);

      // Inside a live Markdown table cell
      const cellEl = getClosestCellEl(range.startContainer, editor);
      if (cellEl) {
        const tr = cellEl.parentElement;
        const tbl = cellEl.closest("table.md-live-table");
        const rows = tbl ? Array.from(tbl.querySelectorAll("tr")) : [];
        const rIdx = rows.indexOf(tr);
        const cells = tr ? Array.from(tr.children) : [];
        const cIdx = cells.indexOf(cellEl);

        if (e.key === "Tab") {
          e.preventDefault();
          if (e.shiftKey) {
            if (cIdx > 0) placeCaretIn(cells[cIdx - 1], false);
            else if (rIdx > 0) {
              const prevRowCells = Array.from(rows[rIdx - 1].children);
              placeCaretIn(prevRowCells[prevRowCells.length - 1], false);
            }
          } else {
            if (cIdx + 1 < cells.length) placeCaretIn(cells[cIdx + 1], false);
            else if (rIdx + 1 < rows.length) {
              placeCaretIn(rows[rIdx + 1].children[0], false);
            } else if (tbl) {
              const newCell = appendRowToLiveTable(tbl);
              placeCaretIn(newCell, true);
              syncToTextarea();
            }
          }
          emitFormats();
          return;
        }

        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (rIdx + 1 < rows.length) {
            const targetCell = rows[rIdx + 1].children[cIdx] || rows[rIdx + 1].children[0];
            placeCaretIn(targetCell, false);
          } else if (tbl) {
            appendRowToLiveTable(tbl);
            const updatedRows = Array.from(tbl.querySelectorAll("tr"));
            const lastRow = updatedRows[updatedRows.length - 1];
            placeCaretIn(lastRow.children[cIdx] || lastRow.children[0], true);
            syncToTextarea();
          }
          emitFormats();
          return;
        }

        if (e.key === "ArrowDown" && !e.shiftKey && rIdx + 1 < rows.length) {
          e.preventDefault();
          placeCaretIn(rows[rIdx + 1].children[cIdx] || rows[rIdx + 1].children[0], false);
          emitFormats();
          return;
        }

        if (e.key === "ArrowUp" && !e.shiftKey && rIdx > 0) {
          e.preventDefault();
          placeCaretIn(rows[rIdx - 1].children[cIdx] || rows[rIdx - 1].children[0], false);
          emitFormats();
          return;
        }

        // Prevent deleting the cell node when Backspace/Delete is pressed in an empty cell
        if (
          (e.key === "Backspace" || e.key === "Delete") &&
          range.collapsed &&
          cellEl.textContent.replace(/\u200B/g, "").length === 0
        ) {
          e.preventDefault();
          return;
        }
        return;
      }

      // Inside a regular/heading/list/task .md-live-line
      const lineEl = getClosestLineEl(range.startContainer, editor);
      if (!lineEl) return;
      const blockKind = lineEl.getAttribute("data-block") || "normal";
      const contentHost =
        blockKind === "task"
          ? lineEl.querySelector(".md-live-task-body") || lineEl
          : lineEl;

      if (e.key === "Enter") {
        e.preventDefault();
        if (!range.collapsed) {
          range.deleteContents();
        }
        const isEmpty =
          contentHost.textContent.replace(/\u200B/g, "").trim().length === 0;

        if (
          isEmpty &&
          (blockKind === "bullet" || blockKind === "task" || blockKind === "quote")
        ) {
          setLineBlockType(lineEl, "normal");
          syncToTextarea();
          emitFormats();
          return;
        }

        const tailFrag = splitContainerAtRange(contentHost, range);
        const nextKind =
          blockKind === "bullet" || blockKind === "task" ? blockKind : "normal";
        const indent = parseInt(lineEl.getAttribute("data-indent") || "0", 10) || 0;
        const { lineEl: nextLine, caretTarget } = makeLineDiv(
          nextKind,
          indent,
          tailFrag
        );
        lineEl.insertAdjacentElement("afterend", nextLine);
        placeCaretIn(caretTarget, true);
        syncToTextarea();
        emitFormats();
        return;
      }

      if (e.key === "Backspace" && range.collapsed) {
        if (blockKind !== "normal" && isCaretAtStartOf(contentHost, range)) {
          e.preventDefault();
          setLineBlockType(lineEl, "normal");
          placeCaretIn(lineEl, true);
          syncToTextarea();
          emitFormats();
          return;
        }
      }
    },
    [applyAction, commitAndExit, syncToTextarea, emitFormats]
  );

  const handleMouseDown = useCallback(
    (e) => {
      e.stopPropagation();
      const target = e.target;
      if (!(target instanceof Element)) return;

      // Toggle checklist checkbox
      const chk = target.closest('[data-md-check="1"]');
      if (chk) {
        e.preventDefault();
        const line = chk.closest(".md-live-line");
        if (line) {
          const next = line.getAttribute("data-checked") === "1" ? "0" : "1";
          line.setAttribute("data-checked", next);
          chk.setAttribute("aria-checked", next === "1" ? "true" : "false");
          syncToTextarea();
          emitFormats();
        }
        return;
      }

      // Live table bottom '+' / right '+' buttons
      const tblBtn = target.closest("[data-tbl-action]");
      if (tblBtn) {
        e.preventDefault();
        const wrap = tblBtn.closest('[data-md-table="1"]');
        const tbl = wrap?.querySelector("table.md-live-table");
        if (!tbl) return;
        const act = tblBtn.getAttribute("data-tbl-action");
        const focusCell =
          act === "add-row"
            ? appendRowToLiveTable(tbl)
            : appendColToLiveTable(tbl);
        placeCaretIn(focusCell, true);
        syncToTextarea();
        emitFormats();
      }
    },
    [syncToTextarea, emitFormats]
  );

  const handlePaste = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const editor = editorRef.current;
      if (!editor) return;
      const text = (e.clipboardData?.getData("text/plain") || "").replace(/\r\n?/g, "\n");
      if (!text) return;

      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const inCell = Boolean(getClosestCellEl(range.startContainer, editor));

      if (inCell) {
        range.deleteContents();
        const node = document.createTextNode(text.replace(/\n/g, " "));
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        // Render pasted Markdown/multiline text live immediately!
        const pastedHtml = markdownToHtml(text, {
          tableOuterBorder: tableOuterBorderRef.current,
          isZh,
        });
        const curLine = getClosestLineEl(range.startContainer, editor);
        if (
          curLine &&
          curLine.parentElement === editor &&
          !text.includes("\n")
        ) {
          range.deleteContents();
          const tmp = document.createElement("div");
          tmp.innerHTML = pastedHtml;
          const firstLine = tmp.firstElementChild;
          const frag = document.createDocumentFragment();
          while (firstLine?.firstChild) frag.appendChild(firstLine.firstChild);
          const lastInserted = frag.lastChild;
          range.insertNode(frag);
          if (lastInserted) {
            range.setStartAfter(lastInserted);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } else {
          const tmp = document.createElement("div");
          tmp.innerHTML = pastedHtml;
          const insertedNodes = Array.from(tmp.childNodes);
          const anchor = curLine && curLine.parentElement === editor ? curLine : null;
          if (anchor && anchor.textContent.replace(/\u200B/g, "").trim() === "") {
            for (const n of insertedNodes) editor.insertBefore(n, anchor);
            editor.removeChild(anchor);
          } else if (anchor) {
            let ref = anchor;
            for (const n of insertedNodes) {
              ref.insertAdjacentElement("afterend", n);
              ref = n;
            }
          } else {
            for (const n of insertedNodes) editor.appendChild(n);
          }
          const lastNode = insertedNodes[insertedNodes.length - 1];
          const targetCell = lastNode?.querySelector?.("td:last-child, th:last-child");
          placeCaretIn(targetCell || lastNode, false);
        }
      }

      syncToTextarea();
      emitFormats();
    },
    [isZh, syncToTextarea, emitFormats]
  );

  if (!taEl || !taEl.parentElement || !mirrorStyle || !nativeMd || readOnly) {
    return null;
  }

  return createPortal(
    <div
      ref={rootRef}
      className="md-live-editor-root"
      style={{
        left: mirrorStyle.left,
        top: mirrorStyle.top,
        transform: mirrorStyle.transform,
        transformOrigin: mirrorStyle.transformOrigin,
        fontFamily: mirrorStyle.fontFamily,
        fontSize: mirrorStyle.fontSize,
        lineHeight: mirrorStyle.lineHeight,
        textAlign: mirrorStyle.textAlign,
        color: mirrorStyle.color,
        opacity: mirrorStyle.opacity,
        filter: mirrorStyle.filter,
        minWidth: mirrorStyle.minWidth,
        minHeight: mirrorStyle.minHeight,
        width: mirrorStyle.width,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={handleMouseDown}
    >
      <div
        ref={editorRef}
        className="md-live-editor"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        style={{
          whiteSpace: mirrorStyle.whiteSpace,
          wordBreak: mirrorStyle.wordBreak,
        }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => e.stopPropagation()}
        onPaste={handlePaste}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          handleInput();
        }}
      />
    </div>,
    taEl.parentElement
  );
}
