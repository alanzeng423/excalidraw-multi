import {
  CaptureUpdateAction,
  exportToBlob,
  restoreElements,
} from "@excalidraw/excalidraw";
import { getElementFontFamilyStr, resolveCjkFontId } from "./cjkFonts";
import { hasMarkdownTable, measureNativeTextBox } from "./nativeMarkdown";

const COLOR_ALIASES = {
  black: "#1e1e1e",
  dark: "#1e1e1e",
  gray: "#868e96",
  grey: "#868e96",
  red: "#e03131",
  pink: "#c2255c",
  grape: "#9c36b5",
  purple: "#6741d9",
  violet: "#6741d9",
  indigo: "#3b5bdb",
  blue: "#1971c2",
  cyan: "#0c8599",
  teal: "#099268",
  green: "#2f9e44",
  lime: "#66a80f",
  yellow: "#f08c00",
  orange: "#e8590c",
  white: "#ffffff",
  transparent: "transparent",
};

const BG_ALIASES = {
  transparent: "transparent",
  none: "transparent",
  white: "#ffffff",
  gray: "#f1f3f5",
  grey: "#f1f3f5",
  red: "#ffc9c9",
  pink: "#fcc2d7",
  purple: "#e5dbff",
  violet: "#e5dbff",
  indigo: "#dbe4ff",
  blue: "#d0ebff",
  cyan: "#c5f6fa",
  teal: "#c3fae8",
  green: "#d3f9d8",
  yellow: "#fff3bf",
  orange: "#ffe8cc",
};

const FONT_FAMILY_MAP = {
  hand: 5,
  excalifont: 5,
  virgil: 1,
  normal: 2,
  helvetica: 2,
  sans: 6,
  nunito: 6,
  code: 3,
  mono: 3,
  cascadia: 3,
  shantell: 10,
  "google sans": 11,
  "open sans": 12,
  playwrite: 13,
  bentham: 14,
};

function genId(prefix = "ag") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36).slice(-4)}`;
}

function resolveColor(val, palette, fallback) {
  if (val === undefined || val === null || val === "") return fallback;
  const s = String(val).trim();
  const low = s.toLowerCase();
  if (palette[low]) return palette[low];
  return s;
}

function resolveFontFamily(val, fallback = 5) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const low = val.trim().toLowerCase();
    if (FONT_FAMILY_MAP[low]) return FONT_FAMILY_MAP[low];
  }
  return fallback;
}

function resolveRoundness(val, type) {
  if (val === null || val === false || val === "sharp") return null;
  if (val === true || val === "round" || val === "rounded") {
    return type === "arrow" || type === "line" ? { type: 2 } : { type: 3 };
  }
  if (typeof val === "object" && val.type) return val;
  return type === "arrow" || type === "line" ? { type: 2 } : { type: 3 };
}

function hasCodeBlock(text) {
  return /(?:^|\n)\s*```/.test(String(text || ""));
}

function getBoundTextElement(container, byId) {
  if (!Array.isArray(container?.boundElements)) return null;
  const ref = container.boundElements.find((b) => b.type === "text");
  if (!ref) return null;
  const txt = byId.get(ref.id);
  return txt && !txt.isDeleted ? txt : null;
}

function buildRefIndex(elements) {
  const byId = new Map();
  const byRef = new Map();
  for (const el of elements) {
    if (el.isDeleted) continue;
    byId.set(el.id, el);
    const ref = el.customData?.agentRef;
    if (typeof ref === "string" && ref) {
      byRef.set(ref, el);
    }
  }
  return { byId, byRef };
}

function resolveTarget(idOrRef, { byId, byRef }) {
  if (!idOrRef) return null;
  return byId.get(idOrRef) || byRef.get(idOrRef) || null;
}

function computeViewportBounds(appState) {
  const zoom = appState?.zoom?.value || 1;
  const x = -(appState?.scrollX || 0);
  const y = -(appState?.scrollY || 0);
  const width = (appState?.width || 1280) / zoom;
  const height = (appState?.height || 800) / zoom;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), zoom: +zoom.toFixed(2) };
}

function intersectsRect(el, rect) {
  const ex = el.x || 0;
  const ey = el.y || 0;
  const ew = Math.abs(el.width || 0);
  const eh = Math.abs(el.height || 0);
  return !(
    ex + ew < rect.x ||
    ex > rect.x + rect.width ||
    ey + eh < rect.y ||
    ey > rect.y + rect.height
  );
}

function computeAnchorEdge(src, dst) {
  const sx = src.x + src.width / 2;
  const sy = src.y + src.height / 2;
  const dx = dst.x + dst.width / 2;
  const dy = dst.y + dst.height / 2;
  const vx = dx - sx;
  const vy = dy - sy;

  const projectOnBox = (box, dirX, dirY) => {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const hw = Math.max(1, box.width / 2);
    const hh = Math.max(1, box.height / 2);
    if (Math.abs(dirX) < 1e-4 && Math.abs(dirY) < 1e-4) {
      return { x: cx + hw, y: cy };
    }
    const tx = Math.abs(dirX) > 1e-4 ? hw / Math.abs(dirX) : Infinity;
    const ty = Math.abs(dirY) > 1e-4 ? hh / Math.abs(dirY) : Infinity;
    const t = Math.min(tx, ty);
    return {
      x: cx + dirX * t,
      y: cy + dirY * t,
    };
  };

  const gap = 6;
  const len = Math.hypot(vx, vy) || 1;
  const ux = vx / len;
  const uy = vy / len;

  const p1 = projectOnBox(src, vx, vy);
  const p2 = projectOnBox(dst, -vx, -vy);
  return {
    start: { x: Math.round(p1.x + ux * gap), y: Math.round(p1.y + uy * gap) },
    end: { x: Math.round(p2.x - ux * gap), y: Math.round(p2.y - uy * gap) },
  };
}

function summarizeElement(el, byId, selectedSet) {
  const base = {
    id: el.id,
    ...(el.customData?.agentRef ? { ref: el.customData.agentRef } : {}),
    type: el.type,
    x: Math.round(el.x),
    y: Math.round(el.y),
    w: Math.round(el.width),
    h: Math.round(el.height),
    ...(selectedSet.has(el.id) ? { selected: true } : {}),
    ...(el.frameId ? { frameId: el.frameId } : {}),
    ...(el.groupIds?.length ? { groupIds: el.groupIds } : {}),
  };

  if (el.type === "text") {
    const raw = String(el.originalText ?? el.text ?? "");
    const truncated = raw.length > 160;
    return {
      ...base,
      text: truncated ? `${raw.slice(0, 160)}…` : raw,
      ...(truncated ? { truncated: true, totalChars: raw.length } : {}),
      fontSize: el.fontSize,
      stroke: el.strokeColor,
      ...(el.customData?.cjkFont ? { cjkFont: el.customData.cjkFont } : {}),
      ...(hasMarkdownTable(raw) ? { hasTable: true, tableOuterBorder: el.customData?.tableOuterBorder !== false } : {}),
      ...(hasCodeBlock(raw) ? { hasCodeBlock: true } : {}),
    };
  }

  if (el.type === "arrow" || el.type === "line") {
    const boundTxt = getBoundTextElement(el, byId);
    return {
      ...base,
      ...(el.startBinding?.elementId ? { from: el.startBinding.elementId } : {}),
      ...(el.endBinding?.elementId ? { to: el.endBinding.elementId } : {}),
      ...(boundTxt ? { label: String(boundTxt.originalText ?? boundTxt.text ?? "") } : {}),
      stroke: el.strokeColor,
      ...(el.strokeStyle && el.strokeStyle !== "solid" ? { strokeStyle: el.strokeStyle } : {}),
    };
  }

  if (el.type === "frame") {
    return {
      ...base,
      name: el.name || "",
    };
  }

  if (el.type === "embeddable") {
    if (el.customData?.type === "table") {
      const tbl = el.customData.table;
      return {
        ...base,
        type: "table_card",
        rows: tbl?.rows?.length || 0,
        cols: tbl?.colWidths?.length || 0,
        outerBorder: tbl?.outerBorder !== false,
      };
    }
    if (el.customData?.type === "markdown") {
      const md = String(el.customData.markdown || "");
      return {
        ...base,
        type: "markdown_card",
        markdownPreview: md.slice(0, 120),
      };
    }
  }

  const boundTxt = getBoundTextElement(el, byId);
  return {
    ...base,
    ...(boundTxt ? { label: String(boundTxt.originalText ?? boundTxt.text ?? "") } : {}),
    ...(el.backgroundColor && el.backgroundColor !== "transparent" ? { bg: el.backgroundColor } : {}),
    stroke: el.strokeColor,
  };
}

function makeBoundTextSkeleton(container, text, opts = {}) {
  const fontSize = opts.fontSize || 18;
  const fontFamily = resolveFontFamily(opts.fontFamily, 5);
  const cjkFont = opts.cjkFont || undefined;
  const lineHeight = 1.25;
  const textId = genId("txt");
  const probeEl = { fontFamily, customData: cjkFont ? { cjkFont } : {} };
  const fontFamilyStr = getElementFontFamilyStr(probeEl);
  const measured = measureNativeTextBox(text, fontSize, fontFamilyStr, lineHeight);

  const isArrow = container.type === "arrow" || container.type === "line";
  const padX = isArrow ? 8 : 20;
  const padY = isArrow ? 6 : 16;

  // Auto-expand shape so bound label never clips
  if (!isArrow) {
    if (container.width < measured.width + padX * 2) {
      container.width = Math.round(measured.width + padX * 2);
    }
    if (container.height < measured.height + padY * 2) {
      container.height = Math.round(measured.height + padY * 2);
    }
  }

  const textW = Math.round(measured.width);
  const textH = Math.round(measured.height);
  const x = isArrow
    ? Math.round(container.x + (container.width || 0) / 2 - textW / 2)
    : Math.round(container.x + (container.width - textW) / 2);
  const y = isArrow
    ? Math.round(container.y + (container.height || 0) / 2 - textH / 2)
    : Math.round(container.y + (container.height - textH) / 2);

  return {
    id: textId,
    type: "text",
    x,
    y,
    width: textW,
    height: textH,
    text,
    originalText: text,
    fontSize,
    fontFamily,
    lineHeight,
    textAlign: "center",
    verticalAlign: "middle",
    strokeColor: resolveColor(opts.textColor || opts.stroke, COLOR_ALIASES, "#1e1e1e"),
    backgroundColor: "transparent",
    containerId: container.id,
    autoResize: true,
    opacity: opts.opacity ?? 100,
    ...(container.groupIds?.length ? { groupIds: [...container.groupIds] } : {}),
    ...(container.frameId ? { frameId: container.frameId } : {}),
    customData: {
      ...(cjkFont ? { cjkFont } : {}),
    },
  };
}

function recomputeConnectedArrows(allElements, movedIdSet) {
  const byId = new Map(allElements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const updatedArrows = new Map();

  for (const el of allElements) {
    if (el.isDeleted || (el.type !== "arrow" && el.type !== "line")) continue;
    const fromId = el.startBinding?.elementId;
    const toId = el.endBinding?.elementId;
    if (!fromId || !toId) continue;
    if (!movedIdSet.has(fromId) && !movedIdSet.has(toId)) continue;
    const src = byId.get(fromId);
    const dst = byId.get(toId);
    if (!src || !dst) continue;

    const { start, end } = computeAnchorEdge(src, dst);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const nextArrow = {
      ...el,
      x: start.x,
      y: start.y,
      width: Math.abs(dx),
      height: Math.abs(dy),
      points: [
        [0, 0],
        [dx, dy],
      ],
      version: (el.version || 0) + 1,
      versionNonce: Math.floor(Math.random() * 2147483647),
      updated: Date.now(),
    };
    updatedArrows.set(el.id, nextArrow);
  }

  if (updatedArrows.size === 0) return allElements;

  // Also re-center any bound text labels on moved arrows
  const labelUpdates = new Map();
  for (const arrow of updatedArrows.values()) {
    const lbl = getBoundTextElement(arrow, byId);
    if (lbl) {
      const midX = arrow.x + (arrow.points[1][0] || 0) / 2;
      const midY = arrow.y + (arrow.points[1][1] || 0) / 2;
      labelUpdates.set(lbl.id, {
        ...lbl,
        x: Math.round(midX - lbl.width / 2),
        y: Math.round(midY - lbl.height / 2),
        version: (lbl.version || 0) + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
        updated: Date.now(),
      });
    }
  }

  return allElements.map((el) => updatedArrows.get(el.id) || labelUpdates.get(el.id) || el);
}

function recenterBoundTexts(allElements, movedIdSet) {
  const byId = new Map(allElements.filter((e) => !e.isDeleted).map((e) => [e.id, e]));
  const textUpdates = new Map();

  for (const id of movedIdSet) {
    const box = byId.get(id);
    if (!box || box.type === "arrow" || box.type === "line" || box.type === "text") continue;
    const lbl = getBoundTextElement(box, byId);
    if (!lbl) continue;
    textUpdates.set(lbl.id, {
      ...lbl,
      x: Math.round(box.x + (box.width - lbl.width) / 2),
      y: Math.round(box.y + (box.height - lbl.height) / 2),
      version: (lbl.version || 0) + 1,
      versionNonce: Math.floor(Math.random() * 2147483647),
      updated: Date.now(),
    });
  }

  if (textUpdates.size === 0) return allElements;
  return allElements.map((el) => textUpdates.get(el.id) || el);
}

async function blobToResizedPngBase64(blob, maxWidth = 1280) {
  const bmp = await createImageBitmap(blob);
  const scale = bmp.width > maxWidth ? maxWidth / bmp.width : 1;
  const outW = Math.max(1, Math.round(bmp.width * scale));
  const outH = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0, outW, outH);
  bmp.close?.();
  const dataUrl = canvas.toDataURL("image/png");
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { base64, width: outW, height: outH };
}

export async function executeAgentTool(api, toolName, args = {}, ctx = {}) {
  if (!api) {
    throw new Error("Excalidraw canvas is not ready.");
  }

  const boardId = ctx.boardId || "";
  const title = ctx.title || "Untitled";

  if (toolName === "get_board_overview") {
    const scope = args.scope || "all";
    const appState = api.getAppState();
    const elements = api.getSceneElements();
    const byId = new Map(elements.map((e) => [e.id, e]));
    const selectedSet = new Set(
      Object.entries(appState.selectedElementIds || {})
        .filter(([, v]) => Boolean(v))
        .map(([k]) => k)
    );
    const viewport = computeViewportBounds(appState);

    let filtered = elements.filter((el) => !(el.type === "text" && el.containerId));
    if (scope === "selected") {
      filtered = filtered.filter((el) => selectedSet.has(el.id));
    } else if (scope === "viewport") {
      filtered = filtered.filter((el) => intersectsRect(el, viewport));
    }

    const items = filtered.slice(0, 250).map((el) => summarizeElement(el, byId, selectedSet));
    return {
      boardId,
      title,
      theme: appState.theme || "light",
      scope,
      totalElements: elements.filter((e) => !(e.type === "text" && e.containerId)).length,
      returnedElements: items.length,
      selectedIds: Array.from(selectedSet),
      viewport,
      elements: items,
    };
  }

  if (toolName === "get_elements_detail") {
    const reqIds = Array.isArray(args.ids) ? args.ids : [];
    const elements = api.getSceneElements();
    const idx = buildRefIndex(elements);
    const details = [];

    for (const key of reqIds) {
      const el = resolveTarget(key, idx);
      if (!el) continue;
      const boundTxt = getBoundTextElement(el, idx.byId);
      details.push({
        id: el.id,
        ref: el.customData?.agentRef || null,
        type: el.type,
        x: Math.round(el.x),
        y: Math.round(el.y),
        w: Math.round(el.width),
        h: Math.round(el.height),
        stroke: el.strokeColor,
        bg: el.backgroundColor,
        fillStyle: el.fillStyle,
        strokeStyle: el.strokeStyle,
        strokeWidth: el.strokeWidth,
        roughness: el.roughness,
        roundness: el.roundness,
        opacity: el.opacity,
        ...(el.type === "text"
          ? {
              text: el.originalText ?? el.text ?? "",
              fontSize: el.fontSize,
              fontFamily: el.fontFamily,
              textAlign: el.textAlign,
              cjkFont: resolveCjkFontId(el.customData?.cjkFont, el.id),
              tableOuterBorder: el.customData?.tableOuterBorder !== false,
            }
          : {}),
        ...(boundTxt
          ? {
              label: boundTxt.originalText ?? boundTxt.text ?? "",
              labelElementId: boundTxt.id,
              labelFontSize: boundTxt.fontSize,
              labelCjkFont: resolveCjkFontId(boundTxt.customData?.cjkFont, boundTxt.id),
            }
          : {}),
        ...(el.startBinding ? { from: el.startBinding.elementId } : {}),
        ...(el.endBinding ? { to: el.endBinding.elementId } : {}),
        ...(el.name ? { name: el.name } : {}),
        ...(el.customData?.type === "table" ? { table: el.customData.table } : {}),
        ...(el.customData?.type === "markdown" ? { markdown: el.customData.markdown } : {}),
      });
    }
    return { count: details.length, elements: details };
  }

  if (toolName === "get_canvas_screenshot") {
    const scope = args.scope || "all";
    const maxWidth = Math.min(1920, Math.max(320, Number(args.maxWidth) || 1280));
    const padding = Math.min(80, Math.max(8, Number(args.padding) || 24));
    const appState = api.getAppState();
    const allElements = api.getSceneElements();
    const selectedIds = appState.selectedElementIds || {};
    const viewport = computeViewportBounds(appState);

    let targets = allElements;
    if (scope === "selected") {
      const selSet = new Set(Object.entries(selectedIds).filter(([, v]) => v).map(([k]) => k));
      targets = allElements.filter(
        (el) => selSet.has(el.id) || (el.containerId && selSet.has(el.containerId))
      );
    } else if (scope === "viewport") {
      const hitIds = new Set(
        allElements.filter((el) => intersectsRect(el, viewport)).map((el) => el.id)
      );
      targets = allElements.filter(
        (el) => hitIds.has(el.id) || (el.containerId && hitIds.has(el.containerId))
      );
    }

    if (targets.length === 0) {
      return {
        empty: true,
        message: "No elements found in requested scope.",
      };
    }

    const blob = await exportToBlob({
      elements: targets,
      appState: {
        ...appState,
        exportBackground: true,
        exportWithDarkMode: appState.theme === "dark",
      },
      files: api.getFiles(),
      exportPadding: padding,
    });

    const { base64, width, height } = await blobToResizedPngBase64(blob, maxWidth);
    return {
      __mcpImage: true,
      mimeType: "image/png",
      data: base64,
      width,
      height,
      elementCount: targets.length,
    };
  }

  if (toolName === "create_elements") {
    const specs = Array.isArray(args.elements) ? args.elements : [];
    if (specs.length === 0) {
      throw new Error("elements must be a non-empty array.");
    }

    const appState = api.getAppState();
    const existingAll = api.getSceneElementsIncludingDeleted();
    const liveExisting = existingAll.filter((e) => !e.isDeleted);
    const idx = buildRefIndex(liveExisting);
    const viewport = computeViewportBounds(appState);

    const createdMap = new Map(); // ref or id -> raw skeleton
    const rawNewElements = [];
    const arrowSpecs = [];
    const frameSpecs = [];
    const boundAdds = new Map(); // existing elementId -> [{ id, type: "arrow" }]

    let autoIdx = 0;
    const defaultOriginX = Math.round(viewport.x + Math.max(80, viewport.width * 0.2));
    const defaultOriginY = Math.round(viewport.y + Math.max(80, viewport.height * 0.2));

    // Pass 1: create nodes, standalone texts
    for (const spec of specs) {
      const type = spec.type || "rectangle";
      if (type === "arrow" || type === "line") {
        arrowSpecs.push(spec);
        continue;
      }
      if (type === "frame") {
        frameSpecs.push(spec);
        continue;
      }

      const id = spec.id && !idx.byId.has(spec.id) ? String(spec.id) : genId(type.slice(0, 3));
      const ref = spec.ref ? String(spec.ref) : undefined;
      const x = Number.isFinite(spec.x) ? Math.round(spec.x) : defaultOriginX + (autoIdx % 4) * 220;
      const y = Number.isFinite(spec.y) ? Math.round(spec.y) : defaultOriginY + Math.floor(autoIdx / 4) * 140;
      autoIdx += 1;

      if (type === "text") {
        const textStr = String(spec.text ?? spec.label ?? "");
        const fontSize = Number(spec.fontSize) || 18;
        const fontFamily = resolveFontFamily(spec.fontFamily, 5);
        const cjkFont = spec.cjkFont || undefined;
        const lineHeight = 1.25;
        const customData = {
          ...(ref ? { agentRef: ref } : {}),
          ...(cjkFont ? { cjkFont } : {}),
          ...(spec.tableOuterBorder === false ? { tableOuterBorder: false } : {}),
        };
        const probe = { fontFamily, customData };
        const measured = measureNativeTextBox(textStr, fontSize, getElementFontFamilyStr(probe), lineHeight);
        const el = {
          id,
          type: "text",
          x,
          y,
          width: Math.round(spec.w || measured.width),
          height: Math.round(spec.h || measured.height),
          text: textStr,
          originalText: textStr,
          fontSize,
          fontFamily,
          lineHeight,
          textAlign: spec.textAlign || "left",
          verticalAlign: "top",
          strokeColor: resolveColor(spec.stroke || spec.color, COLOR_ALIASES, "#1e1e1e"),
          backgroundColor: "transparent",
          autoResize: true,
          opacity: spec.opacity ?? 100,
          ...(spec.groupId ? { groupIds: [String(spec.groupId)] } : {}),
          customData,
        };
        rawNewElements.push(el);
        createdMap.set(id, el);
        if (ref) createdMap.set(ref, el);
        continue;
      }

      // Shapes: rectangle / diamond / ellipse
      const shapeType = ["rectangle", "diamond", "ellipse"].includes(type) ? type : "rectangle";
      const el = {
        id,
        type: shapeType,
        x,
        y,
        width: Math.round(spec.w || 180),
        height: Math.round(spec.h || 72),
        strokeColor: resolveColor(spec.stroke, COLOR_ALIASES, "#1e1e1e"),
        backgroundColor: resolveColor(spec.bg || spec.backgroundColor, BG_ALIASES, "transparent"),
        fillStyle: spec.fillStyle || "solid",
        strokeStyle: spec.strokeStyle || "solid",
        strokeWidth: Number(spec.strokeWidth) || 2,
        roughness: Number.isFinite(spec.roughness) ? spec.roughness : 1,
        roundness: resolveRoundness(spec.roundness, shapeType),
        opacity: spec.opacity ?? 100,
        boundElements: [],
        ...(spec.groupId ? { groupIds: [String(spec.groupId)] } : {}),
        customData: ref ? { agentRef: ref } : {},
      };

      const labelText = spec.label ?? spec.text;
      if (labelText !== undefined && labelText !== null && String(labelText) !== "") {
        const boundText = makeBoundTextSkeleton(el, String(labelText), {
          fontSize: spec.fontSize || 17,
          fontFamily: spec.fontFamily,
          cjkFont: spec.cjkFont,
          textColor: spec.textColor || spec.stroke,
          opacity: el.opacity,
        });
        el.boundElements.push({ id: boundText.id, type: "text" });
        rawNewElements.push(el, boundText);
      } else {
        rawNewElements.push(el);
      }

      createdMap.set(id, el);
      if (ref) createdMap.set(ref, el);
    }

    const resolveAny = (key) => createdMap.get(key) || resolveTarget(key, idx);

    // Pass 2: declarative arrows & lines
    for (const spec of arrowSpecs) {
      const type = spec.type === "line" ? "line" : "arrow";
      const id = spec.id && !idx.byId.has(spec.id) ? String(spec.id) : genId("arr");
      const ref = spec.ref ? String(spec.ref) : undefined;
      const src = spec.from ? resolveAny(spec.from) : null;
      const dst = spec.to ? resolveAny(spec.to) : null;

      let x = Number.isFinite(spec.x) ? Math.round(spec.x) : defaultOriginX;
      let y = Number.isFinite(spec.y) ? Math.round(spec.y) : defaultOriginY;
      let points = Array.isArray(spec.points) && spec.points.length >= 2
        ? spec.points
        : [
            [0, 0],
            [140, 0],
          ];
      let startBinding = null;
      let endBinding = null;

      if (src && dst) {
        const { start, end } = computeAnchorEdge(src, dst);
        x = start.x;
        y = start.y;
        points = [
          [0, 0],
          [end.x - start.x, end.y - start.y],
        ];
        startBinding = { elementId: src.id, focus: 0, gap: 6 };
        endBinding = { elementId: dst.id, focus: 0, gap: 6 };

        for (const endpoint of [src, dst]) {
          if (createdMap.has(endpoint.id)) {
            endpoint.boundElements = [...(endpoint.boundElements || []), { id, type: "arrow" }];
          } else {
            const list = boundAdds.get(endpoint.id) || [];
            list.push({ id, type: "arrow" });
            boundAdds.set(endpoint.id, list);
          }
        }
      }

      const lastPt = points[points.length - 1];
      const arrowEl = {
        id,
        type,
        x,
        y,
        width: Math.abs(lastPt[0] || 0),
        height: Math.abs(lastPt[1] || 0),
        points,
        strokeColor: resolveColor(spec.stroke, COLOR_ALIASES, "#1e1e1e"),
        backgroundColor: "transparent",
        strokeStyle: spec.strokeStyle || "solid",
        strokeWidth: Number(spec.strokeWidth) || 2,
        roughness: Number.isFinite(spec.roughness) ? spec.roughness : 1,
        roundness: resolveRoundness(spec.roundness, type),
        startBinding,
        endBinding,
        startArrowhead: spec.startArrowhead ?? null,
        endArrowhead: type === "arrow" ? (spec.endArrowhead ?? "arrow") : null,
        opacity: spec.opacity ?? 100,
        boundElements: [],
        customData: ref ? { agentRef: ref } : {},
      };

      if (spec.label && String(spec.label).trim()) {
        const lbl = makeBoundTextSkeleton(arrowEl, String(spec.label), {
          fontSize: spec.fontSize || 14,
          fontFamily: spec.fontFamily,
          cjkFont: spec.cjkFont,
          textColor: spec.textColor || spec.stroke,
        });
        lbl.x = Math.round(x + (lastPt[0] || 0) / 2 - lbl.width / 2);
        lbl.y = Math.round(y + (lastPt[1] || 0) / 2 - lbl.height / 2);
        arrowEl.boundElements.push({ id: lbl.id, type: "text" });
        rawNewElements.push(arrowEl, lbl);
      } else {
        rawNewElements.push(arrowEl);
      }

      createdMap.set(id, arrowEl);
      if (ref) createdMap.set(ref, arrowEl);
    }

    // Pass 3: frames wrapping children
    const childFrameAssign = new Map();
    const rawFrames = [];
    for (const spec of frameSpecs) {
      const id = spec.id && !idx.byId.has(spec.id) ? String(spec.id) : genId("frm");
      const ref = spec.ref ? String(spec.ref) : undefined;
      const childIds = Array.isArray(spec.children) ? spec.children : [];
      const childEls = childIds.map(resolveAny).filter(Boolean);

      let fx = spec.x;
      let fy = spec.y;
      let fw = spec.w;
      let fh = spec.h;

      if (childEls.length > 0 && (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fw) || !Number.isFinite(fh))) {
        const pad = 36;
        const minX = Math.min(...childEls.map((c) => c.x));
        const minY = Math.min(...childEls.map((c) => c.y));
        const maxX = Math.max(...childEls.map((c) => c.x + (c.width || 0)));
        const maxY = Math.max(...childEls.map((c) => c.y + (c.height || 0)));
        fx = Math.round(minX - pad);
        fy = Math.round(minY - pad);
        fw = Math.round(maxX - minX + pad * 2);
        fh = Math.round(maxY - minY + pad * 2);
      }

      const frameEl = {
        id,
        type: "frame",
        name: String(spec.name || spec.label || "Group"),
        x: Number.isFinite(fx) ? fx : defaultOriginX - 30,
        y: Number.isFinite(fy) ? fy : defaultOriginY - 30,
        width: Number.isFinite(fw) ? fw : 360,
        height: Number.isFinite(fh) ? fh : 240,
        customData: ref ? { agentRef: ref } : {},
      };
      rawFrames.push(frameEl);
      createdMap.set(id, frameEl);
      if (ref) createdMap.set(ref, frameEl);

      for (const ch of childEls) {
        if (createdMap.has(ch.id)) {
          ch.frameId = id;
          // Also assign frameId to bound text of child
          const btRef = ch.boundElements?.find((b) => b.type === "text");
          if (btRef) {
            const bt = rawNewElements.find((n) => n.id === btRef.id);
            if (bt) bt.frameId = id;
          }
        } else {
          childFrameAssign.set(ch.id, id);
        }
      }
    }

    const restoredNew = restoreElements([...rawFrames, ...rawNewElements], null, {
      refreshDimensions: false,
    });

    const updatedExisting = existingAll.map((el) => {
      const adds = boundAdds.get(el.id);
      const nextFrame = childFrameAssign.get(el.id);
      if (!adds && !nextFrame) return el;
      return {
        ...el,
        ...(adds ? { boundElements: [...(el.boundElements || []), ...adds] } : {}),
        ...(nextFrame ? { frameId: nextFrame } : {}),
        version: (el.version || 0) + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
        updated: Date.now(),
      };
    });

    const nextAll = [...updatedExisting, ...restoredNew];
    api.updateScene({
      elements: nextAll,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    if (args.focus !== false && restoredNew.length > 0) {
      api.scrollToContent?.(restoredNew, { fitToContent: true, animate: true });
    }

    const createdSummary = restoredNew
      .filter((el) => !(el.type === "text" && el.containerId))
      .map((el) => ({
        id: el.id,
        ...(el.customData?.agentRef ? { ref: el.customData.agentRef } : {}),
        type: el.type,
        x: Math.round(el.x),
        y: Math.round(el.y),
        w: Math.round(el.width),
        h: Math.round(el.height),
      }));

    ctx.onAffected?.(createdSummary.map((c) => c.id));
    return { createdCount: createdSummary.length, created: createdSummary };
  }

  if (toolName === "update_elements") {
    const patches = Array.isArray(args.patches) ? args.patches : [];
    if (patches.length === 0) {
      throw new Error("patches must be a non-empty array.");
    }

    const all = api.getSceneElementsIncludingDeleted();
    const idx = buildRefIndex(all);
    const updatedMap = new Map();
    const extraNewTexts = [];
    const movedIds = new Set();
    const affectedIds = [];

    for (const p of patches) {
      const target = resolveTarget(p.id || p.ref, idx);
      if (!target) continue;

      const cur = updatedMap.get(target.id) || target;
      const next = {
        ...cur,
        ...(Number.isFinite(p.x) ? { x: Math.round(p.x) } : {}),
        ...(Number.isFinite(p.y) ? { y: Math.round(p.y) } : {}),
        ...(Number.isFinite(p.w) ? { width: Math.max(10, Math.round(p.w)) } : {}),
        ...(Number.isFinite(p.h) ? { height: Math.max(10, Math.round(p.h)) } : {}),
        ...(p.bg !== undefined || p.backgroundColor !== undefined
          ? { backgroundColor: resolveColor(p.bg ?? p.backgroundColor, BG_ALIASES, "transparent") }
          : {}),
        ...(p.stroke !== undefined || p.color !== undefined
          ? { strokeColor: resolveColor(p.stroke ?? p.color, COLOR_ALIASES, cur.strokeColor) }
          : {}),
        ...(p.fillStyle ? { fillStyle: p.fillStyle } : {}),
        ...(p.strokeStyle ? { strokeStyle: p.strokeStyle } : {}),
        ...(Number.isFinite(p.strokeWidth) ? { strokeWidth: p.strokeWidth } : {}),
        ...(Number.isFinite(p.roughness) ? { roughness: p.roughness } : {}),
        ...(p.roundness !== undefined ? { roundness: resolveRoundness(p.roundness, cur.type) } : {}),
        ...(Number.isFinite(p.opacity) ? { opacity: p.opacity } : {}),
        ...(p.name !== undefined && cur.type === "frame" ? { name: String(p.name) } : {}),
        customData: {
          ...(cur.customData || {}),
          ...(p.cjkFont ? { cjkFont: p.cjkFont } : {}),
          ...(p.tableOuterBorder !== undefined ? { tableOuterBorder: Boolean(p.tableOuterBorder) } : {}),
        },
        version: (cur.version || 0) + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
        updated: Date.now(),
      };

      if (Number.isFinite(p.x) || Number.isFinite(p.y) || Number.isFinite(p.w) || Number.isFinite(p.h)) {
        movedIds.add(cur.id);
      }

      if (cur.type === "text") {
        const nextText = p.text !== undefined ? String(p.text) : p.label !== undefined ? String(p.label) : cur.originalText ?? cur.text ?? "";
        const fontSize = Number(p.fontSize) || cur.fontSize || 18;
        const fontFamily = p.fontFamily !== undefined ? resolveFontFamily(p.fontFamily, cur.fontFamily) : cur.fontFamily;
        next.text = nextText;
        next.originalText = nextText;
        next.fontSize = fontSize;
        next.fontFamily = fontFamily;
        if (p.textAlign) next.textAlign = p.textAlign;
        const measured = measureNativeTextBox(
          nextText,
          fontSize,
          getElementFontFamilyStr(next),
          cur.lineHeight || 1.25
        );
        if (!Number.isFinite(p.w)) next.width = Math.round(measured.width);
        if (!Number.isFinite(p.h)) next.height = Math.round(measured.height);
      } else if (
        p.label !== undefined ||
        p.text !== undefined ||
        p.fontSize ||
        p.fontFamily ||
        p.cjkFont ||
        p.textColor ||
        p.stroke !== undefined ||
        p.color !== undefined
      ) {
        const boundTxt = getBoundTextElement(cur, idx.byId);
        const newLabel = p.label !== undefined ? String(p.label) : p.text !== undefined ? String(p.text) : boundTxt ? String(boundTxt.originalText ?? boundTxt.text ?? "") : null;
        if (newLabel !== null) {
          if (boundTxt) {
            const btCur = updatedMap.get(boundTxt.id) || boundTxt;
            const shouldSyncStroke =
              !p.textColor &&
              (p.stroke !== undefined || p.color !== undefined) &&
              btCur.strokeColor === cur.strokeColor;
            const btNext = {
              ...btCur,
              text: newLabel,
              originalText: newLabel,
              fontSize: Number(p.fontSize) || btCur.fontSize || 17,
              fontFamily: p.fontFamily !== undefined ? resolveFontFamily(p.fontFamily, btCur.fontFamily) : btCur.fontFamily,
              ...(p.textColor
                ? { strokeColor: resolveColor(p.textColor, COLOR_ALIASES, btCur.strokeColor) }
                : shouldSyncStroke
                  ? { strokeColor: next.strokeColor }
                  : {}),
              customData: {
                ...(btCur.customData || {}),
                ...(p.cjkFont ? { cjkFont: p.cjkFont } : {}),
              },
              version: (btCur.version || 0) + 1,
              versionNonce: Math.floor(Math.random() * 2147483647),
              updated: Date.now(),
            };
            const measured = measureNativeTextBox(
              newLabel,
              btNext.fontSize,
              getElementFontFamilyStr(btNext),
              btCur.lineHeight || 1.25
            );
            btNext.width = Math.round(measured.width);
            btNext.height = Math.round(measured.height);
            if (cur.type !== "arrow" && cur.type !== "line") {
              if (!Number.isFinite(p.w) && next.width < btNext.width + 32) {
                next.width = Math.round(btNext.width + 36);
                movedIds.add(cur.id);
              }
              if (!Number.isFinite(p.h) && next.height < btNext.height + 24) {
                next.height = Math.round(btNext.height + 28);
                movedIds.add(cur.id);
              }
              btNext.x = Math.round(next.x + (next.width - btNext.width) / 2);
              btNext.y = Math.round(next.y + (next.height - btNext.height) / 2);
            }
            updatedMap.set(btNext.id, btNext);
          } else if (newLabel !== "") {
            const createdTxt = makeBoundTextSkeleton(next, newLabel, {
              fontSize: p.fontSize || 17,
              fontFamily: p.fontFamily,
              cjkFont: p.cjkFont,
              textColor: p.textColor || next.strokeColor,
            });
            next.boundElements = [...(next.boundElements || []), { id: createdTxt.id, type: "text" }];
            extraNewTexts.push(createdTxt);
            movedIds.add(cur.id);
          }
        }
      }

      updatedMap.set(next.id, next);
      affectedIds.push(next.id);
    }

    if (updatedMap.size === 0) {
      return { updatedCount: 0, updatedIds: [] };
    }

    const restoredExtras = extraNewTexts.length
      ? restoreElements(extraNewTexts, null, { refreshDimensions: false })
      : [];

    let nextAll = [
      ...all.map((el) => updatedMap.get(el.id) || el),
      ...restoredExtras,
    ];
    if (movedIds.size > 0) {
      nextAll = recenterBoundTexts(nextAll, movedIds);
      nextAll = recomputeConnectedArrows(nextAll, movedIds);
    }

    api.updateScene({
      elements: nextAll,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.refresh?.();
    ctx.onAffected?.(affectedIds);
    return { updatedCount: affectedIds.length, updatedIds: affectedIds };
  }

  if (toolName === "delete_elements") {
    const reqIds = Array.isArray(args.ids) ? args.ids : [];
    const all = api.getSceneElementsIncludingDeleted();
    const idx = buildRefIndex(all);
    const deleteSet = new Set();

    for (const key of reqIds) {
      const el = resolveTarget(key, idx);
      if (!el) continue;
      deleteSet.add(el.id);
      const bt = getBoundTextElement(el, idx.byId);
      if (bt) deleteSet.add(bt.id);
    }

    if (deleteSet.size === 0) {
      return { deletedCount: 0, deletedIds: [] };
    }

    const nextAll = all.map((el) => {
      if (deleteSet.has(el.id)) {
        return {
          ...el,
          isDeleted: true,
          version: (el.version || 0) + 1,
          versionNonce: Math.floor(Math.random() * 2147483647),
          updated: Date.now(),
        };
      }
      let dirty = false;
      let nextEl = el;
      if (Array.isArray(el.boundElements) && el.boundElements.some((b) => deleteSet.has(b.id))) {
        nextEl = {
          ...nextEl,
          boundElements: el.boundElements.filter((b) => !deleteSet.has(b.id)),
        };
        dirty = true;
      }
      if (el.startBinding?.elementId && deleteSet.has(el.startBinding.elementId)) {
        nextEl = { ...nextEl, startBinding: null };
        dirty = true;
      }
      if (el.endBinding?.elementId && deleteSet.has(el.endBinding.elementId)) {
        nextEl = { ...nextEl, endBinding: null };
        dirty = true;
      }
      if (!dirty) return el;
      return {
        ...nextEl,
        version: (el.version || 0) + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
        updated: Date.now(),
      };
    });

    api.updateScene({
      elements: nextAll,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    return { deletedCount: deleteSet.size, deletedIds: Array.from(deleteSet) };
  }

  if (toolName === "layout_elements") {
    const strategy = args.strategy || "flowchart";
    const direction = args.direction || "TB";
    const gapX = Math.max(16, Number(args.gapX) || 72);
    const gapY = Math.max(16, Number(args.gapY) || 72);
    const columns = Math.max(1, Number(args.columns) || 3);
    const align = args.align || "center";

    const all = api.getSceneElementsIncludingDeleted();
    const live = all.filter((e) => !e.isDeleted);
    const idx = buildRefIndex(live);
    const appState = api.getAppState();

    let targets = [];
    if (Array.isArray(args.ids) && args.ids.length > 0) {
      targets = args.ids.map((k) => resolveTarget(k, idx)).filter(Boolean);
    } else {
      const selIds = Object.entries(appState.selectedElementIds || {})
        .filter(([, v]) => v)
        .map(([k]) => k);
      targets = (selIds.length > 0
        ? live.filter((e) => selIds.includes(e.id))
        : live
      ).filter((e) => e.type !== "arrow" && e.type !== "line" && e.type !== "frame" && !(e.type === "text" && e.containerId));
    }

    if (targets.length === 0) {
      return { laidOutCount: 0, positions: [] };
    }

    const originX = Math.round(Math.min(...targets.map((t) => t.x)));
    const originY = Math.round(Math.min(...targets.map((t) => t.y)));
    const nextPos = new Map(); // id -> { x, y }

    if (strategy === "flowchart") {
      const targetIds = new Set(targets.map((t) => t.id));
      const inDeg = new Map(targets.map((t) => [t.id, 0]));
      const adj = new Map(targets.map((t) => [t.id, []]));

      for (const el of live) {
        if (el.type !== "arrow") continue;
        const u = el.startBinding?.elementId;
        const v = el.endBinding?.elementId;
        if (u && v && u !== v && targetIds.has(u) && targetIds.has(v)) {
          adj.get(u).push(v);
          inDeg.set(v, (inDeg.get(v) || 0) + 1);
        }
      }

      // Kahn topological layering
      const layerOf = new Map();
      const queue = targets.filter((t) => (inDeg.get(t.id) || 0) === 0).map((t) => t.id);
      for (const id of queue) layerOf.set(id, 0);

      let head = 0;
      while (head < queue.length) {
        const u = queue[head++];
        const curL = layerOf.get(u) || 0;
        for (const v of adj.get(u) || []) {
          layerOf.set(v, Math.max(layerOf.get(v) || 0, curL + 1));
          const rem = (inDeg.get(v) || 1) - 1;
          inDeg.set(v, rem);
          if (rem === 0) queue.push(v);
        }
      }
      // Handle any cycle nodes cleanly
      for (const t of targets) {
        if (!layerOf.has(t.id)) layerOf.set(t.id, 0);
      }

      const layers = new Map();
      for (const t of targets) {
        const l = layerOf.get(t.id) || 0;
        if (!layers.has(l)) layers.set(l, []);
        layers.get(l).push(t);
      }
      const sortedLayerKeys = Array.from(layers.keys()).sort((a, b) => a - b);

      if (direction === "LR") {
        const maxLayerH = Math.max(
          ...sortedLayerKeys.map((k) => {
            const arr = layers.get(k);
            return arr.reduce((s, n) => s + n.height, 0) + Math.max(0, arr.length - 1) * gapY;
          })
        );
        let curX = originX;
        for (const k of sortedLayerKeys) {
          const arr = layers.get(k);
          const colW = Math.max(...arr.map((n) => n.width));
          const totalH = arr.reduce((s, n) => s + n.height, 0) + Math.max(0, arr.length - 1) * gapY;
          let curY = originY + Math.round((maxLayerH - totalH) / 2);
          for (const n of arr) {
            nextPos.set(n.id, { x: Math.round(curX + (colW - n.width) / 2), y: Math.round(curY) });
            curY += n.height + gapY;
          }
          curX += colW + gapX;
        }
      } else {
        const maxLayerW = Math.max(
          ...sortedLayerKeys.map((k) => {
            const arr = layers.get(k);
            return arr.reduce((s, n) => s + n.width, 0) + Math.max(0, arr.length - 1) * gapX;
          })
        );
        let curY = originY;
        for (const k of sortedLayerKeys) {
          const arr = layers.get(k);
          const rowH = Math.max(...arr.map((n) => n.height));
          const totalW = arr.reduce((s, n) => s + n.width, 0) + Math.max(0, arr.length - 1) * gapX;
          let curX = originX + Math.round((maxLayerW - totalW) / 2);
          for (const n of arr) {
            nextPos.set(n.id, { x: Math.round(curX), y: Math.round(curY + (rowH - n.height) / 2) });
            curX += n.width + gapX;
          }
          curY += rowH + gapY;
        }
      }
    } else if (strategy === "grid") {
      const colWidths = Array(columns).fill(0);
      const rowCount = Math.ceil(targets.length / columns);
      const rowHeights = Array(rowCount).fill(0);
      targets.forEach((n, i) => {
        const r = Math.floor(i / columns);
        const c = i % columns;
        colWidths[c] = Math.max(colWidths[c], n.width);
        rowHeights[r] = Math.max(rowHeights[r], n.height);
      });
      const colX = [originX];
      for (let c = 1; c < columns; c += 1) colX.push(colX[c - 1] + colWidths[c - 1] + gapX);
      const rowY = [originY];
      for (let r = 1; r < rowCount; r += 1) rowY.push(rowY[r - 1] + rowHeights[r - 1] + gapY);

      targets.forEach((n, i) => {
        const r = Math.floor(i / columns);
        const c = i % columns;
        nextPos.set(n.id, {
          x: Math.round(colX[c] + (colWidths[c] - n.width) / 2),
          y: Math.round(rowY[r] + (rowHeights[r] - n.height) / 2),
        });
      });
    } else if (strategy === "align") {
      const minX = Math.min(...targets.map((n) => n.x));
      const maxX = Math.max(...targets.map((n) => n.x + n.width));
      const minY = Math.min(...targets.map((n) => n.y));
      const maxY = Math.max(...targets.map((n) => n.y + n.height));
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      for (const n of targets) {
        let x = n.x;
        let y = n.y;
        if (align === "left") x = minX;
        else if (align === "right") x = maxX - n.width;
        else if (align === "center") x = cx - n.width / 2;
        else if (align === "top") y = minY;
        else if (align === "bottom") y = maxY - n.height;
        else if (align === "middle") y = cy - n.height / 2;
        nextPos.set(n.id, { x: Math.round(x), y: Math.round(y) });
      }
    } else if (strategy === "distribute") {
      const horiz = direction === "LR" || direction === "horizontal";
      const sorted = [...targets].sort((a, b) => (horiz ? a.x - b.x : a.y - b.y));
      let cur = horiz ? sorted[0].x : sorted[0].y;
      for (const n of sorted) {
        nextPos.set(n.id, horiz ? { x: Math.round(cur), y: Math.round(n.y) } : { x: Math.round(n.x), y: Math.round(cur) });
        cur += (horiz ? n.width + gapX : n.height + gapY);
      }
    } else {
      // tidy: iterative overlap push-apart
      const rects = targets.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.width, h: n.height }));
      const pad = Math.min(gapX, gapY, 32);
      for (let iter = 0; iter < 12; iter += 1) {
        let moved = false;
        for (let i = 0; i < rects.length; i += 1) {
          for (let j = i + 1; j < rects.length; j += 1) {
            const a = rects[i];
            const b = rects[j];
            const ox = Math.min(a.x + a.w + pad, b.x + b.w + pad) - Math.max(a.x, b.x);
            const oy = Math.min(a.y + a.h + pad, b.y + b.h + pad) - Math.max(a.y, b.y);
            if (ox > 0 && oy > 0) {
              moved = true;
              if (ox < oy) {
                const shift = Math.ceil(ox / 2);
                if (a.x <= b.x) {
                  a.x -= shift;
                  b.x += shift;
                } else {
                  a.x += shift;
                  b.x -= shift;
                }
              } else {
                const shift = Math.ceil(oy / 2);
                if (a.y <= b.y) {
                  a.y -= shift;
                  b.y += shift;
                } else {
                  a.y += shift;
                  b.y -= shift;
                }
              }
            }
          }
        }
        if (!moved) break;
      }
      for (const r of rects) nextPos.set(r.id, { x: Math.round(r.x), y: Math.round(r.y) });
    }

    const movedIds = new Set(nextPos.keys());
    let nextAll = all.map((el) => {
      const p = nextPos.get(el.id);
      if (!p) return el;
      return {
        ...el,
        x: p.x,
        y: p.y,
        version: (el.version || 0) + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
        updated: Date.now(),
      };
    });
    nextAll = recenterBoundTexts(nextAll, movedIds);
    nextAll = recomputeConnectedArrows(nextAll, movedIds);

    api.updateScene({
      elements: nextAll,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    api.scrollToContent?.(
      nextAll.filter((el) => movedIds.has(el.id)),
      { fitToContent: true, animate: true }
    );
    ctx.onAffected?.(Array.from(movedIds));
    return {
      laidOutCount: movedIds.size,
      strategy,
      positions: Array.from(nextPos.entries()).map(([id, p]) => ({ id, ...p })),
    };
  }

  if (toolName === "focus_viewport") {
    const all = api.getSceneElements();
    const idx = buildRefIndex(all);
    const targets =
      Array.isArray(args.ids) && args.ids.length > 0
        ? args.ids.map((k) => resolveTarget(k, idx)).filter(Boolean)
        : all;
    if (targets.length > 0) {
      api.scrollToContent?.(targets, {
        fitToContent: true,
        animate: args.animate !== false,
      });
    }
    return { focusedCount: targets.length };
  }

  throw new Error(`Unknown tool: ${toolName}`);
}
