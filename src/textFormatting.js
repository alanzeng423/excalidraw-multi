const BLOCK_PREFIX_RE = /^(#{1,3}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+)/;
const COLOR_OPEN_RE = /\{(c|color):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}$/;
const COLOR_CLOSE_RE = /^\{\/(c|color)\}/;
const BG_OPEN_RE = /\{(bg|hl):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}$/;
const BG_CLOSE_RE = /^\{\/(bg|hl)\}/;

function getLineBounds(text, start, end) {
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const searchFrom = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const nlAfter = text.indexOf("\n", searchFrom);
  const lineEnd = nlAfter === -1 ? text.length : nlAfter;
  return { lineStart, lineEnd };
}

function classifyLinePrefix(line) {
  const h = line.match(/^(#{1,3})\s+/);
  if (h) return { kind: `h${h[1].length}`, len: h[0].length };
  const task = line.match(/^(\s*[-*+]\s+\[([ xX])\]\s+)/);
  if (task) {
    return {
      kind: task[2] === " " ? "task-unchecked" : "task-checked",
      len: task[0].length,
    };
  }
  const bullet = line.match(/^(\s*[-*+]\s+)/);
  if (bullet) return { kind: "bullet", len: bullet[0].length };
  const quote = line.match(/^(>\s?)/);
  if (quote) return { kind: "quote", len: quote[0].length };
  return { kind: null, len: 0 };
}

export function applyBlockFormat(text, start, end, kind) {
  const { lineStart, lineEnd } = getLineBounds(text, start, end);
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const targetLines = nonEmpty.length > 0 ? nonEmpty : lines;

  const targetPrefix = {
    h1: "# ",
    h2: "## ",
    h3: "### ",
    bullet: "- ",
    task: "- [ ] ",
    quote: "> ",
  }[kind];
  if (!targetPrefix) return { text, start, end };

  let mode = "set";
  if (kind === "task") {
    const allUnchecked = targetLines.every(
      (l) => classifyLinePrefix(l).kind === "task-unchecked"
    );
    const allChecked = targetLines.every(
      (l) => classifyLinePrefix(l).kind === "task-checked"
    );
    if (allUnchecked) mode = "check";
    else if (allChecked) mode = "remove";
  } else {
    const allMatch = targetLines.every(
      (l) => classifyLinePrefix(l).kind === kind
    );
    if (allMatch) mode = "remove";
  }

  let firstDelta = 0;
  let totalDelta = 0;
  const nextLines = lines.map((line, idx) => {
    if (nonEmpty.length > 0 && line.trim().length === 0) return line;
    const prev = classifyLinePrefix(line);
    const body = line.slice(prev.len);
    let nextLine;
    if (mode === "remove") {
      nextLine = body;
    } else if (mode === "check") {
      nextLine = `- [x] ${body}`;
    } else {
      nextLine = `${targetPrefix}${body}`;
    }
    const delta = nextLine.length - line.length;
    if (idx === 0) firstDelta = delta;
    totalDelta += delta;
    return nextLine;
  });

  const nextBlock = nextLines.join("\n");
  const nextText = text.slice(0, lineStart) + nextBlock + text.slice(lineEnd);
  const nextStart =
    start === end
      ? Math.max(lineStart, start + totalDelta)
      : Math.max(lineStart, start + firstDelta);
  const nextEnd = Math.max(nextStart, end + totalDelta);
  return { text: nextText, start: nextStart, end: nextEnd };
}

function isWrappedWithDelimiter(text, start, end, delim) {
  const dLen = delim.length;
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);

  // Guard * against **
  const checkOutside = () => {
    if (!before.endsWith(delim) || !after.startsWith(delim)) return false;
    if (delim === "*") {
      const twoBefore = before.endsWith("**") && !before.endsWith("***");
      const twoAfter = after.startsWith("**") && !after.startsWith("***");
      if (twoBefore && twoAfter) return false;
    }
    return true;
  };

  if (checkOutside()) {
    return "outside";
  }

  if (
    selected.length >= dLen * 2 &&
    selected.startsWith(delim) &&
    selected.endsWith(delim)
  ) {
    if (delim === "*") {
      const isOnlyBold =
        selected.startsWith("**") &&
        selected.endsWith("**") &&
        !(selected.startsWith("***") && selected.endsWith("***"));
      if (isOnlyBold) return null;
    }
    return "inside";
  }
  return null;
}

export function applyInlineFormat(text, start, end, kind) {
  const delim = {
    bold: "**",
    italic: "*",
    strike: "~~",
    code: "`",
  }[kind];
  if (!delim) return { text, start, end };
  const dLen = delim.length;

  // Collapsed caret
  if (start === end) {
    const before = text.slice(0, start);
    const after = text.slice(start);
    if (before.endsWith(delim) && after.startsWith(delim)) {
      const nextText = before.slice(0, -dLen) + after.slice(dLen);
      return { text: nextText, start: start - dLen, end: start - dLen };
    }
    const nextText = before + delim + delim + after;
    return { text: nextText, start: start + dLen, end: start + dLen };
  }

  const wrapped = isWrappedWithDelimiter(text, start, end, delim);
  if (wrapped === "outside") {
    const nextText =
      text.slice(0, start - dLen) +
      text.slice(start, end) +
      text.slice(end + dLen);
    return { text: nextText, start: start - dLen, end: end - dLen };
  }
  if (wrapped === "inside") {
    const inner = text.slice(start + dLen, end - dLen);
    const nextText = text.slice(0, start) + inner + text.slice(end);
    return { text: nextText, start, end: start + inner.length };
  }

  // Preserve leading/trailing whitespace outside delimiters so parser matches cleanly
  const selected = text.slice(start, end);
  const lead = selected.match(/^\s*/)[0];
  const trail = selected.match(/\s*$/)[0];
  const core = selected.slice(lead.length, selected.length - trail.length);
  if (!core) return { text, start, end };

  const wrappedCore = delim + core + delim;
  const nextText =
    text.slice(0, start) + lead + wrappedCore + trail + text.slice(end);
  const nextStart = start + lead.length + dLen;
  const nextEnd = nextStart + core.length;
  return { text: nextText, start: nextStart, end: nextEnd };
}

function findEnclosingTag(text, pos, openReGlobal, closeReGlobal) {
  // Search within the current line only
  const { lineStart, lineEnd } = getLineBounds(text, pos, pos);
  const line = text.slice(lineStart, lineEnd);
  const relPos = pos - lineStart;

  const opens = [];
  let m;
  const re = new RegExp(
    `(${openReGlobal.source})|(${closeReGlobal.source})`,
    "g"
  );
  while ((m = re.exec(line)) !== null) {
    if (m[1]) {
      opens.push({
        start: m.index,
        contentStart: m.index + m[0].length,
        tag: m[2],
        value: m[3],
        openStr: m[0],
      });
    } else if (m[4]) {
      const closeTag = m[5];
      for (let i = opens.length - 1; i >= 0; i -= 1) {
        if (opens[i].tag === closeTag) {
          const opener = opens.splice(i, 1)[0];
          const closeStart = m.index;
          const closeEnd = m.index + m[0].length;
          if (relPos >= opener.contentStart && relPos <= closeStart) {
            return {
              openStart: lineStart + opener.start,
              contentStart: lineStart + opener.contentStart,
              closeStart: lineStart + closeStart,
              closeEnd: lineStart + closeEnd,
              tag: opener.tag,
              value: opener.value,
            };
          }
          break;
        }
      }
    }
  }
  return null;
}

function stripColorTags(str) {
  return str
    .replace(/\{(c|color):(?:[a-zA-Z]+|#[0-9a-fA-F]{3,8})\}/g, "")
    .replace(/\{\/(c|color)\}/g, "");
}

function stripHighlightTags(str) {
  return str
    .replace(/\{(bg|hl):(?:[a-zA-Z]+|#[0-9a-fA-F]{3,8})\}/g, "")
    .replace(/\{\/(bg|hl)\}/g, "")
    .replace(/==([^=\n]+)==/g, "$1");
}

export function applyInlineColor(text, start, end, colorId) {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);

  // Collapsed caret
  if (start === end) {
    const enc = findEnclosingTag(
      text,
      start,
      /\{(c|color):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}/,
      /\{\/(c|color)\}/
    );
    if (enc) {
      const inner = text.slice(enc.contentStart, enc.closeStart);
      if (!colorId || enc.value.toLowerCase() === colorId.toLowerCase()) {
        const nextText =
          text.slice(0, enc.openStart) + inner + text.slice(enc.closeEnd);
        const shift = enc.contentStart - enc.openStart;
        return { text: nextText, start: start - shift, end: start - shift };
      }
      const nextOpen = `{c:${colorId}}`;
      const nextClose = `{/c}`;
      const nextText =
        text.slice(0, enc.openStart) +
        nextOpen +
        inner +
        nextClose +
        text.slice(enc.closeEnd);
      const shift = nextOpen.length - (enc.contentStart - enc.openStart);
      return { text: nextText, start: start + shift, end: start + shift };
    }
    if (!colorId) return { text, start, end };
    const open = `{c:${colorId}}`;
    const close = `{/c}`;
    const nextText = before + open + close + after;
    return {
      text: nextText,
      start: start + open.length,
      end: start + open.length,
    };
  }

  // Check if directly surrounded by {c:...} ... {/c}
  const openMatch = before.match(COLOR_OPEN_RE);
  const closeMatch = after.match(COLOR_CLOSE_RE);
  if (openMatch && closeMatch && openMatch[1] === closeMatch[1]) {
    const prevColor = openMatch[2].toLowerCase();
    const openLen = openMatch[0].length;
    const closeLen = closeMatch[0].length;
    if (!colorId || prevColor === colorId.toLowerCase()) {
      const nextText =
        before.slice(0, -openLen) + selected + after.slice(closeLen);
      return {
        text: nextText,
        start: start - openLen,
        end: end - openLen,
      };
    }
    const nextOpen = `{c:${colorId}}`;
    const nextClose = `{/c}`;
    const nextText =
      before.slice(0, -openLen) +
      nextOpen +
      selected +
      nextClose +
      after.slice(closeLen);
    const nextStart = start - openLen + nextOpen.length;
    return {
      text: nextText,
      start: nextStart,
      end: nextStart + selected.length,
    };
  }

  // Check if selection itself is {c:...}inner{/c}
  const selfMatch = selected.match(
    /^\{(c|color):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}([\s\S]*)\{\/\1\}$/
  );
  if (selfMatch) {
    const prevColor = selfMatch[2].toLowerCase();
    const inner = selfMatch[3];
    if (!colorId || prevColor === colorId.toLowerCase()) {
      const nextText = before + inner + after;
      return { text: nextText, start, end: start + inner.length };
    }
    const nextOpen = `{c:${colorId}}`;
    const nextText = before + nextOpen + inner + "{/c}" + after;
    return {
      text: nextText,
      start: start + nextOpen.length,
      end: start + nextOpen.length + inner.length,
    };
  }

  if (!colorId) {
    const cleaned = stripColorTags(selected);
    const nextText = before + cleaned + after;
    return { text: nextText, start, end: start + cleaned.length };
  }

  const cleaned = stripColorTags(selected);
  const open = `{c:${colorId}}`;
  const close = `{/c}`;
  const nextText = before + open + cleaned + close + after;
  const nextStart = start + open.length;
  return { text: nextText, start: nextStart, end: nextStart + cleaned.length };
}

export function applyInlineHighlight(text, start, end, colorId) {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);

  const makePair = (cid) =>
    cid === "yellow"
      ? { open: "==", close: "==" }
      : { open: `{bg:${cid}}`, close: `{/bg}` };

  // Collapsed caret
  if (start === end) {
    // Check if inside ==|==
    if (before.endsWith("==") && after.startsWith("==")) {
      if (!colorId || colorId === "yellow") {
        const nextText = before.slice(0, -2) + after.slice(2);
        return { text: nextText, start: start - 2, end: start - 2 };
      }
      const { open, close } = makePair(colorId);
      const nextText = before.slice(0, -2) + open + close + after.slice(2);
      return {
        text: nextText,
        start: start - 2 + open.length,
        end: start - 2 + open.length,
      };
    }
    const enc = findEnclosingTag(
      text,
      start,
      /\{(bg|hl):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}/,
      /\{\/(bg|hl)\}/
    );
    if (enc) {
      const inner = text.slice(enc.contentStart, enc.closeStart);
      if (!colorId || enc.value.toLowerCase() === colorId.toLowerCase()) {
        const nextText =
          text.slice(0, enc.openStart) + inner + text.slice(enc.closeEnd);
        const shift = enc.contentStart - enc.openStart;
        return { text: nextText, start: start - shift, end: start - shift };
      }
      const { open, close } = makePair(colorId);
      const nextText =
        text.slice(0, enc.openStart) +
        open +
        inner +
        close +
        text.slice(enc.closeEnd);
      const shift = open.length - (enc.contentStart - enc.openStart);
      return { text: nextText, start: start + shift, end: start + shift };
    }
    if (!colorId) return { text, start, end };
    const { open, close } = makePair(colorId);
    const nextText = before + open + close + after;
    return {
      text: nextText,
      start: start + open.length,
      end: start + open.length,
    };
  }

  // Directly surrounded by == ... ==
  if (before.endsWith("==") && after.startsWith("==")) {
    if (!colorId || colorId === "yellow") {
      const nextText = before.slice(0, -2) + selected + after.slice(2);
      return { text: nextText, start: start - 2, end: end - 2 };
    }
    const { open, close } = makePair(colorId);
    const nextText =
      before.slice(0, -2) + open + selected + close + after.slice(2);
    const nextStart = start - 2 + open.length;
    return {
      text: nextText,
      start: nextStart,
      end: nextStart + selected.length,
    };
  }

  // Directly surrounded by {bg:...} ... {/bg}
  const openMatch = before.match(BG_OPEN_RE);
  const closeMatch = after.match(BG_CLOSE_RE);
  if (openMatch && closeMatch && openMatch[1] === closeMatch[1]) {
    const prevBg = openMatch[2].toLowerCase();
    const openLen = openMatch[0].length;
    const closeLen = closeMatch[0].length;
    if (!colorId || prevBg === colorId.toLowerCase()) {
      const nextText =
        before.slice(0, -openLen) + selected + after.slice(closeLen);
      return { text: nextText, start: start - openLen, end: end - openLen };
    }
    const { open, close } = makePair(colorId);
    const nextText =
      before.slice(0, -openLen) +
      open +
      selected +
      close +
      after.slice(closeLen);
    const nextStart = start - openLen + open.length;
    return {
      text: nextText,
      start: nextStart,
      end: nextStart + selected.length,
    };
  }

  // Selection itself is ==inner==
  if (
    selected.length > 4 &&
    selected.startsWith("==") &&
    selected.endsWith("==")
  ) {
    const inner = selected.slice(2, -2);
    if (!colorId || colorId === "yellow") {
      const nextText = before + inner + after;
      return { text: nextText, start, end: start + inner.length };
    }
    const { open, close } = makePair(colorId);
    const nextText = before + open + inner + close + after;
    return {
      text: nextText,
      start: start + open.length,
      end: start + open.length + inner.length,
    };
  }

  // Selection itself is {bg:...}inner{/bg}
  const selfBg = selected.match(
    /^\{(bg|hl):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}([\s\S]*)\{\/\1\}$/
  );
  if (selfBg) {
    const prevBg = selfBg[2].toLowerCase();
    const inner = selfBg[3];
    if (!colorId || prevBg === colorId.toLowerCase()) {
      const nextText = before + inner + after;
      return { text: nextText, start, end: start + inner.length };
    }
    const { open, close } = makePair(colorId);
    const nextText = before + open + inner + close + after;
    return {
      text: nextText,
      start: start + open.length,
      end: start + open.length + inner.length,
    };
  }

  if (!colorId) {
    const cleaned = stripHighlightTags(selected);
    const nextText = before + cleaned + after;
    return { text: nextText, start, end: start + cleaned.length };
  }

  const cleaned = stripHighlightTags(selected);
  const lead = cleaned.match(/^\s*/)[0];
  const trail = cleaned.match(/\s*$/)[0];
  const core = cleaned.slice(lead.length, cleaned.length - trail.length);
  if (!core) return { text, start, end };

  const { open, close } = makePair(colorId);
  const nextText = before + lead + open + core + close + trail + after;
  const nextStart = start + lead.length + open.length;
  return { text: nextText, start: nextStart, end: nextStart + core.length };
}

export function clearMarkdownFormatting(text, start, end) {
  const isWhole = start === end || (start === 0 && end === text.length);
  const from = isWhole ? 0 : start;
  const to = isWhole ? text.length : end;
  let chunk = text.slice(from, to);

  // Strip block prefixes if cleaning whole text or line starts
  if (isWhole) {
    chunk = chunk
      .split("\n")
      .map((line) => line.replace(BLOCK_PREFIX_RE, ""))
      .join("\n");
  }

  // Strip color/bg tags and inline markdown markers iteratively
  chunk = stripColorTags(chunk);
  chunk = stripHighlightTags(chunk);
  chunk = chunk
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/~~([^~\n]+)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(^|[^\w*])\*([^\s*][^*\n]*?[^\s*]|[^\s*])\*(?!\*)/g, "$1$2");

  const nextText = text.slice(0, from) + chunk + text.slice(to);
  return { text: nextText, start: from, end: from + chunk.length };
}

/**
 * Apply a formatting action to an entire text element (when selected on canvas
 * without an open textarea), preserving per-line block prefixes for inline styles.
 */
export function applyFormatToWholeText(text, action) {
  const src = String(text ?? "");
  if (!src) return src;

  if (action.type === "block") {
    return applyBlockFormat(src, 0, src.length, action.kind).text;
  }
  if (action.type === "clear") {
    return clearMarkdownFormatting(src, 0, src.length).text;
  }

  const lines = src.split("\n");
  const transformLineBody = (body) => {
    if (!body.trim()) return body;
    if (action.type === "inline") {
      return applyInlineFormat(body, 0, body.length, action.kind).text;
    }
    if (action.type === "color") {
      return applyInlineColor(body, 0, body.length, action.color).text;
    }
    if (action.type === "highlight") {
      return applyInlineHighlight(body, 0, body.length, action.color).text;
    }
    return body;
  };

  return lines
    .map((line) => {
      if (!line.trim()) return line;
      const prefix = classifyLinePrefix(line);
      return line.slice(0, prefix.len) + transformLineBody(line.slice(prefix.len));
    })
    .join("\n");
}

export function detectActiveFormats(text, start, end) {
  const src = String(text ?? "");
  const s = Math.max(0, Math.min(start ?? 0, src.length));
  const e = Math.max(s, Math.min(end ?? src.length, src.length));

  const { lineStart, lineEnd } = getLineBounds(src, s, e);
  const firstLine = src.slice(lineStart, lineEnd).split("\n")[0] || "";
  const prefix = classifyLinePrefix(firstLine);

  const before = src.slice(0, s);
  const selected = src.slice(s, e);
  const after = src.slice(e);

  // Detect color
  let color = null;
  const cOut = before.match(COLOR_OPEN_RE);
  const cClose = after.match(COLOR_CLOSE_RE);
  if (cOut && cClose && cOut[1] === cClose[1]) {
    color = cOut[2].toLowerCase();
  } else {
    const cSelf = selected.match(
      /^\{(c|color):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}([\s\S]*)\{\/\1\}$/
    );
    if (cSelf) {
      color = cSelf[2].toLowerCase();
    } else if (s === e) {
      const enc = findEnclosingTag(
        src,
        s,
        /\{(c|color):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}/,
        /\{\/(c|color)\}/
      );
      if (enc) color = enc.value.toLowerCase();
    }
  }

  // Detect highlight
  let highlight = null;
  if (
    (before.endsWith("==") && after.startsWith("==")) ||
    (selected.length > 4 && selected.startsWith("==") && selected.endsWith("=="))
  ) {
    highlight = "yellow";
  } else {
    const bgOut = before.match(BG_OPEN_RE);
    const bgClose = after.match(BG_CLOSE_RE);
    if (bgOut && bgClose && bgOut[1] === bgClose[1]) {
      highlight = bgOut[2].toLowerCase();
    } else {
      const bgSelf = selected.match(
        /^\{(bg|hl):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}([\s\S]*)\{\/\1\}$/
      );
      if (bgSelf) {
        highlight = bgSelf[2].toLowerCase();
      } else if (s === e) {
        const enc = findEnclosingTag(
          src,
          s,
          /\{(bg|hl):([a-zA-Z]+|#[0-9a-fA-F]{3,8})\}/,
          /\{\/(bg|hl)\}/
        );
        if (enc) highlight = enc.value.toLowerCase();
      }
    }
  }

  const checkDelim = (d) =>
    s < e
      ? Boolean(isWrappedWithDelimiter(src, s, e, d))
      : before.endsWith(d) && after.startsWith(d);

  return {
    block:
      prefix.kind === "task-unchecked" || prefix.kind === "task-checked"
        ? "task"
        : prefix.kind,
    bold: checkDelim("**"),
    italic: checkDelim("*"),
    strike: checkDelim("~~"),
    code: checkDelim("`"),
    color,
    highlight,
  };
}
