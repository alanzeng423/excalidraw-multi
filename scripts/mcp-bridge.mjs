#!/usr/bin/env node
/**
 * Zero-dependency Stdio <-> Remote Streamable HTTP MCP bridge for excalidraw-multi.
 *
 * Usage:
 *   node scripts/mcp-bridge.mjs "https://your-domain.example/mcp?token=<boardId>.<secret>"
 * or:
 *   EXCALIDRAW_MCP_URL="https://your-domain.example/mcp?token=..." node scripts/mcp-bridge.mjs
 */
import readline from "node:readline";

const endpoint = process.argv[2] || process.env.EXCALIDRAW_MCP_URL || "";
if (!endpoint) {
  process.stderr.write(
    "Usage: node scripts/mcp-bridge.mjs <https://your-domain/mcp?token=boardId.secret>\n"
  );
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(parsed),
    });

    if (res.status === 202 || res.status === 204) {
      return;
    }

    const text = await res.text();
    if (text.trim()) {
      process.stdout.write(`${text.trim()}\n`);
    }
  } catch (err) {
    if (parsed && parsed.id !== undefined) {
      const errResp = {
        jsonrpc: "2.0",
        id: parsed.id,
        error: {
          code: -32603,
          message: `Bridge network error: ${err?.message || err}`,
        },
      };
      process.stdout.write(`${JSON.stringify(errResp)}\n`);
    }
  }
});
