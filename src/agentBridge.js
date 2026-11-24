const STORAGE_PREFIX = "excalidraw-multi:agent:";

const WRITE_TOOLS = new Set([
  "create_elements",
  "update_elements",
  "delete_elements",
  "layout_elements",
]);

export function isWriteAgentTool(toolName) {
  return WRITE_TOOLS.has(toolName);
}

export function generateAgentSecret() {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function getBoardAgentConfig(boardId) {
  const key = `${STORAGE_PREFIX}${boardId}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.secret === "string" && parsed.secret.length >= 12) {
        return {
          enabled: Boolean(parsed.enabled),
          secret: parsed.secret,
          mode: ["auto", "confirm", "readonly"].includes(parsed.mode)
            ? parsed.mode
            : "auto",
        };
      }
    }
  } catch {}

  const fresh = {
    enabled: false,
    secret: generateAgentSecret(),
    mode: "auto",
  };
  saveBoardAgentConfig(boardId, fresh);
  return fresh;
}

export function saveBoardAgentConfig(boardId, cfg) {
  const key = `${STORAGE_PREFIX}${boardId}`;
  const clean = {
    enabled: Boolean(cfg.enabled),
    secret: String(cfg.secret || generateAgentSecret()),
    mode: ["auto", "confirm", "readonly"].includes(cfg.mode) ? cfg.mode : "auto",
  };
  try {
    localStorage.setItem(key, JSON.stringify(clean));
  } catch {}
  return clean;
}

export function rotateBoardAgentSecret(boardId) {
  const cur = getBoardAgentConfig(boardId);
  return saveBoardAgentConfig(boardId, {
    ...cur,
    secret: generateAgentSecret(),
  });
}

export function buildBoardMcpUrl(boardId, secret, origin = window.location.origin) {
  return `${origin}/mcp?token=${encodeURIComponent(`${boardId}.${secret}`)}`;
}

export function describeAgentToolCall(toolName, args = {}, isZh = true) {
  if (toolName === "get_board_overview") {
    const sc = args.scope || "all";
    return isZh ? `读取画布概览 (${sc})` : `Read board overview (${sc})`;
  }
  if (toolName === "get_elements_detail") {
    const n = Array.isArray(args.ids) ? args.ids.length : 0;
    return isZh ? `读取 ${n} 个元素详情` : `Read detail of ${n} element(s)`;
  }
  if (toolName === "get_canvas_screenshot") {
    return isZh ? "截取画布 PNG 自检" : "Capture canvas PNG screenshot";
  }
  if (toolName === "create_elements") {
    const n = Array.isArray(args.elements) ? args.elements.length : 0;
    return isZh ? `新增 ${n} 个元素` : `Create ${n} element(s)`;
  }
  if (toolName === "update_elements") {
    const n = Array.isArray(args.patches) ? args.patches.length : 0;
    return isZh ? `修改 ${n} 个元素` : `Update ${n} element(s)`;
  }
  if (toolName === "delete_elements") {
    const n = Array.isArray(args.ids) ? args.ids.length : 0;
    return isZh ? `删除 ${n} 个元素` : `Delete ${n} element(s)`;
  }
  if (toolName === "layout_elements") {
    const st = args.strategy || "flowchart";
    return isZh ? `自动排版 (${st})` : `Auto layout (${st})`;
  }
  if (toolName === "focus_viewport") {
    return isZh ? "聚焦画布视口" : "Focus viewport";
  }
  return toolName;
}

export function createBoardAgentClient({
  boardId,
  secret,
  onStatus,
  onRpcRequest,
}) {
  let ws = null;
  let stopped = false;
  let reconnectTimer = null;
  let pingTimer = null;
  let backoffMs = 1000;

  const clearTimers = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const connect = () => {
    if (stopped) return;
    clearTimers();
    onStatus?.("connecting");

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProto}//${window.location.host}/api/agent/ws?boardId=${encodeURIComponent(
      boardId
    )}&secret=${encodeURIComponent(secret)}`;

    try {
      ws = new WebSocket(wsUrl);
    } catch {
      onStatus?.("error");
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      backoffMs = 1000;
      onStatus?.("connected");
      pingTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "ping" }));
          } catch {}
        }
      }, 25_000);
    });

    ws.addEventListener("message", async (evt) => {
      let msg;
      try {
        msg = JSON.parse(typeof evt.data === "string" ? evt.data : "");
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "ready" || msg.type === "pong") return;

      if (msg.type === "rpc_request" && msg.requestId) {
        try {
          const result = await onRpcRequest(msg.tool, msg.args || {});
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "rpc_response",
                requestId: msg.requestId,
                ok: true,
                result,
              })
            );
          }
        } catch (err) {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "rpc_response",
                requestId: msg.requestId,
                ok: false,
                error: err?.message || String(err),
              })
            );
          }
        }
      }
    });

    ws.addEventListener("close", (evt) => {
      clearTimers();
      if (stopped) return;
      if (evt.code === 4000) {
        onStatus?.("replaced");
        return;
      }
      onStatus?.("disconnected");
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // close event handles reconnect
    });
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    reconnectTimer = setTimeout(() => {
      connect();
    }, backoffMs);
    backoffMs = Math.min(15_000, backoffMs * 1.8);
  };

  connect();

  return {
    stop() {
      stopped = true;
      clearTimers();
      if (ws) {
        try {
          ws.close(1000, "Disabled by user");
        } catch {}
        ws = null;
      }
      onStatus?.("off");
    },
  };
}
