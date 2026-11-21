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
  const reqUrl = new URL(request.url);

  // Enforce same-origin browser requests to prevent open-proxy abuse
  const origin = request.headers.get("Origin");
  if (origin && origin !== reqUrl.origin) {
    return new Response("Forbidden origin", { status: 403 });
  }
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return new Response("Forbidden cross-site request", { status: 403 });
  }

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/webdav") {
      return handleWebDAVProxy(request);
    }
    return env.ASSETS.fetch(request);
  },
};
