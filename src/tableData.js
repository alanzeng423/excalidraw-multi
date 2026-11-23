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
  return { text: String(text ?? ""), bg: null, color: null, bold: false };
}

export function createDefaultTable(isZh = true) {
  return {
    headerRow: true,
    striped: false,
    colWidths: [140, 120, 180],
    colAligns: ["left", "center", "left"],
    rows: isZh
      ? [
          [createEmptyCell("项目"), createEmptyCell("状态"), createEmptyCell("备注")],
          [createEmptyCell("核心功能"), { text: "已完成", bg: "green", color: "green", bold: true }, createEmptyCell("双击任意单元格编辑")],
          [createEmptyCell("细节打磨"), { text: "进行中", bg: "yellow", color: "orange", bold: false }, createEmptyCell("Tab 切格 · 支持粘贴 Excel / MD")],
        ]
      : [
          [createEmptyCell("Item"), createEmptyCell("Status"), createEmptyCell("Notes")],
          [createEmptyCell("Core feature"), { text: "Done", bg: "green", color: "green", bold: true }, createEmptyCell("Click any cell to edit")],
          [createEmptyCell("Polish"), { text: "In progress", bg: "yellow", color: "orange", bold: false }, createEmptyCell("Tab to move · Paste Excel / MD")],
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
  };
}

export function normalizeTableData(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.rows) || raw.rows.length === 0) {
    return createDefaultTable(true);
  }
  const colCount = Math.max(
    1,
    ...raw.rows.map((r) => (Array.isArray(r) ? r.length : 0))
  );
  const rows = raw.rows.map((r) => {
    const arr = Array.isArray(r) ? r : [];
    const out = [];
    for (let c = 0; c < colCount; c += 1) {
      out.push(normalizeCell(arr[c]));
    }
    return out;
  });
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
    colWidths,
    colAligns,
    rows,
  };
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
  // Drop trailing blank line produced by spreadsheet copy
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

/**
 * Parse clipboard text as a multi-cell table if it's TSV (Excel / Sheets / Feishu)
 * or a GFM Markdown table. Returns null for ordinary single-cell text so native
 * textarea paste continues uninterrupted.
 */
export function parseTabularPaste(text) {
  if (!text || typeof text !== "string") return null;

  // 1. Markdown pipe table
  const md = parseMarkdownTable(text);
  if (md && (md.rows.length > 1 || md.rows[0].length > 1)) {
    return md;
  }

  // 2. TSV (contains tab, or multiple lines copied from a spreadsheet column)
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
    `| ${row.map((cell) => esc(cell.text)).join(" | ")} |`;

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

  // No explicit header row: emit empty header so GFM remains valid
  const emptyHeader = `| ${Array(colCount).fill(" ").join(" | ")} |`;
  return [emptyHeader, sepRow, ...table.rows.map(formatRow)].join("\n");
}
