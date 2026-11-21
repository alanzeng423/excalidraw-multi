import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseLxgwWenkaiSubsets() {
  const pkgDir = path.resolve(
    __dirname,
    "node_modules/lxgw-wenkai-screen-webfont"
  );
  const cssPath = path.join(pkgDir, "lxgwwenkaigbscreen.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const entries = [];
  const blockRe = /@font-face\s*\{([^}]+)\}/g;
  let match;
  while ((match = blockRe.exec(css)) !== null) {
    const body = match[1];
    const urlMatch = body.match(/url\(['"]?\.\/files\/([^'")]+)['"]?\)/);
    const rangeMatch = body.match(/unicode-range:\s*([^;}\n]+)/i);
    if (urlMatch && rangeMatch) {
      const filename = urlMatch[1].trim();
      entries.push({
        filename,
        uri: `./fonts/LXGWWenKai/${filename}`,
        descriptors: { unicodeRange: rangeMatch[1].trim() },
      });
    }
  }
  if (entries.length === 0) {
    throw new Error("Failed to parse LXGW WenKai Screen font subsets");
  }
  return { pkgDir, entries };
}

function excalidrawLxgwWenkaiPlugin() {
  const { pkgDir, entries } = parseLxgwWenkaiSubsets();
  const replacementList = JSON.stringify(
    entries.map(({ uri, descriptors }) => ({ uri, descriptors }))
  );

  const patchCode = (code) => {
    const pattern = /n\("Virgil",\.\.\.(\w+)\),n\(Mn,\.\.\.(\w+)\)/;
    if (!pattern.test(code)) return null;
    return code.replace(pattern, `n("Virgil",...$1),n(Mn,...${replacementList})`);
  };

  const syncFonts = () => {
    const srcFonts = path.resolve(
      __dirname,
      "node_modules/@excalidraw/excalidraw/dist/prod/fonts"
    );
    const destFonts = path.resolve(__dirname, "public/fonts");

    fs.mkdirSync(destFonts, { recursive: true });

    // Remove unused Xiaolai folder if present
    fs.rmSync(path.join(destFonts, "Xiaolai"), { recursive: true, force: true });

    // Copy Excalidraw's own fonts except Xiaolai
    if (fs.existsSync(srcFonts)) {
      for (const item of fs.readdirSync(srcFonts)) {
        if (item === "Xiaolai") continue;
        fs.cpSync(path.join(srcFonts, item), path.join(destFonts, item), {
          recursive: true,
          force: true,
        });
      }
    }

    // Copy LXGW WenKai Screen subsets
    const destLxgw = path.join(destFonts, "LXGWWenKai");
    fs.mkdirSync(destLxgw, { recursive: true });
    for (const { filename } of entries) {
      fs.copyFileSync(
        path.join(pkgDir, "files", filename),
        path.join(destLxgw, filename)
      );
    }
  };

  return {
    name: "excalidraw-lxgw-wenkai",
    config() {
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: "esbuild-excalidraw-lxgw-wenkai",
                setup(build) {
                  build.onLoad(
                    { filter: /@excalidraw[/\\]excalidraw[/\\]dist[/\\]prod[/\\].*\.js$/ },
                    async (args) => {
                      const raw = await fs.promises.readFile(args.path, "utf8");
                      const patched = patchCode(raw);
                      if (!patched) return null;
                      return { contents: patched, loader: "js" };
                    }
                  );
                },
              },
            ],
          },
        },
      };
    },
    configResolved() {
      syncFonts();
    },
    transform(code, id) {
      if (!id.includes("@excalidraw/excalidraw/dist/prod/")) return null;
      const patched = patchCode(code);
      if (!patched) return null;
      return { code: patched, map: null };
    },
  };
}

export default defineConfig({
  plugins: [excalidrawLxgwWenkaiPlugin(), react(), cloudflare()],
});
