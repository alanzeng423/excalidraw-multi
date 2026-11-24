import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import rough from "roughjs";
import { getElementFontFamilyStr } from "./cjkFonts";
import { parseMarkdownLine } from "./nativeMarkdown";
import {
  applyDomRichAction,
  domToMarkdown,
  getClosestLineEl,
  markdownToHtml,
  placeCaretIn,
  setLineBlockType,
  tryLiveMarkdownRule,
} from "./richMarkdownDom";
import {
  canMergeRange,
  canSplitRange,
  createEmptyCell,
  expandSelectionForMerges,
  getCellAnchor,
  insertColAt,
  insertRowAt,
  mergeCells,
  normalizeTableData,
  parseTabularPaste,
  resolveCellBg,
  resolveCellTextColor,
  setTableSelection,
  splitCells,
} from "./tableData";

function toggleCellTaskAtLine(rawText, lineIdx) {
  const lines = String(rawText ?? "").replace(/\r\n?/g, "\n").split("\n");
  if (lineIdx < 0 || lineIdx >= lines.length) return rawText;
  lines[lineIdx] = lines[lineIdx].replace(
    /^(\s*[-*+]\s+\[)([ xX])(\]\s+)/,
    (_, pre, mark, post) => `${pre}${mark === " " ? "x" : " "}${post}`
  );
  return lines.join("\n");
}

function CellMarkdown({ text, readOnly, onToggleTask }) {
  const raw = String(text ?? "");
  if (!raw) return <div className="tbl-cell-view">&nbsp;</div>;
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");

  return (
    <div className="tbl-cell-view">
      {lines.map((rawLine, li) => {
        const parsed = parseMarkdownLine(rawLine);
        const cls = [
          "tbl-md-line",
          parsed.kind === "heading" ? `tbl-md-h${parsed.level}` : "",
          parsed.prefixType === "quote" ? "tbl-md-quote" : "",
          parsed.prefixType === "bullet" ? "tbl-md-bullet" : "",
          parsed.prefixType === "task-checked" || parsed.prefixType === "task-unchecked"
            ? "tbl-md-task"
            : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={li}
            className={cls}
            style={
              parsed.indent
                ? { paddingLeft: `${parsed.indent * 12}px` }
                : undefined
            }
          >
            {parsed.prefixType === "bullet" && (
              <span className="tbl-md-bullet-dot" aria-hidden="true">•</span>
            )}
            {(parsed.prefixType === "task-unchecked" ||
              parsed.prefixType === "task-checked") && (
              <input
                type="checkbox"
                className="tbl-md-checkbox"
                checked={parsed.prefixType === "task-checked"}
                readOnly={readOnly}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!readOnly) onToggleTask?.(li);
                }}
                onChange={() => {}}
              />
            )}
            <span className="tbl-md-spans">
              {parsed.spans.length === 0 ? (
                "\u00A0"
              ) : (
                parsed.spans.map((span, si) => {
                  const style = {};
                  if (span.color) style.color = span.color;
                  if (span.highlight) style.backgroundColor = span.highlight;
                  const sCls = [
                    span.bold && !span.code ? "tbl-s-bold" : "",
                    span.italic && !span.code ? "tbl-s-italic" : "",
                    span.strike ? "tbl-s-strike" : "",
                    span.code ? "tbl-s-code" : "",
                    span.highlight ? "tbl-s-hl" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <span key={si} className={sCls || undefined} style={style}>
                      {span.text}
                    </span>
                  );
                })
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Draws internal table gridlines matching Excalidraw's native stroke style & roughness
 * (using roughjs when roughness > 0) while automatically skipping borders inside merged cells.
 */
function NativeGridOverlay({
  table,
  tableElRef,
  element,
  isDark,
  layoutTick,
}) {
  const svgRef = useRef(null);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const tbl = tableElRef.current;
    if (!svg || !tbl) return;

    const w = tbl.offsetWidth;
    const h = tbl.offsetHeight;
    if (!w || !h) return;

    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.replaceChildren();

    const R = table.rows.length;
    const C = table.colWidths.length;

    // Measure actual row Y coordinates & column X coordinates from the live table DOM
    const trEls = tbl.querySelectorAll(":scope > tbody > tr");
    const rowY = [0];
    for (let r = 0; r < trEls.length; r += 1) {
      rowY.push(trEls[r].offsetTop + trEls[r].offsetHeight);
    }
    while (rowY.length <= R) rowY.push(h);

    const totalWeight = table.colWidths.reduce((s, v) => s + v, 0) || 1;
    const colX = [0];
    let acc = 0;
    for (let c = 0; c < C; c += 1) {
      acc += (table.colWidths[c] / totalWeight) * w;
      colX.push(acc);
    }

    const rawStroke =
      element.strokeColor && element.strokeColor !== "transparent"
        ? element.strokeColor
        : "#1e1e1e";
    const strokeColor =
      isDark && (rawStroke === "#1e1e1e" || rawStroke === "#000000")
        ? "#d4d4e0"
        : rawStroke;
    const baseWidth = Math.max(1, Math.min(3.5, (element.strokeWidth || 1.5) * 0.72));
    const roughness = Number.isFinite(element.roughness) ? element.roughness : 1;
    const strokeDash =
      element.strokeStyle === "dashed"
        ? [8, 6]
        : element.strokeStyle === "dotted"
          ? [2, 5]
          : undefined;

    const rc = roughness > 0 ? rough.svg(svg) : null;
    const seed = (element.seed || 1) + 73;

    const drawSegment = (x1, y1, x2, y2, emphasized = false) => {
      const sw = emphasized ? Math.max(1.5, baseWidth * 1.25) : baseWidth;
      if (rc) {
        const node = rc.line(x1, y1, x2, y2, {
          stroke: strokeColor,
          strokeWidth: sw,
          roughness: roughness * 0.72,
          bowing: 0.7,
          seed,
          strokeLineDash: strokeDash,
          disableMultiStroke: true,
        });
        svg.appendChild(node);
      } else {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(x1));
        line.setAttribute("y1", String(y1));
        line.setAttribute("x2", String(x2));
        line.setAttribute("y2", String(y2));
        line.setAttribute("stroke", strokeColor);
        line.setAttribute("stroke-width", String(sw));
        line.setAttribute("stroke-opacity", emphasized ? "0.9" : "0.72");
        if (strokeDash) line.setAttribute("stroke-dasharray", strokeDash.join(" "));
        svg.appendChild(line);
      }
    };

    const sameAnchor = (r1, c1, r2, c2) => {
      const a1 = getCellAnchor(table, r1, c1);
      const a2 = getCellAnchor(table, r2, c2);
      return a1.r === a2.r && a1.c === a2.c;
    };

    // Horizontal internal boundaries (between row r-1 and row r), coalesced into contiguous segments
    for (let r = 1; r < R; r += 1) {
      const y = rowY[r];
      const isHeaderEdge = table.headerRow && r === 1;
      let segStart = null;
      for (let c = 0; c <= C; c += 1) {
        const needBorder = c < C && !sameAnchor(r - 1, c, r, c);
        if (needBorder && segStart === null) {
          segStart = colX[c];
        } else if (!needBorder && segStart !== null) {
          drawSegment(segStart, y, colX[c], y, isHeaderEdge);
          segStart = null;
        }
      }
    }

    // Vertical internal boundaries (between col c-1 and col c), coalesced into contiguous segments
    for (let c = 1; c < C; c += 1) {
      const x = colX[c];
      let segStart = null;
      for (let r = 0; r <= R; r += 1) {
        const needBorder = r < R && !sameAnchor(r, c - 1, r, c);
        if (needBorder && segStart === null) {
          segStart = rowY[r];
        } else if (!needBorder && segStart !== null) {
          drawSegment(x, segStart, x, rowY[r], false);
          segStart = null;
        }
      }
    }
  }, [
    table,
    tableElRef,
    element.width,
    element.height,
    element.strokeColor,
    element.strokeWidth,
    element.strokeStyle,
    element.roughness,
    element.seed,
    isDark,
    layoutTick,
  ]);

  return <svg ref={svgRef} className="table-grid-svg" aria-hidden="true" />;
}

export default function TableCard({
  element,
  theme,
  isActive,
  readOnly,
  langCode = "zh-CN",
  onUpdate,
}) {
  const isZh = langCode === "zh-CN";
  const isDark = theme === "dark";

  const table = useMemo(
    () => normalizeTableData(element.customData?.table),
    [element.customData?.table]
  );

  // Selection range { r1, c1, r2, c2 } and editing cell { r, c }
  const [range, setRange] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [resizingWidths, setResizingWidths] = useState(null);
  const [layoutTick, setLayoutTick] = useState(0);

  const tableWrapRef = useRef(null);
  const tableElRef = useRef(null);
  const editorRef = useRef(null);
  const cellComposingRef = useRef(false);
  const cellSavedRangeRef = useRef(null);
  const dragOriginRef = useRef(null);
  const draggingRef = useRef(false);
  const resizeStateRef = useRef(null);

  const expandedRange = useMemo(
    () => (range ? expandSelectionForMerges(table, range) : null),
    [table, range]
  );

  // Publish selection to shared store so Left Style Panel controls act on this table's selection
  useEffect(() => {
    if (isActive && !readOnly) {
      setTableSelection({
        elementId: element.id,
        range: expandedRange,
        editingCell,
      });
    }
  }, [isActive, readOnly, element.id, expandedRange, editingCell]);

  // Clear local editing when deactivated or read-only
  useEffect(() => {
    if (!isActive || readOnly) {
      setEditingCell(null);
      setRange(null);
      draggingRef.current = false;
      dragOriginRef.current = null;
    }
  }, [isActive, readOnly]);

  // Clamp selection if table shrinks
  useEffect(() => {
    const maxR = table.rows.length - 1;
    const maxC = table.colWidths.length - 1;
    if (editingCell && (editingCell.r > maxR || editingCell.c > maxC)) {
      setEditingCell(null);
    }
    if (
      range &&
      (range.r1 > maxR || range.r2 > maxR || range.c1 > maxC || range.c2 > maxC)
    ) {
      setRange({
        r1: Math.min(range.r1, maxR),
        c1: Math.min(range.c1, maxC),
        r2: Math.min(range.r2, maxR),
        c2: Math.min(range.c2, maxC),
      });
    }
  }, [table.rows.length, table.colWidths.length, editingCell, range]);

  // Observe table box resizing to redraw native SVG grid lines smoothly
  useEffect(() => {
    const tbl = tableElRef.current;
    if (!tbl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setLayoutTick((n) => n + 1));
    ro.observe(tbl);
    return () => ro.disconnect();
  }, []);

  // Hydrate & focus live WYSIWYG cell editor when entering cell edit mode
  useEffect(() => {
    const el = editorRef.current;
    if (!el || !editingCell) {
      globalThis.__EXCALIDRAW_LIVE_CELL_EDITOR__ = null;
      return;
    }
    const curText = table.rows[editingCell.r]?.[editingCell.c]?.text ?? "";
    el.innerHTML = markdownToHtml(curText, { allowTables: false });
    el.focus({ preventScroll: true });
    const lastLine = el.querySelector(":scope > .md-live-line:last-of-type");
    const target =
      lastLine?.getAttribute("data-block") === "task"
        ? lastLine.querySelector(".md-live-task-body")
        : lastLine || el;
    placeCaretIn(target, false);
  }, [editingCell?.r, editingCell?.c]);

  // Save selection range inside active live cell editor
  useEffect(() => {
    if (!editingCell) return;
    const onSel = () => {
      const el = editorRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
        cellSavedRangeRef.current = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [editingCell]);

  const commit = useCallback(
    (nextTable) => {
      if (readOnly) return;
      onUpdate(element.id, nextTable);
    },
    [element.id, onUpdate, readOnly]
  );

  const updateCell = useCallback(
    (r, c, patch) => {
      const nextRows = table.rows.map((row, ri) =>
        ri !== r
          ? row
          : row.map((cell, ci) => (ci !== c ? cell : { ...cell, ...patch }))
      );
      commit({ ...table, rows: nextRows });
    },
    [table, commit]
  );

  const handleAppendRow = useCallback(() => {
    const next = insertRowAt(table, table.rows.length);
    const newR = next.rows.length - 1;
    commit(next);
    setRange({ r1: newR, c1: 0, r2: newR, c2: 0 });
    setEditingCell({ r: newR, c: 0 });
  }, [table, commit]);

  const handleAppendCol = useCallback(() => {
    const newC = table.colWidths.length;
    const next = insertColAt(table, newC, "");
    commit(next);
    setRange({ r1: 0, c1: newC, r2: 0, c2: newC });
    setEditingCell({ r: 0, c: newC });
  }, [table, commit]);

  const moveFocusTo = useCallback(
    (r, c, edit = true) => {
      const anchor = getCellAnchor(table, r, c);
      setRange({ r1: anchor.r, c1: anchor.c, r2: anchor.r, c2: anchor.c });
      setEditingCell(edit ? anchor : null);
    },
    [table]
  );

  // Column width drag resizing
  const startColResize = useCallback(
    (e, colIdx) => {
      if (readOnly || !isActive) return;
      e.preventDefault();
      e.stopPropagation();
      const wrapWidth = tableElRef.current?.offsetWidth || element.width || 460;
      const totalWeight =
        table.colWidths.reduce((s, v) => s + v, 0) || table.colWidths.length * 100;
      const pxPerWeight = wrapWidth / totalWeight;
      const startWidths = [...table.colWidths];

      resizeStateRef.current = {
        colIdx,
        startX: e.clientX,
        startWidths,
        pxPerWeight,
      };

      const onMove = (ev) => {
        const st = resizeStateRef.current;
        if (!st) return;
        const deltaWeight = (ev.clientX - st.startX) / st.pxPerWeight;
        const next = [...st.startWidths];
        const minW = 48;
        if (st.colIdx < next.length - 1) {
          const sumPair = st.startWidths[st.colIdx] + st.startWidths[st.colIdx + 1];
          const w1 = Math.max(
            minW,
            Math.min(sumPair - minW, st.startWidths[st.colIdx] + deltaWeight)
          );
          next[st.colIdx] = Math.round(w1);
          next[st.colIdx + 1] = Math.round(sumPair - w1);
        } else {
          next[st.colIdx] = Math.round(
            Math.max(minW, st.startWidths[st.colIdx] + deltaWeight)
          );
        }
        setResizingWidths(next);
        setLayoutTick((n) => n + 1);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setResizingWidths((latest) => {
          if (latest) commit({ ...table, colWidths: latest });
          return null;
        });
        resizeStateRef.current = null;
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [readOnly, isActive, table, element.width, commit]
  );

  // End drag selection cleanly on window pointerup
  useEffect(() => {
    const onWinUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("pointerup", onWinUp);
    return () => window.removeEventListener("pointerup", onWinUp);
  }, []);

  // Bridge live cell editor actions so Left Style Panel buttons format the live selection directly
  useEffect(() => {
    if (!editingCell || !isActive || readOnly) {
      globalThis.__EXCALIDRAW_LIVE_CELL_EDITOR__ = null;
      return;
    }
    const bridge = {
      applyAction: (action) => {
        const el = editorRef.current;
        if (!el) return false;

        // Capture selection before focusing; if collapsed inside a non-empty cell, select all cell content
        const selBefore = window.getSelection();
        let targetRange = null;
        if (
          selBefore &&
          selBefore.rangeCount > 0 &&
          el.contains(selBefore.getRangeAt(0).commonAncestorContainer) &&
          !selBefore.getRangeAt(0).collapsed
        ) {
          targetRange = selBefore.getRangeAt(0).cloneRange();
        } else if (
          cellSavedRangeRef.current &&
          el.contains(cellSavedRangeRef.current.commonAncestorContainer) &&
          !cellSavedRangeRef.current.collapsed
        ) {
          targetRange = cellSavedRangeRef.current.cloneRange();
        } else if (
          action.type !== "block" &&
          el.textContent.replace(/\u200B/g, "").trim().length > 0
        ) {
          const singleLine = el.querySelector(":scope > .md-live-line");
          const targetEl =
            el.children.length === 1 && singleLine
              ? singleLine.getAttribute("data-block") === "task"
                ? singleLine.querySelector(".md-live-task-body") || singleLine
                : singleLine
              : el;
          targetRange = document.createRange();
          targetRange.selectNodeContents(targetEl);
        }

        el.focus({ preventScroll: true });
        if (targetRange) {
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(targetRange);
        }

        const changed = applyDomRichAction(el, action, {
          savedRange: targetRange || cellSavedRangeRef.current,
          isZh,
        });
        if (changed) {
          updateCell(editingCell.r, editingCell.c, { text: domToMarkdown(el) });
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            cellSavedRangeRef.current = sel.getRangeAt(0).cloneRange();
          }
        }
        return changed;
      },
    };
    globalThis.__EXCALIDRAW_LIVE_CELL_EDITOR__ = bridge;
    return () => {
      if (globalThis.__EXCALIDRAW_LIVE_CELL_EDITOR__ === bridge) {
        globalThis.__EXCALIDRAW_LIVE_CELL_EDITOR__ = null;
      }
    };
  }, [editingCell, isActive, readOnly, isZh, updateCell]);

  // Keyboard navigation & live WYSIWYG Markdown shortcuts inside cell editor
  const handleCellKeyDown = useCallback(
    (e, r, c) => {
      e.stopPropagation();
      if (e.isComposing || cellComposingRef.current || e.keyCode === 229) return;
      const rowCount = table.rows.length;
      const colCount = table.colWidths.length;
      const cell = table.rows[r][c];
      const editor = e.currentTarget;

      // Live inline Markdown shortcuts inside cell editor
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        const runAction = (action) => {
          const changed = applyDomRichAction(editor, action, {
            savedRange: cellSavedRangeRef.current,
            isZh,
          });
          if (changed) {
            updateCell(r, c, { text: domToMarkdown(editor) });
          }
        };
        if (!e.shiftKey && k === "b") {
          e.preventDefault();
          runAction({ type: "inline", kind: "bold" });
          return;
        }
        if (!e.shiftKey && k === "i") {
          e.preventDefault();
          runAction({ type: "inline", kind: "italic" });
          return;
        }
        if (!e.shiftKey && k === "e") {
          e.preventDefault();
          runAction({ type: "inline", kind: "code" });
          return;
        }
        if (e.shiftKey && k === "x") {
          e.preventDefault();
          runAction({ type: "inline", kind: "strike" });
          return;
        }
        if (e.shiftKey && k === "h") {
          e.preventDefault();
          runAction({ type: "highlight", color: "yellow" });
          return;
        }
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setEditingCell(null);
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          if (c > 0) moveFocusTo(r, c - 1, true);
          else if (r > 0) moveFocusTo(r - 1, colCount - 1, true);
        } else {
          const nextC = c + (cell.colSpan || 1);
          if (nextC < colCount) {
            moveFocusTo(r, nextC, true);
          } else if (r + 1 < rowCount) {
            moveFocusTo(r + 1, 0, true);
          } else {
            handleAppendRow();
          }
        }
        return;
      }

      if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const nextR = r + (cell.rowSpan || 1);
        if (nextR < rowCount) {
          moveFocusTo(nextR, c, true);
        } else {
          handleAppendRow();
        }
        return;
      }

      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const lineEl = getClosestLineEl(sel.getRangeAt(0).startContainer, editor);
          const nextDiv = document.createElement("div");
          nextDiv.className = "md-live-line";
          nextDiv.setAttribute("data-block", "normal");
          nextDiv.innerHTML = "<br>";
          if (lineEl && lineEl.parentElement === editor) {
            lineEl.insertAdjacentElement("afterend", nextDiv);
          } else {
            editor.appendChild(nextDiv);
          }
          placeCaretIn(nextDiv, true);
          updateCell(r, c, { text: domToMarkdown(editor) });
        }
        return;
      }

      if (e.key === "Backspace") {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && sel.isCollapsed) {
          const rng = sel.getRangeAt(0);
          const lineEl = getClosestLineEl(rng.startContainer, editor);
          const blk = lineEl?.getAttribute("data-block") || "normal";
          if (lineEl && blk !== "normal") {
            const host =
              blk === "task"
                ? lineEl.querySelector(".md-live-task-body") || lineEl
                : lineEl;
            const pre = document.createRange();
            pre.setStart(host, 0);
            pre.setEnd(rng.startContainer, rng.startOffset);
            if (pre.toString().replace(/\u200B/g, "").length === 0) {
              e.preventDefault();
              setLineBlockType(lineEl, "normal");
              placeCaretIn(lineEl, true);
              updateCell(r, c, { text: domToMarkdown(editor) });
              return;
            }
          }
        }
      }

      if (e.key === "ArrowUp" && !e.shiftKey && r > 0) {
        const lines = editor.querySelectorAll(":scope > .md-live-line");
        if (lines.length <= 1) {
          e.preventDefault();
          moveFocusTo(r - 1, c, true);
        }
        return;
      }

      if (e.key === "ArrowDown" && !e.shiftKey) {
        const lines = editor.querySelectorAll(":scope > .md-live-line");
        const nextR = r + (cell.rowSpan || 1);
        if (lines.length <= 1 && nextR < rowCount) {
          e.preventDefault();
          moveFocusTo(nextR, c, true);
        }
      }
    },
    [table, isZh, updateCell, moveFocusTo, handleAppendRow]
  );

  // Card-level shortcuts when a range is selected (not actively typing in textarea)
  const handleCardKeyDown = useCallback(
    (e) => {
      if (!isActive || readOnly) return;
      e.stopPropagation();

      if (editingCell) return;

      // Ctrl/Cmd + Shift + M -> Merge or Split selected range
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (expandedRange && canMergeRange(table, expandedRange)) {
          commit(mergeCells(table, expandedRange));
          setRange({
            r1: expandedRange.r1,
            c1: expandedRange.c1,
            r2: expandedRange.r1,
            c2: expandedRange.c1,
          });
        } else if (expandedRange && canSplitRange(table, expandedRange)) {
          commit(splitCells(table, expandedRange));
        }
        return;
      }

      if (e.key === "Enter" && expandedRange) {
        e.preventDefault();
        setEditingCell({ r: expandedRange.r1, c: expandedRange.c1 });
        return;
      }

      if ((e.key === "Backspace" || e.key === "Delete") && expandedRange) {
        e.preventDefault();
        const nextRows = table.rows.map((row, ri) =>
          row.map((cell, ci) => {
            if (
              ri >= expandedRange.r1 &&
              ri <= expandedRange.r2 &&
              ci >= expandedRange.c1 &&
              ci <= expandedRange.c2 &&
              !cell.mergedInto
            ) {
              return { ...cell, text: "" };
            }
            return cell;
          })
        );
        commit({ ...table, rows: nextRows });
      }
    },
    [isActive, readOnly, editingCell, expandedRange, table, commit]
  );

  // Smart paste from Excel / Feishu / Google Sheets (TSV) or Markdown pipe table, or plain text
  const handleCellPaste = useCallback(
    (e, startR, startC) => {
      e.stopPropagation();
      const text = e.clipboardData?.getData("text/plain") || "";
      const parsed = parseTabularPaste(text);
      if (!parsed) {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const rng = sel.getRangeAt(0);
          rng.deleteContents();
          const node = document.createTextNode(text.replace(/\r\n?/g, "\n"));
          rng.insertNode(node);
          rng.setStartAfter(node);
          rng.collapse(true);
          sel.removeAllRanges();
          sel.addRange(rng);
          if (editorRef.current) {
            updateCell(startR, startC, { text: domToMarkdown(editorRef.current) });
          }
        }
        return;
      }

      e.preventDefault();
      const pastedRows = parsed.rows;
      const pasteH = pastedRows.length;
      const pasteW = Math.max(...pastedRows.map((row) => row.length));

      let next = table;
      while (next.rows.length < startR + pasteH) {
        next = insertRowAt(next, next.rows.length);
      }
      while (next.colWidths.length < startC + pasteW) {
        next = insertColAt(next, next.colWidths.length);
      }

      const nextAligns = [...next.colAligns];
      if (parsed.aligns && startR === 0 && startC === 0) {
        for (let i = 0; i < parsed.aligns.length && i < nextAligns.length; i += 1) {
          nextAligns[i] = parsed.aligns[i];
        }
      }

      const nextRows = next.rows.map((row) => row.map((c) => ({ ...c })));
      for (let dr = 0; dr < pasteH; dr += 1) {
        for (let dc = 0; dc < pastedRows[dr].length; dc += 1) {
          const anchor = getCellAnchor(next, startR + dr, startC + dc);
          nextRows[anchor.r][anchor.c] = {
            ...nextRows[anchor.r][anchor.c],
            text: pastedRows[dr][dc],
          };
        }
      }

      commit({ ...next, colAligns: nextAligns, rows: nextRows });
    },
    [table, commit, updateCell]
  );

  const stop = (e) => e.stopPropagation();

  const effectiveWidths = resizingWidths || table.colWidths;
  const totalWeight = effectiveWidths.reduce((s, v) => s + v, 0) || 1;
  const fontFamilyStr = getElementFontFamilyStr(element);
  const effectiveTable = resizingWidths
    ? { ...table, colWidths: resizingWidths }
    : table;

  const isCellInSelection = (r, c, rs, cs) => {
    if (!expandedRange) return false;
    return (
      r <= expandedRange.r2 &&
      r + rs - 1 >= expandedRange.r1 &&
      c <= expandedRange.c2 &&
      c + cs - 1 >= expandedRange.c1
    );
  };

  const isMultiSelect =
    expandedRange &&
    (expandedRange.r2 > expandedRange.r1 || expandedRange.c2 > expandedRange.c1) &&
    canMergeRange(table, expandedRange);

  const customBg =
    element.backgroundColor && element.backgroundColor !== "transparent"
      ? element.backgroundColor
      : undefined;

  const inkColor =
    element.strokeColor && element.strokeColor !== "transparent"
      ? isDark &&
        (element.strokeColor === "#1e1e1e" || element.strokeColor === "#000000")
        ? "#e6e6ee"
        : element.strokeColor
      : undefined;

  return (
    <div
      className={`table-card native-table-card ${isDark ? "is-dark" : ""} ${
        isActive ? "is-active" : ""
      }`}
      tabIndex={isActive ? 0 : -1}
      style={{
        fontFamily: fontFamilyStr,
        backgroundColor: customBg,
        color: inkColor,
        borderRadius: element.roundness ? "8px" : "0px",
      }}
      onWheel={isActive ? stop : undefined}
      onCopy={isActive ? stop : undefined}
      onCut={isActive ? stop : undefined}
      onPaste={isActive ? stop : undefined}
      onKeyDown={isActive ? handleCardKeyDown : undefined}
      onKeyUp={isActive ? stop : undefined}
    >
      <div
        className="table-card-stage"
        ref={tableWrapRef}
        onPointerDown={isActive ? stop : undefined}
      >
        <div className="table-grid-layer">
          <NativeGridOverlay
            table={effectiveTable}
            tableElRef={tableElRef}
            element={element}
            isDark={isDark}
            layoutTick={layoutTick}
          />

          <table
            ref={tableElRef}
            className={`canvas-table native-canvas-table ${
              table.striped ? "is-striped" : ""
            }`}
          >
            <colgroup>
              {effectiveWidths.map((w, ci) => (
                <col
                  key={ci}
                  style={{ width: `${((w / totalWeight) * 100).toFixed(3)}%` }}
                />
              ))}
            </colgroup>
            <tbody>
              {table.rows.map((row, ri) => {
                const isHeader = table.headerRow && ri === 0;
                return (
                  <tr key={ri} className={isHeader ? "is-header" : ""}>
                    {row.map((cell, ci) => {
                      if (cell.mergedInto) return null;

                      const rs = cell.rowSpan || 1;
                      const cs = cell.colSpan || 1;
                      const isEditing =
                        isActive &&
                        !readOnly &&
                        editingCell?.r === ri &&
                        editingCell?.c === ci;
                      const isSelected =
                        isActive && !readOnly && isCellInSelection(ri, ci, rs, cs);
                      const align = table.colAligns[ci] || "left";
                      const cellBg = resolveCellBg(cell.bg, isDark);
                      const cellColor = resolveCellTextColor(cell.color, isDark);
                      const Tag = isHeader ? "th" : "td";

                      return (
                        <Tag
                          key={ci}
                          rowSpan={rs > 1 ? rs : undefined}
                          colSpan={cs > 1 ? cs : undefined}
                          className={`tbl-cell ${
                            isEditing ? "is-editing" : ""
                          } ${isSelected ? "is-selected" : ""} ${
                            isSelected && isMultiSelect ? "is-range" : ""
                          } ${cell.bold ? "is-bold" : ""}`}
                          style={{
                            textAlign: align,
                            backgroundColor: cellBg || undefined,
                            color: cellColor || undefined,
                          }}
                          onPointerDown={(e) => {
                            if (!isActive || readOnly) return;
                            if (e.button !== 0) return;
                            e.stopPropagation();

                            // If already editing this exact cell, let native textarea selection work
                            if (isEditing) return;

                            if (e.shiftKey && range) {
                              e.preventDefault();
                              setEditingCell(null);
                              setRange({
                                r1: range.r1,
                                c1: range.c1,
                                r2: ri + rs - 1,
                                c2: ci + cs - 1,
                              });
                              return;
                            }

                            dragOriginRef.current = {
                              r1: ri,
                              c1: ci,
                              r2: ri + rs - 1,
                              c2: ci + cs - 1,
                            };
                            draggingRef.current = true;
                            setRange({
                              r1: ri,
                              c1: ci,
                              r2: ri + rs - 1,
                              c2: ci + cs - 1,
                            });
                            setEditingCell(null);
                          }}
                          onPointerEnter={() => {
                            if (!draggingRef.current || !dragOriginRef.current) return;
                            const orig = dragOriginRef.current;
                            const nextRange = {
                              r1: Math.min(orig.r1, ri),
                              c1: Math.min(orig.c1, ci),
                              r2: Math.max(orig.r2, ri + rs - 1),
                              c2: Math.max(orig.c2, ci + cs - 1),
                            };
                            setRange(nextRange);
                            setEditingCell(null);
                          }}
                          onClick={(e) => {
                            if (!isActive || readOnly) return;
                            e.stopPropagation();
                            if (e.shiftKey) return;
                            // Single click on a single cell (no drag range) opens inline editor directly!
                            if (
                              !isEditing &&
                              dragOriginRef.current &&
                              dragOriginRef.current.r1 === ri &&
                              dragOriginRef.current.c1 === ci &&
                              expandedRange &&
                              expandedRange.r1 === ri &&
                              expandedRange.c1 === ci &&
                              expandedRange.r2 === ri + rs - 1 &&
                              expandedRange.c2 === ci + cs - 1
                            ) {
                              setEditingCell({ r: ri, c: ci });
                            }
                          }}
                          onDoubleClick={(e) => {
                            if (!isActive || readOnly) return;
                            e.stopPropagation();
                            setRange({
                              r1: ri,
                              c1: ci,
                              r2: ri + rs - 1,
                              c2: ci + cs - 1,
                            });
                            setEditingCell({ r: ri, c: ci });
                          }}
                        >
                          {isEditing ? (
                            <div
                              ref={editorRef}
                              className="tbl-cell-live-editor"
                              contentEditable
                              suppressContentEditableWarning
                              spellCheck={false}
                              style={{
                                textAlign: align,
                                fontWeight: isHeader || cell.bold ? 600 : 400,
                              }}
                              onPointerDown={stop}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                const chk = e.target instanceof Element ? e.target.closest('[data-md-check="1"]') : null;
                                if (chk) {
                                  e.preventDefault();
                                  const line = chk.closest(".md-live-line");
                                  if (line) {
                                    const next = line.getAttribute("data-checked") === "1" ? "0" : "1";
                                    line.setAttribute("data-checked", next);
                                    chk.setAttribute("aria-checked", next === "1" ? "true" : "false");
                                    if (editorRef.current) {
                                      updateCell(ri, ci, { text: domToMarkdown(editorRef.current) });
                                    }
                                  }
                                }
                              }}
                              onInput={(e) => {
                                if (cellComposingRef.current) return;
                                const el = e.currentTarget;
                                if (el.childNodes.length === 0) {
                                  el.innerHTML = `<div class="md-live-line" data-block="normal"><br></div>`;
                                  placeCaretIn(el.firstElementChild, true);
                                }
                                tryLiveMarkdownRule(el);
                                updateCell(ri, ci, { text: domToMarkdown(el) });
                              }}
                              onCompositionStart={() => {
                                cellComposingRef.current = true;
                              }}
                              onCompositionEnd={(e) => {
                                cellComposingRef.current = false;
                                const el = e.currentTarget;
                                tryLiveMarkdownRule(el);
                                updateCell(ri, ci, { text: domToMarkdown(el) });
                              }}
                              onKeyDown={(e) => handleCellKeyDown(e, ri, ci)}
                              onPaste={(e) => handleCellPaste(e, ri, ci)}
                            />
                          ) : (
                            <CellMarkdown
                              text={cell.text}
                              readOnly={readOnly || !isActive}
                              onToggleTask={(lineIdx) => {
                                const nextText = toggleCellTaskAtLine(
                                  cell.text,
                                  lineIdx
                                );
                                updateCell(ri, ci, { text: nextText });
                              }}
                            />
                          )}

                          {isActive &&
                            !readOnly &&
                            ci + cs < table.colWidths.length && (
                              <span
                                className="tbl-col-resizer"
                                title={isZh ? "拖动调整列宽" : "Drag to resize column"}
                                onPointerDown={(e) => startColResize(e, ci + cs - 1)}
                                onClick={stop}
                              />
                            )}
                        </Tag>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Feishu-style right '+' column adder rail */}
        {isActive && !readOnly && (
          <button
            type="button"
            className="tbl-edge-add tbl-edge-add-col"
            title={isZh ? "右侧添加一列" : "Add column"}
            aria-label={isZh ? "添加列" : "Add column"}
            onPointerDown={stop}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleAppendCol}
          >
            +
          </button>
        )}
      </div>

      {/* Feishu-style bottom '+' row adder rail */}
      {isActive && !readOnly && (
        <button
          type="button"
          className="tbl-edge-add tbl-edge-add-row"
          title={isZh ? "底部添加一行" : "Add row"}
          aria-label={isZh ? "添加行" : "Add row"}
          onPointerDown={stop}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleAppendRow}
        >
          +
        </button>
      )}
    </div>
  );
}
