export const TABLE_LINK = "table://card";

export const TABLE_CELL_BG_PALETTE = [
  { id: null, swatch: "transparent", light: null, dark: null, zh: "默认", en: "Default" },
  { id: "yellow", swatch: "#fff3bf", light: "#fff3bf", dark: "rgba(250, 204, 21, 0.22)", zh: "黄", en: "Yellow" },
  { id: "red", swatch: "#ffe3e3", light: "#ffe3e3", dark: "rgba(255, 107, 107, 0.22)", zh: "红", en: "Red" },
  { id: "green", swatch: "#d3f9d8", light: "#d3f9d8", dark: "rgba(81, 207, 102, 0.22)", zh: "绿", en: "Green" },
  { id: "blue", swatch: "#d0ebff", light: "#d0ebff", dark: "rgba(77, 171, 247, 0.22)", zh: "蓝", en: "Blue" },
  { id: "purple", swatch: "#ede9fe", light: "#ede9fe", dark: "rgba(167, 139, 250, 0.24)", zh: "紫", en: "Purple" },
  { id: "gray", swatch: "#f1f3f5", light: "#f1f3f5", dark: "rgba(148, 163, 184, 0.2)", zh: "灰", en: "Gray" },
];

export const TABLE_CELL_TEXT_PALETTE = [
  { id: null, swatch: "transparent", light: null, dark: null, zh: "默认", en: "Default" },
  { id: "red", swatch: "#e03131", light: "#e03131", dark: "#ff8787", zh: "红", en: "Red" },
  { id: "orange", swatch: "#e8590c", light: "#e8590c", dark: "#ffa94d", zh: "橙", en: "Orange" },
  { id: "green", swatch: "#2b8a3e", light: "#2b8a3e", dark: "#69db7c", zh: "绿", en: "Green" },
  { id: "blue", swatch: "#1971c2", light: "#1971c2", dark: "#74c0fc", zh: "蓝", en: "Blue" },
  { id: "purple", swatch: "#6741d9", light: "#6741d9", dark: "#b197fc", zh: "紫", en: "Purple" },
  { id: "gray", swatch: "#868e96", light: "#868e96", dark: "#adb5bd", zh: "灰", en: "Gray" },
];

export function resolveCellBg(id, isDark) {
  if (!id) return null;
  const found = TABLE_CELL_BG_PALETTE.find((c) => c.id === id);
  if (found) return isDark ? found.dark : found.light;
  return id;
}

export function resolveCellTextColor(id, isDark) {
  if (!id) return null;
  const found = TABLE_CELL_TEXT_PALETTE.find((c) => c.id === id);
  if (found) return isDark ? found.dark : found.light;
  return id;
}

export function createEmptyCell(text = "") {
  return {
    text: String(text ?? ""),
    bg: null,
    color: null,
    bold: false,
    rowSpan: 1,
    colSpan: 1,
    mergedInto: null,
  };
}

export function createDefaultTable() {
  return {
    headerRow: true,
    striped: false,
    outerBorder: true,
    colWidths: [140, 140, 140],
    colAligns: ["left", "left", "left"],
    rows: [
      [createEmptyCell(""), createEmptyCell(""), createEmptyCell("")],
      [createEmptyCell(""), createEmptyCell(""), createEmptyCell("")],
      [createEmptyCell(""), createEmptyCell(""), createEmptyCell("")],
    ],
  };
}

export function normalizeCell(raw) {
  if (typeof raw === "string") return createEmptyCell(raw);
  if (!raw || typeof raw !== "object") return createEmptyCell("");
  return {
    text: String(raw.text ?? ""),
    bg: raw.bg || null,
    color: raw.color || null,
    bold: Boolean(raw.bold),
    rowSpan: Math.max(1, Math.floor(Number(raw.rowSpan) || 1)),
    colSpan: Math.max(1, Math.floor(Number(raw.colSpan) || 1)),
    mergedInto:
      raw.mergedInto &&
      typeof raw.mergedInto.r === "number" &&
      typeof raw.mergedInto.c === "number"
        ? { r: raw.mergedInto.r, c: raw.mergedInto.c }
        : null,
  };
}

function cloneRows(rows) {
  return rows.map((row) =>
    row.map((cell) => ({
      ...cell,
      mergedInto: cell.mergedInto ? { ...cell.mergedInto } : null,
    }))
  );
}

/**
 * Repair & enforce merge invariants so every rowSpan/colSpan matches mergedInto pointers.
 */
function repairMerges(rows) {
  const R = rows.length;
  const C = rows[0]?.length || 0;
  const out = cloneRows(rows);

  // Reset all mergedInto first, then rebuild from valid anchors
  for (let r = 0; r < R; r += 1) {
    for (let c = 0; c < C; c += 1) {
      out[r][c].mergedInto = null;
      out[r][c].rowSpan = Math.max(1, Math.min(R - r, out[r][c].rowSpan || 1));
      out[r][c].colSpan = Math.max(1, Math.min(C - c, out[r][c].colSpan || 1));
    }
  }

  for (let r = 0; r < R; r += 1) {
    for (let c = 0; c < C; c += 1) {
      const cell = out[r][c];
      if (cell.mergedInto) {
        cell.rowSpan = 1;
        cell.colSpan = 1;
        continue;
      }
      const rs = cell.rowSpan;
      const cs = cell.colSpan;
      if (rs === 1 && cs === 1) continue;

      // Verify no overlap with existing merged cells
      let conflict = false;
      for (let dr = 0; dr < rs && !conflict; dr += 1) {
        for (let dc = 0; dc < cs; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          if (out[r + dr][c + dc].mergedInto) {
            conflict = true;
            break;
          }
        }
      }
      if (conflict) {
        cell.rowSpan = 1;
        cell.colSpan = 1;
        continue;
      }
      for (let dr = 0; dr < rs; dr += 1) {
        for (let dc = 0; dc < cs; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          out[r + dr][c + dc].mergedInto = { r, c };
          out[r + dr][c + dc].rowSpan = 1;
          out[r + dr][c + dc].colSpan = 1;
        }
      }
    }
  }
  return out;
}

export function normalizeTableData(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.rows) || raw.rows.length === 0) {
    return createDefaultTable(true);
  }
  const colCount = Math.max(
    1,
    ...raw.rows.map((r) => (Array.isArray(r) ? r.length : 0))
  );
  const rawRows = raw.rows.map((r) => {
    const arr = Array.isArray(r) ? r : [];
    const out = [];
    for (let c = 0; c < colCount; c += 1) {
      out.push(normalizeCell(arr[c]));
    }
    return out;
  });
  const rows = repairMerges(rawRows);
  const colWidths = [];
  for (let c = 0; c < colCount; c += 1) {
    const w = Number(raw.colWidths?.[c]);
    colWidths.push(Number.isFinite(w) && w >= 48 ? w : 140);
  }
  const colAligns = [];
  for (let c = 0; c < colCount; c += 1) {
    const a = raw.colAligns?.[c];
    colAligns.push(a === "center" || a === "right" ? a : "left");
  }
  return {
    headerRow: raw.headerRow !== false,
    striped: Boolean(raw.striped),
    outerBorder: raw.outerBorder !== false,
    colWidths,
    colAligns,
    rows,
  };
}

export function getCellAnchor(table, r, c) {
  const cell = table.rows[r]?.[c];
  if (!cell) return { r, c };
  return cell.mergedInto ? { r: cell.mergedInto.r, c: cell.mergedInto.c } : { r, c };
}

/**
 * Given any rectangular range { r1, c1, r2, c2 }, expand it until it completely
 * encompasses every merged cell intersecting the range (Feishu / Excel behavior).
 */
export function expandSelectionForMerges(table, range) {
  if (!range) return null;
  const R = table.rows.length;
  const C = table.colWidths.length;
  let r1 = Math.max(0, Math.min(range.r1, range.r2, R - 1));
  let r2 = Math.max(0, Math.min(Math.max(range.r1, range.r2), R - 1));
  let c1 = Math.max(0, Math.min(range.c1, range.c2, C - 1));
  let c2 = Math.max(0, Math.min(Math.max(range.c1, range.c2), C - 1));

  let changed = true;
  while (changed) {
    changed = false;
    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        const anchor = getCellAnchor(table, r, c);
        const aCell = table.rows[anchor.r][anchor.c];
        const ar1 = anchor.r;
        const ac1 = anchor.c;
        const ar2 = ar1 + (aCell.rowSpan || 1) - 1;
        const ac2 = ac1 + (aCell.colSpan || 1) - 1;
        if (ar1 < r1) { r1 = ar1; changed = true; }
        if (ac1 < c1) { c1 = ac1; changed = true; }
        if (ar2 > r2) { r2 = ar2; changed = true; }
        if (ac2 > c2) { c2 = ac2; changed = true; }
      }
    }
  }
  return { r1, c1, r2, c2 };
}

export function canMergeRange(table, range) {
  const exp = expandSelectionForMerges(table, range);
  if (!exp) return false;
  const spanR = exp.r2 - exp.r1 + 1;
  const spanC = exp.c2 - exp.c1 + 1;
  if (spanR === 1 && spanC === 1) return false;
  const anchor = table.rows[exp.r1]?.[exp.c1];
  if (!anchor) return false;
  // Already a single merged cell covering this exact rectangle
  if ((anchor.rowSpan || 1) === spanR && (anchor.colSpan || 1) === spanC) {
    return false;
  }
  return true;
}

export function canSplitRange(table, range) {
  const exp = expandSelectionForMerges(table, range);
  if (!exp) return false;
  for (let r = exp.r1; r <= exp.r2; r += 1) {
    for (let c = exp.c1; c <= exp.c2; c += 1) {
      const cell = table.rows[r]?.[c];
      if (cell && ((cell.rowSpan || 1) > 1 || (cell.colSpan || 1) > 1)) {
        return true;
      }
    }
  }
  return false;
}

export function mergeCells(table, range) {
  const exp = expandSelectionForMerges(table, range);
  if (!exp || !canMergeRange(table, exp)) return table;

  const rows = cloneRows(table.rows);
  const texts = [];
  for (let r = exp.r1; r <= exp.r2; r += 1) {
    for (let c = exp.c1; c <= exp.c2; c += 1) {
      const cell = rows[r][c];
      if (!cell.mergedInto && cell.text.trim()) {
        texts.push(cell.text.trim());
      }
    }
  }

  const anchor = rows[exp.r1][exp.c1];
  anchor.text = texts.join("\n");
  anchor.rowSpan = exp.r2 - exp.r1 + 1;
  anchor.colSpan = exp.c2 - exp.c1 + 1;
  anchor.mergedInto = null;

  for (let r = exp.r1; r <= exp.r2; r += 1) {
    for (let c = exp.c1; c <= exp.c2; c += 1) {
      if (r === exp.r1 && c === exp.c1) continue;
      rows[r][c] = {
        ...createEmptyCell(""),
        mergedInto: { r: exp.r1, c: exp.c1 },
      };
    }
  }

  return { ...table, rows: repairMerges(rows) };
}

export function splitCells(table, range) {
  const exp = expandSelectionForMerges(table, range);
  if (!exp) return table;

  const rows = cloneRows(table.rows);
  for (let r = exp.r1; r <= exp.r2; r += 1) {
    for (let c = exp.c1; c <= exp.c2; c += 1) {
      rows[r][c].rowSpan = 1;
      rows[r][c].colSpan = 1;
      rows[r][c].mergedInto = null;
    }
  }
  return { ...table, rows: repairMerges(rows) };
}

export function insertRowAt(table, insertAt) {
  const R = table.rows.length;
  const C = table.colWidths.length;
  const idx = Math.max(0, Math.min(R, insertAt));
  const rows = cloneRows(table.rows);
  const newRow = Array.from({ length: C }, () => createEmptyCell(""));

  // Extend any vertical merge that crosses the insertion boundary (starts before idx and ends >= idx)
  for (let r = 0; r < idx; r += 1) {
    for (let c = 0; c < C; c += 1) {
      const cell = rows[r][c];
      if (!cell.mergedInto && r + (cell.rowSpan || 1) > idx) {
        cell.rowSpan += 1;
      }
    }
  }

  rows.splice(idx, 0, newRow);
  return { ...table, rows: repairMerges(rows) };
}

export function deleteRowAt(table, rowIdx) {
  const R = table.rows.length;
  const C = table.colWidths.length;
  if (R <= 1 || rowIdx < 0 || rowIdx >= R) return table;

  const rows = cloneRows(table.rows);
  for (let c = 0; c < C; c += 1) {
    const cell = rows[rowIdx][c];
    if (!cell.mergedInto && (cell.rowSpan || 1) > 1) {
      // Anchor is on the deleted row: promote anchor down by 1 row
      const nextAnchor = rows[rowIdx + 1][c];
      nextAnchor.text = cell.text;
      nextAnchor.bg = cell.bg;
      nextAnchor.color = cell.color;
      nextAnchor.bold = cell.bold;
      nextAnchor.rowSpan = cell.rowSpan - 1;
      nextAnchor.colSpan = cell.colSpan;
      nextAnchor.mergedInto = null;
    } else if (cell.mergedInto && cell.mergedInto.r < rowIdx) {
      // Merge started above rowIdx: shrink its rowSpan once per anchor
      const anchor = rows[cell.mergedInto.r][cell.mergedInto.c];
      if (cell.mergedInto.c === c) {
        anchor.rowSpan = Math.max(1, (anchor.rowSpan || 1) - 1);
      }
    }
  }

  rows.splice(rowIdx, 1);
  return { ...table, rows: repairMerges(rows) };
}

export function insertColAt(table, insertAt, headerLabel = "") {
  const R = table.rows.length;
  const C = table.colWidths.length;
  const idx = Math.max(0, Math.min(C, insertAt));
  const rows = cloneRows(table.rows);

  // Extend any horizontal merge crossing idx
  for (let r = 0; r < R; r += 1) {
    for (let c = 0; c < idx; c += 1) {
      const cell = rows[r][c];
      if (!cell.mergedInto && c + (cell.colSpan || 1) > idx) {
        cell.colSpan += 1;
      }
    }
  }

  for (let r = 0; r < R; r += 1) {
    rows[r].splice(
      idx,
      0,
      createEmptyCell(table.headerRow && r === 0 ? headerLabel : "")
    );
  }

  const colWidths = [...table.colWidths];
  colWidths.splice(idx, 0, 130);
  const colAligns = [...table.colAligns];
  colAligns.splice(idx, 0, "left");

  return {
    ...table,
    colWidths,
    colAligns,
    rows: repairMerges(rows),
  };
}

export function deleteColAt(table, colIdx) {
  const R = table.rows.length;
  const C = table.colWidths.length;
  if (C <= 1 || colIdx < 0 || colIdx >= C) return table;

  const rows = cloneRows(table.rows);
  for (let r = 0; r < R; r += 1) {
    const cell = rows[r][colIdx];
    if (!cell.mergedInto && (cell.colSpan || 1) > 1) {
      // Promote anchor right by 1 column
      const nextAnchor = rows[r][colIdx + 1];
      nextAnchor.text = cell.text;
      nextAnchor.bg = cell.bg;
      nextAnchor.color = cell.color;
      nextAnchor.bold = cell.bold;
      nextAnchor.rowSpan = cell.rowSpan;
      nextAnchor.colSpan = cell.colSpan - 1;
      nextAnchor.mergedInto = null;
    } else if (cell.mergedInto && cell.mergedInto.c < colIdx) {
      const anchor = rows[cell.mergedInto.r][cell.mergedInto.c];
      if (cell.mergedInto.r === r) {
        anchor.colSpan = Math.max(1, (anchor.colSpan || 1) - 1);
      }
    }
  }

  for (let r = 0; r < R; r += 1) {
    rows[r].splice(colIdx, 1);
  }
  const colWidths = table.colWidths.filter((_, i) => i !== colIdx);
  const colAligns = table.colAligns.filter((_, i) => i !== colIdx);

  return {
    ...table,
    colWidths,
    colAligns,
    rows: repairMerges(rows),
  };
}

// Lightweight selection store bridging TableCard <-> Left Style Panel
let activeTableSelection = null; // { elementId, range: { r1, c1, r2, c2 }, editingCell: { r, c } | null }
const selectionListeners = new Set();

export function getTableSelection() {
  return activeTableSelection;
}

export function setTableSelection(next) {
  activeTableSelection = next;
  for (const fn of selectionListeners) {
    try {
      fn(activeTableSelection);
    } catch {}
  }
}

export function onTableSelectionChange(fn) {
  selectionListeners.add(fn);
  return () => selectionListeners.delete(fn);
}

function parseTsvMatrix(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.length === 0) {
      inQuotes = true;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  while (rows.length > 1 && rows[rows.length - 1].every((c) => c === "")) {
    rows.pop();
  }
  return rows;
}

function parseMarkdownTable(text) {
  const lines = text
    .trim()
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  if (!lines[0].includes("|") || !lines[1].includes("|")) return null;

  const splitRow = (line) => {
    const trimmed = line.replace(/^\|/, "").replace(/\|$/, "");
    return trimmed.split("|").map((c) => c.trim());
  };

  const sepCells = splitRow(lines[1]);
  const isSep =
    sepCells.length >= 1 &&
    sepCells.every((c) => /^:?-{2,}:?$/.test(c));
  if (!isSep) return null;

  const aligns = sepCells.map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    return "left";
  });

  const rows = [splitRow(lines[0])];
  for (let i = 2; i < lines.length; i += 1) {
    if (!lines[i].includes("|")) break;
    rows.push(splitRow(lines[i]));
  }
  return { rows, aligns, isMarkdown: true };
}

export function parseTabularPaste(text) {
  if (!text || typeof text !== "string") return null;

  const md = parseMarkdownTable(text);
  if (md && (md.rows.length > 1 || md.rows[0].length > 1)) {
    return md;
  }

  if (text.includes("\t")) {
    const rows = parseTsvMatrix(text);
    if (rows.length > 1 || (rows[0] && rows[0].length > 1)) {
      return { rows, aligns: null, isMarkdown: false };
    }
  }

  return null;
}

export function tableToMarkdown(rawTable) {
  const table = normalizeTableData(rawTable);
  const esc = (str) => String(str ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  const colCount = table.colWidths.length;

  const formatRow = (row) =>
    `| ${row.map((cell) => esc(cell.mergedInto ? "" : cell.text)).join(" | ")} |`;

  const sepRow = `| ${table.colAligns
    .map((a) => (a === "center" ? ":---:" : a === "right" ? "---:" : "---"))
    .join(" | ")} |`;

  if (table.rows.length === 0) return "";
  if (table.headerRow) {
    const lines = [formatRow(table.rows[0]), sepRow];
    for (let r = 1; r < table.rows.length; r += 1) {
      lines.push(formatRow(table.rows[r]));
    }
    return lines.join("\n");
  }

  const emptyHeader = `| ${Array(colCount).fill(" ").join(" | ")} |`;
  return [emptyHeader, sepRow, ...table.rows.map(formatRow)].join("\n");
}
