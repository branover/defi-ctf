# Test Suite

## Prerequisites

The engine must be running before executing any tests:

```bash
./start.sh
```

Tests connect to `http://localhost:3000` by default. Override with:

```bash
ENGINE_URL=http://localhost:3000 WS_URL=ws://localhost:3000/ws node test/regression.mjs
```

## Running Tests

**Full regression suite** (architecture + API + solution runs):
```bash
node test/regression.mjs
node test/regression.mjs --verbose   # show full error traces
```

**Single challenge** (from `solve/` directory):
```bash
cd solve
node run-challenge.mjs <challengeId>
node run-challenge.mjs <challengeId> --override path/to/custom.js
node run-challenge.mjs <challengeId> --forge path/to/Script.s.sol
```

**Playwright UI tests** (requires engine running + browser):
```bash
npx playwright test
```

## Solution Files

Solution scripts live in `challenges/<id>/solution/solution.js` and are **gitignored** — they exist only on local development machines. The regression suite skips challenges that have no local solution file and logs them as informational.

To run solution regression tests, you need a local copy of the solutions (not distributed with the repo).

## Test Structure

| File | Purpose |
|------|---------|
| `regression.mjs` | HTTP + WS API health checks, solution smoke tests |
| `run-challenge.mjs` (in `solve/`) | Single-challenge automated runner |
| `playwright/` | Browser-based UI tests |

## Exit Codes

`run-challenge.mjs`: `0` = WON, `1` = LOST / timeout / error
