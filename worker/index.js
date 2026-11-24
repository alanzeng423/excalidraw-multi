import { DurableObject } from "cloudflare:workers";
import { MCP_INSTRUCTIONS, MCP_TOOLS } from "./mcpTools.js";

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

const ALLOWED_TOOL_NAMES = new Set(MCP_TOOLS.map((t) => t.name));

const MCP_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Cache-Control": "no-store",
};

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function parseAgentToken(request, url) {
  let raw = "";
  const auth = request.headers.get("Authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    raw = auth.slice(7).trim();
  }
  if (!raw) {
    raw = (url.searchParams.get("token") || "").trim();
  }
  if (!raw && url.pathname.startsWith("/mcp/")) {
    const parts = url.pathname.slice("/mcp/".length).split("/").filter(Boolean);
    if (parts.length === 2) {
      raw = `${decodeURIComponent(parts[0])}.${decodeURIComponent(parts[1])}`;
    } else if (parts.length === 1) {
      raw = decodeURIComponent(parts[0]);
    }
  }
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot >= raw.length - 1) return null;
  const boardId = raw.slice(0, dot).trim();
  const secret = raw.slice(dot + 1).trim();
  if (!/^[a-z0-9_-]{3,64}$/i.test(boardId) || secret.length < 12 || secret.length > 128) {
    return null;
  }
  return { boardId, secret };
}

export class BoardBridge extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.browserWs = null;
    this.activeSecret = "";
    this.pending = new Map();
    this.lastActivityAt = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const secret = url.searchParams.get("secret") || "";
    if (secret.length < 12 || secret.length > 128) {
      return new Response("Invalid secret", { status: 400 });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    // Replace any previous stale browser socket for this board
    if (this.browserWs && this.browserWs !== server) {
      try {
        this.browserWs.close(4000, "Replaced by newer tab connection");
      } catch {}
    }

    this.browserWs = server;
    this.activeSecret = secret;
    this.lastActivityAt = Date.now();

    server.addEventListener("message", (evt) => {
      this.lastActivityAt = Date.now();
      let msg;
      try {
        msg = JSON.parse(typeof evt.data === "string" ? evt.data : "");
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "ping") {
        try {
          server.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        } catch {}
        return;
      }

      if (msg.type === "rpc_response" && msg.requestId) {
        const entry = this.pending.get(msg.requestId);
        if (!entry) return;
        this.pending.delete(msg.requestId);
        clearTimeout(entry.timer);
        entry.resolve({
          ok: Boolean(msg.ok),
          result: msg.result,
          error: msg.error || null,
        });
      }
    });

    const cleanup = () => {
      if (this.browserWs === server) {
        this.browserWs = null;
        this.activeSecret = "";
        for (const [reqId, entry] of this.pending.entries()) {
          clearTimeout(entry.timer);
          entry.resolve({
            ok: false,
            status: 503,
            error: "Browser tab disconnected before completing the request.",
          });
          this.pending.delete(reqId);
        }
      }
    };

    server.addEventListener("close", cleanup);
    server.addEventListener("error", cleanup);

    try {
      server.send(JSON.stringify({ type: "ready", ts: Date.now() }));
    } catch {}

    return new Response(null, { status: 101, webSocket: client });
  }

  async getStatus(secret) {
    const connected = Boolean(this.browserWs && this.browserWs.readyState === 1);
    const authorized = connected && constantTimeEqual(secret, this.activeSecret);
    return {
      connected,
      authorized,
      lastActivityAt: this.lastActivityAt,
    };
  }

  async callTool(secret, toolName, args) {
    if (!this.browserWs || this.browserWs.readyState !== 1) {
      return {
        ok: false,
        status: 503,
        error:
          "Board is not currently connected in a browser tab. Open this board and enable Agent Control first.",
      };
    }
    if (!constantTimeEqual(secret, this.activeSecret)) {
      return {
        ok: false,
        status: 401,
        error:
          "Invalid or rotated Agent token. Copy the current token from the board's Agent panel.",
      };
    }

    const requestId = crypto.randomUUID();
    this.lastActivityAt = Date.now();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          ok: false,
          status: 504,
          error: "Timed out waiting for browser board response (30s).",
        });
      }, 30_000);

      this.pending.set(requestId, { resolve, timer });
      try {
        this.browserWs.send(
          JSON.stringify({
            type: "rpc_request",
            requestId,
            tool: toolName,
            args: args || {},
          })
        );
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({
          ok: false,
          status: 503,
          error: `Failed to forward request to browser: ${err?.message || err}`,
        });
      }
    });
  }
}

function mcpJsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...MCP_CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function formatMcpToolResult(rpc) {
  if (!rpc.ok) {
    return {
      isError: true,
      content: [{ type: "text", text: rpc.error || "Tool execution failed." }],
    };
  }
  if (rpc.result && rpc.result.__mcpImage && rpc.result.data) {
    return {
      content: [
        {
          type: "image",
          data: rpc.result.data,
          mimeType: rpc.result.mimeType || "image/png",
        },
        {
          type: "text",
          text: JSON.stringify({
            width: rpc.result.width,
            height: rpc.result.height,
            elementCount: rpc.result.elementCount,
          }),
        },
      ],
    };
  }
  return {
    content: [
      {
        type: "text",
        text:
          typeof rpc.result === "string"
            ? rpc.result
            : JSON.stringify(rpc.result ?? {}),
      },
    ],
  };
}

async function handleMcpRequest(request, env, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
  }

  if (request.method === "DELETE") {
    return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
  }

  if (request.method === "GET") {
    const parsed = parseAgentToken(request, url);
    let statusInfo = { connected: false };
    if (parsed && env.BOARD_BRIDGE) {
      const stub = env.BOARD_BRIDGE.getByName(parsed.boardId);
      statusInfo = await stub.getStatus(parsed.secret);
    }
    return mcpJsonResponse({
      name: "excalidraw-multi-board",
      protocol: "MCP Streamable HTTP (POST JSON-RPC 2.0)",
      boardId: parsed?.boardId || null,
      ...statusInfo,
    });
  }

  if (request.method !== "POST") {
    return mcpJsonResponse({ error: "Method not allowed" }, 405);
  }

  const parsedToken = parseAgentToken(request, url);
  if (!parsedToken) {
    return mcpJsonResponse(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32001,
          message:
            "Missing or invalid board token. Pass ?token=<boardId>.<secret> or Authorization: Bearer <boardId>.<secret>.",
        },
      },
      401
    );
  }

  let msg;
  try {
    msg = await request.json();
  } catch {
    return mcpJsonResponse(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON." } },
      400
    );
  }

  const isBatch = Array.isArray(msg);
  const requests = isBatch ? msg : [msg];
  const responses = [];

  for (const item of requests) {
    if (!item || typeof item !== "object") continue;
    const { id, method, params } = item;

    // Notifications have no id -> no JSON-RPC response body
    if (id === undefined || method === "notifications/initialized" || method?.startsWith("notifications/")) {
      continue;
    }

    if (method === "initialize") {
      const clientProto = params?.protocolVersion || "2025-03-26";
      responses.push({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: clientProto,
          capabilities: { tools: {} },
          serverInfo: {
            name: "excalidraw-multi-board",
            version: "1.0.0",
          },
          instructions: MCP_INSTRUCTIONS,
        },
      });
      continue;
    }

    if (method === "ping") {
      responses.push({ jsonrpc: "2.0", id, result: {} });
      continue;
    }

    if (method === "tools/list") {
      responses.push({
        jsonrpc: "2.0",
        id,
        result: { tools: MCP_TOOLS },
      });
      continue;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      if (!ALLOWED_TOOL_NAMES.has(toolName)) {
        responses.push({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `Unknown tool: ${toolName}` },
        });
        continue;
      }
      if (!env.BOARD_BRIDGE) {
        responses.push({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: "BOARD_BRIDGE Durable Object is not configured." }],
          },
        });
        continue;
      }

      const stub = env.BOARD_BRIDGE.getByName(parsedToken.boardId);
      const rpc = await stub.callTool(parsedToken.secret, toolName, toolArgs);
      responses.push({
        jsonrpc: "2.0",
        id,
        result: formatMcpToolResult(rpc),
      });
      continue;
    }

    responses.push({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }

  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: MCP_CORS_HEADERS });
  }

  return mcpJsonResponse(isBatch ? responses : responses[0], 200, {
    "Mcp-Session-Id": parsedToken.boardId,
  });
}

async function handleAgentRestCall(request, env, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return mcpJsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const fakeUrl = new URL(url.toString());
  if (body?.token && !fakeUrl.searchParams.get("token")) {
    fakeUrl.searchParams.set("token", String(body.token));
  }
  const parsedToken = parseAgentToken(request, fakeUrl);
  if (!parsedToken) {
    return mcpJsonResponse({ ok: false, error: "Missing or invalid board token." }, 401);
  }
  const toolName = body?.tool;
  if (!ALLOWED_TOOL_NAMES.has(toolName)) {
    return mcpJsonResponse({ ok: false, error: `Unknown tool: ${toolName}` }, 400);
  }
  if (!env.BOARD_BRIDGE) {
    return mcpJsonResponse({ ok: false, error: "BOARD_BRIDGE is not configured." }, 503);
  }
  const stub = env.BOARD_BRIDGE.getByName(parsedToken.boardId);
  const rpc = await stub.callTool(parsedToken.secret, toolName, body?.args || {});
  return mcpJsonResponse(rpc, rpc.ok ? 200 : rpc.status || 500);
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
    if (url.pathname === "/api/agent/ws") {
      const originError = checkSameOrigin(request);
      if (originError) return originError;
      const boardId = url.searchParams.get("boardId") || "";
      if (!/^[a-z0-9_-]{3,64}$/i.test(boardId)) {
        return new Response("Invalid boardId", { status: 400 });
      }
      if (!env.BOARD_BRIDGE) {
        return new Response("BOARD_BRIDGE is not configured", { status: 503 });
      }
      const stub = env.BOARD_BRIDGE.getByName(boardId);
      return stub.fetch(request);
    }
    if (url.pathname === "/api/agent/call") {
      return handleAgentRestCall(request, env, url);
    }
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return handleMcpRequest(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};
