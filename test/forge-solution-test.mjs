/**
 * forge-solution-test.mjs
 *
 * Tests the WebSocket forge_script_run path for both challenge solutions.
 * For each test: starts the appropriate challenge via REST, then runs the
 * script via the WebSocket forge_script_run API.
 *
 * Usage:
 *   cd test && node forge-solution-test.mjs
 *
 * Prerequisites:
 *   - Engine running at http://localhost:3000 (REST + WS)
 */

import WebSocket from 'ws';

const ENGINE_WS   = process.env.ENGINE_WS  ?? 'ws://localhost:3000/ws';
const ENGINE_HTTP = process.env.ENGINE_HTTP ?? 'http://localhost:3000';
const TIMEOUT_MS  = 120_000; // 2 minutes per script

/** Start a challenge via REST and wait a bit for contracts to deploy. */
async function startChallenge(challengeId) {
  const res = await fetch(`${ENGINE_HTTP}/api/challenge/start`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ challengeId }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Failed to start ${challengeId}: ${JSON.stringify(body)}`);
  // Give the chain a few seconds to settle
  await new Promise((r) => setTimeout(r, 4_000));
}

/** Check challenge state via REST. */
async function getChallengeState() {
  const res = await fetch(`${ENGINE_HTTP}/api/challenge/state`);
  return res.json();
}

/**
 * Run a forge script over the WebSocket API.
 * Resolves with { success, exitCode, logs } or rejects on timeout.
 */
function runForgeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const ws   = new WebSocket(ENGINE_WS);
    const logs = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error(`Timeout after ${TIMEOUT_MS}ms waiting for forge_done`));
      }
    }, TIMEOUT_MS);

    ws.on('open', () => {
      console.log(`[WS] Connected. Sending forge_script_run: ${scriptPath}`);
      ws.send(JSON.stringify({
        type:    'forge_script_run',
        payload: { scriptPath },
      }));
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'forge_log') {
        const { stream, message } = msg.payload;
        const line = `[${stream}] ${message}`;
        logs.push(line);
        console.log(line);
      }

      if (msg.type === 'forge_done') {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          ws.close();
          resolve({ ...msg.payload, logs });
        }
      }
    });

    ws.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
    });

    ws.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('WebSocket closed before forge_done'));
      }
    });
  });
}

/** Single test: start challenge → run script → check state. */
async function runTest({ challengeId, scriptPath }) {
  console.log('\n' + '='.repeat(60));
  console.log(`Challenge: ${challengeId}`);
  console.log(`Script:    ${scriptPath}`);
  console.log('='.repeat(60));

  try {
    console.log(`[setup] Starting challenge: ${challengeId}`);
    await startChallenge(challengeId);

    const result = await runForgeScript(scriptPath);
    const pass = result.success;

    console.log(`\n[RESULT] ${pass ? 'PASS' : 'FAIL'} — exitCode=${result.exitCode}`);

    // Check win condition
    const state = await getChallengeState();
    console.log(`[state]  status=${state.status}, block=${state.currentBlock}/${state.totalBlocks}`);

    if (state.status === 'won') {
      console.log('[state]  WIN CONDITION ACHIEVED');
    } else {
      console.log(`[state]  Win condition NOT achieved (status=${state.status})`);
    }

    return pass && state.status === 'won';
  } catch (err) {
    console.error(`[ERROR]  ${err.message}`);
    return false;
  }
}

async function main() {
  const tests = [
    { challengeId: 'admin-who',       scriptPath: 'script/AdminWho.s.sol'  },
    { challengeId: 'spot-the-oracle', scriptPath: 'script/SpotOracle.s.sol' },
  ];

  const results = [];
  for (const t of tests) {
    results.push(await runTest(t));
  }

  console.log('\n' + '='.repeat(60));
  tests.forEach((t, i) => {
    console.log(`${results[i] ? 'PASS' : 'FAIL'}  ${t.challengeId} (${t.scriptPath})`);
  });
  const allPass = results.every(Boolean);
  console.log(`\nOverall: ${allPass ? 'ALL PASS' : 'SOME FAILED'}`);
  console.log('='.repeat(60));

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
