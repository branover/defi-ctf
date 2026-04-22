#!/usr/bin/env node
/**
 * run-js.mjs — Run a JS solve script via WebSocket and wait for win or timeout.
 *
 * Usage:
 *   node run-js.mjs <path/to/solve.js> [timeout_seconds]
 *
 * Environment:
 *   ENGINE_URL — defaults to ws://localhost:3000
 *
 * Exit codes:
 *   0 — challenge won
 *   1 — challenge ended without win (timeout / stopped)
 *   2 — connection error
 */

import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
// Use ws from engine's node_modules
const WS = require(path.join(
  fileURLToPath(import.meta.url), "../../engine/node_modules/ws/index.js"
));

const scriptPath = process.argv[2];
if (!scriptPath) {
  console.error("Usage: node run-js.mjs <script.js> [timeout_seconds]");
  process.exit(2);
}

const source = fs.readFileSync(scriptPath, "utf-8");
const timeoutSec = parseInt(process.argv[3] ?? "180", 10);
const ENGINE_WS = ((process.env.ENGINE_URL ?? "http://localhost:3000")
  .replace(/^http/, "ws")).replace(/\/?$/, "/ws");

console.log(`[run-js] Connecting to ${ENGINE_WS}`);
console.log(`[run-js] Script: ${scriptPath}`);
console.log(`[run-js] Timeout: ${timeoutSec}s`);

const ws = new WS(ENGINE_WS);
let won = false;
let dead = false;

const deadline = setTimeout(() => {
  if (!dead) {
    dead = true;
    console.log(`[run-js] TIMEOUT after ${timeoutSec}s`);
    ws.close();
    process.exit(1);
  }
}, timeoutSec * 1000);

ws.on("open", () => {
  console.log("[run-js] Connected — sending script");
  ws.send(JSON.stringify({ type: "script_run", payload: { source } }));
});

ws.on("message", (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }

  if (msg.type === "script_log") {
    const level = msg.payload?.level ?? "log";
    const text  = msg.payload?.message ?? "";
    console.log(`[script:${level}] ${text}`);
  }

  if (msg.type === "challenge") {
    const state = msg.payload;
    const status = state?.status;
    console.log(`[run-js] Challenge status: ${status} | block ${state?.currentBlock}/${state?.totalBlocks}`);
    if (status === "won") {
      won = true;
      clearTimeout(deadline);
      dead = true;
      console.log("[run-js] WON!");
      ws.close();
      process.exit(0);
    }
    if (status === "idle" && state?.currentBlock > 0) {
      // Challenge ended without win
      clearTimeout(deadline);
      dead = true;
      console.log("[run-js] Challenge ended — not won");
      ws.close();
      process.exit(1);
    }
  }

  // The engine broadcasts a "win" message (not just "challenge" with status "won")
  // when the win condition is met. Watch for it explicitly.
  if (msg.type === "win") {
    const result = msg.payload;
    if (result?.won) {
      won = true;
      clearTimeout(deadline);
      dead = true;
      console.log(`[run-js] WON! (via win message) current=${result.current} target=${result.target}`);
      ws.close();
      process.exit(0);
    } else {
      clearTimeout(deadline);
      dead = true;
      console.log(`[run-js] LOST (via win message) current=${result.current} target=${result.target}`);
      ws.close();
      process.exit(1);
    }
  }

  if (msg.type === "error") {
    console.error("[run-js] Server error:", JSON.stringify(msg.payload));
  }
});

ws.on("error", (e) => {
  console.error("[run-js] WebSocket error:", e.message);
  clearTimeout(deadline);
  process.exit(2);
});

ws.on("close", () => {
  if (!dead) {
    clearTimeout(deadline);
    console.log("[run-js] Connection closed");
    process.exit(won ? 0 : 1);
  }
});
