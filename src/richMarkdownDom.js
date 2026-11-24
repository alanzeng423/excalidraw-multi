import {
  HIGHLIGHT_COLOR_PALETTE,
  TEXT_COLOR_PALETTE,
  parseMarkdownBlocks,
  resolveHighlightColor,
  resolveTextColor,
} from "./nativeMarkdown.js";
import {
  CODE_LANGUAGES,
  highlightCodeToHtml,
  normalizeCodeLang,
} from "./codeHighlight.js";

const ZWS = "\u200B";

const HEX_TO_TEXT_COLOR_ID = Object.fromEntries(
  TEXT_COLOR_PALETTE.map((c) => [c.hex.toLowerCase(), c.id])
);

const FILL_TO_HL_ID = Object.fromEntries(
  HIGHLIGHT_COLOR_PALETTE.map((c) => [c.fill.replace(/\s+/g, "").toLowerCase(), c.id])
);

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeColorToken(colorVal) {
  if (!colorVal) return null;
  const low = String(colorVal).trim().toLowerCase();
  if (HEX_TO_TEXT_COLOR_ID[low]) return HEX_TO_TEXT_COLOR_ID[low];
  return low;
}

function normalizeHighlightToken(fillVal) {
  if (!fillVal) return null;
  const compact = String(fillVal).replace(/\s+/g, "").toLowerCase();
  if (FILL_TO_HL_ID[compact]) return FILL_TO_HL_ID[compact];
  return compact;
}

export function spansToHtml(spans, { stripBaseBold = false } = {}) {
  if (!Array.isArray(spans) || spans.length === 0) return "";
  let html = "";
  for (const span of spans) {
    if (!span.text) continue;
    let out = escapeHtml(span.text);
    if (span.code) {
      out = `<code class="md-live-code">${out}</code>`;
    } else {
      if (span.strike) out = `<del>${out}</del>`;
      if (span.italic) out = `<em>${out}</em>`;
      if (span.bold && !stripBaseBold) out = `<strong>${out}</strong>`;
    }
    if (span.color) {
      const token = normalizeColorToken(span.color);
      out = `<span data-md-color="${escapeHtml(token)}" style="color:${escapeHtml(span.color)}">${out}</span>`;
    }
    if (span.highlight) {
      const token = normalizeHighlightToken(span.highlight);
      out = `<mark class="md-live-mark" data-md-bg="${escapeHtml(token)}" style="background-color:${escapeHtml(span.highlight)}">${out}</mark>`;
    }
    html += out;
  }
  return html;
}

function buildLiveTableHtml(block, { tableOuterBorder = true, isZh = true } = {}) {
  const outerCls = tableOuterBorder === false ? " no-outer-border" : "";
  const rowsHtml = block.rows
    .map((row, ri) => {
      const isHeader = ri === 0;
      const tag = isHeader ? "th" : "td";
      const cellsHtml = row
        .map((spans, ci) => {
          const align = block.aligns?.[ci] || "left";
          const inner = spansToHtml(spans, { stripBaseBold: isHeader }) || "<br>";
          return `<${tag} class="md-live-cell" data-align="${align}" style="text-align:${align}">${inner}</${tag}>`;
        })
        .join("");
      return `<tr${isHeader ? ' class="is-header"' : ""}>${cellsHtml}</tr>`;
    })
    .join("");

  const addRowLabel = isZh ? "底部添加一行" : "Add row";
  const addColLabel = isZh ? "右侧添加一列" : "Add column";

  return (
    `<div class="md-live-table-wrap" data-md-table="1">` +
    `<div class="md-live-table-row-flex">` +
    `<table class="md-live-table${outerCls}"><tbody>${rowsHtml}</tbody></table>` +
    `<button type="button" class="md-live-tbl-add md-live-tbl-add-col" contenteditable="false" data-tbl-action="add-col" title="${addColLabel}" aria-label="${addColLabel}">+</button>` +
    `</div>` +
    `<button type="button" class="md-live-tbl-add md-live-tbl-add-row" contenteditable="false" data-tbl-action="add-row" title="${addRowLabel}" aria-label="${addRowLabel}">+</button>` +
    `</div>`
  );
}

export function renderCodePreHtml(code, lang = "javascript") {
  const clean = String(code ?? "").replace(/\r\n?/g, "\n");
  if (!clean) {
    return " ";
  }
  const highlighted = highlightCodeToHtml(clean, lang);
  // Trailing space after trailing newline ensures <pre> height matches <textarea> empty last line
  return clean.endsWith("\n") ? `${highlighted} ` : highlighted;
}

export function buildLiveCodeBlockHtml(code = "", rawLang = "javascript", { isZh = true } = {}) {
  const lang = normalizeCodeLang(rawLang || "javascript");
  const optionsHtml = CODE_LANGUAGES.map(
    (l) =>
      `<option value="${l.id}"${l.id === lang ? " selected" : ""}>${escapeHtml(l.label)}</option>`
  ).join("");
  const copyLabel = isZh ? "复制" : "Copy";
  const langAria = isZh ? "编程语言" : "Language";
  const preHtml = renderCodePreHtml(code, lang);
  const safeVal = escapeHtml(String(code ?? "").replace(/\r\n?/g, "\n"));

  return (
    `<div class="md-live-codeblock" contenteditable="false" data-md-codeblock="1" data-lang="${lang}">` +
    `<div class="md-live-cb-head">` +
    `<select class="md-live-cb-lang" data-cb-lang="1" aria-label="${langAria}">${optionsHtml}</select>` +
    `<button type="button" class="md-live-cb-copy" data-cb-copy="1">${copyLabel}</button>` +
    `</div>` +
    `<div class="md-live-cb-stage">` +
    `<pre class="md-live-cb-pre" aria-hidden="true" data-cb-pre="1">${preHtml}</pre>` +
    `<textarea class="md-live-cb-input" data-cb-input="1" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" rows="1">${safeVal}</textarea>` +
    `</div>` +
    `</div>`
  );
}

export function readCodeBlockValue(wrapEl) {
  if (!wrapEl) return "";
  const input = wrapEl.querySelector('[data-cb-input="1"]');
  if (input && typeof input.value === "string") {
    return input.value.replace(/\r\n?/g, "\n");
  }
  const pre = wrapEl.querySelector('[data-cb-pre="1"]');
  return (pre?.textContent || "").replace(/\r\n?/g, "\n");
}

export function focusCodeBlockInput(wrapEl, atEnd = true) {
  const input = wrapEl?.querySelector?.('[data-cb-input="1"]');
  if (!input) return;
  input.focus({ preventScroll: true });
  const pos = atEnd ? input.value.length : 0;
  input.setSelectionRange(pos, pos);
}

export function createBlankLiveTableHtml(opts = {}) {
  const emptyBlock = {
    type: "table",
    colCount: 3,
    aligns: ["left", "left", "left"],
    rows: [
      [[], [], []],
      [[], [], []],
      [[], [], []],
    ],
  };
  return buildLiveTableHtml(emptyBlock, opts);
}

function blockLineToHtml(parsed) {
  const indent = parsed.indent || 0;
  const indentStyle = indent > 0 ? ` style="padding-left:${indent * 1.1}em"` : "";

  if (parsed.kind === "heading") {
    const inner = spansToHtml(parsed.spans, { stripBaseBold: true }) || "<br>";
    return `<div class="md-live-line md-live-h${parsed.level}" data-block="h${parsed.level}">${inner}</div>`;
  }
  if (parsed.kind === "quote") {
    const inner = spansToHtml(parsed.spans) || "<br>";
    return `<div class="md-live-line md-live-quote" data-block="quote">${inner}</div>`;
  }
  if (parsed.kind === "bullet") {
    const inner = spansToHtml(parsed.spans) || "<br>";
    return `<div class="md-live-line md-live-bullet" data-block="bullet" data-indent="${indent}"${indentStyle}>${inner}</div>`;
  }
  if (parsed.kind === "task") {
    const checked = parsed.prefixType === "task-checked" ? "1" : "0";
    const inner = spansToHtml(parsed.spans) || "<br>";
    return (
      `<div class="md-live-line md-live-task" data-block="task" data-checked="${checked}" data-indent="${indent}"${indentStyle}>` +
      `<span class="md-live-check" contenteditable="false" data-md-check="1" role="checkbox" aria-checked="${checked === "1" ? "true" : "false"}"></span>` +
      `<span class="md-live-task-body">${inner}</span>` +
      `</div>`
    );
  }
  const inner = spansToHtml(parsed.spans) || "<br>";
  return `<div class="md-live-line" data-block="normal">${inner}</div>`;
}

export function markdownToHtml(markdown, { tableOuterBorder = true, isZh = true, allowTables = true } = {}) {
  const raw = String(markdown ?? "").replace(/\r\n?/g, "\n");
  if (!raw) {
    return `<div class="md-live-line" data-block="normal"><br></div>`;
  }
  const lines = raw.split("\n");
  const blocks = parseMarkdownBlocks(lines);
  const parts = [];
  for (const block of blocks) {
    if (block.type === "codeblock" && allowTables) {
      parts.push(
        buildLiveCodeBlockHtml(block.lines.join("\n"), block.lang || block.rawLang || "text", {
          isZh,
        })
      );
    } else if (block.type === "codeblock") {
      for (const cl of block.lines) {
        parts.push(`<div class="md-live-line" data-block="normal"><code class="md-live-code">${escapeHtml(cl)}</code></div>`);
      }
    } else if (block.type === "table" && allowTables) {
      parts.push(buildLiveTableHtml(block, { tableOuterBorder, isZh }));
    } else if (block.type === "table") {
      // Fallback when tables aren't nested (e.g. inside a table cell)
      for (const row of block.rows) {
        const inner = row.map((s) => spansToHtml(s)).join(" | ") || "<br>";
        parts.push(`<div class="md-live-line" data-block="normal">${inner}</div>`);
      }
    } else {
      parts.push(blockLineToHtml(block.parsed));
    }
  }
  return parts.join("") || `<div class="md-live-line" data-block="normal"><br></div>`;
}

function cleanText(s) {
  return String(s ?? "")
    .replace(/\u200B/g, "")
    .replace(/\u00A0/g, " ");
}

function serializeInlineNode(node, ctx = {}) {
  if (!node) return "";
  if (node.nodeType === 3) {
    return cleanText(node.nodeValue);
  }
  if (node.nodeType !== 1) return "";

  const el = node;
  if (el.getAttribute("contenteditable") === "false" || el.dataset?.mdCheck === "1") {
    return "";
  }
  const tag = el.tagName;
  if (tag === "BR") return "";

  let inner = "";
  for (const child of el.childNodes) {
    inner += serializeInlineNode(child, ctx);
  }
  if (!inner) return "";

  if (tag === "CODE") {
    return `\`${inner}\``;
  }

  let out = inner;

  const isBoldTag = tag === "STRONG" || tag === "B";
  const isItalicTag = tag === "EM" || tag === "I";
  const isStrikeTag = tag === "DEL" || tag === "S" || tag === "STRIKE";
  const colorAttr = el.getAttribute("data-md-color");
  const bgAttr = el.getAttribute("data-md-bg");

  if (isBoldTag && !ctx.inHeading && !ctx.inHeaderCell) {
    out = `**${out}**`;
  }
  if (isItalicTag) {
    out = `*${out}*`;
  }
  if (isStrikeTag) {
    out = `~~${out}~~`;
  }
  if (colorAttr) {
    out = `{c:${colorAttr}}${out}{/c}`;
  }
  if (bgAttr) {
    out = bgAttr === "yellow" ? `==${out}==` : `{bg:${bgAttr}}${out}{/bg}`;
  } else if (tag === "MARK") {
    out = `==${out}==`;
  }
  return out;
}

function serializeInlineChildren(container, ctx = {}) {
  let out = "";
  for (const child of container.childNodes) {
    out += serializeInlineNode(child, ctx);
  }
  return out;
}

function serializeTableElement(tableEl) {
  const trs = Array.from(tableEl.querySelectorAll("tr"));
  if (trs.length === 0) return [];

  const rawRows = [];
  let colCount = 1;
  const aligns = [];

  trs.forEach((tr, ri) => {
    const cells = Array.from(tr.children).filter(
      (el) => el.tagName === "TH" || el.tagName === "TD"
    );
    colCount = Math.max(colCount, cells.length);
    const rowValues = cells.map((cell, ci) => {
      if (ri === 0) {
        aligns[ci] = cell.getAttribute("data-align") || "left";
      }
      const txt = serializeInlineChildren(cell, { inHeaderCell: ri === 0 })
        .replace(/\r?\n/g, " ")
        .trim()
        .replace(/\|/g, "\\|");
      return txt;
    });
    rawRows.push(rowValues);
  });

  while (aligns.length < colCount) aligns.push("left");

  const padRow = (vals) => {
    const padded = [...vals];
    while (padded.length < colCount) padded.push("");
    return `| ${padded.join(" | ")} |`;
  };

  const sepCells = aligns.slice(0, colCount).map((a) => {
    if (a === "center") return ":---:";
    if (a === "right") return "---:";
    return "---";
  });

  const outLines = [padRow(rawRows[0]), `| ${sepCells.join(" | ")} |`];
  for (let r = 1; r < rawRows.length; r += 1) {
    outLines.push(padRow(rawRows[r]));
  }
  return outLines;
}

function serializeLineElement(el) {
  const block = el.getAttribute?.("data-block") || "normal";
  const indent = parseInt(el.getAttribute?.("data-indent") || "0", 10) || 0;
  const indentStr = "  ".repeat(Math.max(0, indent));

  if (block === "h1" || block === "h2" || block === "h3") {
    const level = parseInt(block[1], 10);
    const body = serializeInlineChildren(el, { inHeading: true });
    return `${"#".repeat(level)} ${body}`;
  }
  if (block === "quote") {
    return `> ${serializeInlineChildren(el)}`;
  }
  if (block === "bullet") {
    return `${indentStr}- ${serializeInlineChildren(el)}`;
  }
  if (block === "task") {
    const checked = el.getAttribute("data-checked") === "1";
    const bodyEl = el.querySelector?.(".md-live-task-body") || el;
    return `${indentStr}- [${checked ? "x" : " "}] ${serializeInlineChildren(bodyEl)}`;
  }
  return serializeInlineChildren(el);
}

export function domToMarkdown(rootEl) {
  if (!rootEl) return "";
  const lines = [];

  const visitChild = (node) => {
    if (node.nodeType === 3) {
      const txt = cleanText(node.nodeValue);
      if (txt) lines.push(txt);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node;

    if (el.getAttribute("data-md-codeblock") === "1") {
      const lang = el.getAttribute("data-lang") || "text";
      const code = readCodeBlockValue(el);
      const fenceLang = lang === "text" ? "" : lang;
      lines.push(`\`\`\`${fenceLang}`);
      lines.push(...code.split("\n"));
      lines.push("```");
      return;
    }

    if (el.getAttribute("data-md-table") === "1" || el.tagName === "TABLE") {
      const tbl = el.tagName === "TABLE" ? el : el.querySelector("table");
      if (tbl) {
        lines.push(...serializeTableElement(tbl));
      }
      return;
    }

    if (el.tagName === "DIV" || el.tagName === "P") {
      // Handle nested divs created by some browsers on Enter
      const hasNestedBlock = Array.from(el.children).some(
        (c) => c.getAttribute?.("data-md-table") === "1" || c.tagName === "TABLE"
      );
      if (hasNestedBlock) {
        for (const c of el.childNodes) visitChild(c);
        return;
      }
      lines.push(serializeLineElement(el));
      return;
    }

    if (el.tagName === "BR") {
      lines.push("");
      return;
    }

    const txt = serializeInlineNode(el);
    if (txt) lines.push(txt);
  };

  for (const child of rootEl.childNodes) {
    visitChild(child);
  }

  return lines.join("\n");
}

/**
 * Utility: places caret inside an element at start or end.
 */
export function placeCaretIn(el, atStart = false) {
  if (!el) return;
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  if (el.childNodes.length === 1 && el.firstChild.nodeName === "BR") {
    range.setStart(el, 0);
    range.collapse(true);
  } else {
    range.selectNodeContents(el);
    range.collapse(atStart);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

export function getClosestLineEl(node, rootEl) {
  let cur = node?.nodeType === 3 ? node.parentElement : node;
  while (cur && cur !== rootEl) {
    if (cur.classList?.contains("md-live-line")) return cur;
    cur = cur.parentElement;
  }
  return null;
}

export function getClosestCellEl(node, rootEl) {
  let cur = node?.nodeType === 3 ? node.parentElement : node;
  while (cur && cur !== rootEl) {
    if (cur.tagName === "TD" || cur.tagName === "TH") return cur;
    cur = cur.parentElement;
  }
  return null;
}

export function setLineBlockType(lineEl, targetBlock) {
  if (!lineEl) return;
  const prevBlock = lineEl.getAttribute("data-block") || "normal";
  const nextBlock = prevBlock === targetBlock ? "normal" : targetBlock;

  // Preserve inner content cleanly when converting to/from task
  let bodyHtml = "";
  if (prevBlock === "task") {
    const body = lineEl.querySelector(".md-live-task-body");
    bodyHtml = body ? body.innerHTML : lineEl.innerHTML;
  } else {
    bodyHtml = lineEl.innerHTML;
  }
  if (!bodyHtml) bodyHtml = "<br>";

  lineEl.className = "md-live-line";
  lineEl.removeAttribute("data-checked");
  lineEl.setAttribute("data-block", nextBlock);

  if (nextBlock === "h1" || nextBlock === "h2" || nextBlock === "h3") {
    lineEl.classList.add(`md-live-${nextBlock}`);
    lineEl.innerHTML = bodyHtml;
  } else if (nextBlock === "quote") {
    lineEl.classList.add("md-live-quote");
    lineEl.innerHTML = bodyHtml;
  } else if (nextBlock === "bullet") {
    lineEl.classList.add("md-live-bullet");
    lineEl.innerHTML = bodyHtml;
  } else if (nextBlock === "task") {
    lineEl.classList.add("md-live-task");
    lineEl.setAttribute("data-checked", "0");
    lineEl.innerHTML =
      `<span class="md-live-check" contenteditable="false" data-md-check="1" role="checkbox" aria-checked="false"></span>` +
      `<span class="md-live-task-body">${bodyHtml}</span>`;
  } else {
    lineEl.innerHTML = bodyHtml;
  }

  const caretTarget =
    nextBlock === "task" ? lineEl.querySelector(".md-live-task-body") : lineEl;
  placeCaretIn(caretTarget, false);
}

/**
 * Typora / Feishu-style live input rules:
 * Converts `# `, `## `, `### `, `> `, `- `, `- [ ] `, `**bold**`, `*italic*`,
 * `~~strike~~`, `` `code` ``, `==highlight==` immediately as the user types!
 */
export function tryLiveMarkdownRule(rootEl) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (!rootEl.contains(node) || node.nodeType !== 3) return false;

  const offset = range.startOffset;
  const text = node.nodeValue || "";
  const before = text.slice(0, offset);

  // 1. Block prefix rules (only when inside a normal .md-live-line and at the very beginning)
  const cellEl = getClosestCellEl(node, rootEl);
  const lineEl = cellEl ? null : getClosestLineEl(node, rootEl);
  if (lineEl && (lineEl.getAttribute("data-block") || "normal") === "normal") {
    // Check if `node` is at the visual start of `lineEl`
    const preRange = document.createRange();
    preRange.setStart(lineEl, 0);
    preRange.setEnd(node, offset);
    const fullBefore = cleanText(preRange.toString());

    // Live fenced code block shortcut: ``` or ```js + space
    const fenceM = fullBefore.match(/^```([a-zA-Z0-9+#.-]*)\s$/);
    if (fenceM && lineEl.parentElement === rootEl) {
      const lang = fenceM[1] ? normalizeCodeLang(fenceM[1]) : "javascript";
      const tmp = document.createElement("div");
      tmp.innerHTML = buildLiveCodeBlockHtml("", lang, { isZh: true });
      const wrap = tmp.firstElementChild;
      rootEl.replaceChild(wrap, lineEl);
      focusCodeBlockInput(wrap, false);
      return true;
    }

    const blockRules = [
      { re: /^###\s$/, kind: "h3" },
      { re: /^##\s$/, kind: "h2" },
      { re: /^#\s$/, kind: "h1" },
      { re: /^>\s$/, kind: "quote" },
      { re: /^[-*+]\s\[([ xX])\]\s$/, kind: "task" },
      { re: /^\[([ xX]?)\]\s$/, kind: "task" },
      { re: /^[-*+]\s$/, kind: "bullet" },
    ];

    for (const rule of blockRules) {
      const m = fullBefore.match(rule.re);
      if (m) {
        // Delete the prefix characters
        preRange.deleteContents();
        if (!lineEl.innerHTML) lineEl.innerHTML = "<br>";
        setLineBlockType(lineEl, rule.kind);
        if (rule.kind === "task" && m[1] && m[1].toLowerCase() === "x") {
          lineEl.setAttribute("data-checked", "1");
          const chk = lineEl.querySelector(".md-live-check");
          chk?.setAttribute("aria-checked", "true");
        }
        const target =
          rule.kind === "task"
            ? lineEl.querySelector(".md-live-task-body")
            : lineEl;
        placeCaretIn(target, true);
        return true;
      }
    }
  }

  // 2. Inline pair rules at caret (when user finishes closing delimiter)
  const inlineRules = [
    { re: /\*\*([^\s*](?:[^*]*[^\s*])?)\*\*$/, tag: "strong" },
    { re: /~~([^\s~](?:[^~]*[^\s~])?)~~$/, tag: "del" },
    { re: /`([^`\n]+)`$/, tag: "code", className: "md-live-code" },
    {
      re: /==([^\s=](?:[^=]*[^\s=])?)==$/,
      tag: "mark",
      className: "md-live-mark",
      attrs: {
        "data-md-bg": "yellow",
        style: `background-color:${resolveHighlightColor("yellow")}`,
      },
    },
    { re: /(?:^|[^*])\*([^\s*](?:[^*]*[^\s*])?)\*$/, tag: "em", keepLead: true },
  ];

  for (const rule of inlineRules) {
    const m = before.match(rule.re);
    if (!m) continue;
    let matchStart = offset - m[0].length;
    if (rule.keepLead && m[0][0] !== "*") {
      matchStart += 1;
    }
    const content = m[1];
    if (!content) continue;

    const afterText = text.slice(offset);
    const leadText = text.slice(0, matchStart);

    const parent = node.parentNode;
    const frag = document.createDocumentFragment();
    if (leadText) frag.appendChild(document.createTextNode(leadText));

    const styledEl = document.createElement(rule.tag);
    if (rule.className) styledEl.className = rule.className;
    if (rule.attrs) {
      for (const [k, v] of Object.entries(rule.attrs)) {
        styledEl.setAttribute(k, v);
      }
    }
    styledEl.textContent = content;
    frag.appendChild(styledEl);

    let caretNode;
    let caretOffset;
    if (afterText) {
      caretNode = document.createTextNode(afterText);
      caretOffset = 0;
      frag.appendChild(caretNode);
    } else {
      // Unstyled sibling span prevents Chromium from snapping caret back into <mark>/<code>
      const exitSpan = document.createElement("span");
      exitSpan.setAttribute("data-md-exit", "1");
      caretNode = document.createTextNode(ZWS);
      exitSpan.appendChild(caretNode);
      frag.appendChild(exitSpan);
      caretOffset = 1;
    }

    parent.replaceChild(frag, node);

    const nextRange = document.createRange();
    nextRange.setStart(caretNode, caretOffset);
    nextRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nextRange);
    return true;
  }

  return false;
}

function unwrapElements(container, selector) {
  const matches = Array.from(container.querySelectorAll(selector));
  for (const el of matches) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
}

function findAncestorInRoot(node, rootEl, matcher) {
  let cur = node?.nodeType === 3 ? node.parentElement : node;
  while (cur && cur !== rootEl) {
    if (matcher(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

export function detectActiveDomFormats(rootEl) {
  const res = {
    block: null,
    bold: false,
    italic: false,
    strike: false,
    code: false,
    color: null,
    highlight: null,
  };
  if (!rootEl) return res;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return res;
  const anchor = sel.anchorNode;
  if (!anchor || !rootEl.contains(anchor)) return res;

  const lineEl = getClosestLineEl(anchor, rootEl);
  if (lineEl) {
    const blk = lineEl.getAttribute("data-block");
    if (blk && blk !== "normal") res.block = blk;
  }

  if (findAncestorInRoot(anchor, rootEl, (el) => el.tagName === "STRONG" || el.tagName === "B")) {
    res.bold = true;
  }
  if (findAncestorInRoot(anchor, rootEl, (el) => el.tagName === "EM" || el.tagName === "I")) {
    res.italic = true;
  }
  if (findAncestorInRoot(anchor, rootEl, (el) => el.tagName === "DEL" || el.tagName === "S")) {
    res.strike = true;
  }
  if (findAncestorInRoot(anchor, rootEl, (el) => el.tagName === "CODE")) {
    res.code = true;
  }
  const colorEl = findAncestorInRoot(anchor, rootEl, (el) => el.hasAttribute("data-md-color"));
  if (colorEl) res.color = colorEl.getAttribute("data-md-color");
  const bgEl = findAncestorInRoot(anchor, rootEl, (el) => el.hasAttribute("data-md-bg"));
  if (bgEl) res.highlight = bgEl.getAttribute("data-md-bg");

  return res;
}

export function appendRowToLiveTable(tableEl) {
  if (!tableEl) return null;
  const tbody = tableEl.querySelector("tbody") || tableEl;
  const rows = Array.from(tbody.querySelectorAll("tr"));
  const colCount = rows.reduce((max, tr) => Math.max(max, tr.children.length), 1);
  const headerCells = rows[0] ? Array.from(rows[0].children) : [];

  const tr = document.createElement("tr");
  let firstCell = null;
  for (let c = 0; c < colCount; c += 1) {
    const td = document.createElement("td");
    td.className = "md-live-cell";
    const align = headerCells[c]?.getAttribute("data-align") || "left";
    td.setAttribute("data-align", align);
    td.style.textAlign = align;
    td.innerHTML = "<br>";
    tr.appendChild(td);
    if (c === 0) firstCell = td;
  }
  tbody.appendChild(tr);
  return firstCell;
}

export function appendColToLiveTable(tableEl) {
  if (!tableEl) return null;
  const tbody = tableEl.querySelector("tbody") || tableEl;
  const rows = Array.from(tbody.querySelectorAll("tr"));
  let focusCell = null;
  rows.forEach((tr, ri) => {
    const cell = document.createElement(ri === 0 ? "th" : "td");
    cell.className = "md-live-cell";
    cell.setAttribute("data-align", "left");
    cell.style.textAlign = "left";
    cell.innerHTML = "<br>";
    tr.appendChild(cell);
    if (ri === 0) focusCell = cell;
  });
  return focusCell;
}

function getSelectedLines(rootEl, range) {
  const allLines = Array.from(rootEl.querySelectorAll(":scope > .md-live-line"));
  if (allLines.length === 0) return [];
  const hit = allLines.filter((line) => range.intersectsNode(line));
  if (hit.length > 0) return hit;
  const closest = getClosestLineEl(range.startContainer, rootEl);
  return closest ? [closest] : [allLines[0]];
}

function wrapRangeWithElement(rootEl, range, { tag, className, attrs, stripSelector, toggleAncestorMatcher }) {
  const sel = window.getSelection();
  if (!sel) return;

  // Toggle OFF if selection is already completely inside a matching ancestor
  if (toggleAncestorMatcher) {
    const commonAnc = findAncestorInRoot(range.commonAncestorContainer, rootEl, toggleAncestorMatcher);
    if (commonAnc) {
      const parent = commonAnc.parentNode;
      if (parent) {
        const nextRange = document.createRange();
        const first = commonAnc.firstChild;
        const last = commonAnc.lastChild;
        while (commonAnc.firstChild) parent.insertBefore(commonAnc.firstChild, commonAnc);
        parent.removeChild(commonAnc);
        if (first && last) {
          nextRange.setStartBefore(first);
          nextRange.setEndAfter(last);
          sel.removeAllRanges();
          sel.addRange(nextRange);
        }
        return;
      }
    }
  }

  if (range.collapsed) {
    // Collapsed caret: insert styled element with ZWS so user can type immediately in that style
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    }
    const txt = document.createTextNode(ZWS);
    el.appendChild(txt);
    range.insertNode(el);
    const nextRange = document.createRange();
    nextRange.setStart(txt, 1);
    nextRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nextRange);
    return;
  }

  const fragment = range.extractContents();
  if (stripSelector) {
    unwrapElements(fragment, stripSelector);
  }
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  }
  el.appendChild(fragment);
  range.insertNode(el);

  const nextRange = document.createRange();
  nextRange.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(nextRange);
}

export function applyDomRichAction(rootEl, action, { savedRange = null, tableOuterBorder = true, isZh = true } = {}) {
  if (!rootEl || !action) return false;

  const sel = window.getSelection();
  let range = null;
  const liveRange =
    sel && sel.rangeCount > 0 && rootEl.contains(sel.getRangeAt(0).commonAncestorContainer)
      ? sel.getRangeAt(0)
      : null;
  const hasSaved =
    savedRange && rootEl.contains(savedRange.commonAncestorContainer);

  // Prefer a non-collapsed selection (live or saved) so clicking toolbar buttons never loses selection
  if (liveRange && !liveRange.collapsed) {
    range = liveRange;
  } else if (hasSaved && !savedRange.collapsed) {
    range = savedRange.cloneRange();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } else if (liveRange) {
    range = liveRange;
  } else if (hasSaved) {
    range = savedRange.cloneRange();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } else {
    range = document.createRange();
    range.selectNodeContents(rootEl);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  if (action.type === "insert-codeblock") {
    const tmp = document.createElement("div");
    tmp.innerHTML = buildLiveCodeBlockHtml("", action.lang || "javascript", { isZh });
    const wrap = tmp.firstElementChild;
    const curLine = getClosestLineEl(range.startContainer, rootEl);
    if (curLine && curLine.parentElement === rootEl) {
      const isEmptyLine = cleanText(curLine.textContent).trim() === "";
      if (isEmptyLine) {
        rootEl.replaceChild(wrap, curLine);
      } else {
        curLine.insertAdjacentElement("afterend", wrap);
      }
    } else {
      rootEl.appendChild(wrap);
    }
    focusCodeBlockInput(wrap, false);
    return true;
  }

  if (action.type === "insert-md-table") {
    const tmp = document.createElement("div");
    tmp.innerHTML = createBlankLiveTableHtml({ tableOuterBorder, isZh });
    const wrap = tmp.firstElementChild;
    const curLine = getClosestLineEl(range.startContainer, rootEl);
    if (curLine && curLine.parentElement === rootEl) {
      const isEmptyLine = cleanText(curLine.textContent).trim() === "";
      if (isEmptyLine) {
        rootEl.replaceChild(wrap, curLine);
      } else {
        curLine.insertAdjacentElement("afterend", wrap);
      }
    } else {
      rootEl.appendChild(wrap);
    }
    const firstCell = wrap.querySelector("th, td");
    placeCaretIn(firstCell, true);
    return true;
  }

  if (action.type === "md-table-add-row") {
    const tables = rootEl.querySelectorAll("table.md-live-table");
    const tbl = tables[tables.length - 1];
    if (!tbl) return false;
    const cell = appendRowToLiveTable(tbl);
    placeCaretIn(cell, true);
    return true;
  }

  if (action.type === "md-table-add-col") {
    const tables = rootEl.querySelectorAll("table.md-live-table");
    const tbl = tables[tables.length - 1];
    if (!tbl) return false;
    const cell = appendColToLiveTable(tbl);
    placeCaretIn(cell, true);
    return true;
  }

  if (action.type === "block") {
    const lines = getSelectedLines(rootEl, range);
    if (lines.length === 0) return false;
    for (const line of lines) {
      setLineBlockType(line, action.kind);
    }
    return true;
  }

  if (action.type === "inline") {
    const map = {
      bold: {
        tag: "strong",
        stripSelector: "strong, b",
        toggleAncestorMatcher: (el) => el.tagName === "STRONG" || el.tagName === "B",
      },
      italic: {
        tag: "em",
        stripSelector: "em, i",
        toggleAncestorMatcher: (el) => el.tagName === "EM" || el.tagName === "I",
      },
      strike: {
        tag: "del",
        stripSelector: "del, s, strike",
        toggleAncestorMatcher: (el) => el.tagName === "DEL" || el.tagName === "S",
      },
      code: {
        tag: "code",
        className: "md-live-code",
        stripSelector: "code",
        toggleAncestorMatcher: (el) => el.tagName === "CODE",
      },
    };
    const cfg = map[action.kind];
    if (!cfg) return false;
    wrapRangeWithElement(rootEl, range, cfg);
    return true;
  }

  if (action.type === "color") {
    if (!action.color) {
      const anc = findAncestorInRoot(range.commonAncestorContainer, rootEl, (el) =>
        el.hasAttribute("data-md-color")
      );
      if (anc && anc.parentNode) {
        while (anc.firstChild) anc.parentNode.insertBefore(anc.firstChild, anc);
        anc.parentNode.removeChild(anc);
      } else if (!range.collapsed) {
        const frag = range.extractContents();
        unwrapElements(frag, "[data-md-color]");
        range.insertNode(frag);
      }
      return true;
    }
    const hex = resolveTextColor(action.color);
    if (!hex) return false;
    wrapRangeWithElement(rootEl, range, {
      tag: "span",
      attrs: { "data-md-color": action.color, style: `color:${hex}` },
      stripSelector: "[data-md-color]",
      toggleAncestorMatcher: (el) => el.getAttribute("data-md-color") === action.color,
    });
    return true;
  }

  if (action.type === "highlight") {
    if (!action.color) {
      const anc = findAncestorInRoot(range.commonAncestorContainer, rootEl, (el) =>
        el.hasAttribute("data-md-bg") || el.tagName === "MARK"
      );
      if (anc && anc.parentNode) {
        while (anc.firstChild) anc.parentNode.insertBefore(anc.firstChild, anc);
        anc.parentNode.removeChild(anc);
      } else if (!range.collapsed) {
        const frag = range.extractContents();
        unwrapElements(frag, "mark, [data-md-bg]");
        range.insertNode(frag);
      }
      return true;
    }
    const fill = resolveHighlightColor(action.color);
    if (!fill) return false;
    wrapRangeWithElement(rootEl, range, {
      tag: "mark",
      className: "md-live-mark",
      attrs: { "data-md-bg": action.color, style: `background-color:${fill}` },
      stripSelector: "mark, [data-md-bg]",
      toggleAncestorMatcher: (el) => el.getAttribute("data-md-bg") === action.color,
    });
    return true;
  }

  if (action.type === "clear") {
    const lines = getSelectedLines(rootEl, range);
    if (!range.collapsed) {
      const text = cleanText(range.toString());
      range.deleteContents();
      const txtNode = document.createTextNode(text);
      range.insertNode(txtNode);
      const next = document.createRange();
      next.selectNodeContents(txtNode);
      sel?.removeAllRanges();
      sel?.addRange(next);
    } else {
      for (const line of lines) {
        unwrapElements(line, "strong, b, em, i, del, s, strike, code, mark, [data-md-color], [data-md-bg]");
        setLineBlockType(line, "normal");
      }
    }
    return true;
  }

  return false;
}
