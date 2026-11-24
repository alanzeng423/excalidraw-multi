import rough from "roughjs";
import { getElementFontFamilyStr } from "./cjkFonts";
import { parseMarkdownLine } from "./nativeMarkdown";
import {
  getCellAnchor,
  normalizeTableData,
  resolveCellBg,
  resolveCellTextColor,
} from "./tableData";

const CODE_FONT = "Cascadia, ui-monospace, SFMono-Regular, Menlo, monospace";

let _measureCanvas = null;
function getMeasureCtx() {
  if (!_measureCanvas) {
    _measureCanvas = document.createElement("canvas");
  }
  return _measureCanvas.getContext("2d");
}

function buildFont(fontSize, fontFamily, { bold, italic, code }) {
  const size = code ? fontSize * 0.88 : fontSize;
  const fam = code ? CODE_FONT : fontFamily;
  const st = italic && !code ? "italic " : "";
  const wt = bold && !code ? "700 " : "";
  return `${st}${wt}${size}px ${fam}`;
}

function measureLineSpans(ctx, parsed, baseFontSize, fontFamily) {
  const fontSize = baseFontSize * (parsed.scale || 1);
  let prefixW = (parsed.indent || 0) * fontSize * 0.8;
  if (parsed.prefixType === "quote") prefixW += fontSize * 0.65;
  else if (parsed.prefixType === "bullet") prefixW += fontSize * 0.8;
  else if (
    parsed.prefixType === "task-unchecked" ||
    parsed.prefixType === "task-checked"
  ) {
    prefixW += fontSize * 1.1;
  }

  let total = prefixW;
  const spanMetrics = [];
  for (const span of parsed.spans) {
    ctx.font = buildFont(fontSize, fontFamily, span);
    const textWidth = ctx.measureText(span.text).width;
    const padX = span.code ? fontSize * 0.22 : span.highlight ? fontSize * 0.08 : 0;
    const width = textWidth + padX * 2;
    spanMetrics.push({ span, textWidth, padX, width });
    total += width;
  }
  return { fontSize, prefixW, totalWidth: total, spanMetrics };
}

function wrapParsedLine(ctx, parsed, maxWidth, baseFontSize, fontFamily) {
  const fontSize = baseFontSize * (parsed.scale || 1);
  const safeMax = Math.max(24, maxWidth);
  const full = measureLineSpans(ctx, parsed, baseFontSize, fontFamily);
  if (full.totalWidth <= safeMax || parsed.spans.length === 0) {
    return [{ parsed, metrics: full }];
  }

  const out = [];
  let curSpans = [];
  let isFirstLine = true;
  let curPrefixW = full.prefixW;
  let curWidth = curPrefixW;

  const flush = () => {
    const lineParsed = isFirstLine
      ? { ...parsed, spans: curSpans }
      : {
          ...parsed,
          prefixType: parsed.prefixType === "quote" ? "quote" : null,
          spans: curSpans,
        };
    out.push({
      parsed: lineParsed,
      metrics: measureLineSpans(ctx, lineParsed, baseFontSize, fontFamily),
    });
    curSpans = [];
    isFirstLine = false;
    curPrefixW = parsed.prefixType === "quote" ? fontSize * 0.65 : 0;
    curWidth = curPrefixW;
  };

  for (const span of parsed.spans) {
    ctx.font = buildFont(fontSize, fontFamily, span);
    const padExtra = span.code ? fontSize * 0.44 : span.highlight ? fontSize * 0.16 : 0;
    let buf = "";
    for (const ch of span.text) {
      const chW = ctx.measureText(ch).width;
      const extra = buf === "" ? padExtra : 0;
      if ((curWidth + chW + extra > safeMax) && (buf.length > 0 || curSpans.length > 0)) {
        if (buf) curSpans.push({ ...span, text: buf });
        flush();
        buf = ch;
        curWidth = curPrefixW + chW + padExtra;
      } else {
        buf += ch;
        curWidth += chW + extra;
      }
    }
    if (buf) {
      curSpans.push({ ...span, text: buf });
    }
  }
  if (curSpans.length > 0 || out.length === 0) {
    flush();
  }
  return out;
}

function computeTableLayout(element) {
  const table = normalizeTableData(element.customData?.table);
  const w = Math.max(80, element.width || 480);
  const h = Math.max(60, element.height || 220);
  const colCount = table.colWidths.length;
  const rowCount = table.rows.length;
  const fontFamily = getElementFontFamilyStr(element);
  const fontSize = 13.5;
  const lineH = 20;
  const padX = 10;
  const padY = 8;
  const minRowH = 36;

  const totalWeight = table.colWidths.reduce((s, v) => s + v, 0) || colCount * 100;
  const colPx = table.colWidths.map((cw) => (cw / totalWeight) * w);
  const colX = [0];
  for (let c = 0; c < colCount; c += 1) {
    colX.push(colX[c] + colPx[c]);
  }

  const ctx = getMeasureCtx();
  const rowH = Array(rowCount).fill(minRowH);
  const cellParsed = Array.from({ length: rowCount }, () => Array(colCount).fill(null));

  for (let r = 0; r < rowCount; r += 1) {
    const isHeader = table.headerRow && r === 0;
    for (let c = 0; c < colCount; c += 1) {
      const cell = table.rows[r][c];
      if (cell.mergedInto) continue;
      const rs = cell.rowSpan || 1;
      const cs = cell.colSpan || 1;
      const spanW = colX[c + cs] - colX[c];
      const maxTextW = Math.max(24, spanW - padX * 2);
      const rawLines = String(cell.text ?? "").replace(/\r\n?/g, "\n").split("\n");
      const parsedLines = [];
      for (const rl of rawLines) {
        const p = parseMarkdownLine(rl, isHeader || cell.bold ? { bold: true } : {});
        const wrapped = wrapParsedLine(ctx, p, maxTextW, fontSize, fontFamily);
        for (const item of wrapped) parsedLines.push(item);
      }
      cellParsed[r][c] = parsedLines;
      const neededH = Math.max(
        minRowH,
        parsedLines.reduce((sum, item) => sum + lineH * (item.parsed.scale || 1), 0) +
          padY * 2
      );
      if (rs === 1) {
        if (neededH > rowH[r]) rowH[r] = neededH;
      } else {
        let curSpanH = 0;
        for (let k = 0; k < rs; k += 1) curSpanH += rowH[r + k];
        if (neededH > curSpanH) {
          rowH[r + rs - 1] += neededH - curSpanH;
        }
      }
    }
  }

  // Scale rows slightly to fill card height neatly when table has extra vertical slack,
  // or keep natural row heights clipped cleanly if overflowing.
  const naturalTotal = rowH.reduce((s, v) => s + v, 0);
  if (naturalTotal > 0 && naturalTotal < h && h - naturalTotal <= 120) {
    const scale = h / naturalTotal;
    for (let r = 0; r < rowCount; r += 1) rowH[r] *= scale;
  }

  const rowY = [0];
  for (let r = 0; r < rowCount; r += 1) {
    rowY.push(rowY[r] + rowH[r]);
  }

  return {
    table,
    w,
    h,
    colCount,
    rowCount,
    colX,
    rowY,
    rowH,
    cellParsed,
    fontFamily,
    fontSize,
    lineH,
    padX,
    padY,
  };
}

function drawRoundedPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function sameAnchor(table, r1, c1, r2, c2) {
  const a1 = getCellAnchor(table, r1, c1);
  const a2 = getCellAnchor(table, r2, c2);
  return a1.r === a2.r && a1.c === a2.c;
}

export function drawCanvasTable(ctx, element) {
  const layout = computeTableLayout(element);
  const {
    table,
    w,
    h,
    colCount,
    rowCount,
    colX,
    rowY,
    cellParsed,
    fontFamily,
    lineH,
    padX,
    padY,
  } = layout;

  const radius = element.roundness ? 10 : 0;
  const strokeColor =
    element.strokeColor && element.strokeColor !== "transparent"
      ? element.strokeColor
      : "#1e1e1e";
  const baseWidth = Math.max(1, Math.min(3.5, (element.strokeWidth || 1.5) * 0.72));
  const roughness = Number.isFinite(element.roughness) ? element.roughness : 1;
  const strokeDash =
    element.strokeStyle === "dashed"
      ? [8, 6]
      : element.strokeStyle === "dotted"
        ? [2, 5]
        : undefined;
  const cardBg =
    element.backgroundColor && element.backgroundColor !== "transparent"
      ? element.backgroundColor
      : "transparent";
  const headerBg = "rgba(105, 101, 219, 0.08)";
  const stripeBg = "rgba(105, 101, 219, 0.035)";
  const codeBg = "rgba(105, 101, 219, 0.12)";
  const accentFill = "#6965db";

  ctx.save();
  drawRoundedPath(ctx, 0, 0, w, h, radius);
  ctx.clip();

  if (cardBg !== "transparent") {
    ctx.fillStyle = cardBg;
    ctx.fillRect(0, 0, w, h);
  }

  // 1. Cell fills & Markdown content
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  for (let r = 0; r < rowCount; r += 1) {
    const y = rowY[r];
    if (y > h) break;
    const isHeader = table.headerRow && r === 0;

    for (let c = 0; c < colCount; c += 1) {
      const cell = table.rows[r][c];
      if (cell.mergedInto) continue;
      const rs = cell.rowSpan || 1;
      const cs = cell.colSpan || 1;
      const x = colX[c];
      const cw = colX[c + cs] - x;
      const rh = rowY[r + rs] - y;

      const customBg = resolveCellBg(cell.bg, false);
      const fill =
        customBg ||
        (isHeader ? headerBg : table.striped && r % 2 === 1 ? stripeBg : null);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, cw, rh);
      }

      const parsedLines = cellParsed[r][c] || [];
      const totalBlockH = parsedLines.reduce(
        (s, it) => s + lineH * (it.parsed.scale || 1),
        0
      );
      let cy = y + Math.max(padY, (rh - totalBlockH) / 2);
      const align = table.colAligns[c] || "left";
      const baseInk = resolveCellTextColor(cell.color, false) || strokeColor;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 2, Math.max(0, cw - 4), Math.max(0, rh - 4));
      ctx.clip();

      for (const { parsed, metrics } of parsedLines) {
        const lh = lineH * (parsed.scale || 1);
        const fs = metrics.fontSize;
        const baselineY = cy + lh * 0.74;
        let startX = x + padX;
        if (align === "center") {
          startX = x + Math.max(padX, (cw - metrics.totalWidth) / 2);
        } else if (align === "right") {
          startX = x + cw - padX - metrics.totalWidth;
        }

        const indentPx = (parsed.indent || 0) * fs * 0.8;
        if (parsed.prefixType === "quote") {
          ctx.fillStyle = accentFill;
          ctx.fillRect(startX + indentPx, cy + lh * 0.14, 2.5, lh * 0.72);
        } else if (parsed.prefixType === "bullet") {
          ctx.fillStyle = baseInk;
          ctx.beginPath();
          ctx.arc(startX + indentPx + fs * 0.3, baselineY - fs * 0.3, 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (
          parsed.prefixType === "task-unchecked" ||
          parsed.prefixType === "task-checked"
        ) {
          const bs = fs * 0.78;
          const bx = startX + indentPx;
          const by = baselineY - bs * 0.86;
          if (parsed.prefixType === "task-checked") {
            ctx.fillStyle = accentFill;
            drawRoundedPath(ctx, bx, by, bs, bs, 2.5);
            ctx.fill();
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(bx + bs * 0.22, by + bs * 0.52);
            ctx.lineTo(bx + bs * 0.44, by + bs * 0.74);
            ctx.lineTo(bx + bs * 0.78, by + bs * 0.28);
            ctx.stroke();
          } else {
            ctx.strokeStyle = baseInk;
            ctx.lineWidth = 1.2;
            drawRoundedPath(ctx, bx, by, bs, bs, 2.5);
            ctx.stroke();
          }
        }

        let sx = startX + metrics.prefixW;
        for (const { span, textWidth, padX: spPad, width } of metrics.spanMetrics) {
          if (span.highlight || span.code) {
            ctx.fillStyle = span.highlight || codeBg;
            drawRoundedPath(
              ctx,
              sx,
              baselineY - fs * 0.85,
              width,
              fs * 1.12,
              fs * 0.18
            );
            ctx.fill();
          }
          const ink = span.color || baseInk;
          ctx.font = buildFont(fs, fontFamily, span);
          ctx.fillStyle = ink;
          ctx.fillText(span.text, sx + spPad, baselineY);
          if (span.strike) {
            ctx.strokeStyle = ink;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.moveTo(sx + spPad, baselineY - fs * 0.3);
            ctx.lineTo(sx + spPad + textWidth, baselineY - fs * 0.3);
            ctx.stroke();
          }
          sx += width;
        }

        cy += lh;
      }

      ctx.restore();
    }
  }

  // 2. Native internal gridlines (using roughjs when roughness > 0, skipping merged interiors)
  const rc = roughness > 0 ? rough.canvas(ctx.canvas) : null;
  const seed = (element.seed || 1) + 73;
  const gridBottom = Math.min(h, rowY[rowCount]);

  const drawSeg = (x1, y1, x2, y2, emphasized = false) => {
    const sw = emphasized ? Math.max(1.5, baseWidth * 1.25) : baseWidth;
    if (rc) {
      rc.line(x1, y1, x2, y2, {
        stroke: strokeColor,
        strokeWidth: sw,
        roughness: roughness * 0.72,
        bowing: 0.7,
        seed,
        strokeLineDash: strokeDash,
        disableMultiStroke: true,
      });
    } else {
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = sw;
      ctx.globalAlpha = emphasized ? 0.9 : 0.72;
      if (strokeDash) ctx.setLineDash(strokeDash);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
  };

  for (let r = 1; r < rowCount; r += 1) {
    const y = rowY[r];
    if (y >= h) break;
    const isHeaderEdge = table.headerRow && r === 1;
    let segStart = null;
    for (let c = 0; c <= colCount; c += 1) {
      const need = c < colCount && !sameAnchor(table, r - 1, c, r, c);
      if (need && segStart === null) segStart = colX[c];
      else if (!need && segStart !== null) {
        drawSeg(segStart, y, colX[c], y, isHeaderEdge);
        segStart = null;
      }
    }
  }

  for (let c = 1; c < colCount; c += 1) {
    const x = colX[c];
    let segStart = null;
    for (let r = 0; r <= rowCount; r += 1) {
      const need = r < rowCount && !sameAnchor(table, r, c - 1, r, c);
      if (need && segStart === null) segStart = rowY[r];
      else if (!need && segStart !== null) {
        drawSeg(x, segStart, x, Math.min(gridBottom, rowY[r]), false);
        segStart = null;
      }
    }
  }

  ctx.restore();
}

export function appendSvgTable(doc, svgNS, group, element) {
  const layout = computeTableLayout(element);
  const {
    table,
    w,
    h,
    colCount,
    rowCount,
    colX,
    rowY,
    cellParsed,
    fontFamily,
    lineH,
    padX,
    padY,
  } = layout;

  const radius = element.roundness ? 10 : 0;
  const clipId = `table-clip-${element.id}-${Math.floor(Math.random() * 1e6)}`;
  const strokeColor =
    element.strokeColor && element.strokeColor !== "transparent"
      ? element.strokeColor
      : "#1e1e1e";
  const baseWidth = Math.max(1, Math.min(3.5, (element.strokeWidth || 1.5) * 0.72));
  const strokeDash =
    element.strokeStyle === "dashed"
      ? "8 6"
      : element.strokeStyle === "dotted"
        ? "2 5"
        : null;
  const headerBg = "rgba(105, 101, 219, 0.08)";
  const stripeBg = "rgba(105, 101, 219, 0.035)";
  const codeBg = "rgba(105, 101, 219, 0.12)";
  const accentFill = "#6965db";

  const clip = doc.createElementNS(svgNS, "clipPath");
  clip.setAttribute("id", clipId);
  const clipRect = doc.createElementNS(svgNS, "rect");
  clipRect.setAttribute("x", "0");
  clipRect.setAttribute("y", "0");
  clipRect.setAttribute("width", String(w));
  clipRect.setAttribute("height", String(h));
  clipRect.setAttribute("rx", String(radius));
  clipRect.setAttribute("ry", String(radius));
  clip.appendChild(clipRect);
  group.appendChild(clip);

  const inner = doc.createElementNS(svgNS, "g");
  inner.setAttribute("clip-path", `url(#${clipId})`);

  for (let r = 0; r < rowCount; r += 1) {
    const y = rowY[r];
    if (y > h) break;
    const isHeader = table.headerRow && r === 0;

    for (let c = 0; c < colCount; c += 1) {
      const cell = table.rows[r][c];
      if (cell.mergedInto) continue;
      const rs = cell.rowSpan || 1;
      const cs = cell.colSpan || 1;
      const x = colX[c];
      const cw = colX[c + cs] - x;
      const rh = rowY[r + rs] - y;

      const customBg = resolveCellBg(cell.bg, false);
      const fill =
        customBg ||
        (isHeader ? headerBg : table.striped && r % 2 === 1 ? stripeBg : null);
      if (fill) {
        const rect = doc.createElementNS(svgNS, "rect");
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(y));
        rect.setAttribute("width", String(cw));
        rect.setAttribute("height", String(rh));
        rect.setAttribute("fill", fill);
        inner.appendChild(rect);
      }

      const parsedLines = cellParsed[r][c] || [];
      const totalBlockH = parsedLines.reduce(
        (s, it) => s + lineH * (it.parsed.scale || 1),
        0
      );
      let cy = y + Math.max(padY, (rh - totalBlockH) / 2);
      const align = table.colAligns[c] || "left";
      const baseInk = resolveCellTextColor(cell.color, false) || strokeColor;

      for (const { parsed, metrics } of parsedLines) {
        const lh = lineH * (parsed.scale || 1);
        const fs = metrics.fontSize;
        const baselineY = cy + lh * 0.74;
        let startX = x + padX;
        if (align === "center") {
          startX = x + Math.max(padX, (cw - metrics.totalWidth) / 2);
        } else if (align === "right") {
          startX = x + cw - padX - metrics.totalWidth;
        }

        const indentPx = (parsed.indent || 0) * fs * 0.8;
        if (parsed.prefixType === "bullet") {
          const dot = doc.createElementNS(svgNS, "circle");
          dot.setAttribute("cx", String(startX + indentPx + fs * 0.3));
          dot.setAttribute("cy", String(baselineY - fs * 0.3));
          dot.setAttribute("r", "2");
          dot.setAttribute("fill", baseInk);
          inner.appendChild(dot);
        } else if (parsed.prefixType === "quote") {
          const bar = doc.createElementNS(svgNS, "rect");
          bar.setAttribute("x", String(startX + indentPx));
          bar.setAttribute("y", String(cy + lh * 0.14));
          bar.setAttribute("width", "2.5");
          bar.setAttribute("height", String(lh * 0.72));
          bar.setAttribute("fill", accentFill);
          inner.appendChild(bar);
        }

        let sx = startX + metrics.prefixW;
        for (const { span, padX: spPad, width } of metrics.spanMetrics) {
          if (span.highlight || span.code) {
            const bg = doc.createElementNS(svgNS, "rect");
            bg.setAttribute("x", String(sx));
            bg.setAttribute("y", String(baselineY - fs * 0.85));
            bg.setAttribute("width", String(width));
            bg.setAttribute("height", String(fs * 1.12));
            bg.setAttribute("rx", String(fs * 0.18));
            bg.setAttribute("fill", span.highlight || codeBg);
            inner.appendChild(bg);
          }
          const t = doc.createElementNS(svgNS, "text");
          t.textContent = span.text;
          t.setAttribute("x", String(sx + spPad));
          t.setAttribute("y", String(baselineY));
          t.setAttribute("font-family", span.code ? CODE_FONT : fontFamily);
          t.setAttribute("font-size", `${span.code ? fs * 0.88 : fs}px`);
          t.setAttribute("fill", span.color || baseInk);
          t.setAttribute("text-anchor", "start");
          if (span.bold && !span.code) t.setAttribute("font-weight", "700");
          if (span.italic && !span.code) t.setAttribute("font-style", "italic");
          if (span.strike) t.setAttribute("text-decoration", "line-through");
          inner.appendChild(t);
          sx += width;
        }

        cy += lh;
      }
    }
  }

  // Internal gridlines (respecting merged cells)
  const gridBottom = Math.min(h, rowY[rowCount]);
  const appendLine = (x1, y1, x2, y2, emphasized = false) => {
    const line = doc.createElementNS(svgNS, "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("y1", String(y1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y2", String(y2));
    line.setAttribute("stroke", strokeColor);
    line.setAttribute("stroke-opacity", emphasized ? "0.9" : "0.72");
    line.setAttribute(
      "stroke-width",
      String(emphasized ? Math.max(1.5, baseWidth * 1.25) : baseWidth)
    );
    if (strokeDash) line.setAttribute("stroke-dasharray", strokeDash);
    inner.appendChild(line);
  };

  for (let r = 1; r < rowCount; r += 1) {
    const y = rowY[r];
    if (y >= h) break;
    const isHeaderEdge = table.headerRow && r === 1;
    let segStart = null;
    for (let c = 0; c <= colCount; c += 1) {
      const need = c < colCount && !sameAnchor(table, r - 1, c, r, c);
      if (need && segStart === null) segStart = colX[c];
      else if (!need && segStart !== null) {
        appendLine(segStart, y, colX[c], y, isHeaderEdge);
        segStart = null;
      }
    }
  }

  for (let c = 1; c < colCount; c += 1) {
    const x = colX[c];
    let segStart = null;
    for (let r = 0; r <= rowCount; r += 1) {
      const need = r < rowCount && !sameAnchor(table, r, c - 1, r, c);
      if (need && segStart === null) segStart = rowY[r];
      else if (!need && segStart !== null) {
        appendLine(x, segStart, x, Math.min(gridBottom, rowY[r]), false);
        segStart = null;
      }
    }
  }

  group.appendChild(inner);
}

export function initTableRenderer() {
  if (globalThis.__EXCALIDRAW_TABLE__) return globalThis.__EXCALIDRAW_TABLE__;
  const bridge = {
    drawCanvasTable,
    appendSvgTable,
  };
  globalThis.__EXCALIDRAW_TABLE__ = bridge;
  return bridge;
}
