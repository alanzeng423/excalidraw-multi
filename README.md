# excalidraw-multi

Multi-board [Excalidraw](https://excalidraw.com/) hosted on Cloudflare Workers (Static Assets), with:

- **Multiple boards in IndexedDB** — each board is stored independently in the browser with cross-tab sync (`BroadcastChannel`) and single-writer tab locking (`navigator.locks`).
- **Excalidraw-style minimalist UI** — dot-grid canvas, floating island toolbar, transparent SVG board previews, and light/dark mode.
- **Custom Canvas Fonts** — replaces Excalidraw's default `Xiaolai` CJK fallback with **LXGW WenKai Screen (霞鹜文楷)** (97 unicode-range `.woff2` subsets), and adds 5 self-hosted English fonts (**Shantell Sans**, **Google Sans**, **Open Sans**, **Playwrite AR Guides**, **Bentham**) directly to Excalidraw's font picker with LXGW WenKai CJK fallback.
- **Native Text Box Markdown & Left Style Panel** — toggleable (`MD` switch) Canvas & SVG Markdown rendering directly inside Excalidraw's native text boxes and shape-bound text (`# / ## / ###` headings, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `==highlight==`, `- bullets`, `- [x]` checkboxes, `> quotes`, plus partial inline text color `{c:red}...{/c}` / `{c:#hex}...{/c}` and multi-color highlights `{bg:blue}...{/bg}`), with one-click formatting & color swatches integrated right into Excalidraw's left style panel and keyboard shortcuts (`Ctrl/Cmd+B/I/E`, `Ctrl/Cmd+Shift+X/H`).
- **Canvas Markdown Cards (GFM + KaTeX)** — insert draggable, resizable, arrow-connectable Markdown cards (`+MD` / `Alt+M`) with Preview / Edit / Split modes, interactive task checkboxes, tables, code blocks, and LaTeX math, synced via IndexedDB and WebDAV.
- **Interactive Table Cards** — insert Notion/spreadsheet-style editable tables (`+表格` / `Alt+T`) with click-to-edit cells, `Tab`/`Enter`/arrow navigation, drag-to-resize columns, row/column add & delete, header/striped toggles, per-cell bold/color/fill, smart paste from Excel/Feishu/Markdown tables, one-click Copy as Markdown, plus full PNG/SVG export and homepage SVG thumbnail rendering.
- **Excalidraw Library Persistence & Sync** — persists library items across reloads and tabs in IndexedDB, supports one-click install from [libraries.excalidraw.com](https://libraries.excalidraw.com/), and syncs `library.excalidrawlib` over WebDAV.
- **End-to-End Encrypted Read-Only Share Links** — generates shareable `/share/:id#key=...` links encrypted in-browser with AES-GCM (the decryption key stays in the URL `#fragment` and is never sent to the server), stored in Cloudflare KV with configurable expiration and one-click "Copy to my boards".
- **WebDAV Sync** — built-in Cloudflare Worker CORS proxy (`/api/webdav`) with SSRF protection, storing standard `.excalidraw` boards, `library.excalidrawlib`, and an `index.json` manifest (with deletion tombstones) for two-way sync across devices.
- **Complete Menu & Bilingual UI** — includes Canvas Search, Command Palette (`Ctrl/Cmd+/`), Theme Switcher, and persisted `zh-CN` / `en` language toggle.

## Development & Deployment

```bash
npm install
npm run dev              # local dev server
npm run build            # build client + Worker via cf build
npm run deploy:dry-run   # preview Cloudflare Workers deployment
npm run deploy           # deploy to Cloudflare Workers via cf deploy
```

### Optional Environment Variables

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID (injected automatically in Cloudflare Workers Builds).
- `WORKER_DOMAIN`: Custom domain(s), comma-separated (e.g. `draw.example.com`). When omitted, deploys to `*.workers.dev`.
- `SHARE_KV_ID`: Cloudflare KV namespace ID for storing encrypted read-only share snapshots (`SHARES` binding).
