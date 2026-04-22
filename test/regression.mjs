/**
 * defi-ctf regression test suite
 *
 * Usage:  node test/regression.mjs [--verbose]
 *
 * Expects the platform to already be running (start.sh).
 * Tests: health, challenge API, solution runs, determinism.
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir      = dirname(fileURLToPath(import.meta.url));
const ENGINE_URL = process.env.ENGINE_URL ?? "http://localhost:3000";
const WS_URL     = process.env.WS_URL     ?? "ws://localhost:3000/ws";
const VERBOSE    = process.argv.includes("--verbose");

// ── Tiny test harness ────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const results = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, ok: true });
    console.log(`  ✓  ${name}`);
  } catch (e) {
    failed++;
    results.push({ name, ok: false, error: e.message });
    console.log(`  ✗  ${name}`);
    console.log(`       ${e.message}`);
    if (VERBOSE) console.error(e);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "assertion failed");
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function httpGet(path) {
  const r = await fetch(`${ENGINE_URL}${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json();
}

async function httpPost(path, body = {}) {
  const r = await fetch(`${ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

// ── WebSocket helper ─────────────────────────────────────────────────────────

function openWS() {
  return new Promise((resolve, reject) => {
    // Dynamic import so this file runs in Node without bundling
    import("ws").then(({ default: WS }) => {
      const ws = new WS(WS_URL);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
      setTimeout(() => reject(new Error("WS connect timeout")), 5000);
    }).catch(reject);
  });
}

function wsMessages(ws) {
  const inbox = [];
  const waiters = [];
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const w = waiters.shift();
      if (w) w.resolve(msg);
      else inbox.push(msg);
    } catch {}
  });
  return {
    next(timeout = 8000) {
      if (inbox.length) return Promise.resolve(inbox.shift());
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("WS message timeout")), timeout);
        waiters.push({ resolve: (v) => { clearTimeout(t); resolve(v); } });
      });
    },
    find(predicate, timeout = 30000) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`wsFind timeout`)), timeout);
        function check(msg) {
          if (inbox.length) {
            const i = inbox.findIndex(predicate);
            if (i >= 0) { clearTimeout(t); resolve(inbox.splice(i, 1)[0]); return; }
          }
          waiters.push({ resolve: (m) => { if (predicate(m)) { clearTimeout(t); resolve(m); } else { check(m); } } });
        }
        check(null);
      });
    },
  };
}

// Wait for a challenge to reach a given status (polling HTTP)
async function waitForStatus(status, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await httpGet("/api/challenge/state");
    if (state.status === status) return state;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Challenge never reached status "${status}" within ${timeoutMs}ms`);
}

function discoverChallengeDefs() {
  const root = join(__dir, "../challenges");
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(p);
      } else if (ent.isFile() && ent.name === "manifest.json") {
        const manifest = JSON.parse(readFileSync(p, "utf-8"));
        out.push({
          id: manifest.id,
          blockCount: manifest.chain.blockCount,
          manifestPath: p,
          solutionPath: join(dirname(p), "solution", "solution.js"),
        });
      }
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Run a solution script and wait for win/lost.
// Uses fast-forward chunks so tests are independent of wall-clock block interval.
async function runSolution(challengeId, solutionPath, blockCount, timeoutMs = 120000) {
  const source = readFileSync(solutionPath, "utf-8");

  // Stop any running challenge first
  await httpPost("/api/challenge/stop").catch(() => {});
  await new Promise(r => setTimeout(r, 500));

  const ws  = await openWS();
  const bus = wsMessages(ws);

  // Start challenge
  await httpPost("/api/challenge/start", { challengeId });

  // Wait for "running"
  let started = false;
  for (let i = 0; i < 30; i++) {
    const s = await httpGet("/api/challenge/state");
    if (s.status === "running") { started = true; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  assert(started, `Challenge ${challengeId} did not reach "running" state`);

  // Inject solution script
  ws.send(JSON.stringify({ type: "script_run", payload: { source } }));

  // Wait for win/lost with accelerated mining
  let result = null;
  let ffChunks = 0;
  const maxChunks = Math.ceil((blockCount + 50) / 10);
  const startedAt = Date.now();
  while (ffChunks <= maxChunks && Date.now() - startedAt < timeoutMs) {
    await httpPost("/api/control", { action: "fast_forward", blocks: 10 }).catch(() => {});
    const state = await httpGet("/api/challenge/state");
    if (state.status === "won" || state.status === "lost") {
      result = state;
      break;
    }
    ffChunks++;
    await new Promise(r => setTimeout(r, 150));
  }

  ws.close();
  return result;
}

// ── Architecture tests ────────────────────────────────────────────────────────

async function runArchTests() {
  console.log("\n── Architecture ─────────────────────────────────────────────");

  await test("health endpoint returns ok", async () => {
    const h = await httpGet("/health");
    assert(h.ok === true, `expected {ok:true}, got ${JSON.stringify(h)}`);
  });

  await test("GET /api/challenges returns non-empty list", async () => {
    const list = await httpGet("/api/challenges");
    assert(Array.isArray(list) && list.length > 0, "expected array with challenges");
    if (VERBOSE) console.log("       challenges:", list.map(c => c.id).join(", "));
  });

  await test("challenges have required fields", async () => {
    const list = await httpGet("/api/challenges");
    for (const c of list) {
      assert(c.id,          `missing id on ${JSON.stringify(c)}`);
      assert(c.name,        `missing name on ${c.id}`);
      assert(c.blockCount,  `missing blockCount on ${c.id}`);
      assert(c.target,      `missing target on ${c.id}`);
    }
  });

  await test("challenge state endpoint returns valid shape", async () => {
    const s = await httpGet("/api/challenge/state");
    assert(typeof s.status === "string", "expected status string");
    assert(typeof s.currentBlock === "number", "expected currentBlock number");
  });

  await test("WS connects and receives challenge + challenges messages", async () => {
    const ws  = await openWS();
    const bus = wsMessages(ws);
    ws.send(JSON.stringify({ type: "get_challenges", payload: {} }));
    const challengeMsg = await bus.find((m) => m?.type === "challenge", 8000);
    const challengesMsg = await bus.find((m) => m?.type === "challenges", 8000);
    ws.close();
    assert(Boolean(challengeMsg), "did not receive 'challenge' message");
    assert(Boolean(challengesMsg), "did not receive 'challenges' message");
  });

  await test("start + stop challenge resets to idle", async () => {
    await httpPost("/api/challenge/start", { challengeId: "wave-rider" });
    await waitForStatus("running", 30000);
    await httpPost("/api/challenge/stop");
    await waitForStatus("idle", 10000);
  });

  await test("price history endpoint returns array after challenge started", async () => {
    // Start briefly to get some price data
    await httpPost("/api/challenge/start", { challengeId: "wave-rider" });
    await waitForStatus("running", 30000);
    await new Promise(r => setTimeout(r, 3000));  // let a few blocks mine
    const hist = await httpGet("/api/history/weth-usdc-uniswap?lastN=50");
    await httpPost("/api/challenge/stop");
    assert(Array.isArray(hist), "expected array from history endpoint");
    if (VERBOSE) console.log(`       got ${hist.length} candles`);
  });

  await test("determinism: two runs produce identical candle at block 30", async () => {
    const getPrice30 = async () => {
      await httpPost("/api/challenge/start", { challengeId: "wave-rider" });
      await waitForStatus("running", 30000);
      // Fast-forward to block 30
      await httpPost("/api/control", { action: "fast_forward", blocks: 30 });
      await new Promise(r => setTimeout(r, 2000));
      const hist = await httpGet("/api/history/weth-usdc-uniswap?lastN=100");
      await httpPost("/api/challenge/stop");
      await waitForStatus("idle", 10000);
      // Return last candle's close price
      return hist.length > 0 ? hist[hist.length - 1].close : null;
    };

    const p1 = await getPrice30();
    await new Promise(r => setTimeout(r, 1000));
    const p2 = await getPrice30();

    assert(p1 !== null, "first run returned no candles");
    assert(p2 !== null, "second run returned no candles");
    assert(Math.abs(p1 - p2) < 0.001, `prices differ: ${p1} vs ${p2} — not deterministic`);
    if (VERBOSE) console.log(`       deterministic close price at block 30: $${p1.toFixed(4)}`);
  });
}

// ── Solution tests ────────────────────────────────────────────────────────────

async function runSolutionTests() {
  console.log("\n── Solutions ────────────────────────────────────────────────");

  const defs = discoverChallengeDefs();
  assert(defs.length > 0, "no challenge manifests discovered");

  // Log challenges without solutions (informational — not all challenges need one yet)
  const missing = defs.filter(d => !existsSync(d.solutionPath));
  if (missing.length > 0) {
    console.log(`  ℹ  ${missing.length} challenge(s) without solution.js (skipped): ${missing.map(m => m.id).join(", ")}`);
  }

  // Only test challenges that actually have a solution.js
  const withSolutions = defs.filter(d => existsSync(d.solutionPath));
  assert(withSolutions.length > 0, "no challenges have solution.js — at least one is required");

  for (const d of withSolutions) {
    await test(`${d.id}: solution wins`, async () => {
      const result = await runSolution(d.id, d.solutionPath, d.blockCount, 300000);
      assert(result !== null, "challenge did not complete (timed out or engine error)");
      assert(result.status === "won", `expected status 'won', got '${result.status}'`);
      if (VERBOSE) console.log(`       final status: ${result.status}`);
    });
  }
}

// ── Solve workspace API tests ─────────────────────────────────────────────────

async function runSolveApiTests() {
  console.log("\n── Solve workspace API ──────────────────────────────────────");

  // All solve/ API calls require ?challenge=<id> (scoped since PR #41).
  // Use wave-rider as the test challenge.
  const CHALLENGE = "wave-rider";
  const Q = `challenge=${encodeURIComponent(CHALLENGE)}`;

  // Use a unique temp path so parallel runs don't collide
  const tmpPath = `test-regression-${Date.now()}.sol`;
  const tmpContent = `// regression-test-content-${Date.now()}`;

  await test("GET /api/solve/files without challenge param returns 400", async () => {
    const r = await fetch(`${ENGINE_URL}/api/solve/files`);
    assert(r.status === 400, `expected 400, got ${r.status}`);
  });

  await test("GET /api/solve/files with challenge returns a tree array", async () => {
    const r = await fetch(`${ENGINE_URL}/api/solve/files?${Q}`);
    assert(r.ok, `expected 200, got ${r.status}`);
    const tree = await r.json();
    assert(Array.isArray(tree), `expected array, got ${typeof tree}`);
    if (VERBOSE) console.log("       tree entries:", tree.map(n => n.name).join(", "));
  });

  await test("GET /api/solve/files tree entries have name and path fields", async () => {
    const r = await fetch(`${ENGINE_URL}/api/solve/files?${Q}`);
    assert(r.ok, `GET /api/solve/files → ${r.status}`);
    const tree = await r.json();
    for (const node of tree) {
      assert(typeof node.name === "string", `node missing name: ${JSON.stringify(node)}`);
      assert(typeof node.path === "string", `node missing path: ${JSON.stringify(node)}`);
    }
  });

  await test("POST /api/solve/file creates a new file", async () => {
    const r = await fetch(`${ENGINE_URL}/api/solve/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: CHALLENGE, path: tmpPath, content: tmpContent }),
    });
    const bodyText = await r.text();
    assert(r.ok, `POST /api/solve/file → ${r.status}: ${bodyText}`);
    const body = JSON.parse(bodyText);
    assert(body.ok === true, `expected {ok:true}, got ${JSON.stringify(body)}`);
  });

  await test("GET /api/solve/file reads the created file back", async () => {
    const r = await fetch(
      `${ENGINE_URL}/api/solve/file?${Q}&path=${encodeURIComponent(tmpPath)}`
    );
    assert(r.ok, `GET /api/solve/file → ${r.status}`);
    const text = await r.text();
    assert(text === tmpContent, `expected "${tmpContent}", got "${text}"`);
  });

  await test("GET /api/solve/files includes the newly created file", async () => {
    const r = await fetch(`${ENGINE_URL}/api/solve/files?${Q}`);
    assert(r.ok, `GET /api/solve/files → ${r.status}`);
    const tree = await r.json();

    // Flatten the tree to find our file
    function flatten(nodes) {
      const out = [];
      for (const n of nodes) {
        out.push(n);
        if (n.children) out.push(...flatten(n.children));
      }
      return out;
    }
    const all = flatten(tree);
    const found = all.some(n => n.path === tmpPath || n.name === tmpPath);
    assert(found, `"${tmpPath}" not found in file tree after creation`);
  });

  await test("DELETE /api/solve/file removes the file", async () => {
    const r = await fetch(
      `${ENGINE_URL}/api/solve/file?${Q}&path=${encodeURIComponent(tmpPath)}`,
      { method: "DELETE" }
    );
    assert(r.ok, `DELETE /api/solve/file → ${r.status}`);
    const body = await r.json();
    assert(body.ok === true, `expected {ok:true}, got ${JSON.stringify(body)}`);
  });

  await test("GET /api/solve/file after delete returns 404", async () => {
    const r = await fetch(
      `${ENGINE_URL}/api/solve/file?${Q}&path=${encodeURIComponent(tmpPath)}`
    );
    assert(r.status === 404, `expected 404, got ${r.status}`);
  });

  await test("path traversal via .. on GET is rejected with 400", async () => {
    const r = await fetch(
      `${ENGINE_URL}/api/solve/file?${Q}&path=${encodeURIComponent("../../etc/passwd")}`
    );
    assert(r.status === 400, `expected 400 for traversal, got ${r.status}`);
  });

  await test("path traversal on POST is rejected with 400", async () => {
    const r = await fetch(`${ENGINE_URL}/api/solve/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: CHALLENGE, path: "../../evil.txt", content: "pwned" }),
    });
    assert(r.status === 400, `expected 400 for traversal on POST, got ${r.status}`);
  });

  await test("path traversal on DELETE is rejected with 400", async () => {
    const r = await fetch(
      `${ENGINE_URL}/api/solve/file?${Q}&path=${encodeURIComponent("../../etc/passwd")}`,
      { method: "DELETE" }
    );
    assert(r.status === 400, `expected 400 for traversal on DELETE, got ${r.status}`);
  });

  await test("POST /api/solve/file with missing path returns 400", async () => {
    const r = await fetch(`${ENGINE_URL}/api/solve/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: CHALLENGE, content: "no path" }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
  });

  await test("GET /api/solve/file with missing path param returns 400", async () => {
    const r = await fetch(`${ENGINE_URL}/api/solve/file?${Q}`);
    assert(r.status === 400, `expected 400, got ${r.status}`);
  });

  await test("POST /api/solve/file with missing challenge param returns 400", async () => {
    const r = await fetch(`${ENGINE_URL}/api/solve/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "test.sol", content: "no challenge" }),
    });
    assert(r.status === 400, `expected 400 for missing challenge, got ${r.status}`);
  });

  await test("POST /api/solve/file creates nested dirs automatically", async () => {
    const nestedPath = `test-nested-${Date.now()}/sub/file.sol`;
    const r = await fetch(`${ENGINE_URL}/api/solve/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: CHALLENGE, path: nestedPath, content: "// nested" }),
    });
    assert(r.ok, `POST /api/solve/file → ${r.status}`);

    // Read it back
    const r2 = await fetch(
      `${ENGINE_URL}/api/solve/file?${Q}&path=${encodeURIComponent(nestedPath)}`
    );
    assert(r2.ok, `GET nested file → ${r2.status}`);
    const text = await r2.text();
    assert(text === "// nested", `expected "// nested", got "${text}"`);

    // Clean up
    const topDir = nestedPath.split("/")[0];
    await fetch(
      `${ENGINE_URL}/api/solve/file?${Q}&path=${encodeURIComponent(topDir)}`,
      { method: "DELETE" }
    );
  });
}

// ── Trigger name/description tests ───────────────────────────────────────────

async function runTriggerTests() {
  console.log("\n── Trigger name/description (PR #36) ───────────────────────");

  // Start a challenge so the script sandbox is active
  await httpPost("/api/challenge/stop").catch(() => {});
  await httpPost("/api/challenge/start", { challengeId: "wave-rider" });
  for (let i = 0; i < 30; i++) {
    const s = await httpGet("/api/challenge/state");
    if (s.status === "running") break;
    await new Promise(r => setTimeout(r, 1000));
  }

  const ws  = await openWS();
  const bus = wsMessages(ws);

  await test("onBlock trigger uses auto-generated description when no name given", async () => {
    ws.send(JSON.stringify({
      type: "script_run",
      payload: { source: `onBlock(() => {});` },
    }));
    const msg = await bus.find(m => m?.type === "triggers", 8000);
    assert(msg, "no triggers message received");
    const t = msg.payload.triggers.find(t => t.type === "onBlock");
    assert(t, "no onBlock trigger found");
    assert(typeof t.description === "string" && t.description.length > 0,
      `expected non-empty description, got: ${JSON.stringify(t.description)}`);
    if (VERBOSE) console.log(`       description: "${t.description}"`);
  });

  // Clear triggers
  ws.send(JSON.stringify({ type: "script_stop", payload: {} }));
  await bus.find(m => m?.type === "triggers", 5000).catch(() => {});

  await test("onBlock trigger stores custom name as description", async () => {
    ws.send(JSON.stringify({
      type: "script_run",
      payload: { source: `onBlock(() => {}, "My custom trigger");` },
    }));
    const msg = await bus.find(m => m?.type === "triggers", 8000);
    assert(msg, "no triggers message received");
    const t = msg.payload.triggers.find(t => t.type === "onBlock");
    assert(t, "no onBlock trigger found");
    assert(t.description === "My custom trigger",
      `expected "My custom trigger", got "${t.description}"`);
  });

  // Clear triggers
  ws.send(JSON.stringify({ type: "script_stop", payload: {} }));
  await bus.find(m => m?.type === "triggers", 5000).catch(() => {});

  await test("onPriceBelow trigger auto-description contains pool and threshold", async () => {
    ws.send(JSON.stringify({
      type: "script_run",
      payload: { source: `onPriceBelow("weth-usdc-uniswap", 2500, () => {});` },
    }));
    const msg = await bus.find(m => m?.type === "triggers", 8000);
    assert(msg, "no triggers message received");
    const t = msg.payload.triggers.find(t => t.type === "onPriceBelow");
    assert(t, "no onPriceBelow trigger found");
    assert(t.description.includes("weth-usdc-uniswap"), `description missing pool: "${t.description}"`);
    assert(t.description.includes("2500"), `description missing threshold: "${t.description}"`);
  });

  // Clear triggers
  ws.send(JSON.stringify({ type: "script_stop", payload: {} }));
  await bus.find(m => m?.type === "triggers", 5000).catch(() => {});

  await test("onPriceBelow trigger stores custom name as description", async () => {
    ws.send(JSON.stringify({
      type: "script_run",
      payload: { source: `onPriceBelow("weth-usdc-uniswap", 2500, () => {}, "Buy the dip");` },
    }));
    const msg = await bus.find(m => m?.type === "triggers", 8000);
    assert(msg, "no triggers message received");
    const t = msg.payload.triggers.find(t => t.type === "onPriceBelow");
    assert(t, "no onPriceBelow trigger found");
    assert(t.description === "Buy the dip",
      `expected "Buy the dip", got "${t.description}"`);
  });

  // Cleanup
  ws.send(JSON.stringify({ type: "script_stop", payload: {} }));
  await bus.find(m => m?.type === "triggers", 5000).catch(() => {});
  ws.close();
  await httpPost("/api/challenge/stop");
}

// ── ManualTrade WS handler tests ──────────────────────────────────────────────

async function runManualTradeTests() {
  console.log("\n── ManualTrade WS handler (PR #40) ─────────────────────────");

  // Start wave-rider which has WETH/USDC
  await httpPost("/api/challenge/stop").catch(() => {});
  await httpPost("/api/challenge/start", { challengeId: "wave-rider" });
  for (let i = 0; i < 30; i++) {
    const s = await httpGet("/api/challenge/state");
    if (s.status === "running") break;
    await new Promise(r => setTimeout(r, 1000));
  }

  const ws  = await openWS();
  const bus = wsMessages(ws);

  await test("manual_trade with invalid pool returns error in manual_trade_result", async () => {
    ws.send(JSON.stringify({
      type: "manual_trade",
      payload: { pool: "nonexistent-pool", tokenIn: "WETH", amountIn: "1.0" },
    }));
    const msg = await bus.find(m => m?.type === "manual_trade_result", 10000);
    assert(msg, "no manual_trade_result received");
    assert(msg.payload.error, `expected error field, got: ${JSON.stringify(msg.payload)}`);
  });

  await test("manual_trade with invalid amount returns error in manual_trade_result", async () => {
    ws.send(JSON.stringify({
      type: "manual_trade",
      payload: { pool: "weth-usdc-uniswap", tokenIn: "WETH", amountIn: "not-a-number" },
    }));
    const msg = await bus.find(m => m?.type === "manual_trade_result", 10000);
    assert(msg, "no manual_trade_result received");
    assert(msg.payload.error, `expected error field, got: ${JSON.stringify(msg.payload)}`);
  });

  await test("manual_trade with zero amount returns error in manual_trade_result", async () => {
    ws.send(JSON.stringify({
      type: "manual_trade",
      payload: { pool: "weth-usdc-uniswap", tokenIn: "WETH", amountIn: "0" },
    }));
    const msg = await bus.find(m => m?.type === "manual_trade_result", 10000);
    assert(msg, "no manual_trade_result received");
    assert(msg.payload.error, `expected error field, got: ${JSON.stringify(msg.payload)}`);
  });

  await test("manual_trade with unknown tokenIn symbol returns error", async () => {
    ws.send(JSON.stringify({
      type: "manual_trade",
      payload: { pool: "weth-usdc-uniswap", tokenIn: "SHITCOIN", amountIn: "1.0" },
    }));
    const msg = await bus.find(m => m?.type === "manual_trade_result", 10000);
    assert(msg, "no manual_trade_result received");
    assert(msg.payload.error, `expected error for unknown token, got: ${JSON.stringify(msg.payload)}`);
    assert(msg.payload.error.includes("SHITCOIN"), `error should mention the unknown token, got: "${msg.payload.error}"`);
  });

  await test("manual_trade with excess amount returns insufficient balance error", async () => {
    // The player starts with 10 ETH worth of USDC; trying to sell 10M USDC should fail
    ws.send(JSON.stringify({
      type: "manual_trade",
      payload: { pool: "weth-usdc-uniswap", tokenIn: "USDC", amountIn: "10000000" },
    }));
    const msg = await bus.find(m => m?.type === "manual_trade_result", 10000);
    assert(msg, "no manual_trade_result received");
    assert(msg.payload.error, `expected insufficient balance error, got: ${JSON.stringify(msg.payload)}`);
  });

  ws.close();
  await httpPost("/api/challenge/stop");
}

// ── Per-challenge IDE file scoping tests (PR #41) ────────────────────────────

async function runChallengeFileScopingTests() {
  console.log("\n── Per-challenge IDE file scoping (PR #41) ─────────────────");

  // Use .sol extension — the solve/ workspace only stores .sol files.
  const ts = Date.now();
  const fileA = `scope-test-chall-a-${ts}.sol`;
  const fileB = `scope-test-chall-b-${ts}.sol`;

  await test("file written for challenge-a not visible under challenge-b scope", async () => {
    // Write a file scoped to challenge "wave-rider"
    const r1 = await fetch(`${ENGINE_URL}/api/solve/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: "wave-rider", path: fileA, content: "challenge-a" }),
    });
    assert(r1.ok, `write for wave-rider → ${r1.status}`);

    // Write a different file scoped to challenge "the-spread"
    const r2 = await fetch(`${ENGINE_URL}/api/solve/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: "the-spread", path: fileB, content: "challenge-b" }),
    });
    assert(r2.ok, `write for the-spread → ${r2.status}`);

    // Read file back under wave-rider scope — should be "challenge-a"
    const r3 = await fetch(
      `${ENGINE_URL}/api/solve/file?challenge=wave-rider&path=${encodeURIComponent(fileA)}`
    );
    assert(r3.ok, `read wave-rider/${fileA} → ${r3.status}`);
    const textA = await r3.text();
    assert(textA === "challenge-a", `expected "challenge-a", got "${textA}"`);

    // File A should NOT be visible under the-spread scope (404 or different content)
    const r4 = await fetch(
      `${ENGINE_URL}/api/solve/file?challenge=the-spread&path=${encodeURIComponent(fileA)}`
    );
    assert(r4.status === 404, `expected 404 for wave-rider file under the-spread scope, got ${r4.status}`);

    // Cleanup
    await fetch(`${ENGINE_URL}/api/solve/file?challenge=wave-rider&path=${encodeURIComponent(fileA)}`, { method: "DELETE" });
    await fetch(`${ENGINE_URL}/api/solve/file?challenge=the-spread&path=${encodeURIComponent(fileB)}`, { method: "DELETE" });
  });

  await test("challenge-scoped path traversal via challengeId is rejected", async () => {
    // A malicious challengeId with path characters should be rejected
    const r = await fetch(`${ENGINE_URL}/api/solve/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: "../../../etc", path: "evil.txt", content: "pwned" }),
    });
    assert(r.status === 400, `expected 400 for traversal in challengeId, got ${r.status}`);
  });
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log("defi-ctf regression tests");
  console.log(`Engine: ${ENGINE_URL}`);
  console.log("─".repeat(60));

  // Verify engine reachable
  try {
    await httpGet("/health");
  } catch {
    console.error("ERROR: engine not reachable at", ENGINE_URL);
    console.error("Start the platform first:  ./start.sh");
    process.exit(1);
  }

  await runArchTests();
  await runSolveApiTests();
  await runTriggerTests();
  await runManualTradeTests();
  await runChallengeFileScopingTests();
  await runSolutionTests();

  console.log("\n" + "─".repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log("All tests passed.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
