import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LATIN_RANGE =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT_RANGE =
  "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF";

const CUSTOM_ENGLISH_FONTS = [
  {
    id: 10,
    family: "Shantell Sans",
    metrics: { unitsPerEm: 1000, ascender: 950, descender: -300, lineHeight: 1.25 },
    iconVar: "Nr",
    faces: [
      {
        uri: "./fonts/Custom/ShantellSans-latin-ext.woff2",
        descriptors: { unicodeRange: LATIN_EXT_RANGE },
      },
      {
        uri: "./fonts/Custom/ShantellSans-latin.woff2",
        descriptors: { unicodeRange: LATIN_RANGE },
      },
    ],
  },
  {
    id: 11,
    family: "Google Sans",
    metrics: { unitsPerEm: 1000, ascender: 960, descender: -250, lineHeight: 1.25 },
    iconVar: "la",
    faces: [
      {
        uri: "./fonts/Custom/GoogleSans-latin-ext.woff2",
        descriptors: { unicodeRange: LATIN_EXT_RANGE },
      },
      {
        uri: "./fonts/Custom/GoogleSans-latin.woff2",
        descriptors: { unicodeRange: LATIN_RANGE },
      },
    ],
  },
  {
    id: 12,
    family: "Open Sans",
    metrics: { unitsPerEm: 2048, ascender: 2189, descender: -600, lineHeight: 1.35 },
    iconVar: "la",
    faces: [
      {
        uri: "./fonts/Custom/OpenSans-latin-ext.woff2",
        descriptors: { unicodeRange: LATIN_EXT_RANGE },
      },
      {
        uri: "./fonts/Custom/OpenSans-latin.woff2",
        descriptors: { unicodeRange: LATIN_RANGE },
      },
    ],
  },
  {
    id: 13,
    family: "Playwrite AR Guides",
    metrics: { unitsPerEm: 1000, ascender: 1100, descender: -400, lineHeight: 1.5 },
    iconVar: "Nr",
    faces: [{ uri: "./fonts/Custom/PlaywriteARGuides.woff2" }],
  },
  {
    id: 14,
    family: "Bentham",
    metrics: { unitsPerEm: 1000, ascender: 890, descender: -260, lineHeight: 1.2 },
    iconVar: "Cd",
    faces: [
      {
        uri: "./fonts/Custom/Bentham-latin-ext.woff2",
        descriptors: { unicodeRange: LATIN_EXT_RANGE },
      },
      {
        uri: "./fonts/Custom/Bentham-latin.woff2",
        descriptors: { unicodeRange: LATIN_RANGE },
      },
    ],
  },
];

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

function excalidrawCustomFontsPlugin() {
  const { pkgDir, entries } = parseLxgwWenkaiSubsets();
  const lxgwList = JSON.stringify(
    entries.map(({ uri, descriptors }) => ({ uri, descriptors }))
  );

  const fontFamilyAdditions = CUSTOM_ENGLISH_FONTS.map(
    (f) => `,${JSON.stringify(f.family)}:${f.id}`
  ).join("");

  const fallbackCases = CUSTOM_ENGLISH_FONTS.map((f) => `case ${f.id}:`).join("");

  const metadataAdditions = CUSTOM_ENGLISH_FONTS.map(
    (f) => `,[${f.id}]:{metrics:${JSON.stringify(f.metrics)},icon:${f.iconVar}}`
  ).join("");

  const initRegistrations = CUSTOM_ENGLISH_FONTS.map(
    (f) => `,n(${JSON.stringify(f.family)},...${JSON.stringify(f.faces)})`
  ).join("");

  const patchCode = (code) => {
    const initPattern = /n\("Virgil",\.\.\.(\w+)\),n\(Mn,\.\.\.(\w+)\)/;
    if (!initPattern.test(code)) return null;

    let out = code;

    // 1. Add custom English fonts to FONT_FAMILY map
    const ffPattern =
      /Ie=\{Virgil:1,Helvetica:2,Cascadia:3,Excalifont:5,Nunito:6,"Lilita One":7,"Comic Shanns":8,"Liberation Sans":9\}/;
    if (!ffPattern.test(out)) {
      throw new Error("Could not find Excalidraw FONT_FAMILY map to patch");
    }
    out = out.replace(
      ffPattern,
      `Ie={Virgil:1,Helvetica:2,Cascadia:3,Excalifont:5,Nunito:6,"Lilita One":7,"Comic Shanns":8,"Liberation Sans":9${fontFamilyAdditions}}`
    );

    // 2. Include LXGW WenKai fallback for Excalifont + all custom English fonts
    const fbPattern =
      /bo=e=>\{switch\(e\)\{case Ie\.Excalifont:return\[Mn,Tn\];default:return\[Tn\]\}\}/;
    if (!fbPattern.test(out)) {
      throw new Error("Could not find Excalidraw font fallback helper to patch");
    }
    out = out.replace(
      fbPattern,
      `bo=e=>{switch(e){case Ie.Excalifont:${fallbackCases}return[Mn,Tn];default:return[Tn]}}`
    );

    // 3. Add FONT_METADATA entries (metrics + icon) for custom English fonts
    const metaPattern =
      /\[Ie\["Comic Shanns"\]\]:\{metrics:\{unitsPerEm:1e3,ascender:750,descender:-250,lineHeight:1\.25\},icon:Ua\}/;
    if (!metaPattern.test(out)) {
      throw new Error("Could not find Excalidraw FONT_METADATA map to patch");
    }
    out = out.replace(metaPattern, (m) => `${m}${metadataAdditions}`);

    // 4. Replace Xiaolai with LXGW WenKai Screen and register the 5 custom English fonts
    out = out.replace(
      initPattern,
      `n("Virgil",...$1),n(Mn,...${lxgwList})${initRegistrations}`
    );

    return out;
  };

  const syncFonts = () => {
    const srcFonts = path.resolve(
      __dirname,
      "node_modules/@excalidraw/excalidraw/dist/prod/fonts"
    );
    const customFontsDir = path.resolve(__dirname, "src/fonts");
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

    // Copy self-hosted custom English Google Fonts
    const destCustom = path.join(destFonts, "Custom");
    fs.mkdirSync(destCustom, { recursive: true });
    if (fs.existsSync(customFontsDir)) {
      for (const file of fs.readdirSync(customFontsDir)) {
        if (!file.endsWith(".woff2")) continue;
        fs.copyFileSync(
          path.join(customFontsDir, file),
          path.join(destCustom, file)
        );
      }
    }
  };

  return {
    name: "excalidraw-custom-fonts",
    config() {
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: "esbuild-excalidraw-custom-fonts",
                setup(build) {
                  build.onLoad(
                    {
                      filter:
                        /@excalidraw[/\\]excalidraw[/\\]dist[/\\]prod[/\\].*\.js$/,
                    },
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
  plugins: [excalidrawCustomFontsPlugin(), react(), cloudflare()],
});
