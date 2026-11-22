const ALLOWED_WEBDAV_METHODS = new Set([
  "GET",
  "HEAD",
  "PUT",
  "DELETE",
  "MKCOL",
  "PROPFIND",
  "OPTIONS",
]);

const FORWARDED_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "depth",
  "if-match",
  "if-none-match",
  "overwrite",
];

const MAX_SHARE_BYTES = 10 * 1024 * 1024; // 10 MiB
const ALLOWED_SHARE_TTLS = new Set([0, 604800, 2592000, 7776000]);

function checkSameOrigin(request) {
  const reqUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== reqUrl.origin) {
    return new Response("Forbidden origin", { status: 403 });
  }
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return new Response("Forbidden cross-site request", { status: 403 });
  }
  return null;
}

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::1" ||
    host === "0.0.0.0"
  ) {
    return true;
  }

  // Block IPv4 private / loopback / link-local / CGNAT ranges
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) {
      return true;
    }
  }

  // Block IPv6 private / link-local / loopback literals
  if (host.includes(":")) {
    if (
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe80") ||
      host.startsWith("::ffff:")
    ) {
      return true;
    }
  }

  return false;
}

async function handleWebDAVProxy(request) {
  const originError = checkSameOrigin(request);
  if (originError) return originError;

  const method = (
    request.headers.get("X-WebDAV-Method") || request.method
  ).toUpperCase();
  if (!ALLOWED_WEBDAV_METHODS.has(method)) {
    return new Response("Method not allowed", { status: 405 });
  }

  const targetRaw = request.headers.get("X-WebDAV-URL");
  if (!targetRaw) {
    return new Response("Missing X-WebDAV-URL header", { status: 400 });
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetRaw);
  } catch {
    return new Response("Invalid X-WebDAV-URL", { status: 400 });
  }

  if (targetUrl.protocol !== "https:") {
    return new Response("Only HTTPS WebDAV endpoints are allowed", {
      status: 400,
    });
  }

  if (isBlockedHost(targetUrl.hostname)) {
    return new Response("Target host is not allowed", { status: 403 });
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("User-Agent", "Excalidraw-Multi-WebDAV/1.0");

  const hasBody =
    method !== "GET" &&
    method !== "HEAD" &&
    method !== "OPTIONS" &&
    method !== "DELETE";

  let upstream;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "follow",
    });
  } catch (err) {
    return new Response(`Upstream WebDAV error: ${err?.message || err}`, {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const responseHeaders = new Headers();
  for (const name of [
    "content-type",
    "etag",
    "last-modified",
    "dav",
    "allow",
  ]) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "no-store");

  const emptyStatus =
    upstream.status === 204 ||
    upstream.status === 304 ||
    method === "HEAD";

  return new Response(emptyStatus ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

function generateShareId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

async function handleCreateShare(request, env) {
  const originError = checkSameOrigin(request);
  if (originError) return originError;

  if (!env.SHARES) {
    return Response.json(
      { error: "Share storage (SHARES KV) is not configured." },
      { status: 503 }
    );
  }

  const contentLen = Number(request.headers.get("content-length") || 0);
  if (contentLen > MAX_SHARE_BYTES) {
    return Response.json(
      { error: "Board is too large to share (max 10 MB)." },
      { status: 413 }
    );
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_SHARE_BYTES) {
    return Response.json(
      { error: "Board is too large to share (max 10 MB)." },
      { status: 413 }
    );
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    !payload ||
    payload.v !== 1 ||
    typeof payload.iv !== "string" ||
    typeof payload.data !== "string" ||
    !payload.iv ||
    !payload.data
  ) {
    return Response.json({ error: "Invalid encrypted payload." }, { status: 400 });
  }

  const ttl = ALLOWED_SHARE_TTLS.has(Number(payload.ttl))
    ? Number(payload.ttl)
    : 7776000;

  const id = generateShareId();
  const record = JSON.stringify({
    v: 1,
    iv: payload.iv,
    data: payload.data,
    createdAt: Date.now(),
  });

  await env.SHARES.put(
    `share:${id}`,
    record,
    ttl > 0 ? { expirationTtl: ttl } : undefined
  );

  return Response.json(
    { id },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}

async function handleGetShare(id, env) {
  if (!env.SHARES) {
    return Response.json(
      { error: "Share storage (SHARES KV) is not configured." },
      { status: 503 }
    );
  }

  if (!/^[a-z0-9_-]{6,32}$/i.test(id)) {
    return Response.json({ error: "Invalid share ID." }, { status: 400 });
  }

  const raw = await env.SHARES.get(`share:${id}`);
  if (!raw) {
    return Response.json(
      { error: "Shared board not found or expired." },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  return new Response(raw, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/webdav") {
      return handleWebDAVProxy(request);
    }
    if (url.pathname === "/api/share" && request.method === "POST") {
      return handleCreateShare(request, env);
    }
    if (
      url.pathname.startsWith("/api/share/") &&
      request.method === "GET"
    ) {
      const id = url.pathname.slice("/api/share/".length);
      return handleGetShare(id, env);
    }
    return env.ASSETS.fetch(request);
  },
};
