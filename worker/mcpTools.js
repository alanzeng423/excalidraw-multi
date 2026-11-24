export const MCP_INSTRUCTIONS = `You are connected directly to a live Excalidraw whiteboard in the user's browser.

Best practices for clean, accurate diagrams:
1. Always call get_board_overview first (use scope="selected" when the user says "selected items" or "these").
2. Native text elements support rich Markdown rendered live on canvas & exports:
   - Headings: # H1, ## H2, ### H3
   - Inline styles: **bold**, *italic*, ~~strike~~, \`code\`, ==yellow highlight==, {bg:blue}colored highlight{/bg}, {c:red}colored text{/c}
   - Lists & checklists: - item, - [ ] todo, - [x] done, > quote
   - Sharp hand-drawn GFM tables: | Col1 | Col2 |\\n| --- | --- |\\n| A | B | (set tableOuterBorder: false to hide outer border)
   - Syntax-highlighted code blocks (16 languages): \`\`\`ts\\nconst x = 1;\\n\`\`\`
3. Use declarative arrows ({ type: "arrow", from: "refA", to: "refB", label: "..." }) instead of guessing pixel endpoints — you can reference newly created nodes by their "ref" in the same create_elements call!
4. After creating or modifying multi-node diagrams, call layout_elements (strategy: "flowchart" with direction "TB" or "LR", or "grid" / "tidy") so coordinates and arrows never overlap.
5. Call get_canvas_screenshot after major edits to visually inspect your diagram and fix any overlap or spacing issues.`;

export const MCP_TOOLS = [
  {
    name: "get_board_overview",
    description:
      "Read a compact semantic summary of the live Excalidraw board: board title, theme, viewport bounds, selected element IDs, nodes with labels/positions/colors, and arrow connections.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["all", "selected", "viewport"],
          description: "Which elements to include (default: all). Use 'selected' when the user refers to currently selected elements.",
        },
      },
    },
  },
  {
    name: "get_elements_detail",
    description:
      "Read full untruncated details (full Markdown text, tables, code blocks, fonts, styles, bindings) for specific element IDs or agent refs.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Element IDs or custom agent refs to inspect.",
        },
      },
      required: ["ids"],
    },
  },
  {
    name: "get_canvas_screenshot",
    description:
      "Render and return a PNG screenshot of the live board (or selected/viewport area) so you can visually inspect layout, alignment, overlap, and readability.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["all", "selected", "viewport"],
          description: "Area to capture (default: all).",
        },
        maxWidth: {
          type: "number",
          description: "Maximum PNG width in pixels (default: 1280).",
        },
      },
    },
  },
  {
    name: "create_elements",
    description:
      "Declaratively create shapes (rectangle, diamond, ellipse with auto-bound labels), rich Markdown native text/tables/code blocks, declarative arrows (from -> to by id or ref), and frames wrapping children. Recorded as a single Ctrl+Z undo step.",
    inputSchema: {
      type: "object",
      properties: {
        elements: {
          type: "array",
          description: "List of element specs to create in one atomic batch.",
          items: {
            type: "object",
            properties: {
              ref: { type: "string", description: "Optional stable semantic alias (e.g. 'api-gateway') usable by arrows/frames in this batch and future updates." },
              type: {
                type: "string",
                enum: ["rectangle", "diamond", "ellipse", "text", "arrow", "line", "frame"],
              },
              x: { type: "number" },
              y: { type: "number" },
              w: { type: "number" },
              h: { type: "number" },
              label: { type: "string", description: "Text label bound inside a shape or on an arrow." },
              text: { type: "string", description: "Rich Markdown content for standalone text (supports headings, colors, highlights, tables, fenced code blocks)." },
              from: { type: "string", description: "Source element id or ref for arrow/line." },
              to: { type: "string", description: "Target element id or ref for arrow/line." },
              bg: { type: "string", description: "Background fill color name (blue, green, yellow, orange, red, purple, gray, transparent) or hex." },
              stroke: { type: "string", description: "Stroke/text color name (black, blue, green, red, purple, orange, gray) or hex." },
              strokeStyle: { type: "string", enum: ["solid", "dashed", "dotted"] },
              strokeWidth: { type: "number" },
              roundness: { description: "'sharp' / null or 'rounded' / true." },
              fontSize: { type: "number" },
              fontFamily: { description: "Font name ('hand', 'normal', 'code', 'sans') or Excalidraw fontFamily number." },
              cjkFont: { type: "string", description: "Optional Chinese font id (e.g. 'lxgw-wenkai', 'dengxian', 'kaiti', 'yozai')." },
              tableOuterBorder: { type: "boolean", description: "Set false to hide outer border on a native Markdown table." },
              name: { type: "string", description: "Frame title when type='frame'." },
              children: {
                type: "array",
                items: { type: "string" },
                description: "Child ids or refs for type='frame' (auto-sizes frame around children).",
              },
            },
            required: ["type"],
          },
        },
        focus: {
          type: "boolean",
          description: "Smoothly scroll viewport to created elements (default: true).",
        },
      },
      required: ["elements"],
    },
  },
  {
    name: "update_elements",
    description:
      "Incrementally patch existing elements by id or ref (update text/label, colors, position, size, fonts, tableOuterBorder). Connected arrows and bound labels automatically re-align. Single Ctrl+Z undo step.",
    inputSchema: {
      type: "object",
      properties: {
        patches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              ref: { type: "string" },
              x: { type: "number" },
              y: { type: "number" },
              w: { type: "number" },
              h: { type: "number" },
              label: { type: "string" },
              text: { type: "string" },
              bg: { type: "string" },
              stroke: { type: "string" },
              strokeStyle: { type: "string", enum: ["solid", "dashed", "dotted"] },
              strokeWidth: { type: "number" },
              roundness: {},
              fontSize: { type: "number" },
              fontFamily: {},
              cjkFont: { type: "string" },
              tableOuterBorder: { type: "boolean" },
              opacity: { type: "number" },
              name: { type: "string" },
            },
          },
        },
      },
      required: ["patches"],
    },
  },
  {
    name: "delete_elements",
    description:
      "Delete elements by id or ref (also cleans up bound text labels and dangling arrow bindings). Single Ctrl+Z undo step.",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["ids"],
    },
  },
  {
    name: "layout_elements",
    description:
      "Deterministically arrange elements and re-anchor all connecting arrows cleanly without overlap. Supports flowchart (topological TB/LR), grid, align, distribute, and tidy (push-apart).",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Target element ids/refs. Defaults to selected elements or all non-arrow elements.",
        },
        strategy: {
          type: "string",
          enum: ["flowchart", "grid", "align", "distribute", "tidy"],
        },
        direction: {
          type: "string",
          enum: ["TB", "LR", "horizontal", "vertical"],
        },
        gapX: { type: "number" },
        gapY: { type: "number" },
        columns: { type: "number" },
        align: {
          type: "string",
          enum: ["left", "center", "right", "top", "middle", "bottom"],
        },
      },
    },
  },
  {
    name: "focus_viewport",
    description: "Scroll and zoom the user's browser viewport smoothly onto specific element ids/refs (or the entire board).",
    inputSchema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
        },
        animate: { type: "boolean" },
      },
    },
  },
];
