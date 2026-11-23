import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TABLE_CELL_BG_PALETTE,
  TABLE_CELL_TEXT_PALETTE,
  createEmptyCell,
  normalizeTableData,
  parseTabularPaste,
  resolveCellBg,
  resolveCellTextColor,
  tableToMarkdown,
} from "./tableData";

const ALIGN_ORDER = ["left", "center", "right"];

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

  const [focus, setFocus] = useState(null); // { r, c } | null
  const [openPicker, setOpenPicker] = useState(null); // "bg" | "color" | null
  const [copiedMd, setCopiedMd] = useState(false);
  const [resizingWidths, setResizingWidths] = useState(null);

  const tableWrapRef = useRef(null);
  const editorRef = useRef(null);
  const resizeStateRef = useRef(null);

  // Clear focus & pickers when leaving active edit mode or read-only
  useEffect(() => {
    if (!isActive || readOnly) {
      setFocus(null);
      setOpenPicker(null);
    }
  }, [isActive, readOnly]);

  // Clamp focus if rows/cols shrink externally (e.g. Undo)
  useEffect(() => {
    if (!focus) return;
    const maxR = table.rows.length - 1;
    const maxC = table.colWidths.length - 1;
    if (focus.r > maxR || focus.c > maxC) {
      setFocus({ r: Math.min(focus.r, maxR), c: Math.min(focus.c, maxC) });
    }
  }, [focus, table.rows.length, table.colWidths.length]);

  // Focus & auto-size textarea whenever focused cell changes
  useEffect(() => {
    const el = editorRef.current;
    if (!el || !focus) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [focus?.r, focus?.c]);

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

  const handleAddRow = useCallback(
    (afterIdx) => {
      const colCount = table.colWidths.length;
      const insertAt =
        typeof afterIdx === "number"
          ? Math.min(table.rows.length, afterIdx + 1)
          : table.rows.length;
      const newRow = Array.from({ length: colCount }, () => createEmptyCell(""));
      const nextRows = [
        ...table.rows.slice(0, insertAt),
        newRow,
        ...table.rows.slice(insertAt),
      ];
      commit({ ...table, rows: nextRows });
      setFocus({ r: insertAt, c: focus ? Math.min(focus.c, colCount - 1) : 0 });
    },
    [table, commit, focus]
  );

  const handleDeleteRow = useCallback(() => {
    if (table.rows.length <= 1) return;
    const targetR = focus ? focus.r : table.rows.length - 1;
    const nextRows = table.rows.filter((_, ri) => ri !== targetR);
    commit({ ...table, rows: nextRows });
    setFocus({
      r: Math.min(targetR, nextRows.length - 1),
      c: focus ? focus.c : 0,
    });
  }, [table, commit, focus]);

  const handleAddCol = useCallback(() => {
    const insertAt = focus ? focus.c + 1 : table.colWidths.length;
    const nextWidths = [
      ...table.colWidths.slice(0, insertAt),
      130,
      ...table.colWidths.slice(insertAt),
    ];
    const nextAligns = [
      ...table.colAligns.slice(0, insertAt),
      "left",
      ...table.colAligns.slice(insertAt),
    ];
    const nextRows = table.rows.map((row, ri) => [
      ...row.slice(0, insertAt),
      createEmptyCell(
        table.headerRow && ri === 0
          ? isZh
            ? `列 ${insertAt + 1}`
            : `Col ${insertAt + 1}`
          : ""
      ),
      ...row.slice(insertAt),
    ]);
    commit({
      ...table,
      colWidths: nextWidths,
      colAligns: nextAligns,
      rows: nextRows,
    });
    setFocus({ r: focus ? focus.r : 0, c: insertAt });
  }, [table, commit, focus, isZh]);

  const handleDeleteCol = useCallback(() => {
    if (table.colWidths.length <= 1) return;
    const targetC = focus ? focus.c : table.colWidths.length - 1;
    const nextWidths = table.colWidths.filter((_, ci) => ci !== targetC);
    const nextAligns = table.colAligns.filter((_, ci) => ci !== targetC);
    const nextRows = table.rows.map((row) =>
      row.filter((_, ci) => ci !== targetC)
    );
    commit({
      ...table,
      colWidths: nextWidths,
      colAligns: nextAligns,
      rows: nextRows,
    });
    setFocus({
      r: focus ? focus.r : 0,
      c: Math.min(targetC, nextWidths.length - 1),
    });
  }, [table, commit, focus]);

  const handleCycleAlign = useCallback(() => {
    const col = focus ? focus.c : 0;
    const cur = table.colAligns[col] || "left";
    const nextAlign = ALIGN_ORDER[(ALIGN_ORDER.indexOf(cur) + 1) % ALIGN_ORDER.length];
    const nextAligns = table.colAligns.map((a, i) => (i === col ? nextAlign : a));
    commit({ ...table, colAligns: nextAligns });
  }, [table, commit, focus]);

  const handleCopyMarkdown = useCallback(async () => {
    const md = tableToMarkdown(table);
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand?.("copy");
      ta.remove();
    }
    setCopiedMd(true);
    setTimeout(() => setCopiedMd(false), 1600);
  }, [table]);

  // Column width drag resizing
  const startColResize = useCallback(
    (e, colIdx) => {
      if (readOnly || !isActive) return;
      e.preventDefault();
      e.stopPropagation();
      const wrapWidth = tableWrapRef.current?.clientWidth || element.width || 440;
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
          const w1 = Math.max(minW, Math.min(sumPair - minW, st.startWidths[st.colIdx] + deltaWeight));
          next[st.colIdx] = Math.round(w1);
          next[st.colIdx + 1] = Math.round(sumPair - w1);
        } else {
          next[st.colIdx] = Math.round(Math.max(minW, st.startWidths[st.colIdx] + deltaWeight));
        }
        setResizingWidths(next);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setResizingWidths((latest) => {
          if (latest) {
            commit({ ...table, colWidths: latest });
          }
          return null;
        });
        resizeStateRef.current = null;
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [readOnly, isActive, table, element.width, commit]
  );

  // Keyboard navigation inside cell editor
  const handleCellKeyDown = useCallback(
    (e, r, c) => {
      e.stopPropagation();
      const rowCount = table.rows.length;
      const colCount = table.colWidths.length;

      if (e.key === "Escape") {
        e.preventDefault();
        setFocus(null);
        setOpenPicker(null);
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          if (c > 0) setFocus({ r, c: c - 1 });
          else if (r > 0) setFocus({ r: r - 1, c: colCount - 1 });
        } else {
          if (c < colCount - 1) {
            setFocus({ r, c: c + 1 });
          } else if (r < rowCount - 1) {
            setFocus({ r: r + 1, c: 0 });
          } else {
            // Tab at last cell appends a new row automatically
            handleAddRow(rowCount - 1);
          }
        }
        return;
      }

      if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        if (r < rowCount - 1) {
          setFocus({ r: r + 1, c });
        } else {
          handleAddRow(rowCount - 1);
        }
        return;
      }

      if (e.key === "ArrowUp" && !e.shiftKey) {
        const ta = e.currentTarget;
        const beforeCaret = ta.value.slice(0, ta.selectionStart);
        if (!beforeCaret.includes("\n") && r > 0) {
          e.preventDefault();
          setFocus({ r: r - 1, c });
        }
        return;
      }

      if (e.key === "ArrowDown" && !e.shiftKey) {
        const ta = e.currentTarget;
        const afterCaret = ta.value.slice(ta.selectionEnd);
        if (!afterCaret.includes("\n") && r < rowCount - 1) {
          e.preventDefault();
          setFocus({ r: r + 1, c });
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        const cell = table.rows[r][c];
        updateCell(r, c, { bold: !cell.bold });
      }
    },
    [table, handleAddRow, updateCell]
  );

  // Smart paste from Excel / Feishu / Google Sheets (TSV) or Markdown pipe table
  const handleCellPaste = useCallback(
    (e, startR, startC) => {
      e.stopPropagation();
      const text = e.clipboardData?.getData("text/plain");
      const parsed = parseTabularPaste(text);
      if (!parsed) return; // let normal text paste into the cell

      e.preventDefault();
      const pastedRows = parsed.rows;
      const pasteH = pastedRows.length;
      const pasteW = Math.max(...pastedRows.map((row) => row.length));

      const targetRowsCount = Math.max(table.rows.length, startR + pasteH);
      const targetColsCount = Math.max(table.colWidths.length, startC + pasteW);

      const nextWidths = [...table.colWidths];
      const nextAligns = [...table.colAligns];
      while (nextWidths.length < targetColsCount) nextWidths.push(130);
      while (nextAligns.length < targetColsCount) nextAligns.push("left");

      if (parsed.aligns && startR === 0 && startC === 0) {
        for (let i = 0; i < parsed.aligns.length && i < nextAligns.length; i += 1) {
          nextAligns[i] = parsed.aligns[i];
        }
      }

      const nextRows = Array.from({ length: targetRowsCount }, (_, ri) => {
        const existing = table.rows[ri] || [];
        return Array.from({ length: targetColsCount }, (_, ci) =>
          existing[ci] ? { ...existing[ci] } : createEmptyCell("")
        );
      });

      for (let dr = 0; dr < pasteH; dr += 1) {
        for (let dc = 0; dc < pastedRows[dr].length; dc += 1) {
          nextRows[startR + dr][startC + dc] = {
            ...nextRows[startR + dr][startC + dc],
            text: pastedRows[dr][dc],
          };
        }
      }

      commit({
        ...table,
        colWidths: nextWidths,
        colAligns: nextAligns,
        rows: nextRows,
      });
    },
    [table, commit]
  );

  const stop = (e) => e.stopPropagation();

  const effectiveWidths = resizingWidths || table.colWidths;
  const totalWeight = effectiveWidths.reduce((s, v) => s + v, 0) || 1;
  const activeCell = focus ? table.rows[focus.r]?.[focus.c] : null;
  const activeColAlign = focus ? table.colAligns[focus.c] || "left" : table.colAligns[0] || "left";
  const customBg =
    element.backgroundColor && element.backgroundColor !== "transparent"
      ? element.backgroundColor
      : undefined;

  const alignLabel =
    activeColAlign === "center"
      ? isZh
        ? "居中"
        : "Center"
      : activeColAlign === "right"
        ? isZh
          ? "右对齐"
          : "Right"
        : isZh
          ? "左对齐"
          : "Left";

  return (
    <div
      className={`table-card ${isDark ? "is-dark" : ""} ${
        isActive ? "is-active" : ""
      }`}
      style={customBg ? { backgroundColor: customBg } : undefined}
      onWheel={isActive ? stop : undefined}
      onCopy={isActive ? stop : undefined}
      onCut={isActive ? stop : undefined}
      onPaste={isActive ? stop : undefined}
      onKeyDown={isActive ? stop : undefined}
      onKeyUp={isActive ? stop : undefined}
    >
      {isActive && !readOnly && (
        <div
          className="table-card-toolbar"
          onPointerDown={stop}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className="table-toolbar-group">
            <span className="table-card-tag">
              {table.rows.length}×{table.colWidths.length}
            </span>
            <button
              type="button"
              className="tbl-btn"
              title={isZh ? "在下方插入一行" : "Insert row below"}
              onClick={() => handleAddRow(focus ? focus.r : table.rows.length - 1)}
            >
              {isZh ? "+行" : "+Row"}
            </button>
            <button
              type="button"
              className="tbl-btn"
              title={isZh ? "在右侧插入一列" : "Insert column right"}
              onClick={handleAddCol}
            >
              {isZh ? "+列" : "+Col"}
            </button>
            <button
              type="button"
              className="tbl-btn danger"
              disabled={table.rows.length <= 1}
              title={isZh ? "删除当前行" : "Delete current row"}
              onClick={handleDeleteRow}
            >
              {isZh ? "-行" : "-Row"}
            </button>
            <button
              type="button"
              className="tbl-btn danger"
              disabled={table.colWidths.length <= 1}
              title={isZh ? "删除当前列" : "Delete current column"}
              onClick={handleDeleteCol}
            >
              {isZh ? "-列" : "-Col"}
            </button>
          </div>

          <div className="table-toolbar-group">
            <button
              type="button"
              className={`tbl-btn ${table.headerRow ? "active" : ""}`}
              title={isZh ? "首行作为表头" : "Toggle header row"}
              onClick={() => commit({ ...table, headerRow: !table.headerRow })}
            >
              {isZh ? "表头" : "Header"}
            </button>
            <button
              type="button"
              className={`tbl-btn ${table.striped ? "active" : ""}`}
              title={isZh ? "隔行斑马纹" : "Toggle striped rows"}
              onClick={() => commit({ ...table, striped: !table.striped })}
            >
              {isZh ? "斑马纹" : "Stripe"}
            </button>
            <button
              type="button"
              className="tbl-btn"
              title={isZh ? "切换当前列对齐方式" : "Cycle column alignment"}
              onClick={handleCycleAlign}
            >
              {alignLabel}
            </button>

            {activeCell && (
              <>
                <span className="tbl-sep" aria-hidden="true" />
                <button
                  type="button"
                  className={`tbl-btn ${activeCell.bold ? "active" : ""}`}
                  title={isZh ? "单元格加粗 (Ctrl+B)" : "Cell bold (Ctrl+B)"}
                  onClick={() =>
                    updateCell(focus.r, focus.c, { bold: !activeCell.bold })
                  }
                >
                  <strong>B</strong>
                </button>

                <div className="tbl-picker-wrap">
                  <button
                    type="button"
                    className={`tbl-btn tbl-swatch-trigger ${
                      openPicker === "bg" ? "active" : ""
                    }`}
                    title={isZh ? "单元格背景色" : "Cell background color"}
                    onClick={() =>
                      setOpenPicker((p) => (p === "bg" ? null : "bg"))
                    }
                  >
                    <span
                      className="tbl-color-dot"
                      style={{
                        background:
                          resolveCellBg(activeCell.bg, isDark) || "transparent",
                      }}
                    />
                  </button>
                  {openPicker === "bg" && (
                    <div className="tbl-popover" onPointerDown={stop}>
                      {TABLE_CELL_BG_PALETTE.map((c) => (
                        <button
                          key={String(c.id)}
                          type="button"
                          className={`tbl-pop-swatch ${
                            activeCell.bg === c.id ? "active" : ""
                          } ${c.id === null ? "is-none" : ""}`}
                          style={
                            c.id !== null
                              ? { background: c.swatch }
                              : undefined
                          }
                          title={isZh ? c.zh : c.en}
                          onClick={() => {
                            updateCell(focus.r, focus.c, { bg: c.id });
                            setOpenPicker(null);
                          }}
                        >
                          {c.id === null ? "×" : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="tbl-picker-wrap">
                  <button
                    type="button"
                    className={`tbl-btn tbl-swatch-trigger ${
                      openPicker === "color" ? "active" : ""
                    }`}
                    title={isZh ? "单元格文字颜色" : "Cell text color"}
                    onClick={() =>
                      setOpenPicker((p) => (p === "color" ? null : "color"))
                    }
                  >
                    <span
                      className="tbl-text-dot"
                      style={{
                        color:
                          resolveCellTextColor(activeCell.color, isDark) ||
                          "currentColor",
                      }}
                    >
                      A
                    </span>
                  </button>
                  {openPicker === "color" && (
                    <div className="tbl-popover" onPointerDown={stop}>
                      {TABLE_CELL_TEXT_PALETTE.map((c) => (
                        <button
                          key={String(c.id)}
                          type="button"
                          className={`tbl-pop-swatch ${
                            activeCell.color === c.id ? "active" : ""
                          } ${c.id === null ? "is-none" : ""}`}
                          style={
                            c.id !== null
                              ? { background: c.swatch }
                              : undefined
                          }
                          title={isZh ? c.zh : c.en}
                          onClick={() => {
                            updateCell(focus.r, focus.c, { color: c.id });
                            setOpenPicker(null);
                          }}
                        >
                          {c.id === null ? "×" : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            <span className="tbl-sep" aria-hidden="true" />
            <button
              type="button"
              className="tbl-btn"
              title={isZh ? "复制为 Markdown 表格" : "Copy as Markdown table"}
              onClick={handleCopyMarkdown}
            >
              {copiedMd
                ? isZh
                  ? "已复制"
                  : "Copied"
                : isZh
                  ? "复制 MD"
                  : "Copy MD"}
            </button>
          </div>
        </div>
      )}

      <div
        className="table-card-scroll"
        ref={tableWrapRef}
        onPointerDown={isActive ? stop : undefined}
      >
        <table className={`canvas-table ${table.striped ? "is-striped" : ""}`}>
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
                    const isFocused =
                      isActive && !readOnly && focus?.r === ri && focus?.c === ci;
                    const align = table.colAligns[ci] || "left";
                    const cellBg = resolveCellBg(cell.bg, isDark);
                    const cellColor = resolveCellTextColor(cell.color, isDark);
                    const Tag = isHeader ? "th" : "td";

                    return (
                      <Tag
                        key={ci}
                        className={`tbl-cell ${isFocused ? "is-focused" : ""} ${
                          cell.bold ? "is-bold" : ""
                        }`}
                        style={{
                          textAlign: align,
                          backgroundColor: cellBg || undefined,
                          color: cellColor || undefined,
                        }}
                        onClick={(e) => {
                          if (!isActive || readOnly) return;
                          e.stopPropagation();
                          setOpenPicker(null);
                          setFocus({ r: ri, c: ci });
                        }}
                      >
                        {isFocused ? (
                          <textarea
                            ref={editorRef}
                            className="tbl-cell-editor"
                            rows={1}
                            value={cell.text}
                            style={{
                              textAlign: align,
                              fontWeight: isHeader || cell.bold ? 600 : 400,
                            }}
                            onChange={(e) => {
                              e.target.style.height = "auto";
                              e.target.style.height = `${e.target.scrollHeight}px`;
                              updateCell(ri, ci, { text: e.target.value });
                            }}
                            onKeyDown={(e) => handleCellKeyDown(e, ri, ci)}
                            onPaste={(e) => handleCellPaste(e, ri, ci)}
                          />
                        ) : (
                          <div className="tbl-cell-view">
                            {cell.text || (isActive && !readOnly ? "\u00A0" : "")}
                          </div>
                        )}

                        {isActive && !readOnly && ci < table.colWidths.length - 1 && (
                          <span
                            className="tbl-col-resizer"
                            title={isZh ? "拖动调整列宽" : "Drag to resize column"}
                            onPointerDown={(e) => startColResize(e, ci)}
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

        {isActive && !readOnly && (
          <button
            type="button"
            className="tbl-quick-add-row"
            onPointerDown={stop}
            onClick={() => handleAddRow(table.rows.length - 1)}
          >
            {isZh ? "+ 添加行" : "+ Add row"}
          </button>
        )}
      </div>
    </div>
  );
}
