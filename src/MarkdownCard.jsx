import { useEffect, useMemo, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import { renderMarkdownHtml, toggleTaskAtIndex } from "./markdown";

export default function MarkdownCard({
  element,
  theme,
  isActive,
  readOnly,
  onUpdate,
}) {
  const markdown = element.customData?.markdown ?? "";
  const [mode, setMode] = useState("preview"); // preview | edit | split
  const [draft, setDraft] = useState(markdown);
  const textareaRef = useRef(null);

  // Sync draft when element updates externally (undo/redo/remote sync)
  useEffect(() => {
    setDraft(markdown);
  }, [markdown]);

  // Auto-exit edit mode when card loses focus or enters read-only
  useEffect(() => {
    if ((!isActive || readOnly) && mode !== "preview") {
      setMode("preview");
    }
  }, [isActive, readOnly, mode]);

  // Auto-focus textarea when switching to edit/split
  useEffect(() => {
    if (mode !== "preview" && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  const html = useMemo(() => renderMarkdownHtml(draft), [draft]);

  const commit = (next) => {
    setDraft(next);
    if (!readOnly && next !== markdown) {
      onUpdate(element.id, next);
    }
  };

  const stop = (e) => {
    e.stopPropagation();
  };

  const handleKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      setMode("preview");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      setMode("preview");
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${draft.slice(0, start)}  ${draft.slice(end)}`;
      commit(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  };

  const handlePreviewClick = (e) => {
    const target = e.target;
    if (
      target instanceof HTMLInputElement &&
      target.type === "checkbox" &&
      target.dataset.taskIndex !== undefined
    ) {
      e.stopPropagation();
      if (readOnly) {
        e.preventDefault();
        return;
      }
      const idx = Number(target.dataset.taskIndex);
      if (Number.isFinite(idx)) {
        const next = toggleTaskAtIndex(draft, idx);
        commit(next);
      }
    }
  };

  const isDark = theme === "dark";
  const customBg =
    element.backgroundColor && element.backgroundColor !== "transparent"
      ? element.backgroundColor
      : undefined;

  return (
    <div
      className={`md-card ${isDark ? "is-dark" : ""} ${
        isActive ? "is-active" : ""
      } mode-${mode}`}
      style={customBg ? { backgroundColor: customBg } : undefined}
      onWheel={isActive ? stop : undefined}
      onCopy={isActive ? stop : undefined}
      onCut={isActive ? stop : undefined}
      onPaste={isActive ? stop : undefined}
      onKeyDown={isActive ? stop : undefined}
      onKeyUp={isActive ? stop : undefined}
      onDoubleClick={(e) => {
        if (!readOnly && mode === "preview") {
          e.stopPropagation();
          setMode("edit");
        }
      }}
    >
      {isActive && !readOnly && (
        <div
          className="md-card-toolbar"
          onPointerDown={stop}
          onMouseDown={stop}
        >
          <span className="md-card-tag">MD</span>
          <div className="md-card-modes">
            <button
              type="button"
              className={mode === "preview" ? "active" : ""}
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
            <button
              type="button"
              className={mode === "edit" ? "active" : ""}
              onClick={() => setMode("edit")}
            >
              Edit
            </button>
            <button
              type="button"
              className={mode === "split" ? "active" : ""}
              onClick={() => setMode("split")}
            >
              Split
            </button>
          </div>
        </div>
      )}

      <div className="md-card-content">
        {(mode === "edit" || mode === "split") && !readOnly && (
          <textarea
            ref={textareaRef}
            className="md-editor"
            value={draft}
            placeholder="Write Markdown, GFM tables, tasks, or $LaTeX$ math..."
            spellCheck={false}
            onPointerDown={stop}
            onMouseDown={stop}
            onKeyDown={handleKeyDown}
            onChange={(e) => commit(e.target.value)}
          />
        )}

        {(mode === "preview" || mode === "split") && (
          <div
            className="md-preview"
            onClick={handlePreviewClick}
            onPointerDown={isActive ? stop : undefined}
            dangerouslySetInnerHTML={{
              __html:
                html ||
                '<p class="md-placeholder">Double-click to write Markdown…</p>',
            }}
          />
        )}
      </div>
    </div>
  );
}
