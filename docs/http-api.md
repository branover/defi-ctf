# HTTP API

Base URL: `http://localhost:3000/api`

All responses are JSON. Write endpoints accept `Content-Type: application/json`. CORS is open (`*`) for local development.

---

## `GET /health`

Liveness probe. Returns immediately.

```json
{ "ok": true }
```

---

## `GET /api/challenges`

List all loaded challenges with their metadata.

**Response**

```json
[
  {
    "id":           "wave-rider",
    "name":         "Riding the Wave",
    "description":  "A chaotic market...",
    "blockCount":   500,
    "target":       "15",
    "startingValue": "10",
    "metric":       "ethBalance"
  },
  {
    "id":           "the-spread",
    "name":         "The Spread",
    "description":  "Two WETH/USDC pools have diverged...",
    "blockCount":   300,
    "target":       "12",
    "startingValue": "10",
    "metric":       "ethBalance"
  }
]
```

**Fields**

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique challenge identifier, used in all API calls |
| `name` | string | Display name |
| `description` | string | Full flavour text |
| `category` | string \| null | `"trading-strategy"` \| `"market-manipulation"` \| `"defi-exploit"` \| `null` |
| `difficulty` | string \| null | `"easy"` \| `"medium"` \| `"hard"` \| `"expert"` \| `null` |
| `tags` | string[] | Searchable tags (may be empty) |
| `blockCount` | number | Total blocks before time expires |
| `target` | string | Win target value (ETH or token units, decimal string) |
| `startingValue` | string | Starting value for profit calculation |
| `metric` | string | `"ethBalance"` \| `"tokenBalance"` \| `"portfolioValueInEth"` \| `"usdBalance"` \| `"nftSalesProfit"` \| `"drainContract"` |

---

## `GET /api/challenge/state`

Current state of the running (or last-run) challenge.

**Response**

```json
{
  "id":            "wave-rider",
  "status":        "running",
  "currentBlock":  142,
  "totalBlocks":   500,
  "playerBalance": "2300000000000000000",
  "targetBalance": "5000000000000000000",
  "metric":        "ethBalance"
}
```

**Status values**

| Value | Meaning |
|---|---|
| `idle` | No challenge loaded |
| `running` | Mining blocks, bots active |
| `paused` | Mining halted, state preserved |
| `won` | Player met the win condition |
| `lost` | Block limit reached without winning |
| `complete` | Synonym for won/lost (post-game) |

**Balance fields** (`playerBalance`, `targetBalance`) are *profit-relative* wei strings — zero at challenge start regardless of the account's actual ETH balance. `playerBalance` grows as the player earns profit; `targetBalance` is fixed at `(target − startingValue)` in wei.

---

## `POST /api/challenge/start`

Start a challenge. Reverts chain state to a clean snapshot, mints tokens, seeds pools, and begins block mining.

**Body**

```json
{ "challengeId": "wave-rider" }
```

**Response** (success)

```json
{ "ok": true }
```

**Errors**

| Status | Condition |
|---|---|
| 400 | `challengeId` missing from body |
| 404 | Challenge ID not found |
| 409 | Another start is already in progress (concurrent start rejected) |
| 500 | Engine error (check engine stdout) |

---

## `POST /api/challenge/stop`

Stop the running challenge. Mining halts, bots clear, triggers clear. Chain state is preserved until the next `start`.

**Body** — none required

**Response**

```json
{ "ok": true }
```

---

## `POST /api/control`

Simulation control. Actions take effect immediately.

**Body**

| Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | yes | `"pause"` \| `"resume"` \| `"fast_forward"` |
| `blocks` | number | only for `fast_forward` | Number of blocks to mine instantly (default: 10) |

> **Speed control is WebSocket-only.** Use the `set_speed` action via the WS `control` message to change simulation speed.

**Examples**

```bash
# Pause
curl -X POST http://localhost:3000/api/control \
  -H "Content-Type: application/json" \
  -d '{"action":"pause"}'

# Fast-forward 50 blocks
curl -X POST http://localhost:3000/api/control \
  -H "Content-Type: application/json" \
  -d '{"action":"fast_forward","blocks":50}'
```

**Response**

```json
{ "ok": true }
```

**Errors**

| Status | Condition |
|---|---|
| 400 | Unknown `action` value |

---

## `GET /api/history/:poolId`

OHLCV candle history for a pool, ordered oldest-first.

**Path param** — `poolId`: pool ID (e.g. `weth-usdc-uniswap`, `weth-usdc-uniswap`)

**Query params**

| Param | Type | Default | Description |
|---|---|---|---|
| `lastN` | number | 200 | Return only the most recent N candles |

**Example**

```bash
curl "http://localhost:3000/api/history/weth-usdc-uniswap?lastN=50"
```

**Response**

```json
[
  {
    "time":   1713600000,
    "open":   3012.5,
    "high":   3045.2,
    "low":    2998.1,
    "close":  3031.7,
    "volume": 14.2
  }
]
```

**Fields**

| Field | Description |
|---|---|
| `time` | Candle open Unix timestamp (seconds). Derived from `blockNumber × 12 × blocksPerCandle` |
| `open` / `high` / `low` / `close` | Token1-per-token0 price (e.g. USDC per WETH). Human-readable float |
| `volume` | Cumulative token0 units swapped during the candle period |

Candle width (`blocksPerCandle`) is set per-challenge in the manifest. Default is 10 blocks.

---

## `GET /api/triggers`

List all registered triggers across all WebSocket sessions.

**Response**

```json
[
  {
    "id":        "trig_3",
    "type":      "onPriceBelow",
    "poolId":    "weth-usdc-uniswap",
    "pair":      "weth-usdc-uniswap",
    "threshold": 2900,
    "active":    true
  },
  {
    "id":     "trig_1",
    "type":   "onBlock",
    "active": true
  }
]
```

**Fields**

| Field | Description |
|---|---|
| `id` | Stable trigger ID for the session lifetime |
| `type` | `"onBlock"` \| `"onPriceBelow"` \| `"onPriceAbove"` |
| `poolId` | Pool ID (price triggers only) — e.g. `"weth-usdc-uniswap"` |
| `pair` | Alias for `poolId` (backward-compatibility alias; prefer `poolId`) |
| `threshold` | Price threshold (price triggers only) |
| `active` | `false` if the trigger was deactivated (e.g. `once: true` fired) |

---

## `GET /api/connection_info`

Returns everything a Foundry/cast workflow needs in a single call: RPC URL, chain ID, player wallet, deployed contracts, tokens, and pool details.

**Response**

```json
{
  "rpcUrl":  "http://127.0.0.1:8545",
  "chainId": 31337,
  "player": {
    "address":    "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "privateKey": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  },
  "contracts": {
    "vault": "0x5FbDB2315678afecb367f032d93F642f64180aa3"
  },
  "tokens": {
    "WETH": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    "USDC": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
  },
  "pools": {
    "weth-usdc-uniswap": {
      "address":     "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
      "exchange":    "uniswap",
      "displayName": "Uniswap",
      "tokenA":      "WETH",
      "tokenB":      "USDC"
    }
  }
}
```

`contracts` and `tokens` are only populated while a challenge is running (both default to `{}`). `pools` is empty `{}` when no challenge is running.

`botAccounts` is present only when the running challenge has `botPositions` (leveraged challenges). It maps bot account index (string) to address.

```json
"botAccounts": { "1": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }
```

This endpoint powers `solve/env.sh` — see [`foundry-workflow.md`](foundry-workflow.md).

---

## `GET /api/challenge/:id/readme`

Raw markdown text of the challenge's `README.md` file, if one exists.

**Path param** — `id`: challenge ID (e.g. `leaky-vault`)

**Response** — `text/plain` markdown string.

**Errors**

| Status | Condition |
|---|---|
| 404 | Challenge not found, or no README for this challenge |

---

## `GET /api/challenge/:id/template`

Returns the JavaScript solve template for a challenge (`solve/challenges/<id>/solve.js` if it exists, else `solve/script/solve.js`). Used by the IDE to seed a new player solution file on first visit.

**Response** — `text/plain` JS source.

---

## `GET /api/challenge/:id/solidity-template`

Returns the Solidity solve template for a challenge (`solve/challenges/<id>/Script.s.sol` if non-empty, else `solve/script/Solve.s.sol`). Used by the IDE to seed the Solidity workspace on first visit.

**Response** — `text/plain` Solidity source.

---

## `GET /api/challenge/:id/files`

File tree of the challenge's solution directory (used by the in-browser IDE).

**Path param** — `id`: challenge ID

**Response** — recursive file tree object.

---

## `GET /api/challenge/:id/file`

Get the content of a single file in the challenge's solution directory.

**Path param** — `id`: challenge ID  
**Query param** — `path`: relative path within the solution directory (required)

**Response** — `text/plain` file content.

**Errors**

| Status | Condition |
|---|---|
| 400 | `path` not provided, or path traversal attempt |
| 404 | Challenge not found, or file not found |

---

## `POST /api/challenge/:id/file`

Create or overwrite a file in the challenge's solution directory (IDE save).

**Path param** — `id`: challenge ID  
**Body** — `{ "path": "src/Attacker.sol", "content": "..." }`

**Response** — `{ "ok": true }`

---

## `DELETE /api/challenge/:id/file`

Delete a file or directory in the challenge's solution directory.

**Path param** — `id`: challenge ID  
**Query param** — `path`: relative path (required)

**Response** — `{ "ok": true }`

---

## `GET /api/env`

Run `solve/env.sh` and return the resulting `.env` file contents as both a raw string and a parsed key→value map. Use this to check which addresses are currently exported or to refresh the env after a challenge restart.

**Response** (success)

```json
{ "ok": true, "vars": { "RPC_URL": "http://127.0.0.1:8545", "ADDR_VAULT": "0x..." }, "raw": "RPC_URL=...\n" }
```

**Response** (failure — no challenge running or env.sh not available)

```json
{ "ok": false, "error": "env.sh failed: ...", "vars": {}, "raw": "" }
```

---

## `GET /api/blocks`

Block explorer — returns full block data including transactions with decoded calldata.

**Query params**

| Param | Type | Default | Description |
|---|---|---|---|
| `from` | number | 0 | Starting block number. `0` or missing → most recent `limit` blocks |
| `limit` | number | 50 | Number of blocks to return (max 100) |

**Response**

```json
{
  "blocks": [
    {
      "number": 42,
      "timestamp": 1713600000,
      "hash": "0x...",
      "transactions": [
        {
          "hash": "0x...",
          "from": "0x...",
          "to": "0x...",
          "value": "0",
          "input": "0x...",
          "gasUsed": "21000",
          "blockNumber": 42,
          "decoded": { "fn": "swapExactIn", "args": [...] }
        }
      ]
    }
  ]
}
```

`decoded` is present when the calldata selector is known; `null` otherwise.

---

## `GET /api/solve/files`

File tree of the per-challenge solve directory (`.sol` files only, including `lib/`).

**Query param** — `challenge`: challenge ID (required)

**Response** — recursive file tree with `readOnly: true` on `lib/` entries.

---

## `GET /api/solve/file`

Get the content of a single `.sol` file in the per-challenge solve directory.

**Query params** — `challenge`: challenge ID (required), `path`: relative path (required)

**Response** — `text/plain` file content.

---

## `POST /api/solve/file`

Create or overwrite a `.sol` file in the per-challenge solve directory. `lib/` files are read-only and will return 403.

**Body** — `{ "challenge": "leaky-vault", "path": "Script.s.sol", "content": "..." }`

**Response** — `{ "ok": true }`

---

## `DELETE /api/solve/file`

Delete a `.sol` file or directory in the per-challenge solve directory. `lib/` entries are read-only.

**Query params** — `challenge`: challenge ID (required), `path`: relative path (required)

**Response** — `{ "ok": true }`

---

## `GET /api/nft/:contractId/listings`

Active NFT listings with rarity scores for a marketplace contract.

**Path param** — `contractId`: contract ID of an NFTMarketplace (from the challenge manifest)

**Response**

```json
[
  {
    "tokenId":     "42",
    "seller":      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "price":       "0.5",
    "rarityScore": 87
  }
]
```

`rarityScore` is 0 if the collection has not yet been revealed.

---

## `GET /api/nft/:contractId/owned`

NFTs owned by a given address.

**Path param** — `contractId`: NFTMarketplace contract ID  
**Query param** — `address`: wallet address (required)

**Response**

```json
[
  { "tokenId": "7", "rarityScore": 55 }
]
```

---

## `GET /api/nft/:contractId/floor`

Current floor price of the marketplace (cheapest active listing).

**Path param** — `contractId`: NFTMarketplace contract ID

**Response** — `null` if no active listings, otherwise:

```json
{
  "floorPrice": "0.35",
  "tokenId":    "12"
}
```

---

## `GET /api/nft/:contractId/sales`

All `Sold` events from the marketplace contract on the current chain (player and bot trades), newest first. Each entry includes `sellerLabel` / `buyerLabel` from the challenge address book when known.

**Response** — `[]` when idle or the contract is not deployed; otherwise an array of objects with `tokenId`, `price`, `seller`, `buyer`, `sellerLabel`, `buyerLabel`, `txHash`, `blockNumber`, `timestamp` (ms).

---

## `GET /api/pools`

Depth and reserve data for all currently-deployed pools. Only returns data while a challenge is running (returns `[]` when idle).

**Response**

```json
[
  {
    "id":        "weth-usdc-uniswap",
    "symbol0":   "WETH",
    "symbol1":   "USDC",
    "decimals0": 18,
    "decimals1": 6,
    "spotPrice": 3024.88,
    "tvlEst":    6049760.0,
    "reserve0":  "2001500000000000000000",
    "reserve1":  "6049760000000",
    "depth": {
      "spotPrice": 3024.88,
      "tvlUSD":    6049760.0,
      "ask": [
        { "bps": 10,   "token0Delta": "667000000000000000",   "usdApprox": 2016.0 },
        { "bps": 50,   "token0Delta": "3335000000000000000",  "usdApprox": 10080.0 },
        { "bps": 100,  "token0Delta": "6670000000000000000",  "usdApprox": 20160.0 },
        { "bps": 500,  "token0Delta": "33350000000000000000", "usdApprox": 100800.0 },
        { "bps": 1000, "token0Delta": "66700000000000000000", "usdApprox": 201600.0 }
      ],
      "bid": [...]
    }
  }
]
```

**Fields**

| Field | Description |
|---|---|
| `id` | Pool ID |
| `symbol0` / `symbol1` | Token symbols (address-sorted) |
| `decimals0` / `decimals1` | Token decimal places |
| `exchange` | Exchange slug (e.g. `"uniswap"`, `"sushiswap"`) |
| `displayName` | Human-readable exchange name (e.g. `"Uniswap"`) |
| `spotPrice` | Current token1/token0 price (human units) |
| `tvlEst` | Approximate TVL in token1 units (2 × reserve1 human) |
| `reserve0` / `reserve1` | Raw reserve uint256 strings |
| `depth.ask` | Cost to push price UP: `bps` bands at 10, 50, 100, 500, 1000 |
| `depth.bid` | Cost to push price DOWN at same bands |
| `depth.ask[].token0Delta` | Token0 raw units needed to move price by `bps` |
| `depth.ask[].usdApprox` | Approximate USD cost at current price |
