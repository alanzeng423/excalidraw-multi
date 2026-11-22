# excalidraw-multi

Multi-board [Excalidraw](https://excalidraw.com/) hosted on Cloudflare Workers (Static Assets), with:

- **Multiple boards in IndexedDB** — each board is stored independently in the browser with cross-tab sync (`BroadcastChannel`) and single-writer tab locking (`navigator.locks`).
- **Excalidraw-style minimalist UI** — dot-grid canvas, floating island toolbar, transparent SVG board previews, and light/dark mode.
- **Custom Canvas Fonts** — replaces Excalidraw's default `Xiaolai` CJK fallback with **LXGW WenKai Screen (霞鹜文楷)** (97 unicode-range `.woff2` subsets), and adds 5 self-hosted English fonts (**Shantell Sans**, **Google Sans**, **Open Sans**, **Playwrite AR Guides**, **Bentham**) directly to Excalidraw's font picker with LXGW WenKai CJK fallback.
- **Canvas Markdown Cards (GFM + KaTeX)** — insert draggable, resizable, arrow-connectable Markdown cards (`+ MD` / `Alt+M`) with Preview / Edit / Split modes, interactive task checkboxes, tables, code blocks, and LaTeX math, synced via IndexedDB and WebDAV.
- **WebDAV Sync (Jianguoyun-ready)** — built-in Cloudflare Worker CORS proxy (`/api/webdav`) with SSRF protection, storing standard `.excalidraw` files and an `index.json` manifest (with deletion tombstones) for two-way sync across devices.

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
