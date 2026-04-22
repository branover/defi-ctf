#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FOUNDRY_BIN="${FOUNDRY_BIN:-/home/kali/.foundry/bin}"
ANVIL_PORT="${ANVIL_PORT:-8545}"
ENGINE_PORT="${ENGINE_PORT:-3000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
LOG_DIR="$REPO_ROOT/.logs"
MNEMONIC="test test test test test test test test test test test junk"
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

mkdir -p "$LOG_DIR"

# Kill any stale processes from a previous run before starting fresh
"$REPO_ROOT/stop.sh" >/dev/null 2>&1 || true
rm -f "$REPO_ROOT/.pids"

# ──────────────────────────────────────────────────────────────────────────
echo "[1/6] Checking dependencies..."
"$FOUNDRY_BIN/anvil" --version >/dev/null 2>&1 || { echo "ERROR: anvil not found at $FOUNDRY_BIN/anvil"; exit 1; }
node --version >/dev/null 2>&1 || { echo "ERROR: node.js not found"; exit 1; }

# ──────────────────────────────────────────────────────────────────────────
echo "[2/6] Starting Anvil (deterministic chain)..."
# Start with auto-mining enabled for deployment; engine will disable it when challenge starts
"$FOUNDRY_BIN/anvil" \
  --port "$ANVIL_PORT" \
  --mnemonic "$MNEMONIC" \
  --accounts 20 \
  --chain-id 31337 \
  --block-base-fee-per-gas 0 \
  --gas-limit 30000000 \
  >"$LOG_DIR/anvil.log" 2>&1 &
ANVIL_PID=$!
echo "  Anvil PID: $ANVIL_PID"

# Wait for Anvil RPC
echo "  Waiting for Anvil..."
for i in $(seq 1 60); do
  if curl -sf -X POST "http://127.0.0.1:$ANVIL_PORT" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' >/dev/null 2>&1; then
    echo "  Anvil ready."
    break
  fi
  sleep 0.2
  if [ $i -eq 60 ]; then echo "ERROR: Anvil failed to start. Check $LOG_DIR/anvil.log"; kill $ANVIL_PID 2>/dev/null; exit 1; fi
done

# ──────────────────────────────────────────────────────────────────────────
echo "[3/6] Compiling contracts..."
cd "$REPO_ROOT/contracts"
"$FOUNDRY_BIN/forge" build --silent
echo "  Contracts compiled."

# ──────────────────────────────────────────────────────────────────────────
echo "[4/6] Deploying base contracts..."
DEPLOYER_PRIVATE_KEY="$DEPLOYER_KEY" "$FOUNDRY_BIN/forge" script script/Deploy.s.sol \
  --rpc-url "http://127.0.0.1:$ANVIL_PORT" \
  --broadcast \
  --private-key "$DEPLOYER_KEY" \
  --silent \
  2>&1 | grep -E "(===|deployed|WETH|USDC|Factory)" || true
echo "  Contracts deployed. Addresses: $REPO_ROOT/contracts/out/addresses.json"

echo "  Chain state committed (auto-mining active)."

# ──────────────────────────────────────────────────────────────────────────
echo "[5/6] Starting engine..."
cd "$REPO_ROOT/engine"
if [ ! -d node_modules ]; then
  echo "  Installing engine dependencies..."
  npm install --silent
fi
ANVIL_PORT="$ANVIL_PORT" ENGINE_PORT="$ENGINE_PORT" \
DEPLOYER_PRIVATE_KEY="$DEPLOYER_KEY" \
  npx tsx src/index.ts >"$LOG_DIR/engine.log" 2>&1 &
ENGINE_PID=$!
echo "  Engine PID: $ENGINE_PID"

# Wait for engine HTTP
for i in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:$ENGINE_PORT/health" >/dev/null 2>&1; then
    echo "  Engine ready."
    break
  fi
  sleep 0.3
  if [ $i -eq 50 ]; then
    echo "ERROR: Engine failed to start. Check $LOG_DIR/engine.log"
    kill $ANVIL_PID $ENGINE_PID 2>/dev/null
    exit 1
  fi
done

# ──────────────────────────────────────────────────────────────────────────
echo "[6/6] Starting frontend..."
cd "$REPO_ROOT/frontend"
if [ ! -d node_modules ]; then
  echo "  Installing frontend dependencies..."
  npm install --silent
fi
ANVIL_PORT="$ANVIL_PORT" ENGINE_PORT="$ENGINE_PORT" \
  npx vite --port "$FRONTEND_PORT" >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "  Frontend PID: $FRONTEND_PID"

# Save PIDs
echo "$ANVIL_PID $ENGINE_PID $FRONTEND_PID" >"$REPO_ROOT/.pids"

echo ""
echo "╔═════════════════════════════════════╗"
echo "║         defi-ctf running          ║"
echo "╠═════════════════════════════════════╣"
printf "║  %-6s  %-23s  ║\n" "Chain:" "http://localhost:$ANVIL_PORT"
printf "║  %-6s  %-23s  ║\n" "API:" "http://localhost:$ENGINE_PORT"
printf "║  %-6s  %-23s  ║\n" "UI:" "http://localhost:$FRONTEND_PORT"
echo "╠═════════════════════════════════════╣"
echo "║  Logs:    .logs/                  ║"
echo "║  Stop:    ./stop.sh               ║"
echo "╚═════════════════════════════════════╝"
echo ""

# Keep alive — if any process dies, stop everything
wait -n 2>/dev/null || true
echo "A process exited. Stopping all."
kill $ANVIL_PID $ENGINE_PID $FRONTEND_PID 2>/dev/null || true
rm -f "$REPO_ROOT/.pids"
