const STORAGE_KEY = "excalidraw-multi:native-md";

const HEADING_SCALES = { 1: 1.38, 2: 1.22, 3: 1.1 };
const CODE_FONT = "Cascadia, ui-monospace, SFMono-Regular, Menlo, monospace";

export const TEXT_COLOR_PALETTE = [
  { id: "red", hex: "#e03131", zh: "红", en: "Red" },
  { id: "orange", hex: "#f08c00", zh: "橙", en: "Orange" },
  { id: "green", hex: "#2f9e44", zh: "绿", en: "Green" },
  { id: "blue", hex: "#1971c2", zh: "蓝", en: "Blue" },
  { id: "purple", hex: "#6741d9", zh: "紫", en: "Purple" },
  { id: "pink", hex: "#c2255c", zh: "粉", en: "Pink" },
  { id: "gray", hex: "#868e96", zh: "灰", en: "Gray" },
];

export const HIGHLIGHT_COLOR_PALETTE = [
  {
    id: "yellow",
    swatch: "#ffe066",
    fill: "rgba(255, 224, 102, 0.56)",
    zh: "黄高亮",
    en: "Yellow highlight",
  },
  {
    id: "red",
    swatch: "#ffc9c9",
    fill: "rgba(255, 180, 180, 0.55)",
    zh: "红高亮",
    en: "Red highlight",
  },
  {
    id: "orange",
    swatch: "#ffd8a8",
    fill: "rgba(255, 200, 140, 0.55)",
    zh: "橙高亮",
    en: "Orange highlight",
  },
  {
    id: "green",
    swatch: "#b2f2bb",
    fill: "rgba(160, 238, 175, 0.56)",
    zh: "绿高亮",
    en: "Green highlight",
  },
  {
    id: "blue",
    swatch: "#a5d8ff",
    fill: "rgba(155, 212, 255, 0.56)",
    zh: "蓝高亮",
    en: "Blue highlight",
  },
  {
    id: "purple",
    swatch: "#e5dbff",
    fill: "rgba(216, 200, 255, 0.6)",
    zh: "紫高亮",
    en: "Purple highlight",
  },
];

const TEXT_COLOR_MAP = Object.fromEntries([
  ...TEXT_COLOR_PALETTE.map((c) => [c.id, c.hex]),
  ["yellow", "#e6a800"],
  ["black", "#1e1e1e"],
  ["white", "#ffffff"],
]);

const HIGHLIGHT_COLOR_MAP = Object.fromEntries([
  ...HIGHLIGHT_COLOR_PALETTE.map((c) => [c.id, c.fill]),
  ["pink", "rgba(252, 194, 215, 0.56)"],
  ["gray", "rgba(206, 212, 218, 0.55)"],
]);

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function hexToRgba(hex, alpha) {
  let h = hex.slice(1);
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = +(parseInt(h.slice(6, 8), 16) / 255).toFixed(3);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function resolveTextColor(token) {
  const key = String(token || "").trim().toLowerCase();
  if (!key) return null;
  if (TEXT_COLOR_MAP[key]) return TEXT_COLOR_MAP[key];
  if (HEX_COLOR_RE.test(key)) return key;
  return null;
}

export function resolveHighlightColor(token) {
  const key = String(token || "").trim().toLowerCase();
  if (!key) return null;
  if (HIGHLIGHT_COLOR_MAP[key]) return HIGHLIGHT_COLOR_MAP[key];
  if (HEX_COLOR_RE.test(key)) return hexToRgba(key, 0.46);
  return null;
}

function readInitialEnabled() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

function parseFontString(fontStr) {
  const m = String(fontStr || "").match(
    /(?:^|\s)(\d+(?:\.\d+)?)px\s+(.+)$/
  );
  if (!m) return { fontSize: 20, fontFamily: "Excalifont, Xiaolai, sans-serif" };
  return { fontSize: parseFloat(m[1]), fontFamily: m[2].trim() };
}

function buildCtxFont(fontSize, fontFamily, { bold, italic, code }) {
  const size = code ? fontSize * 0.88 : fontSize;
  const family = code ? CODE_FONT : fontFamily;
  const style = italic && !code ? "italic " : "";
  const weight = bold && !code ? "700 " : "";
  return `${style}${weight}${size}px ${family}`;
}

function findMatchingTagClose(input, startIdx, openTagRe, closeTag) {
  let depth = 1;
  let pos = startIdx;
  while (pos < input.length) {
    const nextClose = input.indexOf(closeTag, pos);
    if (nextClose === -1) return -1;
    // Check if another matching open tag appears before nextClose
    const slice = input.slice(pos, nextClose);
    const openMatch = slice.match(openTagRe);
    if (openMatch && openMatch.index !== undefined) {
      depth += 1;
      pos = pos + openMatch.index + openMatch[0].length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose;
    pos = nextClose + closeTag.length;
  }
  return -1;
}

export function parseInlineSpans(input, baseStyle = {}) {
  const spans = [];
  const push = (text, style) => {
    if (!text) return;
    const merged = {
      bold: Boolean(baseStyle.bold || style.bold),
      italic: Boolean(baseStyle.italic || style.italic),
      strike: Boolean(baseStyle.strike || style.strike),
      code: Boolean(baseStyle.code || style.code),
      color: style.color ?? baseStyle.color ?? null,
      highlight: style.highlight ?? baseStyle.highlight ?? null,
    };
    const prev = spans[spans.length - 1];
    if (
      prev &&
      prev.bold === merged.bold &&
      prev.italic === merged.italic &&
      prev.strike === merged.strike &&
      prev.code === merged.code &&
      prev.color === merged.color &&
      prev.highlight === merged.highlight
    ) {
      prev.text += text;
    } else {
      spans.push({ text, ...merged });
    }
  };

  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];

    // 1. Backslash escape for markdown / tag punctuation
    if (ch === "\\" && i + 1 < len && /[\\*_~=`#>\-\[\]{}]/.test(input[i + 1])) {
      push(input[i + 1], {});
      i += 2;
      continue;
    }

    // 2. Inline code `...`
    if (ch === "`") {
      const end = input.indexOf("`", i + 1);
      if (end > i + 1) {
        push(input.slice(i + 1, end), { code: true });
        i = end + 1;
        continue;
      }
    }

    // 3. Inline text color {c:red}...{/c} or {color:#e03131}...{/color}
    if (ch === "{") {
      const colorOpen = input
        .slice(i)
        .match(/^\{(c|color):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}/);
      if (colorOpen) {
        const tag = colorOpen[1];
        const resolved = resolveTextColor(colorOpen[2]);
        if (resolved) {
          const openLen = colorOpen[0].length;
          const closeTag = `{/${tag}}`;
          const openRe = new RegExp(
            `\\{${tag}:(?:[a-zA-Z]+|#[0-9a-fA-F]{3,8})\\}`
          );
          const end = findMatchingTagClose(input, i + openLen, openRe, closeTag);
          if (end >= i + openLen) {
            const inner = parseInlineSpans(input.slice(i + openLen, end), {
              ...baseStyle,
              color: resolved,
            });
            for (const s of inner) push(s.text, s);
            i = end + closeTag.length;
            continue;
          }
        }
      }

      // 4. Inline highlight color {bg:blue}...{/bg} or {hl:#a5d8ff}...{/hl}
      const bgOpen = input
        .slice(i)
        .match(/^\{(bg|hl):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}/);
      if (bgOpen) {
        const tag = bgOpen[1];
        const resolved = resolveHighlightColor(bgOpen[2]);
        if (resolved) {
          const openLen = bgOpen[0].length;
          const closeTag = `{/${tag}}`;
          const openRe = new RegExp(
            `\\{${tag}:(?:[a-zA-Z]+|#[0-9a-fA-F]{3,8})\\}`
          );
          const end = findMatchingTagClose(input, i + openLen, openRe, closeTag);
          if (end >= i + openLen) {
            const inner = parseInlineSpans(input.slice(i + openLen, end), {
              ...baseStyle,
              highlight: resolved,
            });
            for (const s of inner) push(s.text, s);
            i = end + closeTag.length;
            continue;
          }
        }
      }
    }

    // 5. Bold + Italic ***...***
    if (
      input.startsWith("***", i) &&
      i + 3 < len &&
      !/\s/.test(input[i + 3])
    ) {
      const end = input.indexOf("***", i + 3);
      if (end > i + 3 && !/\s/.test(input[end - 1])) {
        const inner = parseInlineSpans(input.slice(i + 3, end), {
          ...baseStyle,
          bold: true,
          italic: true,
        });
        for (const s of inner) push(s.text, s);
        i = end + 3;
        continue;
      }
    }

    // 6. Bold **...**
    if (
      input.startsWith("**", i) &&
      i + 2 < len &&
      !/\s/.test(input[i + 2])
    ) {
      const end = input.indexOf("**", i + 2);
      if (end > i + 2 && !/\s/.test(input[end - 1])) {
        const inner = parseInlineSpans(input.slice(i + 2, end), {
          ...baseStyle,
          bold: true,
        });
        for (const s of inner) push(s.text, s);
        i = end + 2;
        continue;
      }
    }

    // 7. Strikethrough ~~...~~
    if (
      input.startsWith("~~", i) &&
      i + 2 < len &&
      !/\s/.test(input[i + 2])
    ) {
      const end = input.indexOf("~~", i + 2);
      if (end > i + 2 && !/\s/.test(input[end - 1])) {
        const inner = parseInlineSpans(input.slice(i + 2, end), {
          ...baseStyle,
          strike: true,
        });
        for (const s of inner) push(s.text, s);
        i = end + 2;
        continue;
      }
    }

    // 8. Default yellow highlight ==...==
    if (
      input.startsWith("==", i) &&
      i + 2 < len &&
      !/\s/.test(input[i + 2])
    ) {
      const end = input.indexOf("==", i + 2);
      if (end > i + 2 && !/\s/.test(input[end - 1])) {
        const inner = parseInlineSpans(input.slice(i + 2, end), {
          ...baseStyle,
          highlight: HIGHLIGHT_COLOR_MAP.yellow,
        });
        for (const s of inner) push(s.text, s);
        i = end + 2;
        continue;
      }
    }

    // 9. Italic *...* (strict: no adjacent whitespace so `2 * 3 * 4` won't match)
    if (
      ch === "*" &&
      input[i + 1] !== "*" &&
      i + 1 < len &&
      !/\s/.test(input[i + 1])
    ) {
      let end = -1;
      let search = i + 1;
      while (search < len) {
        const idx = input.indexOf("*", search);
        if (idx === -1) break;
        if (
          input[idx - 1] !== "\\" &&
          input[idx - 1] !== "*" &&
          input[idx + 1] !== "*" &&
          !/\s/.test(input[idx - 1])
        ) {
          end = idx;
          break;
        }
        search = idx + 1;
      }
      if (end > i + 1) {
        const inner = parseInlineSpans(input.slice(i + 1, end), {
          ...baseStyle,
          italic: true,
        });
        for (const s of inner) push(s.text, s);
        i = end + 1;
        continue;
      }
    }

    push(ch, {});
    i += 1;
  }

  return spans;
}

export function parseMarkdownLine(rawLine, inheritedStyle = {}) {
  const line = String(rawLine ?? "");

  // Escaped leading block syntax (\#, \>, \-, \*)
  const escBlock = line.match(/^\\([#>\-*]\s.*)$/);
  if (escBlock) {
    return {
      kind: "normal",
      scale: 1,
      indent: 0,
      prefixType: null,
      spans: parseInlineSpans(escBlock[1], inheritedStyle),
    };
  }

  // Heading: # / ## / ###
  const heading = line.match(/^(#{1,3})\s+(.*)$/);
  if (heading) {
    const level = heading[1].length;
    return {
      kind: "heading",
      level,
      scale: HEADING_SCALES[level] || 1.1,
      indent: 0,
      prefixType: null,
      spans: parseInlineSpans(heading[2], { ...inheritedStyle, bold: true }),
    };
  }

  // Blockquote: > ...
  const quote = line.match(/^>\s?(.*)$/);
  if (quote) {
    return {
      kind: "quote",
      scale: 1,
      indent: 0,
      prefixType: "quote",
      spans: parseInlineSpans(quote[1], inheritedStyle),
    };
  }

  // Task list: - [ ] / - [x] (with optional leading spaces)
  const task = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
  if (task) {
    const indentLevel = Math.floor(task[1].length / 2);
    return {
      kind: "task",
      scale: 1,
      indent: indentLevel,
      prefixType: task[2] === " " ? "task-unchecked" : "task-checked",
      spans: parseInlineSpans(task[3], inheritedStyle),
    };
  }

  // Unordered list: - ... / * ...
  const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
  if (bullet) {
    const indentLevel = Math.floor(bullet[1].length / 2);
    return {
      kind: "bullet",
      scale: 1,
      indent: indentLevel,
      prefixType: "bullet",
      spans: parseInlineSpans(bullet[2], inheritedStyle),
    };
  }

  return {
    kind: "normal",
    scale: 1,
    indent: 0,
    prefixType: null,
    spans: parseInlineSpans(line, inheritedStyle),
  };
}

/**
 * When Excalidraw wraps a single paragraph across multiple visual lines (e.g. inside
 * a shape container), an inline tag like `{c:red}long wrapped text{/c}` or `**bold text**`
 * may open on one line and close on a subsequent line. This helper balances those tags
 * per visual line so every wrapped line renders with the intended inline style.
 */
function balanceWrappedLines(lines) {
  if (!Array.isArray(lines) || lines.length <= 1) return lines;
  const joined = lines.join("\n");
  if (
    !joined.includes("{") &&
    !joined.includes("**") &&
    !joined.includes("~~") &&
    !joined.includes("==")
  ) {
    return lines;
  }

  const out = [];
  const openStack = []; // { open: string, close: string, tag: string }

  for (let li = 0; li < lines.length; li += 1) {
    const raw = lines[li];
    const remainingText = lines.slice(li + 1).join("\n");

    // Re-open tags carried over from previous line
    const prefix = openStack.map((item) => item.open).join("");
    let i = 0;
    const len = raw.length;
    while (i < len) {
      if (raw[i] === "\\" && i + 1 < len) {
        i += 2;
        continue;
      }
      if (raw[i] === "`") {
        const end = raw.indexOf("`", i + 1);
        if (end > i + 1) {
          i = end + 1;
          continue;
        }
      }

      // Check closing tag against top of stack
      let matchedClose = false;
      for (let s = openStack.length - 1; s >= 0; s -= 1) {
        const closeTok = openStack[s].close;
        if (raw.startsWith(closeTok, i)) {
          openStack.splice(s, 1);
          i += closeTok.length;
          matchedClose = true;
          break;
        }
      }
      if (matchedClose) continue;

      // Check new opening tag {c:...}, {color:...}, {bg:...}, {hl:...}
      if (raw[i] === "{") {
        const m = raw
          .slice(i)
          .match(/^\{(c|color|bg|hl):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}/);
        if (m) {
          const closeTok = `{/${m[1]}}`;
          const restOfLine = raw.slice(i + m[0].length);
          if (restOfLine.includes(closeTok) || remainingText.includes(closeTok)) {
            openStack.push({ open: m[0], close: closeTok, tag: m[1] });
            i += m[0].length;
            continue;
          }
        }
      }

      // Check symmetric tokens **, ~~, ==
      let matchedSym = false;
      for (const tok of ["**", "~~", "=="]) {
        if (raw.startsWith(tok, i)) {
          const restOfLine = raw.slice(i + tok.length);
          if (restOfLine.includes(tok) || remainingText.includes(tok)) {
            openStack.push({ open: tok, close: tok, tag: tok });
            i += tok.length;
            matchedSym = true;
            break;
          }
        }
      }
      if (matchedSym) continue;

      i += 1;
    }

    const suffix = [...openStack]
      .reverse()
      .map((item) => item.close)
      .join("");
    out.push(prefix + raw + suffix);
  }

  return out;
}

export function isMarkdownTableSeparator(line) {
  const s = String(line ?? "").trim();
  if (!s.includes("|") || !s.includes("-")) return false;
  const cells = splitMarkdownTableRow(s);
  return cells.length >= 1 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export function splitMarkdownTableRow(line) {
  let s = String(line ?? "").trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i += 1;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += s[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

export function parseMarkdownBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = String(lines[i] ?? "");
    if (
      i + 1 < lines.length &&
      line.includes("|") &&
      isMarkdownTableSeparator(lines[i + 1])
    ) {
      const headerRaw = splitMarkdownTableRow(line);
      const sepRaw = splitMarkdownTableRow(lines[i + 1]);
      const aligns = sepRaw.map((c) => {
        const l = c.startsWith(":");
        const r = c.endsWith(":");
        if (l && r) return "center";
        if (r) return "right";
        return "left";
      });
      const rawRows = [headerRaw];
      let j = i + 2;
      while (j < lines.length) {
        const nextLine = String(lines[j] ?? "");
        if (!nextLine.trim() || !nextLine.includes("|")) break;
        rawRows.push(splitMarkdownTableRow(nextLine));
        j += 1;
      }
      const colCount = Math.max(
        1,
        aligns.length,
        ...rawRows.map((r) => r.length)
      );
      while (aligns.length < colCount) aligns.push("left");
      const rows = rawRows.map((r, ri) => {
        const padded = [];
        for (let c = 0; c < colCount; c += 1) {
          padded.push(
            parseInlineSpans(r[c] ?? "", ri === 0 ? { bold: true } : {})
          );
        }
        return padded;
      });
      blocks.push({ type: "table", colCount, aligns, rows });
      i = j;
      continue;
    }

    blocks.push({ type: "line", parsed: parseMarkdownLine(line) });
    i += 1;
  }
  return blocks;
}

function measureSpansList(ctx, spans, fontSize, fontFamily) {
  let total = 0;
  const spanMetrics = [];
  for (const span of spans) {
    ctx.font = buildCtxFont(fontSize, fontFamily, span);
    const textWidth = ctx.measureText(span.text).width;
    const padX = span.code ? fontSize * 0.24 : span.highlight ? fontSize * 0.1 : 0;
    const width = textWidth + padX * 2;
    spanMetrics.push({ span, textWidth, padX, width });
    total += width;
  }
  return { totalWidth: total, spanMetrics };
}

function measureMarkdownTable(ctx, block, fontSize, fontFamily, lineHeightPx) {
  const padX = Math.max(8, fontSize * 0.55);
  const rowH = Math.max(lineHeightPx * 1.28, fontSize * 1.65);
  const colWidths = Array(block.colCount).fill(Math.max(40, fontSize * 2.4));
  const cellMetrics = [];

  for (let r = 0; r < block.rows.length; r += 1) {
    const rowM = [];
    for (let c = 0; c < block.colCount; c += 1) {
      const m = measureSpansList(ctx, block.rows[r][c], fontSize, fontFamily);
      rowM.push(m);
      const needed = m.totalWidth + padX * 2;
      if (needed > colWidths[c]) colWidths[c] = needed;
    }
    cellMetrics.push(rowM);
  }

  const totalWidth = colWidths.reduce((s, w) => s + w, 0);
  const marginY = Math.max(2, fontSize * 0.14);
  const totalHeight = block.rows.length * rowH + marginY * 2;
  return { colWidths, cellMetrics, rowH, padX, marginY, totalWidth, totalHeight };
}

function getPrefixWidth(parsed, fontSize) {
  const indentPx = (parsed.indent || 0) * fontSize * 0.9;
  if (parsed.prefixType === "quote") return indentPx + fontSize * 0.72;
  if (parsed.prefixType === "bullet") return indentPx + fontSize * 0.9;
  if (
    parsed.prefixType === "task-unchecked" ||
    parsed.prefixType === "task-checked"
  ) {
    return indentPx + fontSize * 1.15;
  }
  return indentPx;
}

function measureParsedLine(ctx, parsed, baseFontSize, fontFamily) {
  const fontSize = baseFontSize * parsed.scale;
  const prefixWidth = getPrefixWidth(parsed, fontSize);
  const { totalWidth, spanMetrics } = measureSpansList(
    ctx,
    parsed.spans,
    fontSize,
    fontFamily
  );
  return {
    fontSize,
    prefixWidth,
    totalWidth: prefixWidth + totalWidth,
    spanMetrics,
  };
}

function measureLineWidth(ctx, line, fontStr, isTestEnv) {
  const { fontSize, fontFamily } = parseFontString(fontStr);
  if (isMarkdownTableSeparator(line)) {
    return isTestEnv ? 10 : 1;
  }
  const s = String(line ?? "");
  if (s.includes("|") && (s.trim().startsWith("|") || s.split("|").length >= 3)) {
    const cells = splitMarkdownTableRow(s);
    const padX = Math.max(8, fontSize * 0.55);
    let total = 0;
    for (const c of cells) {
      const m = measureSpansList(ctx, parseInlineSpans(c), fontSize, fontFamily);
      total += Math.max(Math.max(40, fontSize * 2.4), m.totalWidth + padX * 2);
    }
    return isTestEnv ? total * 10 : total;
  }
  const parsed = parseMarkdownLine(line);
  const { totalWidth } = measureParsedLine(ctx, parsed, fontSize, fontFamily);
  return isTestEnv ? totalWidth * 10 : totalWidth;
}

function measureBlockHeight(lines, fontSize, lineHeight) {
  const baseLinePx = fontSize * lineHeight;
  const blocks = parseMarkdownBlocks(lines);
  let total = 0;
  for (const block of blocks) {
    if (block.type === "table") {
      const rowH = Math.max(baseLinePx * 1.28, fontSize * 1.65);
      const marginY = Math.max(2, fontSize * 0.14);
      total += block.rows.length * rowH + marginY * 2;
    } else {
      total += baseLinePx * block.parsed.scale;
    }
  }
  return total;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawSpansOnCanvas(ctx, spanMetrics, startX, baselineY, fontSize, fontFamilyStr, strokeColor) {
  const codeBg = "rgba(105, 101, 219, 0.12)";
  let x = startX;
  for (const { span, textWidth, padX, width } of spanMetrics) {
    if (span.highlight) {
      ctx.fillStyle = span.highlight;
      drawRoundedRect(
        ctx,
        x,
        baselineY - fontSize * 0.86,
        width,
        fontSize * 1.12,
        fontSize * 0.18
      );
      ctx.fill();
    } else if (span.code) {
      ctx.fillStyle = codeBg;
      drawRoundedRect(
        ctx,
        x,
        baselineY - fontSize * 0.82,
        width,
        fontSize * 1.06,
        fontSize * 0.22
      );
      ctx.fill();
    }

    const inkColor = span.color || strokeColor;
    ctx.font = buildCtxFont(fontSize, fontFamilyStr, span);
    ctx.fillStyle = inkColor;
    const textX = x + padX;

    if (span.italic && !span.code) {
      ctx.save();
      ctx.translate(textX, baselineY);
      ctx.transform(1, 0, -0.17, 1, 0, 0);
      ctx.fillText(span.text, 0, 0);
      if (span.bold) {
        ctx.fillText(span.text, Math.max(0.45, fontSize * 0.028), 0);
      }
      ctx.restore();
    } else {
      ctx.fillText(span.text, textX, baselineY);
      if (span.bold && !span.code) {
        ctx.fillText(
          span.text,
          textX + Math.max(0.45, fontSize * 0.028),
          baselineY
        );
      }
    }

    if (span.strike) {
      ctx.strokeStyle = inkColor;
      ctx.lineWidth = Math.max(1.1, fontSize * 0.075);
      ctx.beginPath();
      const sy = baselineY - fontSize * 0.3;
      ctx.moveTo(textX, sy);
      ctx.lineTo(textX + textWidth, sy);
      ctx.stroke();
    }

    x += width;
  }
}

function drawCanvasText(ctx, element, rawLines, opts) {
  const { fontFamilyStr, lineHeightPx, baselineOffset } = opts;
  const lines = balanceWrappedLines(rawLines);
  const blocks = parseMarkdownBlocks(lines);
  const quoteBarColor = "#6965db";
  const accentFill = "#6965db";

  let cursorY = 0;

  for (const block of blocks) {
    if (block.type === "table") {
      const fontSize = element.fontSize;
      const tm = measureMarkdownTable(
        ctx,
        block,
        fontSize,
        fontFamilyStr,
        lineHeightPx
      );
      let tableX = 0;
      if (element.textAlign === "center") {
        tableX = (element.width - tm.totalWidth) / 2;
      } else if (element.textAlign === "right") {
        tableX = element.width - tm.totalWidth;
      }
      const tableY = cursorY + tm.marginY;
      const tableH = block.rows.length * tm.rowH;
      const radius = Math.min(6, fontSize * 0.28);

      ctx.save();
      ctx.textAlign = "left";

      // Clip inside rounded outer box for header fill
      ctx.save();
      drawRoundedRect(ctx, tableX, tableY, tm.totalWidth, tableH, radius);
      ctx.clip();
      ctx.fillStyle = "rgba(105, 101, 219, 0.09)";
      ctx.fillRect(tableX, tableY, tm.totalWidth, tm.rowH);
      ctx.restore();

      // Grid lines
      ctx.strokeStyle = element.strokeColor;
      ctx.lineWidth = Math.max(1, fontSize * 0.06);
      ctx.globalAlpha = (ctx.globalAlpha ?? 1) * 0.42;
      ctx.beginPath();
      for (let r = 1; r < block.rows.length; r += 1) {
        const ly = tableY + r * tm.rowH;
        ctx.moveTo(tableX, ly);
        ctx.lineTo(tableX + tm.totalWidth, ly);
      }
      let cx = tableX;
      for (let c = 0; c < block.colCount - 1; c += 1) {
        cx += tm.colWidths[c];
        ctx.moveTo(cx, tableY);
        ctx.lineTo(cx, tableY + tableH);
      }
      ctx.stroke();

      // Emphasized outer border & header separator
      ctx.globalAlpha = 0.72;
      drawRoundedRect(ctx, tableX, tableY, tm.totalWidth, tableH, radius);
      ctx.stroke();
      if (block.rows.length > 1) {
        ctx.beginPath();
        ctx.moveTo(tableX, tableY + tm.rowH);
        ctx.lineTo(tableX + tm.totalWidth, tableY + tm.rowH);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Cell rich text
      for (let r = 0; r < block.rows.length; r += 1) {
        const cellTop = tableY + r * tm.rowH;
        const baselineY = cellTop + baselineOffset(fontSize, tm.rowH);
        let cellX = tableX;
        for (let c = 0; c < block.colCount; c += 1) {
          const cw = tm.colWidths[c];
          const cm = tm.cellMetrics[r][c];
          const align = block.aligns[c] || "left";
          let sx = cellX + tm.padX;
          if (align === "center") {
            sx = cellX + (cw - cm.totalWidth) / 2;
          } else if (align === "right") {
            sx = cellX + cw - tm.padX - cm.totalWidth;
          }
          drawSpansOnCanvas(
            ctx,
            cm.spanMetrics,
            sx,
            baselineY,
            fontSize,
            fontFamilyStr,
            element.strokeColor
          );
          cellX += cw;
        }
      }

      ctx.restore();
      cursorY += tm.totalHeight;
      continue;
    }

    const parsed = block.parsed;
    const lineH = lineHeightPx * parsed.scale;
    const { fontSize, prefixWidth, totalWidth, spanMetrics } =
      measureParsedLine(ctx, parsed, element.fontSize, fontFamilyStr);
    const baselineY = cursorY + baselineOffset(fontSize, lineH);

    let startX = 0;
    if (element.textAlign === "center") {
      startX = (element.width - totalWidth) / 2;
    } else if (element.textAlign === "right") {
      startX = element.width - totalWidth;
    }

    ctx.save();
    ctx.textAlign = "left";
    const indentPx = (parsed.indent || 0) * fontSize * 0.9;

    // Draw block prefix decoration
    if (parsed.prefixType === "quote") {
      ctx.fillStyle = quoteBarColor;
      drawRoundedRect(
        ctx,
        startX + indentPx + fontSize * 0.08,
        cursorY + lineH * 0.12,
        Math.max(2.5, fontSize * 0.13),
        lineH * 0.76,
        2
      );
      ctx.fill();
    } else if (parsed.prefixType === "bullet") {
      ctx.fillStyle = element.strokeColor;
      ctx.beginPath();
      ctx.arc(
        startX + indentPx + fontSize * 0.36,
        baselineY - fontSize * 0.3,
        Math.max(2, fontSize * 0.14),
        0,
        Math.PI * 2
      );
      ctx.fill();
    } else if (
      parsed.prefixType === "task-unchecked" ||
      parsed.prefixType === "task-checked"
    ) {
      const boxSize = fontSize * 0.74;
      const bx = startX + indentPx + fontSize * 0.1;
      const by = baselineY - boxSize * 0.88;
      if (parsed.prefixType === "task-checked") {
        ctx.fillStyle = accentFill;
        drawRoundedRect(ctx, bx, by, boxSize, boxSize, boxSize * 0.22);
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1.5, fontSize * 0.1);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(bx + boxSize * 0.22, by + boxSize * 0.52);
        ctx.lineTo(bx + boxSize * 0.43, by + boxSize * 0.73);
        ctx.lineTo(bx + boxSize * 0.78, by + boxSize * 0.28);
        ctx.stroke();
      } else {
        ctx.strokeStyle = element.strokeColor;
        ctx.lineWidth = Math.max(1.2, fontSize * 0.08);
        drawRoundedRect(ctx, bx, by, boxSize, boxSize, boxSize * 0.22);
        ctx.stroke();
      }
    }

    if (parsed.prefixType === "quote") {
      ctx.globalAlpha = (ctx.globalAlpha ?? 1) * 0.78;
    }

    drawSpansOnCanvas(
      ctx,
      spanMetrics,
      startX + prefixWidth,
      baselineY,
      fontSize,
      fontFamilyStr,
      element.strokeColor
    );

    ctx.restore();
    cursorY += lineH;
  }
}

let measureCanvas = null;
function getMeasureCtx() {
  if (!measureCanvas) {
    measureCanvas = document.createElement("canvas");
  }
  return measureCanvas.getContext("2d");
}

function appendSpansToSvg(
  doc,
  svgNS,
  group,
  spanMetrics,
  startX,
  baselineY,
  fontSize,
  fontFamilyStr,
  strokeColor,
  direction,
  isQuote = false
) {
  const codeBg = "rgba(105, 101, 219, 0.12)";
  let x = startX;
  for (const { span, padX, width } of spanMetrics) {
    if (span.highlight || span.code) {
      const bg = doc.createElementNS(svgNS, "rect");
      bg.setAttribute("x", String(x));
      bg.setAttribute(
        "y",
        String(baselineY - fontSize * (span.code && !span.highlight ? 0.82 : 0.86))
      );
      bg.setAttribute("width", String(width));
      bg.setAttribute(
        "height",
        String(fontSize * (span.code && !span.highlight ? 1.06 : 1.12))
      );
      bg.setAttribute("rx", String(fontSize * 0.2));
      bg.setAttribute("fill", span.highlight || codeBg);
      group.appendChild(bg);
    }

    const inkColor = span.color || strokeColor;
    const t = doc.createElementNS(svgNS, "text");
    t.textContent = span.text;
    t.setAttribute("x", String(x + padX));
    t.setAttribute("y", String(baselineY));
    t.setAttribute("font-family", span.code ? CODE_FONT : fontFamilyStr);
    t.setAttribute("font-size", `${span.code ? fontSize * 0.88 : fontSize}px`);
    t.setAttribute("fill", inkColor);
    t.setAttribute("text-anchor", "start");
    t.setAttribute("style", "white-space: pre;");
    t.setAttribute("direction", direction || "ltr");
    t.setAttribute("dominant-baseline", "alphabetic");
    if (isQuote) t.setAttribute("opacity", "0.78");
    if (span.bold && !span.code) t.setAttribute("font-weight", "700");
    if (span.italic && !span.code) t.setAttribute("font-style", "italic");
    if (span.strike) t.setAttribute("text-decoration", "line-through");
    group.appendChild(t);

    x += width;
  }
}

function appendSvgText(doc, svgNS, group, element, rawLines, opts) {
  const { fontFamilyStr, lineHeightPx, baselineOffset, direction } = opts;
  const lines = balanceWrappedLines(rawLines);
  const blocks = parseMarkdownBlocks(lines);
  const ctx = getMeasureCtx();
  const accentFill = "#6965db";

  let cursorY = 0;

  for (const block of blocks) {
    if (block.type === "table") {
      const fontSize = element.fontSize;
      const tm = measureMarkdownTable(
        ctx,
        block,
        fontSize,
        fontFamilyStr,
        lineHeightPx
      );
      let tableX = 0;
      if (element.textAlign === "center") {
        tableX = (element.width - tm.totalWidth) / 2;
      } else if (element.textAlign === "right") {
        tableX = element.width - tm.totalWidth;
      }
      const tableY = cursorY + tm.marginY;
      const tableH = block.rows.length * tm.rowH;
      const radius = Math.min(6, fontSize * 0.28);
      const sw = Math.max(1, fontSize * 0.06);

      const headerBg = doc.createElementNS(svgNS, "rect");
      headerBg.setAttribute("x", String(tableX));
      headerBg.setAttribute("y", String(tableY));
      headerBg.setAttribute("width", String(tm.totalWidth));
      headerBg.setAttribute("height", String(tm.rowH));
      headerBg.setAttribute("rx", String(radius));
      headerBg.setAttribute("fill", "rgba(105, 101, 219, 0.09)");
      group.appendChild(headerBg);

      for (let r = 1; r < block.rows.length; r += 1) {
        const line = doc.createElementNS(svgNS, "line");
        const ly = tableY + r * tm.rowH;
        line.setAttribute("x1", String(tableX));
        line.setAttribute("y1", String(ly));
        line.setAttribute("x2", String(tableX + tm.totalWidth));
        line.setAttribute("y2", String(ly));
        line.setAttribute("stroke", element.strokeColor);
        line.setAttribute("stroke-opacity", r === 1 ? "0.72" : "0.42");
        line.setAttribute("stroke-width", String(sw));
        group.appendChild(line);
      }

      let cx = tableX;
      for (let c = 0; c < block.colCount - 1; c += 1) {
        cx += tm.colWidths[c];
        const line = doc.createElementNS(svgNS, "line");
        line.setAttribute("x1", String(cx));
        line.setAttribute("y1", String(tableY));
        line.setAttribute("x2", String(cx));
        line.setAttribute("y2", String(tableY + tableH));
        line.setAttribute("stroke", element.strokeColor);
        line.setAttribute("stroke-opacity", "0.42");
        line.setAttribute("stroke-width", String(sw));
        group.appendChild(line);
      }

      const outer = doc.createElementNS(svgNS, "rect");
      outer.setAttribute("x", String(tableX));
      outer.setAttribute("y", String(tableY));
      outer.setAttribute("width", String(tm.totalWidth));
      outer.setAttribute("height", String(tableH));
      outer.setAttribute("rx", String(radius));
      outer.setAttribute("fill", "none");
      outer.setAttribute("stroke", element.strokeColor);
      outer.setAttribute("stroke-opacity", "0.72");
      outer.setAttribute("stroke-width", String(sw));
      group.appendChild(outer);

      for (let r = 0; r < block.rows.length; r += 1) {
        const cellTop = tableY + r * tm.rowH;
        const baselineY = cellTop + baselineOffset(fontSize, tm.rowH);
        let cellX = tableX;
        for (let c = 0; c < block.colCount; c += 1) {
          const cw = tm.colWidths[c];
          const cm = tm.cellMetrics[r][c];
          const align = block.aligns[c] || "left";
          let sx = cellX + tm.padX;
          if (align === "center") {
            sx = cellX + (cw - cm.totalWidth) / 2;
          } else if (align === "right") {
            sx = cellX + cw - tm.padX - cm.totalWidth;
          }
          appendSpansToSvg(
            doc,
            svgNS,
            group,
            cm.spanMetrics,
            sx,
            baselineY,
            fontSize,
            fontFamilyStr,
            element.strokeColor,
            direction
          );
          cellX += cw;
        }
      }

      cursorY += tm.totalHeight;
      continue;
    }

    const parsed = block.parsed;
    const lineH = lineHeightPx * parsed.scale;
    const { fontSize, prefixWidth, totalWidth, spanMetrics } =
      measureParsedLine(ctx, parsed, element.fontSize, fontFamilyStr);
    const baselineY = cursorY + baselineOffset(fontSize, lineH);

    let startX = 0;
    if (element.textAlign === "center") {
      startX = (element.width - totalWidth) / 2;
    } else if (element.textAlign === "right") {
      startX = element.width - totalWidth;
    }

    const indentPx = (parsed.indent || 0) * fontSize * 0.9;

    if (parsed.prefixType === "quote") {
      const bar = doc.createElementNS(svgNS, "rect");
      bar.setAttribute("x", String(startX + indentPx + fontSize * 0.08));
      bar.setAttribute("y", String(cursorY + lineH * 0.12));
      bar.setAttribute("width", String(Math.max(2.5, fontSize * 0.13)));
      bar.setAttribute("height", String(lineH * 0.76));
      bar.setAttribute("rx", "2");
      bar.setAttribute("fill", accentFill);
      group.appendChild(bar);
    } else if (parsed.prefixType === "bullet") {
      const dot = doc.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", String(startX + indentPx + fontSize * 0.36));
      dot.setAttribute("cy", String(baselineY - fontSize * 0.3));
      dot.setAttribute("r", String(Math.max(2, fontSize * 0.14)));
      dot.setAttribute("fill", element.strokeColor);
      group.appendChild(dot);
    } else if (
      parsed.prefixType === "task-unchecked" ||
      parsed.prefixType === "task-checked"
    ) {
      const boxSize = fontSize * 0.74;
      const bx = startX + indentPx + fontSize * 0.1;
      const by = baselineY - boxSize * 0.88;
      const rect = doc.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(bx));
      rect.setAttribute("y", String(by));
      rect.setAttribute("width", String(boxSize));
      rect.setAttribute("height", String(boxSize));
      rect.setAttribute("rx", String(boxSize * 0.22));
      if (parsed.prefixType === "task-checked") {
        rect.setAttribute("fill", accentFill);
        group.appendChild(rect);
        const check = doc.createElementNS(svgNS, "path");
        check.setAttribute(
          "d",
          `M ${bx + boxSize * 0.22} ${by + boxSize * 0.52} L ${
            bx + boxSize * 0.43
          } ${by + boxSize * 0.73} L ${bx + boxSize * 0.78} ${
            by + boxSize * 0.28
          }`
        );
        check.setAttribute("fill", "none");
        check.setAttribute("stroke", "#ffffff");
        check.setAttribute("stroke-width", String(Math.max(1.5, fontSize * 0.1)));
        check.setAttribute("stroke-linecap", "round");
        check.setAttribute("stroke-linejoin", "round");
        group.appendChild(check);
      } else {
        rect.setAttribute("fill", "none");
        rect.setAttribute("stroke", element.strokeColor);
        rect.setAttribute("stroke-width", String(Math.max(1.2, fontSize * 0.08)));
        group.appendChild(rect);
      }
    }

    appendSpansToSvg(
      doc,
      svgNS,
      group,
      spanMetrics,
      startX + prefixWidth,
      baselineY,
      fontSize,
      fontFamilyStr,
      element.strokeColor,
      direction,
      parsed.prefixType === "quote"
    );

    cursorY += lineH;
  }
}

export function measureNativeTextBox(text, fontSize, fontFamilyStr, lineHeight) {
  const ctx = getMeasureCtx();
  const rawLines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const enabled = Boolean(globalThis.__EXCALIDRAW_MD__?.enabled);
  const lines = enabled ? balanceWrappedLines(rawLines) : rawLines;
  const fontStr = `${fontSize}px ${fontFamilyStr}`;
  const baseLinePx = fontSize * lineHeight;

  let width = 0;
  let height = 0;
  if (enabled) {
    const blocks = parseMarkdownBlocks(lines);
    for (const block of blocks) {
      if (block.type === "table") {
        const tm = measureMarkdownTable(ctx, block, fontSize, fontFamilyStr, baseLinePx);
        width = Math.max(width, tm.totalWidth);
        height += tm.totalHeight;
      } else {
        const m = measureParsedLine(ctx, block.parsed, fontSize, fontFamilyStr);
        width = Math.max(width, m.totalWidth);
        height += baseLinePx * block.parsed.scale;
      }
    }
  } else {
    for (const line of lines) {
      ctx.font = fontStr;
      width = Math.max(width, ctx.measureText(line || " ").width);
      height += baseLinePx;
    }
  }
  return { width: Math.max(width, fontSize * 0.5), height };
}

export function getNativeMarkdownEnabled() {
  return Boolean(globalThis.__EXCALIDRAW_MD__?.enabled);
}

export function setNativeMarkdownEnabled(enabled) {
  const next = Boolean(enabled);
  if (globalThis.__EXCALIDRAW_MD__) {
    globalThis.__EXCALIDRAW_MD__.enabled = next;
  }
  try {
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {}
  return next;
}

export function initNativeMarkdown() {
  if (globalThis.__EXCALIDRAW_MD__) return globalThis.__EXCALIDRAW_MD__;
  const bridge = {
    enabled: readInitialEnabled(),
    measureLineWidth,
    measureBlockHeight,
    drawCanvasText,
    appendSvgText,
  };
  globalThis.__EXCALIDRAW_MD__ = bridge;
  return bridge;
}
