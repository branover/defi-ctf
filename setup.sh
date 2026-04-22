#!/usr/bin/env bash
# setup.sh — One-shot dependency installer for defi-ctf
#
# Installs: Node.js 20, Foundry (forge + anvil), all npm packages,
#           Playwright Chromium browser.
#
# Supported OS: Debian / Ubuntu / Kali Linux
# Run once after cloning; re-run any time to update/repair dependencies.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$REPO_ROOT/.logs"
mkdir -p "$LOG_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${GREEN}[setup]${NC} $*"; }
warn()    { echo -e "${YELLOW}[setup]${NC} $*"; }
error()   { echo -e "${RED}[setup] ERROR:${NC} $*" >&2; }
step()    { echo -e "\n${GREEN}━━ $* ━━${NC}"; }

# ── OS detection ───────────────────────────────────────────────────────────────
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_LIKE="${ID_LIKE:-}"
else
  OS_ID="unknown"
fi

is_debian_like() {
  [[ "$OS_ID" == "debian" || "$OS_ID" == "ubuntu" || "$OS_ID" == "kali" || \
     "$OS_LIKE" == *"debian"* || "$OS_LIKE" == *"ubuntu"* ]]
}

# ── Step 1: Node.js 20 ────────────────────────────────────────────────────────
step "Node.js 20"

NEED_NODE=1
if command -v node &>/dev/null; then
  NODE_VER=$(node --version 2>/dev/null || echo "v0")
  MAJOR=${NODE_VER//[^0-9.]*/}; MAJOR=${MAJOR%%.*}
  if [ "${MAJOR:-0}" -ge 20 ]; then
    info "Node.js $NODE_VER already installed."
    NEED_NODE=0
  else
    warn "Found Node.js $NODE_VER — need v20+. Upgrading..."
  fi
fi

if [ "$NEED_NODE" -eq 1 ]; then
  if is_debian_like && command -v apt-get &>/dev/null; then
    info "Installing Node.js 20 via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1 | tail -5
    sudo apt-get install -y nodejs 2>&1 | tail -5
  elif command -v nvm &>/dev/null; then
    info "Installing Node.js 20 via nvm..."
    nvm install 20 && nvm use 20
  else
    error "Cannot install Node.js automatically on this OS."
    error "Please install Node.js 20+ from https://nodejs.org/ then re-run setup.sh"
    exit 1
  fi
  info "Node.js $(node --version) installed."
fi

# ── Step 2: Foundry (forge + anvil + cast) ────────────────────────────────────
step "Foundry"

FOUNDRY_DIR="${FOUNDRY_DIR:-$HOME/.foundry}"
FOUNDRY_BIN="$FOUNDRY_DIR/bin"

if command -v forge &>/dev/null || [ -x "$FOUNDRY_BIN/forge" ]; then
  FORGE_VER=$("$FOUNDRY_BIN/forge" --version 2>/dev/null || forge --version 2>/dev/null || echo "unknown")
  info "Foundry already installed: $FORGE_VER"
  # Always run foundryup to ensure it's up to date
  info "Updating Foundry..."
  export PATH="$FOUNDRY_BIN:$PATH"
  "$FOUNDRY_BIN/foundryup" 2>&1 | tail -3 || true
else
  info "Installing Foundry..."
  curl -L https://foundry.paradigm.xyz | bash 2>&1 | tail -10
  export PATH="$FOUNDRY_BIN:$PATH"
  foundryup 2>&1 | tail -10
  info "Foundry installed: $(forge --version)"
fi

# Verify
if ! command -v forge &>/dev/null && ! [ -x "$FOUNDRY_BIN/forge" ]; then
  error "Foundry installation failed. Check $LOG_DIR for details."
  error "Manual install: https://getfoundry.sh/"
  exit 1
fi

# Add Foundry to PATH for remaining steps (shell profile updated by foundryup)
export PATH="$FOUNDRY_BIN:$PATH"

# ── Step 3: Engine npm dependencies ──────────────────────────────────────────
step "Engine dependencies"
cd "$REPO_ROOT/engine"
info "npm ci in engine/..."
npm ci --silent
info "Engine dependencies installed."

# ── Step 4: Frontend npm dependencies ─────────────────────────────────────────
step "Frontend dependencies"
cd "$REPO_ROOT/frontend"
info "npm ci in frontend/..."
npm ci --silent
info "Frontend dependencies installed."

# ── Step 5: Test dependencies + Playwright ────────────────────────────────────
step "Test dependencies"
cd "$REPO_ROOT/test"
info "npm install in test/..."
npm install --silent

info "Installing Playwright Chromium browser..."
npx playwright install chromium --with-deps 2>&1 | tail -5
info "Playwright Chromium installed."

# ── Step 6: Compile contracts ─────────────────────────────────────────────────
step "Contracts"
cd "$REPO_ROOT/contracts"
info "forge build..."
"$FOUNDRY_BIN/forge" build --silent
info "Contracts compiled. Artifacts in contracts/out/"

# ── Step 7: Verify frontend TypeScript build ──────────────────────────────────
step "TypeScript / build verification"

info "Checking engine TypeScript..."
cd "$REPO_ROOT/engine"
npx tsc --noEmit && info "Engine TypeScript: OK" || {
  error "Engine TypeScript errors found. Run: cd engine && npx tsc --noEmit"
  exit 1
}

info "Building frontend..."
cd "$REPO_ROOT/frontend"
npm run build --silent && info "Frontend build: OK" || {
  error "Frontend build failed. Run: cd frontend && npm run build"
  exit 1
}

# ── Done ───────────────────────────────────────────────────────────────────────
cd "$REPO_ROOT"
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   defi-ctf setup complete            ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Start:    ./start.sh                ║${NC}"
echo -e "${GREEN}║  Tests:    ./test/run-tests.sh       ║${NC}"
echo -e "${GREEN}║  UI tests: ./test/run-tests.sh --ui  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""
warn "If this is your first shell session after installing Foundry, run:"
echo "  source ~/.bashrc   (or open a new terminal)"
echo ""
