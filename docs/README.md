# DeFi CTF — Documentation

A local Ethereum simulation platform for DeFi trading challenges. The engine runs an Anvil chain with bots, pools, and a block-by-block tick loop. Players interact through the browser frontend or by scripting strategies directly via the WebSocket SDK.

---

## Contents

| Document | What it covers |
|---|---|
| [http-api.md](http-api.md) | REST endpoints — challenge control, history, triggers, pool depth, NFT, solve workspace |
| [websocket-api.md](websocket-api.md) | WebSocket protocol — real-time messages in both directions, forge/NFT messages |
| [script-sdk.md](script-sdk.md) | Script Sandbox SDK — all globals available inside player scripts |
| [smart-contracts.md](smart-contracts.md) | On-chain contracts — ABIs, custom contract deployment, exploit patterns |
| [challenges.md](challenges.md) | Creating challenges — manifest schema, win conditions, pools, tokens, NFT/leverage fields |
| [bots.md](bots.md) | Bot personalities — how each one works, all params, writing custom bots |
| [examples.md](examples.md) | Full worked examples — trading strategies, arbitrage, frontrunning, exploits |
| [foundry-workflow.md](foundry-workflow.md) | Foundry/cast workflow — forge script, deploy, env.sh setup, in-browser Solidity IDE |

---

## Quick orientation

```
engine/          Node.js simulation engine
  src/
    api/         HTTP server (Express)
    ws/          WebSocket server
    chain/       Anvil client + mining controller
    player/      Script sandbox + player session
    market/      Pool registry, candle builder, AMM math
    bots/        Bot scheduler + 12 personalities
    triggers/    Trigger registry + engine
    challenge/   Challenge loader, runner, win checker

contracts/       Solidity (Forge project)
  src/
    amm/         ConstantProductAMM, AMMFactory
    tokens/      WETH, MockERC20
    infra/       FlashLoanProvider, LendingProtocol, VolumeCompetition, …
    hacks/       VulnerableVault, UnprotectedOwnership, ReentrancyAttacker, …
  script/        Deploy.s.sol

challenges/      One directory per challenge, each with manifest.json + README.md
solve/           Foundry workspace for player exploit scripts + in-browser IDE source
  challenges/    Per-challenge subdirectories (seeded on first IDE access)
docs/            ← you are here
```

---

## Base URLs (all local)

| Interface | Address |
|---|---|
| HTTP API | `http://localhost:3000/api` |
| WebSocket | `ws://localhost:3000/ws` |
| Anvil RPC | `http://localhost:8545` |
| Frontend | `http://localhost:5173` |

---

## Player account

The engine uses the standard Hardhat/Anvil mnemonic: `test test test test test test test test test test test junk`

Player wallet (account 0): `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`  
Private key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`

Bot wallets start at account 1. See [challenges.md](challenges.md) for the full account table.
