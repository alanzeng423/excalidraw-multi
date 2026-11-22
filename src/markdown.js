import { marked } from "marked";
import katex from "katex";
import DOMPurify from "dompurify";

export const MARKDOWN_LINK = "markdown://note";

export const DEFAULT_MARKDOWN = `# Markdown Note

Supports **GFM** & **LaTeX** math:

- [x] Drag, resize & connect arrows
- [ ] Double-click to edit

$$E = mc^2, \\quad \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}$$

| Feature | Status |
| --- | --- |
| GFM Tables | Ready |
| KaTeX Math | Ready |
`;

marked.setOptions({
  gfm: true,
  breaks: true,
});

function renderKatex(expr, displayMode) {
  try {
    return katex.renderToString(expr.trim(), {
      displayMode,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return expr;
  }
}

export function renderMarkdownHtml(source) {
  const input = typeof source === "string" ? source : "";
  if (!input.trim()) return "";

  const codePlaceholders = [];
  const mathPlaceholders = [];

  // 1. Protect fenced code blocks & inline code so $ inside code is untouched
  let text = input
    .replace(/```[\s\S]*?```/g, (m) => {
      const idx = codePlaceholders.length;
      codePlaceholders.push(m);
      return `@@CODEBLOCK_${idx}@@`;
    })
    .replace(/`[^`\n]+`/g, (m) => {
      const idx = codePlaceholders.length;
      codePlaceholders.push(m);
      return `@@CODEINLINE_${idx}@@`;
    });

  // 2. Extract display math: $$...$$ and \[...\]
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    const idx = mathPlaceholders.length;
    mathPlaceholders.push(
      `<div class="md-math-block">${renderKatex(expr, true)}</div>`
    );
    return `\n\n@@MATHBLOCK_${idx}@@\n\n`;
  });

  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) => {
    const idx = mathPlaceholders.length;
    mathPlaceholders.push(
      `<div class="md-math-block">${renderKatex(expr, true)}</div>`
    );
    return `\n\n@@MATHBLOCK_${idx}@@\n\n`;
  });

  // 3. Extract inline math: \(...\) and $...$ (avoiding escaped \$ and $100 currency)
  text = text.replace(/\\\((.+?)\\\)/g, (_, expr) => {
    const idx = mathPlaceholders.length;
    mathPlaceholders.push(renderKatex(expr, false));
    return `@@MATHINLINE_${idx}@@`;
  });

  text = text.replace(
    /(?<!\\)\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$/g,
    (_, expr) => {
      const idx = mathPlaceholders.length;
      mathPlaceholders.push(renderKatex(expr, false));
      return `@@MATHINLINE_${idx}@@`;
    }
  );

  // 4. Restore code snippets before passing to marked
  text = text.replace(/@@CODE(?:BLOCK|INLINE)_(\d+)@@/g, (_, idx) => {
    return codePlaceholders[Number(idx)] ?? "";
  });

  // 5. Parse GFM Markdown
  let html = marked.parse(text);

  // 6. Restore rendered KaTeX blocks & inline math
  html = html.replace(/<p>\s*@@MATHBLOCK_(\d+)@@\s*<\/p>/g, (_, idx) => {
    return mathPlaceholders[Number(idx)] ?? "";
  });
  html = html.replace(/@@MATH(?:BLOCK|INLINE)_(\d+)@@/g, (_, idx) => {
    return mathPlaceholders[Number(idx)] ?? "";
  });

  // 7. Make links open in new tab & tag task-list checkboxes with index
  let taskIdx = 0;
  html = html.replace(/<a\s+href=/g, '<a target="_blank" rel="noopener noreferrer" href=');
  html = html.replace(
    /<input\s+([^>]*type="checkbox"[^>]*)>/gi,
    (_, attrs) => {
      const cleanAttrs = attrs.replace(/\s*disabled(?:="[^"]*")?/gi, "");
      const out = `<input ${cleanAttrs} data-task-index="${taskIdx}">`;
      taskIdx += 1;
      return out;
    }
  );

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    ADD_ATTR: ["target", "rel", "data-task-index"],
  });
}

export function toggleTaskAtIndex(markdown, targetIndex) {
  const lines = (markdown || "").split("\n");
  let inFence = false;
  let count = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = lines[i].match(/^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s*.*)$/);
    if (match) {
      if (count === targetIndex) {
        const nextMark = match[2] === " " ? "x" : " ";
        lines[i] = `${match[1]}${nextMark}${match[3]}`;
        return lines.join("\n");
      }
      count += 1;
    }
  }
  return markdown;
}
