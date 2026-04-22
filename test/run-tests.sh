#!/usr/bin/env bash
# defi-ctf test runner
#
# Usage:
#   ./test/run-tests.sh                   # API regression tests only
#   ./test/run-tests.sh --ui              # + Playwright UI tests (headless)
#   ./test/run-tests.sh --only-ui         # only Playwright UI tests
#   ./test/run-tests.sh --no-start        # skip platform start (already running)
#   ./test/run-tests.sh --verbose         # verbose regression output
#   ./test/run-tests.sh --ui --headed     # Playwright in headed mode (debug)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERBOSE=""
NO_START=0
RUN_UI=0
ONLY_UI=0
HEADED=""

for arg in "$@"; do
  case "$arg" in
    --verbose)   VERBOSE="--verbose" ;;
    --no-start)  NO_START=1 ;;
    --ui)        RUN_UI=1 ;;
    --only-ui)   ONLY_UI=1; NO_START=1 ;;
    --headed)    HEADED="--headed" ;;
  esac
done

# ── Install test dependencies if needed ────────────────────────────────────────
cd "$REPO_ROOT/test"
if [ ! -d node_modules ]; then
  echo "[test] Installing test dependencies..."
  npm install --silent
fi
cd "$REPO_ROOT"

# ── Start platform if needed ──────────────────────────────────────────────────
if [ "$NO_START" -eq 0 ]; then
  echo "[test] Starting platform..."
  "$REPO_ROOT/stop.sh" >/dev/null 2>&1 || true

  "$REPO_ROOT/start.sh" >"$REPO_ROOT/.logs/test-start.log" 2>&1 &
  START_PID=$!

  echo "[test] Waiting for engine..."
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:3000/health" >/dev/null 2>&1; then
      echo "[test] Engine ready."
      break
    fi
    sleep 1
    if [ "$i" -eq 60 ]; then
      echo "ERROR: engine did not start in 60s. See .logs/test-start.log"
      kill $START_PID 2>/dev/null || true
      exit 1
    fi
  done
  sleep 1  # brief settle time for WS subscriptions
fi

EXIT_CODE=0

# ── Regression tests (API + WS) ───────────────────────────────────────────────
if [ "$ONLY_UI" -eq 0 ]; then
  echo ""
  echo "[test] Running API/WS regression suite..."
  cd "$REPO_ROOT"
  node test/regression.mjs $VERBOSE || EXIT_CODE=$?

  echo ""
  echo "[test] Engine unit tests (Vitest)..."
  cd "$REPO_ROOT/engine"
  if [ ! -d node_modules ]; then
    echo "[test] Installing engine dependencies..."
    npm install --silent
  fi
  npm test || EXIT_CODE=$?
  cd "$REPO_ROOT"

  echo ""
  echo "[test] Frontend unit tests (Vitest)..."
  cd "$REPO_ROOT/frontend"
  if [ ! -d node_modules ]; then
    echo "[test] Installing frontend dependencies..."
    npm install --silent
  fi
  npm test || EXIT_CODE=$?
  cd "$REPO_ROOT"
fi

# ── Playwright UI tests ───────────────────────────────────────────────────────
if [ "$RUN_UI" -eq 1 ] || [ "$ONLY_UI" -eq 1 ]; then
  echo ""
  echo "[test] Running Playwright UI tests..."
  cd "$REPO_ROOT/test"
  echo "[test] Ensuring Playwright Chromium is installed..."
  npx playwright install chromium
  npx playwright test $HEADED \
    --reporter=list \
    || EXIT_CODE=$?

  # Print report path on failure for easy access
  if [ $EXIT_CODE -ne 0 ]; then
    echo ""
    echo "[test] HTML report: $REPO_ROOT/.test-results/html/index.html"
  fi
  cd "$REPO_ROOT"
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
if [ "$NO_START" -eq 0 ]; then
  echo ""
  echo "[test] Stopping platform..."
  "$REPO_ROOT/stop.sh" >/dev/null 2>&1 || true
fi

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "All tests passed."
else
  echo "Tests FAILED (exit $EXIT_CODE)."
fi

exit $EXIT_CODE
