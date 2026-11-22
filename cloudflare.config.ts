import { bindings, defineConfig } from "cf/config";

const domains = process.env.WORKER_DOMAIN
  ? process.env.WORKER_DOMAIN.split(",")
      .map((d) => d.trim())
      .filter(Boolean)
  : undefined;

const sharesBinding = process.env.SHARE_KV_ID
  ? bindings.kv({ id: process.env.SHARE_KV_ID })
  : undefined;

export default defineConfig({
  worker: {
    name: "excalidraw-multi",
    compatibilityDate: "2026-10-01",
    entrypoint: "./worker/index.js",
    workersDev: !domains,
    previewUrls: false,
    ...(domains ? { domains } : {}),
    env: {
      ASSETS: bindings.assets(),
      ...(sharesBinding ? { SHARES: sharesBinding } : {}),
    },
    assets: {
      htmlHandling: "auto-trailing-slash",
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
  },
});
