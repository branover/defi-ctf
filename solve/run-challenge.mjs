#!/usr/bin/env node
/**
 * run-challenge.mjs — automated challenge test runner
 *
 * Usage:
 *   node run-challenge.mjs <challengeId>              # auto-detect solve script
 *   node run-challenge.mjs <challengeId> --override <path/to/custom.js>
 *   node run-challenge.mjs <challengeId> --forge <path/to/Script.s.sol>
 *
 * Exit codes:  0 = WON,  1 = LOST/TIMEOUT/ERROR
 *
 * Strategy auto-detection priority:
 *   1. test-scripts/<id>.js  (local-only overrides, gitignored)
 *   2. challenges/<id>/solve.js  (JS SDK script, gitignored locally)
 *   3. challenges/<id>/Script.s.sol  (Forge script, gitignored locally)
 */

import { createRequire } from 'module';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);
const WS        = require('../engine/node_modules/ws');

const BASE    = 'http://localhost:3000';
const PK      = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TIMEOUT = 7 * 60 * 1000; // 7 minutes max per challenge

const args = process.argv.slice(2);
const CHALLENGE_ID = args[0];
if (!CHALLENGE_ID) { console.error('Usage: node run-challenge.mjs <challengeId>'); process.exit(1); }

// Parse optional flags
let overrideJs = null, forgeOverride = null;
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--override') overrideJs    = readFileSync(args[++i], 'utf8');
  if (args[i] === '--forge')    forgeOverride = args[++i];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path, retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${BASE}${path}`);
      return r.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(3000);
    }
  }
}
async function post(path, body = {}, retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(`${BASE}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return r.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(3000);
    }
  }
}

async function waitIdle(maxMs = 20 * 60 * 1000) {
  const t = Date.now();
  while (Date.now() - t < maxMs) {
    const s = await get('/api/challenge/state');
    if (!['running', 'paused'].includes(s.status)) return;
    process.stdout.write('.');
    await sleep(4000);
  }
  throw new Error('Timed out waiting for engine to become idle');
}

async function startChallenge() {
  for (let i = 0; i < 600; i++) {
    const s = await get('/api/challenge/state');
    if (!['running', 'paused'].includes(s.status)) {
      const r = await post('/api/challenge/start', { challengeId: CHALLENGE_ID });
      if (r.ok) { await sleep(200); return; }
    }
    await sleep(3000);
  }
  throw new Error('Failed to start challenge after retries');
}

async function pollResult(timeoutMs = TIMEOUT) {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    const s = await get('/api/challenge/state');
    if (s.status === 'won')  return 'won';
    if (s.status === 'lost') return 'lost';
    // If the challenge was stopped by a competing agent, exit early
    if (s.status === 'idle' || (s.id && s.id !== CHALLENGE_ID)) return 'interrupted';
    await sleep(2500);
  }
  return 'timeout';
}

async function runJs(source) {
  return new Promise((resolve) => {
    const ws = new WS('ws://localhost:3000/ws');
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; ws.terminate(); resolve(r); } };

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'script_run', payload: { source } }));
    });
    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'challenge') {
          const st = msg.payload?.status;
          if (st === 'won')  finish('won');
          if (st === 'lost') finish('lost');
          if (st === 'idle') finish('interrupted');
        }
        if (msg.type === 'log') {
          const lvl = msg.payload?.level ?? 'log';
          const txt = msg.payload?.args?.join(' ') ?? '';
          console.log(`  [script:${lvl}] ${txt}`);
        }
        if (msg.type === 'script_log') {
          const lvl = msg.payload?.level ?? 'log';
          const txt = msg.payload?.message ?? '';
          console.log(`  [script:${lvl}] ${txt}`);
        }
      } catch {}
    });
    ws.on('error', e => console.error('[ws error]', e.message));
    setTimeout(() => finish('timeout'), TIMEOUT);
  });
}

async function runForge(scriptRelPath) {
  const connInfo = await get('/api/connection_info');
  const foundryBin = `${process.env.HOME ?? '/root'}/.foundry/bin`;
  const env = {
    ...process.env,
    PATH:        `${foundryBin}:${process.env.PATH ?? ''}`,
    RPC_URL:     connInfo.rpcUrl,
    PRIVATE_KEY: PK,
    PLAYER:      connInfo.player.address,
    ...Object.fromEntries(
      Object.entries(connInfo.contracts ?? {}).map(([k, v]) => [k.toUpperCase(), v])
    ),
    ...Object.fromEntries(
      Object.entries(connInfo.tokens ?? {}).map(([k, v]) => [`${k.toUpperCase()}_ADDR`, v.address ?? v])
    ),
  };
  const absScript = resolve(__dirname, scriptRelPath);
  const cmd = `forge script ${absScript} --rpc-url ${env.RPC_URL} --private-key ${env.PRIVATE_KEY} --broadcast --slow`;
  console.log('\n[forge] Running:', cmd);
  try {
    const out = execSync(cmd, { env, cwd: __dirname, timeout: 4 * 60 * 1000, encoding: 'utf8' });
    console.log(out.slice(0, 3000));
  } catch (e) {
    console.error('[forge] exit', e.status);
    if (e.stdout) console.error(e.stdout.slice(0, 2000));
    if (e.stderr) console.error(e.stderr.slice(0, 1000));
  }
  return pollResult(90_000);
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing: ${CHALLENGE_ID}`);
  console.log(`${'='.repeat(60)}`);

  // Detect solve strategy
  let jsSource   = overrideJs;
  let forgePath  = forgeOverride;

  if (!jsSource && !forgePath) {
    const overridePath = resolve(__dirname, 'test-scripts', `${CHALLENGE_ID}.js`);
    const solveJsPath  = resolve(__dirname, 'challenges', CHALLENGE_ID, 'solve.js');
    const solPath      = resolve(__dirname, 'challenges', CHALLENGE_ID, 'Script.s.sol');

    if (existsSync(overridePath))  jsSource  = readFileSync(overridePath, 'utf8');
    else if (existsSync(solveJsPath)) jsSource = readFileSync(solveJsPath, 'utf8');
    else if (existsSync(solPath))  forgePath = `challenges/${CHALLENGE_ID}/Script.s.sol`;
  }

  if (!jsSource && !forgePath) {
    console.error(`[error] No solve script found for: ${CHALLENGE_ID}`);
    process.exit(1);
  }

  const strategy = jsSource ? 'JS SDK' : `Forge (${forgePath})`;
  console.log(`Strategy: ${strategy}`);

  // Wait for idle
  process.stdout.write('[waiting for idle]');
  await waitIdle();
  console.log(' ready');

  // Start challenge
  console.log('[starting challenge]');
  await startChallenge();
  console.log('[running]');

  // Execute strategy
  const t0 = Date.now();
  let result;
  if (jsSource) {
    // WS-run then poll (WS may disconnect before challenge ends)
    const wsResult = runJs(jsSource);
    const pollP    = pollResult();
    result = await Promise.race([wsResult, pollP]);
  } else {
    result = await runForge(forgePath);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // Stop
  await post('/api/challenge/stop', {});

  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: ${result.toUpperCase()}  (${elapsed}s)`);
  console.log(`${'='.repeat(60)}\n`);

  process.exit(result === 'won' ? 0 : 1);
})().catch(e => { console.error('[fatal]', e); process.exit(1); });
