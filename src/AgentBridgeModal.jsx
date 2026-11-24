import { useState } from "react";
import { buildBoardMcpUrl } from "./agentBridge";

const CLIENT_TABS = [
  { id: "remote", zh: "Antigravity / Cursor", en: "Antigravity / Cursor" },
  { id: "claude", zh: "Claude Code", en: "Claude Code" },
  { id: "stdio", zh: "Stdio / REST", en: "Stdio / REST" },
];

export default function AgentBridgeModal({
  boardId,
  config,
  status,
  logs,
  isZh,
  onToggleEnabled,
  onChangeMode,
  onRotateSecret,
  onClose,
}) {
  const [tab, setTab] = useState("remote");
  const [copiedKey, setCopiedKey] = useState("");

  const mcpUrl = buildBoardMcpUrl(boardId, config.secret);
  const token = `${boardId}.${config.secret}`;

  const copyText = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((cur) => (cur === key ? "" : cur)), 1800);
  };

  const remoteJson = JSON.stringify(
    {
      mcpServers: {
        "excalidraw-board": {
          url: mcpUrl,
        },
      },
    },
    null,
    2
  );

  const claudeCmd = `claude mcp add --transport http excalidraw-board "${mcpUrl}"`;

  const stdioSnippet = JSON.stringify(
    {
      mcpServers: {
        "excalidraw-board": {
          command: "node",
          args: ["scripts/mcp-bridge.mjs", mcpUrl],
        },
      },
    },
    null,
    2
  );

  const restSnippet = `curl -X POST "${window.location.origin}/api/agent/call" \\\n  -H "Content-Type: application/json" \\\n  -d '{"token":"${token}","tool":"get_board_overview","args":{}}'`;

  const statusText = (() => {
    if (!config.enabled) return isZh ? "未开启" : "Disabled";
    if (status === "connected") return isZh ? "已连接，等待外部 Agent 调用" : "Connected & ready";
    if (status === "connecting") return isZh ? "正在建立实时通道…" : "Connecting…";
    if (status === "replaced") return isZh ? "已被同画板其他标签页接管" : "Replaced by another tab";
    return isZh ? "已断开，正在重连…" : "Disconnected, reconnecting…";
  })();

  const statusCls = !config.enabled
    ? "is-off"
    : status === "connected"
      ? "is-ok"
      : status === "connecting"
        ? "is-busy"
        : "is-warn";

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={isZh ? "外部 Agent 控制 (MCP)" : "External Agent Control (MCP)"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-card agent-modal">
        <div className="modal-head">
          <div>
            <h2>{isZh ? "外部 Agent 控制 (MCP)" : "External Agent Control (MCP)"}</h2>
            <p className="modal-sub">
              {isZh
                ? "凭证绑定到当前画板，Antigravity / Claude Code / Cursor 可实时读写画布"
                : "Board-bound MCP endpoint for Antigravity, Claude Code, Cursor, or CLI"}
            </p>
          </div>
          <button
            className="tile-icon-btn"
            type="button"
            aria-label={isZh ? "关闭" : "Close"}
            onClick={onClose}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Enable switch + Live connection status */}
        <div className="agent-switch-bar">
          <div className="agent-status-row">
            <span className={`agent-dot ${statusCls}`} />
            <span className="agent-status-text">{statusText}</span>
          </div>
          <button
            type="button"
            className={`tool-btn ${config.enabled ? "primary" : "outline"}`}
            onClick={onToggleEnabled}
          >
            {config.enabled
              ? isZh
                ? "已开启（点击断开）"
                : "Enabled (Disconnect)"
              : isZh
                ? "开启 Agent 联动"
                : "Enable Agent Bridge"}
          </button>
        </div>

        {/* Permission mode */}
        <div className="share-ttl-section">
          <span className="share-field-label">
            {isZh ? "修改权限模式" : "Write permission mode"}
          </span>
          <div className="share-ttl-group">
            {[
              { id: "auto", zh: "流畅模式（Ctrl+Z 可撤回）", en: "Auto-apply (Undoable)" },
              { id: "confirm", zh: "审阅确认", en: "Ask before write" },
              { id: "readonly", zh: "仅只读", en: "Read-only" },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                className={`preset-chip ${config.mode === m.id ? "active" : ""}`}
                onClick={() => onChangeMode(m.id)}
              >
                {isZh ? m.zh : m.en}
              </button>
            ))}
          </div>
        </div>

        {/* Board-bound MCP URL */}
        <div className="share-ttl-section">
          <div className="agent-field-head">
            <span className="share-field-label">
              {isZh ? "当前画板 MCP 地址（刷新自动重连）" : "Board-bound MCP URL"}
            </span>
            <button
              type="button"
              className="agent-link-btn"
              onClick={onRotateSecret}
              title={isZh ? "生成新密钥并使旧凭证失效" : "Rotate secret and revoke old tokens"}
            >
              {isZh ? "重置密钥" : "Rotate secret"}
            </button>
          </div>
          <div className="share-result">
            <input
              className="share-url-input"
              type="text"
              readOnly
              value={mcpUrl}
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              className="tool-btn primary"
              onClick={() => copyText("url", mcpUrl)}
            >
              {copiedKey === "url"
                ? isZh
                  ? "已复制"
                  : "Copied"
                : isZh
                  ? "复制"
                  : "Copy"}
            </button>
          </div>
        </div>

        {/* Client setup snippets */}
        <div className="agent-tabs">
          {CLIENT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`agent-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {isZh ? t.zh : t.en}
            </button>
          ))}
        </div>

        {tab === "remote" && (
          <div className="agent-code-box">
            <pre>{remoteJson}</pre>
            <button
              type="button"
              className="agent-copy-mini"
              onClick={() => copyText("remote", remoteJson)}
            >
              {copiedKey === "remote" ? (isZh ? "已复制" : "Copied") : isZh ? "复制 JSON" : "Copy JSON"}
            </button>
          </div>
        )}

        {tab === "claude" && (
          <div className="agent-code-box">
            <pre>{claudeCmd}</pre>
            <button
              type="button"
              className="agent-copy-mini"
              onClick={() => copyText("claude", claudeCmd)}
            >
              {copiedKey === "claude" ? (isZh ? "已复制" : "Copied") : isZh ? "复制命令" : "Copy cmd"}
            </button>
          </div>
        )}

        {tab === "stdio" && (
          <div className="agent-code-stack">
            <div className="agent-code-box">
              <pre>{stdioSnippet}</pre>
              <button
                type="button"
                className="agent-copy-mini"
                onClick={() => copyText("stdio", stdioSnippet)}
              >
                {copiedKey === "stdio" ? (isZh ? "已复制" : "Copied") : isZh ? "复制 Stdio" : "Copy Stdio"}
              </button>
            </div>
            <div className="agent-code-box">
              <pre>{restSnippet}</pre>
              <button
                type="button"
                className="agent-copy-mini"
                onClick={() => copyText("rest", restSnippet)}
              >
                {copiedKey === "rest" ? (isZh ? "已复制" : "Copied") : isZh ? "复制 curl" : "Copy curl"}
              </button>
            </div>
          </div>
        )}

        {/* Recent activity log */}
        {logs.length > 0 && (
          <div className="agent-log-box">
            <div className="share-field-label">
              {isZh ? "最近 Agent 操作记录" : "Recent Agent activity"}
            </div>
            <div className="agent-log-list">
              {logs.map((entry) => (
                <div key={entry.id} className={`agent-log-item is-${entry.state}`}>
                  <span className="agent-log-time">{entry.time}</span>
                  <span className="agent-log-desc">{entry.summary}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="share-e2e-note">
          {isZh
            ? "零云端落盘：云端仅做实时消息中继，画板数据始终保存在本地浏览器中；断开或关闭页面后外部 Agent 将无法访问。"
            : "Zero cloud persistence: the Worker only relays live RPCs while this board tab is open. Closing the tab immediately ends access."}
        </p>
      </div>
    </div>
  );
}
