const STORAGE_KEY = "excalidraw-multi:native-md";

const HEADING_SCALES = { 1: 1.38, 2: 1.22, 3: 1.1 };
const CODE_FONT = "Cascadia, ui-monospace, SFMono-Regular, Menlo, monospace";

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

export function parseInlineSpans(input, baseStyle = {}) {
  const spans = [];
  const push = (text, style) => {
    if (!text) return;
    const merged = {
      bold: Boolean(baseStyle.bold || style.bold),
      italic: Boolean(baseStyle.italic || style.italic),
      strike: Boolean(baseStyle.strike || style.strike),
      code: Boolean(baseStyle.code || style.code),
      highlight: Boolean(baseStyle.highlight || style.highlight),
    };
    const prev = spans[spans.length - 1];
    if (
      prev &&
      prev.bold === merged.bold &&
      prev.italic === merged.italic &&
      prev.strike === merged.strike &&
      prev.code === merged.code &&
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

    // 1. Backslash escape for markdown punctuation
    if (ch === "\\" && i + 1 < len && /[\\*_~=`#>\-\[\]]/.test(input[i + 1])) {
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

    // 3. Bold + Italic ***...***
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

    // 4. Bold **...**
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

    // 5. Strikethrough ~~...~~
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

    // 6. Highlight ==...==
    if (
      input.startsWith("==", i) &&
      i + 2 < len &&
      !/\s/.test(input[i + 2])
    ) {
      const end = input.indexOf("==", i + 2);
      if (end > i + 2 && !/\s/.test(input[end - 1])) {
        const inner = parseInlineSpans(input.slice(i + 2, end), {
          ...baseStyle,
          highlight: true,
        });
        for (const s of inner) push(s.text, s);
        i = end + 2;
        continue;
      }
    }

    // 7. Italic *...* (strict: no adjacent whitespace so `2 * 3 * 4` won't match)
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

export function parseMarkdownLine(rawLine) {
  const line = String(rawLine ?? "");

  // Escaped leading block syntax (\#, \>, \-, \*)
  const escBlock = line.match(/^\\([#>\-*]\s.*)$/);
  if (escBlock) {
    return {
      kind: "normal",
      scale: 1,
      indent: 0,
      prefixType: null,
      spans: parseInlineSpans(escBlock[1]),
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
      spans: parseInlineSpans(heading[2], { bold: true }),
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
      spans: parseInlineSpans(quote[1]),
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
      spans: parseInlineSpans(task[3]),
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
      spans: parseInlineSpans(bullet[2]),
    };
  }

  return {
    kind: "normal",
    scale: 1,
    indent: 0,
    prefixType: null,
    spans: parseInlineSpans(line),
  };
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
  let total = prefixWidth;
  const spanMetrics = [];

  for (const span of parsed.spans) {
    ctx.font = buildCtxFont(fontSize, fontFamily, span);
    const textWidth = ctx.measureText(span.text).width;
    const padX = span.code ? fontSize * 0.24 : span.highlight ? fontSize * 0.1 : 0;
    const width = textWidth + padX * 2;
    spanMetrics.push({ span, textWidth, padX, width });
    total += width;
  }

  return { fontSize, prefixWidth, totalWidth: total, spanMetrics };
}

function measureLineWidth(ctx, line, fontStr, isTestEnv) {
  const { fontSize, fontFamily } = parseFontString(fontStr);
  const parsed = parseMarkdownLine(line);
  const { totalWidth } = measureParsedLine(ctx, parsed, fontSize, fontFamily);
  return isTestEnv ? totalWidth * 10 : totalWidth;
}

function measureBlockHeight(lines, fontSize, lineHeight) {
  const baseLinePx = fontSize * lineHeight;
  let total = 0;
  for (const line of lines) {
    const parsed = parseMarkdownLine(line);
    total += baseLinePx * parsed.scale;
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

function drawCanvasText(ctx, element, lines, opts) {
  const { fontFamilyStr, lineHeightPx, baselineOffset, isDark } = opts;
  const highlightFill = isDark
    ? "rgba(250, 204, 21, 0.28)"
    : "rgba(255, 224, 102, 0.52)";
  const codeBg = isDark
    ? "rgba(168, 165, 255, 0.18)"
    : "rgba(105, 101, 219, 0.11)";
  const quoteBarColor = isDark ? "#a8a5ff" : "#6965db";
  const accentFill = isDark ? "#a8a5ff" : "#6965db";

  let cursorY = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseMarkdownLine(lines[i]);
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
        ctx.strokeStyle = isDark ? "#121218" : "#ffffff";
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

    let x = startX + prefixWidth;
    if (parsed.prefixType === "quote") {
      ctx.globalAlpha = (ctx.globalAlpha ?? 1) * 0.78;
    }

    for (const { span, textWidth, padX, width } of spanMetrics) {
      // Background highlight or inline code pill
      if (span.highlight) {
        ctx.fillStyle = highlightFill;
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

      ctx.font = buildCtxFont(fontSize, fontFamilyStr, span);
      ctx.fillStyle = element.strokeColor;
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
          // Subtle faux-bold pass so hand-drawn / CJK Regular fonts visibly thicken
          ctx.fillText(
            span.text,
            textX + Math.max(0.45, fontSize * 0.028),
            baselineY
          );
        }
      }

      if (span.strike) {
        ctx.strokeStyle = element.strokeColor;
        ctx.lineWidth = Math.max(1.1, fontSize * 0.075);
        ctx.beginPath();
        const sy = baselineY - fontSize * 0.3;
        ctx.moveTo(textX, sy);
        ctx.lineTo(textX + textWidth, sy);
        ctx.stroke();
      }

      x += width;
    }

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

function appendSvgText(doc, svgNS, group, element, lines, opts) {
  const { fontFamilyStr, lineHeightPx, baselineOffset, direction, isDark } =
    opts;
  const ctx = getMeasureCtx();
  const highlightFill = isDark
    ? "rgba(250, 204, 21, 0.28)"
    : "rgba(255, 224, 102, 0.52)";
  const codeBg = isDark
    ? "rgba(168, 165, 255, 0.18)"
    : "rgba(105, 101, 219, 0.11)";
  const accentFill = isDark ? "#a8a5ff" : "#6965db";

  let cursorY = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseMarkdownLine(lines[i]);
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
        check.setAttribute("stroke", isDark ? "#121218" : "#ffffff");
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

    let x = startX + prefixWidth;
    for (const { span, textWidth, padX, width } of spanMetrics) {
      if (span.highlight || span.code) {
        const bg = doc.createElementNS(svgNS, "rect");
        bg.setAttribute("x", String(x));
        bg.setAttribute(
          "y",
          String(baselineY - fontSize * (span.code ? 0.82 : 0.86))
        );
        bg.setAttribute("width", String(width));
        bg.setAttribute(
          "height",
          String(fontSize * (span.code ? 1.06 : 1.12))
        );
        bg.setAttribute("rx", String(fontSize * 0.2));
        bg.setAttribute("fill", span.highlight ? highlightFill : codeBg);
        group.appendChild(bg);
      }

      const t = doc.createElementNS(svgNS, "text");
      t.textContent = span.text;
      t.setAttribute("x", String(x + padX));
      t.setAttribute("y", String(baselineY));
      t.setAttribute("font-family", span.code ? CODE_FONT : fontFamilyStr);
      t.setAttribute(
        "font-size",
        `${span.code ? fontSize * 0.88 : fontSize}px`
      );
      t.setAttribute("fill", element.strokeColor);
      t.setAttribute("text-anchor", "start");
      t.setAttribute("style", "white-space: pre;");
      t.setAttribute("direction", direction || "ltr");
      t.setAttribute("dominant-baseline", "alphabetic");
      if (parsed.prefixType === "quote") t.setAttribute("opacity", "0.78");
      if (span.bold && !span.code) t.setAttribute("font-weight", "700");
      if (span.italic && !span.code) t.setAttribute("font-style", "italic");
      if (span.strike) t.setAttribute("text-decoration", "line-through");
      group.appendChild(t);

      x += width;
    }

    cursorY += lineH;
  }
}

export function measureNativeTextBox(text, fontSize, fontFamilyStr, lineHeight) {
  const ctx = getMeasureCtx();
  const lines = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const enabled = Boolean(globalThis.__EXCALIDRAW_MD__?.enabled);
  const fontStr = `${fontSize}px ${fontFamilyStr}`;

  let width = 0;
  let height = 0;
  for (const line of lines) {
    if (enabled) {
      const parsed = parseMarkdownLine(line);
      const m = measureParsedLine(ctx, parsed, fontSize, fontFamilyStr);
      width = Math.max(width, m.totalWidth);
      height += fontSize * lineHeight * parsed.scale;
    } else {
      ctx.font = fontStr;
      width = Math.max(width, ctx.measureText(line || " ").width);
      height += fontSize * lineHeight;
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
