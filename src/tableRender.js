import {
  normalizeTableData,
  resolveCellBg,
  resolveCellTextColor,
} from "./tableData";

const FONT_STACK =
  '"Assistant", "Xiaolai", -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif';

let _measureCanvas = null;
function getMeasureCtx() {
  if (!_measureCanvas) {
    _measureCanvas = document.createElement("canvas");
  }
  return _measureCanvas.getContext("2d");
}

function wrapCellText(ctx, text, maxWidth, font) {
  ctx.font = font;
  const paragraphs = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const lines = [];
  const safeMax = Math.max(16, maxWidth);

  for (const para of paragraphs) {
    if (!para) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const ch of para) {
      const next = current + ch;
      if (current && ctx.measureText(next).width > safeMax) {
        lines.push(current);
        current = ch;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

function computeTableLayout(element) {
  const table = normalizeTableData(element.customData?.table);
  const w = Math.max(80, element.width || 440);
  const h = Math.max(60, element.height || 220);
  const colCount = table.colWidths.length;
  const rowCount = table.rows.length;

  const totalWeight = table.colWidths.reduce((s, v) => s + v, 0) || colCount * 100;
  const colPx = table.colWidths.map((cw) => (cw / totalWeight) * w);
  const colX = [];
  let cx = 0;
  for (let c = 0; c < colCount; c += 1) {
    colX.push(cx);
    cx += colPx[c];
  }

  const fontSize = 13;
  const lineHeight = 18;
  const padX = 10;
  const padY = 8;
  const minRowH = 34;
  const ctx = getMeasureCtx();

  const cellLines = [];
  const naturalRowH = [];

  for (let r = 0; r < rowCount; r += 1) {
    const isHeader = table.headerRow && r === 0;
    const rowLines = [];
    let maxLines = 1;
    for (let c = 0; c < colCount; c += 1) {
      const cell = table.rows[r][c];
      const bold = isHeader || cell.bold;
      const font = `${bold ? "600 " : ""}${fontSize}px ${FONT_STACK}`;
      const lines = wrapCellText(ctx, cell.text, colPx[c] - padX * 2, font);
      rowLines.push({ lines, font, bold });
      if (lines.length > maxLines) maxLines = lines.length;
    }
    cellLines.push(rowLines);
    naturalRowH.push(Math.max(minRowH, maxLines * lineHeight + padY * 2));
  }

  const naturalTotal = naturalRowH.reduce((s, v) => s + v, 0);
  // If table fits with room to spare, keep clean natural row heights;
  // if taller than card height, compress slightly or clip cleanly at card bottom.
  const rowH = naturalRowH;
  const rowY = [];
  let ry = 0;
  for (let r = 0; r < rowCount; r += 1) {
    rowY.push(ry);
    ry += rowH[r];
  }

  return {
    table,
    w,
    h,
    colCount,
    rowCount,
    colPx,
    colX,
    rowH,
    rowY,
    naturalTotal,
    cellLines,
    fontSize,
    lineHeight,
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

export function drawCanvasTable(ctx, element) {
  const layout = computeTableLayout(element);
  const {
    table,
    w,
    h,
    colCount,
    rowCount,
    colPx,
    colX,
    rowH,
    rowY,
    cellLines,
    fontSize,
    lineHeight,
    padX,
    padY,
  } = layout;

  const radius = element.roundness ? 10 : 0;
  const cardBg =
    element.backgroundColor && element.backgroundColor !== "transparent"
      ? element.backgroundColor
      : "#ffffff";
  const borderColor = "#dcdce8";
  const headerBg = "#f4f4fa";
  const stripeBg = "#fafafd";
  const defaultInk = "#1e1e24";

  ctx.save();
  drawRoundedPath(ctx, 0, 0, w, h, radius);
  ctx.clip();

  // Base card fill
  ctx.fillStyle = cardBg;
  ctx.fillRect(0, 0, w, h);

  // Cell backgrounds & text
  ctx.textBaseline = "middle";
  for (let r = 0; r < rowCount; r += 1) {
    const y = rowY[r];
    if (y > h) break;
    const rh = rowH[r];
    const isHeader = table.headerRow && r === 0;

    for (let c = 0; c < colCount; c += 1) {
      const x = colX[c];
      const cw = colPx[c];
      const cell = table.rows[r][c];
      const customBg = resolveCellBg(cell.bg, false);

      if (customBg) {
        ctx.fillStyle = customBg;
        ctx.fillRect(x, y, cw, rh);
      } else if (isHeader) {
        ctx.fillStyle = headerBg;
        ctx.fillRect(x, y, cw, rh);
      } else if (table.striped && r % 2 === 1) {
        ctx.fillStyle = stripeBg;
        ctx.fillRect(x, y, cw, rh);
      }

      const { lines, font } = cellLines[r][c];
      const align = table.colAligns[c] || "left";
      ctx.font = font;
      ctx.fillStyle = resolveCellTextColor(cell.color, false) || defaultInk;
      ctx.textAlign = align;

      const textX =
        align === "center"
          ? x + cw / 2
          : align === "right"
            ? x + cw - padX
            : x + padX;
      const totalTextH = lines.length * lineHeight;
      const startY = y + Math.max(padY, (rh - totalTextH) / 2) + lineHeight / 2;

      for (let li = 0; li < lines.length; li += 1) {
        const ly = startY + li * lineHeight;
        if (ly > y + rh + lineHeight) break;
        ctx.fillText(lines[li], textX, ly, Math.max(8, cw - padX * 2));
      }
    }
  }

  // Grid lines
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let r = 1; r <= rowCount; r += 1) {
    const y = Math.round(r < rowCount ? rowY[r] : rowY[rowCount - 1] + rowH[rowCount - 1]) + 0.5;
    if (y >= h) break;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  const gridBottom = Math.min(h, rowY[rowCount - 1] + rowH[rowCount - 1]);
  for (let c = 1; c < colCount; c += 1) {
    const x = Math.round(colX[c]) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, gridBottom);
  }
  ctx.stroke();

  // Emphasized header divider
  if (table.headerRow && rowCount > 1 && rowH[0] < h) {
    ctx.strokeStyle = "#c8c8da";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    const hy = Math.round(rowH[0]) + 0.5;
    ctx.moveTo(0, hy);
    ctx.lineTo(w, hy);
    ctx.stroke();
  }

  // Outer card border
  drawRoundedPath(ctx, 0.5, 0.5, w - 1, h - 1, radius);
  ctx.strokeStyle = element.strokeColor && element.strokeColor !== "transparent"
    ? element.strokeColor
    : borderColor;
  ctx.lineWidth = Math.max(1, element.strokeWidth || 1);
  ctx.stroke();

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
    colPx,
    colX,
    rowH,
    rowY,
    cellLines,
    fontSize,
    lineHeight,
    padX,
    padY,
  } = layout;

  const radius = element.roundness ? 10 : 0;
  const clipId = `table-clip-${element.id}-${Math.floor(Math.random() * 1e6)}`;

  const cardBg =
    element.backgroundColor && element.backgroundColor !== "transparent"
      ? element.backgroundColor
      : "#ffffff";
  const borderColor = "#dcdce8";
  const headerBg = "#f4f4fa";
  const stripeBg = "#fafafd";
  const defaultInk = "#1e1e24";

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

  const bgRect = doc.createElementNS(svgNS, "rect");
  bgRect.setAttribute("x", "0");
  bgRect.setAttribute("y", "0");
  bgRect.setAttribute("width", String(w));
  bgRect.setAttribute("height", String(h));
  bgRect.setAttribute("fill", cardBg);
  inner.appendChild(bgRect);

  for (let r = 0; r < rowCount; r += 1) {
    const y = rowY[r];
    if (y > h) break;
    const rh = rowH[r];
    const isHeader = table.headerRow && r === 0;

    for (let c = 0; c < colCount; c += 1) {
      const x = colX[c];
      const cw = colPx[c];
      const cell = table.rows[r][c];
      const customBg = resolveCellBg(cell.bg, false);
      const fill = customBg || (isHeader ? headerBg : table.striped && r % 2 === 1 ? stripeBg : null);

      if (fill) {
        const rect = doc.createElementNS(svgNS, "rect");
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(y));
        rect.setAttribute("width", String(cw));
        rect.setAttribute("height", String(rh));
        rect.setAttribute("fill", fill);
        inner.appendChild(rect);
      }

      const { lines, bold } = cellLines[r][c];
      const align = table.colAligns[c] || "left";
      const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
      const textX =
        align === "center"
          ? x + cw / 2
          : align === "right"
            ? x + cw - padX
            : x + padX;
      const totalTextH = lines.length * lineHeight;
      const startY = y + Math.max(padY, (rh - totalTextH) / 2) + lineHeight * 0.72;
      const ink = resolveCellTextColor(cell.color, false) || defaultInk;

      for (let li = 0; li < lines.length; li += 1) {
        if (!lines[li]) continue;
        const t = doc.createElementNS(svgNS, "text");
        t.textContent = lines[li];
        t.setAttribute("x", String(textX));
        t.setAttribute("y", String(startY + li * lineHeight));
        t.setAttribute("font-family", FONT_STACK);
        t.setAttribute("font-size", `${fontSize}px`);
        if (bold) t.setAttribute("font-weight", "600");
        t.setAttribute("fill", ink);
        t.setAttribute("text-anchor", anchor);
        inner.appendChild(t);
      }
    }
  }

  // Horizontal & vertical grid lines
  const gridBottom = Math.min(h, rowY[rowCount - 1] + rowH[rowCount - 1]);
  for (let r = 1; r <= rowCount; r += 1) {
    const y = r < rowCount ? rowY[r] : rowY[rowCount - 1] + rowH[rowCount - 1];
    if (y >= h) break;
    const line = doc.createElementNS(svgNS, "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", String(y));
    line.setAttribute("x2", String(w));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", table.headerRow && r === 1 ? "#c8c8da" : borderColor);
    line.setAttribute("stroke-width", table.headerRow && r === 1 ? "1.25" : "1");
    inner.appendChild(line);
  }
  for (let c = 1; c < colCount; c += 1) {
    const line = doc.createElementNS(svgNS, "line");
    line.setAttribute("x1", String(colX[c]));
    line.setAttribute("y1", "0");
    line.setAttribute("x2", String(colX[c]));
    line.setAttribute("y2", String(gridBottom));
    line.setAttribute("stroke", borderColor);
    line.setAttribute("stroke-width", "1");
    inner.appendChild(line);
  }

  group.appendChild(inner);

  const outline = doc.createElementNS(svgNS, "rect");
  outline.setAttribute("x", "0.5");
  outline.setAttribute("y", "0.5");
  outline.setAttribute("width", String(Math.max(1, w - 1)));
  outline.setAttribute("height", String(Math.max(1, h - 1)));
  outline.setAttribute("rx", String(radius));
  outline.setAttribute("ry", String(radius));
  outline.setAttribute("fill", "none");
  outline.setAttribute(
    "stroke",
    element.strokeColor && element.strokeColor !== "transparent"
      ? element.strokeColor
      : borderColor
  );
  outline.setAttribute("stroke-width", String(Math.max(1, element.strokeWidth || 1)));
  group.appendChild(outline);
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
