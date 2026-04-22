# WebSocket API

Endpoint: `ws://localhost:3000/ws`

Each connection gets an isolated **player session** with its own signer wallet, trigger set, and log buffer (up to 200 entries). All messages — both directions — use the same envelope:

```json
{ "type": "<message_type>", "payload": { ... } }
```

The server sends several messages automatically on connect: the current challenge state (`challenge`) and the full challenge catalogue (`challenges`).

---

## Client → Server messages

### `ping`

Heartbeat. Use to keep the connection alive or measure round-trip latency.

```json
{ "type": "ping", "payload": {} }
```

Response: [`pong`](#pong)

---

### `challenge_start`

Start a challenge. Equivalent to `POST /api/challenge/start` but over WS, so you receive live broadcast updates.

```json
{
  "type": "challenge_start",
  "payload": { "challengeId": "wave-rider" }
}
```

On success, all clients receive a [`challenge`](#challenge) broadcast with `status: "running"`.  
On error, the sending client receives an [`error`](#error) message.

---

### `challenge_stop`

Stop the running challenge. Clears bots and all triggers.

```json
{ "type": "challenge_stop", "payload": {} }
```

---

### `control`

Simulation control — pause/resume/speed/fast-forward.

```json
{ "type": "control", "payload": { "action": "pause" } }
{ "type": "control", "payload": { "action": "resume" } }
{ "type": "control", "payload": { "action": "fast_forward", "blocks": 20 } }
{ "type": "control", "payload": { "action": "set_speed", "speed": 3 } }
```

| `action` | Extra field | Effect |
|---|---|---|
| `pause` | — | Halt block mining; bots and triggers frozen |
| `resume` | — | Resume mining from where it stopped |
| `fast_forward` | `blocks` (default 10) | Mine N blocks instantly, then resume previous state |
| `set_speed` | `speed` 1–10 | Multiply mining rate (shorter delay between mined blocks vs `blockIntervalMs`) |

After any `control` action, the server echoes a [`speed`](#speed) message back to the sender. The server also sends `speed` on WebSocket connect and broadcasts it to all clients after a successful `challenge_start` so the UI matches the persisted multiplier.

---

### `script_run`

Execute a JavaScript strategy script inside the player sandbox. The script runs once synchronously (5-second timeout); any triggers it registers persist across blocks until `script_stop` or the next `script_run`.

Running a new script automatically clears the previous one's triggers first.

```json
{
  "type": "script_run",
  "payload": {
    "source": "onBlock(async (ctx) => { ctx.log(`block ${ctx.blockNumber}`); });"
  }
}
```

After execution the server sends:
- [`script_log`](#script_log) — `"Script loaded. N trigger(s) registered."`
- [`triggers`](#triggers) — updated trigger list for this session

---

### `script_stop`

Clear all triggers registered by this session. Does not affect other sessions.

```json
{ "type": "script_stop", "payload": {} }
```

Response: [`triggers`](#triggers) with empty list.

---

### `trigger_remove`

Remove a single trigger by ID.

```json
{ "type": "trigger_remove", "payload": { "triggerId": "trig_3" } }
```

Response: [`triggers`](#triggers) with the trigger removed.

---

### `get_challenges`

Re-request the full challenge catalogue. Also sent automatically on connect.

```json
{ "type": "get_challenges", "payload": {} }
```

Response: [`challenges`](#challenges)

---

### `subscribe_pair`

Hint to the server that you're interested in a specific pair. Currently a no-op (all price and candle broadcasts are sent to all clients), but reserved for future per-client filtering.

```json
{ "type": "subscribe_pair", "payload": { "pair": "weth-usdc-uniswap" } }
```

---

### `get_history`

Request historical candle data for a pair. Currently a no-op over WebSocket — candle history is served via `GET /api/history/:poolId` instead.

```json
{ "type": "get_history", "payload": { "pair": "weth-usdc-uniswap", "lastN": 50 } }
```

---

### `get_blocks`

Request block and transaction data. Equivalent to `GET /api/blocks` but over WebSocket.

```json
{ "type": "get_blocks", "payload": { "from": 0, "limit": 20 } }
```

`from`: starting block (`0` or missing → most recent `limit` blocks). `limit`: max blocks (capped at 100).

**Response:** [`blocks_result`](#blocks_result)

---

### `forge_script_run`

Run a Forge script from the `solve/` workspace through the in-browser Solidity IDE. The engine invokes `forge script` with the player's private key and RPC URL pre-filled.

```json
{
  "type": "forge_script_run",
  "payload": { "scriptPath": "script/Solve.s.sol" }
}
```

The server responds with a stream of [`forge_log`](#forge_log) messages and a final [`forge_done`](#forge_done).

---

### `forge_deploy`

Compile and deploy a single Solidity contract from the `solve/` workspace.

```json
{
  "type": "forge_deploy",
  "payload": {
    "contractPath": "src/Attacker.sol",
    "contractName": "Attacker"
  }
}
```

The server responds with a stream of [`forge_log`](#forge_log) messages and a final [`forge_done`](#forge_done).

---

### `nft_buy`

Buy one or more listed NFTs. The engine reads each listing, sums WETH prices, wraps native ETH if needed (single `deposit`), approves the marketplace once for the total, then calls `buyToken` for each id in order. Inbound WebSocket messages are processed sequentially per connection, so rapid clicks are safe.

```json
{
  "type": "nft_buy",
  "payload": {
    "contractId": "marketplace",
    "tokenIds": [3, 7, 12]
  }
}
```

Legacy single-token form (still supported):

```json
{
  "type": "nft_buy",
  "payload": { "contractId": "marketplace", "tokenId": 42 }
}
```

At most **50** token ids per request. Duplicate ids in `tokenIds` are de-duplicated.

On success the server sends [`nft_buy_ok`](#nft_buy_ok) to the buyer and broadcasts [`nft_update`](#nft_update) to all clients. On failure, an [`error`](#error) message with `code: "NFT_ERROR"` is sent to the buyer (listings are refreshed when possible).

---

### `manual_trade`

Execute a swap via the UI trade form. Same execution path as the `swap()` SDK function. Broadcasts a `trade` event and replies with `manual_trade_result`.

```json
{
  "type": "manual_trade",
  "payload": { "pool": "weth-usdc-uniswap", "tokenIn": "USDC", "amountIn": "1000" }
}
```

`amountIn` is a human-readable decimal string (not wei). The engine parses it using the token's decimals.

**Response:** [`manual_trade_result`](#manual_trade_result) to the sender; [`trade`](#trade) broadcast to all clients.

---

### `get_balance`

Query the player's balance for a token symbol. Supports all pool tokens plus tokens in the current challenge's token list.

```json
{ "type": "get_balance", "payload": { "symbol": "WETH" } }
```

**Response:** [`balance_result`](#balance_result) to the sender.

---

### `wrap_eth`

Wrap native ETH → WETH via the WETH contract's `deposit()`.

```json
{ "type": "wrap_eth", "payload": { "amount": "5.0" } }
```

`amount` is a human-readable ETH string.

**Response:** [`wrap_result`](#wrap_result) to the sender.

---

### `unwrap_eth`

Unwrap WETH → native ETH via the WETH contract's `withdraw()`.

```json
{ "type": "unwrap_eth", "payload": { "amount": "5.0" } }
```

`amount` is a human-readable WETH string.

**Response:** [`unwrap_result`](#unwrap_result) to the sender.

---

### `nft_list`

List an NFT token for sale. The engine approves the marketplace and calls `listToken(tokenId, price)`.

```json
{
  "type": "nft_list",
  "payload": {
    "contractId": "marketplace",
    "tokenId": 7,
    "price": "0.5"
  }
}
```

`price` is a human-readable WETH amount string (e.g. `"0.5"` for 0.5 WETH).

On success the server sends [`nft_list_ok`](#nft_list_ok) to the lister and broadcasts [`nft_update`](#nft_update) to all clients.

---

## Server → Client messages

All broadcast messages are sent to **every connected client** unless noted.

---

### `challenge`

Challenge state update. Sent on connect, every block during a running challenge, and on any explicit state change (start/stop/pause/resume/win/loss).

```json
{
  "type": "challenge",
  "payload": {
    "id":            "wave-rider",
    "status":        "running",
    "currentBlock":  87,
    "totalBlocks":   500,
    "playerBalance": "1500000000000000000",
    "targetBalance": "5000000000000000000",
    "metric":        "ethBalance"
  }
}
```

`playerBalance` and `targetBalance` are profit-relative wei strings (0 at start).

---

### `challenges`

Full challenge catalogue. Sent automatically on connect and in response to `get_challenges`.

> **Note:** The two sends have slightly different payload shapes — a known server inconsistency.

**On connect** — `payload` is an array directly, and includes `startingValue`:

```json
{
  "type": "challenges",
  "payload": [
    {
      "id":            "wave-rider",
      "name":          "Riding the Wave",
      "description":   "...",
      "blockCount":    500,
      "target":        "15",
      "startingValue": "10",
      "pools": [
        {
          "id":          "weth-usdc-uniswap",
          "tokenA":      "WETH",
          "tokenB":      "USDC",
          "exchange":    "uniswap",
          "displayName": "Uniswap"
        }
      ]
    }
  ]
}
```

**In response to `get_challenges`** — `payload` is wrapped in `{ challenges: [...] }` and omits `startingValue`:

```json
{
  "type": "challenges",
  "payload": {
    "challenges": [
      {
        "id":          "wave-rider",
        "name":        "Riding the Wave",
        "description": "...",
        "blockCount":  500,
        "target":      "15",
        "pools": [...]
      }
    ]
  }
}
```

---

### `price`

Spot price update for a pool — fires once per block per pool.

```json
{
  "type": "price",
  "payload": {
    "pair":       "weth-usdc-uniswap",
    "price":      3024.88,
    "blockNumber": 88,
    "reserve0":   "2010500000000000000000",
    "reserve1":   "6080000000"
  }
}
```

`reserve0` and `reserve1` are raw uint256 strings in the token's native units (wei for WETH, 6-decimal units for USDC). `price` = `(reserve1 / 10^decimals1) / (reserve0 / 10^decimals0)`.

---

### `candle`

OHLCV candle update. Fires every block. `isUpdate: false` means a new candle period began; `isUpdate: true` means the current candle was revised.

```json
{
  "type": "candle",
  "payload": {
    "pair": "weth-usdc-uniswap",
    "candle": {
      "time":   1713600120,
      "open":   3012.5,
      "high":   3045.2,
      "low":    2998.1,
      "close":  3031.7,
      "volume": 14.2
    },
    "isUpdate": false
  }
}
```

---

### `block`

Fires every time a block is mined.

```json
{
  "type": "block",
  "payload": {
    "blockNumber":    89,
    "timestamp":      1713600180,
    "blocksRemaining": 411
  }
}
```

`timestamp` is the engine's wall-clock Unix milliseconds, not the block timestamp.

---

### `win`

Emitted once when the challenge ends — either because the player won or time ran out.

```json
{
  "type": "win",
  "payload": {
    "won":        true,
    "metric":     "ethBalance",
    "current":    "5.12",
    "target":     "5.00",
    "blocksUsed": 342
  }
}
```

`current` and `target` are decimal ETH strings (profit-relative). `won: false` means the player ran out of blocks.

---

### `trade`

Emitted whenever the player executes a swap via the `swap()` SDK function or the Manual Trade UI.
Broadcast to all clients. Used by the frontend to draw trade markers on the price chart.

```json
{
  "type": "trade",
  "payload": {
    "blockNumber": 42,
    "pool":        "weth-usdc-uniswap",
    "direction":   "buy",
    "tokenIn":     "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    "amountIn":    "3024880000",
    "amountOut":   "1000000000000000000",
    "txHash":      "0xabc..."
  }
}
```

`direction`: `"buy"` = acquiring token0 (e.g. buying WETH with USDC), `"sell"` = spending token0.
`amountIn` / `amountOut` are raw uint256 strings in the token's native units.

---

### `trigger_fired`

Emitted when a trigger's condition is met. Sent to all clients.

```json
{
  "type": "trigger_fired",
  "payload": {
    "triggerId":   "trig_2",
    "triggerType": "onPriceBelow",
    "blockNumber": 91,
    "poolId":      "weth-usdc-uniswap",
    "pair":        "weth-usdc-uniswap",
    "price":       2885.4
  }
}
```

`poolId` / `pair` and `price` are omitted for `onBlock` triggers. `pair` is kept as a backward-compatible alias for `poolId`.

---

### `triggers`

Updated trigger list for the session. Sent to the triggering client only — after `script_run`, `script_stop`, or `trigger_remove`.

```json
{
  "type": "triggers",
  "payload": {
    "triggers": [
      { "id": "trig_1", "type": "onBlock", "active": true },
      { "id": "trig_2", "type": "onPriceBelow", "poolId": "weth-usdc-uniswap", "pair": "weth-usdc-uniswap", "threshold": 2900, "active": true }
    ]
  }
}
```

---

### `script_log`

Log output from a running script. Sent to all clients. `console.log`, `console.warn`, `console.error`, and the `log()` / `ctx.log()` helpers all produce this.

```json
{
  "type": "script_log",
  "payload": {
    "sessionId":   "session_1713600000",
    "level":       "log",
    "message":     "[42] BUY @ $2910.33",
    "blockNumber": 42
  }
}
```

`level`: `"log"` | `"warn"` | `"error"`

---

### `speed`

Current simulation speed multiplier (1–10). Sent to the client after any `control` action, on initial connect, and broadcast to all clients after `challenge_start` completes. The multiplier is kept across challenge runs until changed with `set_speed`.

```json
{ "type": "speed", "payload": { "speed": 3 } }
```

---

### `error`

Sent to the triggering client when a message handler fails.

```json
{
  "type": "error",
  "payload": {
    "code":    "HANDLER_ERROR",
    "message": "Pool not found: bad-pool-id"
  }
}
```

Error codes: `PARSE_ERROR` | `NOT_FOUND` | `HANDLER_ERROR` | `SCRIPT_TOO_LARGE` | `NFT_ERROR` | `GET_BLOCKS_ERROR`

---

### `blocks_result`

Sent to the requester in response to [`get_blocks`](#get_blocks). Contains the same block/transaction shape as `GET /api/blocks`.

```json
{
  "type": "blocks_result",
  "payload": {
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
            "decoded": null
          }
        ]
      }
    ]
  }
}
```

---

### `pong`

Response to [`ping`](#ping).

```json
{ "type": "pong", "payload": { "timestamp": 1713600000000 } }
```

---

### `forge_log`

A single line of output from a running `forge script` or `forge create` command. Sent to the triggering client only.

```json
{
  "type": "forge_log",
  "payload": {
    "stream":  "stdout",
    "message": "Script ran successfully."
  }
}
```

`stream`: `"stdout"` | `"stderr"` | `"info"` | `"error"`

---

### `forge_done`

Signals the end of a `forge_script_run` or `forge_deploy` operation. Sent to the triggering client only.

```json
{
  "type": "forge_done",
  "payload": {
    "success":  true,
    "exitCode": 0,
    "address":  "0xABCD..."
  }
}
```

`address` is only present on successful `forge_deploy` and contains the deployed contract address. On failure, `success` is `false` and `exitCode` is non-zero (or `-1` for internal errors).

---

### `manual_trade_result`

Sent to the sender after a [`manual_trade`](#manual_trade) completes (success or failure).

```json
{
  "type": "manual_trade_result",
  "payload": {
    "amountOut":         "1000000000000000000",
    "amountOutDecimals": 18,
    "amountOutSymbol":   "WETH",
    "txHash":            "0x..."
  }
}
```

On failure: `{ "error": "Insufficient balance: have ..., need ..." }` (no other fields).

---

### `balance_result`

Sent to the requester after a [`get_balance`](#get_balance).

```json
{ "type": "balance_result", "payload": { "symbol": "WETH", "balance": "5.25" } }
```

`balance` is a human-readable decimal string (formatted with the token's decimals). On failure: `{ "symbol": "XYZ", "error": "Unknown token: XYZ" }`.

---

### `wrap_result`

Sent to the sender after a [`wrap_eth`](#wrap_eth) completes.

```json
{ "type": "wrap_result", "payload": { "wethBalance": "10.5", "txHash": "0x..." } }
```

On failure: `{ "error": "..." }`.

---

### `unwrap_result`

Sent to the sender after an [`unwrap_eth`](#unwrap_eth) completes.

```json
{ "type": "unwrap_result", "payload": { "ethBalance": "10.5", "txHash": "0x..." } }
```

On failure: `{ "error": "..." }`.

---

### `env_updated`

Sent to the initiating client after `challenge_start` triggers a successful `env.sh` refresh, signalling that `/api/env` has fresh values.

```json
{ "type": "env_updated", "payload": {} }
```

---

### `nft_buy_ok`

Sent to the buyer client after a successful [`nft_buy`](#nft_buy).

```json
{
  "type": "nft_buy_ok",
  "payload": {
    "tokenIds": [3, 7, 12],
    "tokenId": 3,
    "purchases": [
      { "tokenId": 3, "price": "0.1", "txHash": "0x…", "block": 124 }
    ]
  }
}
```

`tokenId` mirrors the first purchased id for older clients. `purchases` lists each token bought (most recent last). `price` / `txHash` / `block` on the root payload reflect the **last** purchase when present.

---

### `nft_list_ok`

Sent to the listing client after a successful [`nft_list`](#nft_list).

```json
{
  "type": "nft_list_ok",
  "payload": { "tokenId": 7, "price": "0.5" }
}
```

---

### `nft_update`

Broadcast to all clients after any NFT buy or list completes. Contains the full updated listing state for the marketplace contract.

```json
{
  "type": "nft_update",
  "payload": {
    "contractId": "marketplace",
    "listings": [
      {
        "tokenId":     "12",
        "seller":      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "price":       "0.35",
        "rarityScore": 72
      }
    ]
  }
}
```

---

## Connecting from JavaScript

```js
const ws = new WebSocket("ws://localhost:3000/ws");

ws.onopen = () => {
  // Start a challenge
  ws.send(JSON.stringify({
    type: "challenge_start",
    payload: { challengeId: "wave-rider" },
  }));
};

ws.onmessage = (event) => {
  const { type, payload } = JSON.parse(event.data);
  switch (type) {
    case "price":
      console.log(`[${payload.blockNumber}] ${payload.pair}: $${payload.price.toFixed(2)}`);
      break;
    case "win":
      console.log(payload.won ? "WON!" : "Lost.", payload.current, "ETH profit");
      break;
    case "script_log":
      console.log(`[${payload.level}]`, payload.message);
      break;
  }
};

// Run a strategy script (poolId is the primary identifier)
ws.send(JSON.stringify({
  type: "script_run",
  payload: {
    source: `
      onBlock(async (ctx) => {
        const price = await getPrice("weth-usdc-uniswap");
        ctx.log("price: $" + price.toFixed(2));
      });
    `,
  },
}));
```
