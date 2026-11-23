const STORAGE_KEY = "excalidraw-multi:cjk-font";

export const ENGLISH_FONT_FAMILIES = {
  1: "Virgil",
  2: "Helvetica",
  3: "Cascadia",
  5: "Excalifont",
  6: "Nunito",
  7: "Lilita One",
  8: "Comic Shanns",
  9: "Liberation Sans",
  10: "Shantell Sans",
  11: "Google Sans",
  12: "Open Sans",
  13: "Playwrite AR Guides",
  14: "Bentham",
};

export const CJK_FONTS = [
  // Standard / Common Chinese Fonts
  {
    id: "lxgw-wenkai",
    group: "standard",
    zh: "霞鹜文楷",
    shortZh: "文楷",
    en: "LXGW WenKai",
    shortEn: "WenKai",
    tagZh: "默认 · 温润",
    tagEn: "Default",
    primary: "Xiaolai",
    stack: '"Xiaolai"',
    cssUrl: null, // self-hosted via Excalidraw Xiaolai override
  },
  {
    id: "dengxian",
    group: "standard",
    zh: "等线",
    shortZh: "等线",
    en: "DengXian",
    shortEn: "DengXian",
    tagZh: "现代黑体",
    tagEn: "Clean Sans",
    primary: "Noto Sans SC",
    stack: '"DengXian", "等线", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    cssUrl:
      "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap",
  },
  {
    id: "kaiti",
    group: "standard",
    zh: "楷体",
    shortZh: "楷体",
    en: "KaiTi",
    shortEn: "KaiTi",
    tagZh: "标准楷书",
    tagEn: "Classic Kai",
    primary: "KaiTi",
    stack: '"KaiTi", "楷体", "STKaiti", "Kaiti SC", "BiauKai", "Xiaolai", serif',
    cssUrl: null,
  },
  {
    id: "songti",
    group: "standard",
    zh: "宋体",
    shortZh: "宋体",
    en: "Songti",
    shortEn: "Songti",
    tagZh: "经典衬线",
    tagEn: "Serif",
    primary: "Noto Serif SC",
    stack: '"SimSun", "宋体", "Songti SC", "STSong", "Noto Serif SC", serif',
    cssUrl:
      "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&display=swap",
  },
  {
    id: "chill-round",
    group: "standard",
    zh: "寒蝉全圆体",
    shortZh: "圆体",
    en: "Chill Round",
    shortEn: "Round",
    tagZh: "清新圆润",
    tagEn: "Rounded",
    primary: "寒蝉全圆体",
    stack: '"寒蝉全圆体", "PingFang SC", "Xiaolai", sans-serif',
    cssUrl:
      "https://cdn.jsdelivr.net/npm/@chinese-fonts/hcqyt@2.0.0/dist/ChillRoundFRegular/result.css",
  },

  // Chinese Handwriting Fonts
  {
    id: "yozai",
    group: "handwriting",
    zh: "悠哉手写体",
    shortZh: "悠哉",
    en: "LXGW Yozai",
    shortEn: "Yozai",
    tagZh: "自然手写",
    tagEn: "Handwriting",
    primary: "Yozai",
    stack: '"Yozai", "Xiaolai", cursive',
    cssUrl:
      "https://cdn.jsdelivr.net/npm/@chinese-fonts/yozai@3.0.0/dist/Yozai-Regular/result.css",
  },
  {
    id: "jxzk",
    group: "handwriting",
    zh: "江西拙楷",
    shortZh: "拙楷",
    en: "Jiangxi Zhuokai",
    shortEn: "Zhuokai",
    tagZh: "质朴手写楷",
    tagEn: "Brush Kai",
    primary: "jiangxizhuokai",
    stack: '"jiangxizhuokai", "Xiaolai", cursive',
    cssUrl:
      "https://cdn.jsdelivr.net/npm/@chinese-fonts/jxzk@3.0.0/dist/%E6%B1%9F%E8%A5%BF%E6%8B%99%E6%A5%B7/result.css",
  },
  {
    id: "long-cang",
    group: "handwriting",
    zh: "龙藏手写体",
    shortZh: "龙藏",
    en: "Long Cang",
    shortEn: "Long Cang",
    tagZh: "灵动笔迹",
    tagEn: "Script",
    primary: "Long Cang",
    stack: '"Long Cang", "Xiaolai", cursive',
    cssUrl:
      "https://fonts.googleapis.com/css2?family=Long+Cang&display=swap",
  },
  {
    id: "zhi-mang-xing",
    group: "handwriting",
    zh: "志莽行书",
    shortZh: "行书",
    en: "Zhi Mang Xing",
    shortEn: "Running",
    tagZh: "潇洒行书",
    tagEn: "Cursive",
    primary: "Zhi Mang Xing",
    stack: '"Zhi Mang Xing", "Xiaolai", cursive',
    cssUrl:
      "https://fonts.googleapis.com/css2?family=Zhi+Mang+Xing&display=swap",
  },
  {
    id: "ma-shan-zheng",
    group: "handwriting",
    zh: "马善政楷书",
    shortZh: "毛笔",
    en: "Ma Shan Zheng",
    shortEn: "Brush",
    tagZh: "豪放毛笔",
    tagEn: "Calligraphy",
    primary: "Ma Shan Zheng",
    stack: '"Ma Shan Zheng", "Xiaolai", cursive',
    cssUrl:
      "https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap",
  },
  {
    id: "zcool-kuaile",
    group: "handwriting",
    zh: "站酷快乐体",
    shortZh: "快乐",
    en: "ZCOOL KuaiLe",
    shortEn: "KuaiLe",
    tagZh: "可爱圆手写",
    tagEn: "Playful",
    primary: "ZCOOL KuaiLe",
    stack: '"ZCOOL KuaiLe", "Xiaolai", cursive',
    cssUrl:
      "https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap",
  },
];

export const QUICK_CJK_FONT_IDS = ["lxgw-wenkai", "dengxian", "kaiti", "yozai"];

const FONT_BY_ID = new Map(CJK_FONTS.map((f) => [f.id, f]));
const injectedUrls = new Map(); // cssUrl -> Promise<void>
const legacyTextIds = new Set();
const loadedListeners = new Set();

function readInitialDefaultId() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && FONT_BY_ID.has(saved)) return saved;
  } catch {}
  return "lxgw-wenkai";
}

let defaultCjkId = readInitialDefaultId();
let cjkEpoch = 0;

function bumpEpoch() {
  cjkEpoch += 1;
  if (globalThis.__EXCALIDRAW_CJK__) {
    globalThis.__EXCALIDRAW_CJK__.epoch = cjkEpoch;
  }
  for (const fn of loadedListeners) {
    try {
      fn(cjkEpoch);
    } catch {}
  }
}

export function onCjkFontLoaded(fn) {
  loadedListeners.add(fn);
  return () => loadedListeners.delete(fn);
}

export function getCjkFontById(id) {
  return FONT_BY_ID.get(id) || FONT_BY_ID.get("lxgw-wenkai");
}

export function getDefaultCjkFontId() {
  return defaultCjkId;
}

export function setDefaultCjkFontId(id) {
  if (!FONT_BY_ID.has(id)) return defaultCjkId;
  defaultCjkId = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
  ensureCjkFontLoaded(id);
  return defaultCjkId;
}

export function markLegacyTextIds(elements) {
  if (!Array.isArray(elements)) return;
  for (const el of elements) {
    if (el && el.type === "text" && el.id && !el.customData?.cjkFont) {
      legacyTextIds.add(el.id);
    }
  }
}

export function unmarkLegacyTextId(id) {
  if (id) legacyTextIds.delete(id);
}

export function resolveCjkFontId(explicitId, elementId) {
  if (explicitId && FONT_BY_ID.has(explicitId)) return explicitId;
  if (elementId && legacyTextIds.has(elementId)) return "lxgw-wenkai";
  return defaultCjkId;
}

export function resolveCjkFamily(explicitId, elementId) {
  const id = resolveCjkFontId(explicitId, elementId);
  const font = getCjkFontById(id);
  if (font.cssUrl && !injectedUrls.has(font.cssUrl)) {
    ensureCjkFontLoaded(id);
  }
  return font.stack;
}

export function getElementFontFamilyStr(element) {
  const eng = ENGLISH_FONT_FAMILIES[element?.fontFamily] || "Excalifont";
  const cjkStack = resolveCjkFamily(element?.customData?.cjkFont, element?.id);
  return `${eng}, ${cjkStack}, Segoe UI Emoji`;
}

export function ensureCjkFontLoaded(id, sampleText = "中文手写字体预览一二三") {
  const font = getCjkFontById(id);
  if (!font?.cssUrl || typeof document === "undefined") {
    return Promise.resolve();
  }

  let cssPromise = injectedUrls.get(font.cssUrl);
  if (!cssPromise) {
    cssPromise = new Promise((resolve) => {
      const existing = document.querySelector(
        `link[data-cjk-font-url="${font.cssUrl}"]`
      );
      if (existing) {
        resolve();
        return;
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = font.cssUrl;
      link.dataset.cjkFontUrl = font.cssUrl;
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
    });
    injectedUrls.set(font.cssUrl, cssPromise);
  }

  return cssPromise.then(async () => {
    try {
      if (document.fonts?.load) {
        await document.fonts.load(`20px "${font.primary}"`, sampleText);
      }
    } catch {}
    bumpEpoch();
  });
}

export function preloadSceneCjkFonts(elements) {
  if (!Array.isArray(elements)) return;
  const byFont = new Map();
  for (const el of elements) {
    if (!el || el.isDeleted || el.type !== "text") continue;
    const id = el.customData?.cjkFont;
    if (!id || !FONT_BY_ID.has(id)) continue;
    const prev = byFont.get(id) || "";
    byFont.set(id, prev + (el.text || el.originalText || ""));
  }
  for (const [id, sample] of byFont.entries()) {
    ensureCjkFontLoaded(id, sample || "中文手写字体预览");
  }
}

export function initCjkFonts() {
  if (globalThis.__EXCALIDRAW_CJK__) return globalThis.__EXCALIDRAW_CJK__;
  const bridge = {
    epoch: cjkEpoch,
    resolveFamily: (explicitId, elementId) =>
      resolveCjkFamily(explicitId, elementId),
  };
  globalThis.__EXCALIDRAW_CJK__ = bridge;

  if (typeof document !== "undefined" && document.fonts?.addEventListener) {
    document.fonts.addEventListener("loadingdone", () => {
      bumpEpoch();
    });
  }

  // Warm up saved default CJK font if it's a remote font
  if (defaultCjkId !== "lxgw-wenkai") {
    ensureCjkFontLoaded(defaultCjkId);
  }

  return bridge;
}
