# ─────────────────────────────────────────────────────────────────────────────
# defi-ctf — multi-stage Dockerfile
#
# Targets:
#   platform  (default) — all-in-one: Anvil + Engine + Frontend
#   test                — platform + Playwright Chromium for UI tests
#
# Build:
#   docker build --target platform -t defi-ctf .
#   docker build --target test     -t defi-ctf-test .
#
# Run:
#   docker run -p 3000:3000 -p 5173:5173 -p 8545:8545 defi-ctf
# ─────────────────────────────────────────────────────────────────────────────

# ── Base: Node 20 on Debian Bookworm ──────────────────────────────────────────
FROM node:20-bookworm-slim AS base

# System utilities needed by Foundry installer and stop.sh (fuser)
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash curl git ca-certificates psmisc procps \
    && rm -rf /var/lib/apt/lists/*

# Install Foundry (forge + anvil + cast + chisel)
ENV FOUNDRY_DIR=/root/.foundry
ENV FOUNDRY_BIN=/root/.foundry/bin
ENV PATH="$FOUNDRY_BIN:$PATH"

RUN curl -L https://foundry.paradigm.xyz | bash 2>&1 \
    && foundryup 2>&1 \
    && forge --version && anvil --version

# ── Dependency layer (cached unless package-lock changes) ─────────────────────
FROM base AS deps

WORKDIR /app

COPY engine/package.json engine/package-lock.json engine/
RUN cd engine && npm ci --silent

COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci --silent

# ── Build layer ───────────────────────────────────────────────────────────────
FROM deps AS build

# Copy full source
COPY . .

# Vendored forge-std may be missing (sparse checkout, export tarballs, etc.).
# Install it when absent so `forge build` always has imports.
RUN cd contracts && \
    if [ ! -f lib/forge-std/src/Script.sol ]; then \
      forge install --no-git foundry-rs/forge-std@v1.15.0; \
    fi

# Pre-compile Solidity contracts (does not need a running chain)
RUN cd contracts && forge build --silent

# Verify TypeScript and build frontend (catches errors at image build time)
RUN cd engine   && npx tsc --noEmit
RUN cd frontend && npm run build --silent

# ── Platform target ───────────────────────────────────────────────────────────
FROM build AS platform

# Override FOUNDRY_BIN so start.sh's default path check works
ENV FOUNDRY_BIN=/root/.foundry/bin

EXPOSE 3000 5173 8545

HEALTHCHECK --interval=5s --timeout=3s --retries=30 --start-period=60s \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["./start.sh"]

# ── Test target ───────────────────────────────────────────────────────────────
FROM platform AS test

WORKDIR /app

# Additional Playwright system dependencies + Chromium
COPY test/package.json test/package-lock.json* test/
RUN cd test && npm install --silent \
    && npx playwright install chromium --with-deps 2>&1 | tail -10

# Default: run all tests against the platform running in this same container.
# Override ENGINE_URL / WS_URL / FRONTEND_URL to point at a different host.
ENV ENGINE_URL=http://localhost:3000
ENV WS_URL=ws://localhost:3000/ws
ENV FRONTEND_URL=http://localhost:5173

# The test entrypoint starts the platform first (--no-start skips that)
CMD ["./test/run-tests.sh", "--ui"]
