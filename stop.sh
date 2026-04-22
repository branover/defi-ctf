#!/usr/bin/env bash
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS_FILE="$REPO_ROOT/.pids"

if [ -f "$PIDS_FILE" ]; then
  read -r ANVIL_PID ENGINE_PID FRONTEND_PID < "$PIDS_FILE"
  echo "Stopping defi-ctf (PIDs: $ANVIL_PID $ENGINE_PID $FRONTEND_PID)..."
  kill "$ANVIL_PID" "$ENGINE_PID" "$FRONTEND_PID" 2>/dev/null || true
  rm -f "$PIDS_FILE"
else
  echo "No .pids file found. Killing by port..."
fi

# Always kill anything on defi-ctf ports to avoid stale processes
fuser -k 8545/tcp 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
# Kill all Vite dev servers (may have accumulated on 5173-5180 from prior runs)
for port in 5173 5174 5175 5176 5177 5178 5179 5180; do
  fuser -k ${port}/tcp 2>/dev/null || true
done
# Kill any remaining anvil or tsx processes from this project
pkill -f "anvil --port 8545" 2>/dev/null || true
pkill -f "defi-ctf/engine" 2>/dev/null || true
echo "Done."
