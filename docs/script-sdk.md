# Script Sandbox SDK

Scripts are JavaScript executed inside a Node.js `vm` context. The SDK is injected flat into the global scope — no `require`, no `import`, no module system.

Submit a script via the WebSocket `script_run` message or the Script panel in the frontend. The script runs synchronously on load (5-second timeout); async callbacks have no timeout.

---

## Execution model

When you run a script:

1. All triggers from the previous script are cleared.
2. The script body executes once — typically to register one or more triggers.
3. Triggers fire on subsequent blocks as the engine mines them.

Scripts cannot `while(true)` or block indefinitely at load time. All blocking work goes inside trigger callbacks, which are `async` and awaited per-block.

```js
// At load time — runs once, registers a trigger
let count = 0;

onBlock(async (ctx) => {
  // Inside the trigger — runs every block
  count++;
  ctx.log(`block ${ctx.blockNumber}, total trades so far: ${count}`);
});
```

---

## Triggers

### `onBlock(callback, name?)` → `triggerId`

Fires once per mined block, after bots have executed for that block. The optional `name`
string sets the display label shown in the Trigger panel.

```js
const id = onBlock(async (ctx) => {
  ctx.log(`block ${ctx.blockNumber}`);
  // Remove after 10 blocks
  if (ctx.blockNumber >= 10) removeTrigger(id);
}, "My block watcher");
```

**Callback context**

| Field | Type | Description |
|---|---|---|
| `ctx.blockNumber` | number | The block just mined (1-indexed within the challenge) |
| `ctx.timestamp` | number | Engine wall-clock Unix milliseconds |
| `ctx.log` | function | Logger bound to this block number — outputs appear in the Script Log panel |

---

### `onPriceBelow(poolId, threshold, callback, name?)` → `triggerId`

Fires every block while the spot price of `poolId` is below `threshold`. Does **not** fire on first drop — fires continuously while the condition holds.

```js
// One-shot buy on dip
const id = onPriceBelow("weth-usdc-uniswap", 2900, async (ctx) => {
  ctx.log(`Dip at $${ctx.price.toFixed(2)}, buying`);
  const usdc = await getBalance("USDC");
  await swap("weth-usdc-uniswap", "USDC", usdc);
  removeTrigger(id);  // fire once
});
```

**Callback context** — all `onBlock` fields, plus:

| Field | Type | Description |
|---|---|---|
| `ctx.poolId` | string | Pool ID (e.g. `"weth-usdc-uniswap"`) |
| `ctx.pair` | string | Alias for `ctx.poolId` (backward compat) |
| `ctx.price` | number | Current spot price that triggered the condition |

---

### `onPriceAbove(poolId, threshold, callback, name?)` → `triggerId`

Fires every block while spot price is above `threshold`.

```js
onPriceAbove("weth-usdc-uniswap", 3200, async (ctx) => {
  const weth = await getBalance("WETH");
  if (weth > 0n) {
    await swap("weth-usdc-uniswap", "WETH", weth);
    ctx.log(`Sold at $${ctx.price.toFixed(2)}`);
  }
});
```

---

### `removeTrigger(triggerId)`

Deregisters a trigger immediately. Safe to call from within the trigger's own callback.

```js
const id = onBlock(async (ctx) => {
  if (ctx.blockNumber === 50) {
    log("Stopping at block 50");
    removeTrigger(id);
  }
});
```

---

## Trading

### `swap(poolId, tokenInSymbol, amountIn, minOut?)` → `Promise<bigint>`

Swap tokens in a pool. Approves the token automatically before swapping.

Automatically logs: `swap 1.0000 WETH → 3024.1234 USDC | impact 0.05%`

```js
// Sell all USDC for WETH
const usdc = await getBalance("USDC");
const wethOut = await swap("weth-usdc-uniswap", "USDC", usdc);

// With slippage protection (revert if we get less than 99% of the quote)
const expectedOut = await quoteOut("weth-usdc-uniswap", "WETH", parseEther("5"));
const minOut = expectedOut * 99n / 100n;
await swap("weth-usdc-uniswap", "WETH", parseEther("5"), minOut);
```

| Param | Type | Description |
|---|---|---|
| `poolId` | string | Unique ID of the pool to trade on — taken directly from the challenge manifest. This is **not** a token pair name; it identifies one specific pool instance. When a challenge has multiple pools with the same tokens (e.g. Uniswap and SushiSwap both holding WETH/USDC), each gets a distinct ID like `"weth-usdc-uniswap"` and `"weth-usdc-sushiswap"`. There is no automatic routing — you pick the exact pool. |
| `tokenInSymbol` | string | Token symbol, case-insensitive (`"WETH"`, `"USDC"`) |
| `amountIn` | bigint | Amount in smallest units (wei for ETH/WETH, 10^-6 for USDC) |
| `minOut` | bigint | Minimum output — tx reverts if not met. Default `0n` |

Returns `bigint` — actual amount of output token received.

---

### `addLiquidity(poolId, amount0, amount1, amount0Min?, amount1Min?)` → `Promise<bigint>`

Provide liquidity to a pool. Amounts are in pool token order (`token0` / `token1`, sorted by address). Approvals are handled automatically.

Returns `bigint` — LP share tokens received.

```js
// Provide 1 WETH + proportional USDC
const { reserve0, reserve1 } = await getReserves("weth-usdc-uniswap");
const wethIn = parseEther("1");
const usdcIn = wethIn * reserve1 / reserve0;

const shares = await addLiquidity(
  "weth-usdc-uniswap",
  wethIn,    // token0 (WETH, sorted lower)
  usdcIn,    // token1 (USDC)
  wethIn * 99n / 100n,   // 1% slippage on token0
  usdcIn * 99n / 100n,   // 1% slippage on token1
);
log(`LP shares received: ${shares}`);
```

> **Token order:** `token0` is the address that sorts lower. Check `connection_info` or the `price` WebSocket broadcast (which includes `symbol0`/`symbol1`) to know which is which for a given pool.

---

### `removeLiquidity(poolId, shares, amount0Min?, amount1Min?)` → `Promise<{amount0, amount1}>`

Burn LP shares and withdraw underlying tokens.

```js
const shares = await getLPBalance("weth-usdc-uniswap");
const { amount0, amount1 } = await removeLiquidity("weth-usdc-uniswap", shares);
log(`Withdrew ${formatEther(amount0)} WETH + ${formatUnits(amount1, 6)} USDC`);
```

---

### `wrapEth(amount)` → `Promise<void>`

Convert native ETH to WETH by calling `deposit()` on the WETH contract.

```js
await wrapEth(parseEther("10"));
const weth = await getBalance("WETH");
log(`WETH balance: ${formatEther(weth)}`);
```

---

### `unwrapEth(amount)` → `Promise<void>`

Convert WETH back to native ETH via `withdraw()`.

```js
const weth = await getBalance("WETH");
await unwrapEth(weth);
log(`ETH: ${formatEther(await getBalance("ETH"))}`);
```

---

## Market data

### `getBalance(tokenSymbol)` → `Promise<bigint>`

Player's token balance in smallest units.

```js
const eth  = await getBalance("ETH");    // wei
const weth = await getBalance("WETH");   // wei
const usdc = await getBalance("USDC");   // 10^-6

log(`ETH:  ${formatEther(eth)}`);
log(`USDC: ${formatUnits(usdc, 6)}`);
```

Throws `Error: Unknown token: XYZ` if the symbol doesn't match any registered pool token.

---

### `getPrice(poolId)` → `Promise<number>`

Current spot price — token1 per token0, normalized for decimals. `poolId` is the pool's unique identifier (e.g. `"weth-usdc-uniswap"`).

For WETH/USDC pools (WETH = token0 because its address sorts lower): returns USDC per WETH.

```js
const price = await getPrice("weth-usdc-uniswap");  // e.g. 3024.88
```

---

### `getReserves(poolId)` → `Promise<{reserve0, reserve1, price}>`

Raw pool reserves and computed spot price.

```js
const { reserve0, reserve1, price } = await getReserves("weth-usdc-uniswap");
// For a WETH/USDC pool: reserve0 = WETH (wei), reserve1 = USDC (6-decimal units)
const wethHuman = Number(reserve0) / 1e18;
const usdcHuman = Number(reserve1) / 1e6;
log(`TVL: $${(usdcHuman * 2).toLocaleString()}`);
log(`Price: $${price.toFixed(2)}`);
```

> **Note:** Token symbols are not returned by `getReserves`. To check token order for a pool,
> refer to the challenge manifest's `pools` array, the `connection_info` response
> (`GET /api/connection_info`), or inspect the `symbol0`/`symbol1` fields in the
> `price` WebSocket broadcast which fires every block.

---

### `quoteOut(poolId, tokenInSymbol, amountIn)` → `Promise<bigint>`

Simulate a swap off-chain using constant-product AMM math (includes 0.3% fee). No state change, no gas.

```js
const usdcOut = await quoteOut("weth-usdc-uniswap", "WETH", parseEther("1"));
log(`1 WETH → ${formatUnits(usdcOut, 6)} USDC`);
```

| Param | Type | Description |
|---|---|---|
| `poolId` | string | Pool ID |
| `tokenInSymbol` | string | Input token symbol |
| `amountIn` | bigint | Amount in smallest units |

Returns `bigint` — expected output amount in smallest units.

---

### `getLPBalance(poolId)` → `Promise<bigint>`

Player's LP share balance for a pool.

```js
const shares = await getLPBalance("weth-usdc-uniswap");
log(`LP shares: ${shares}`);
```

---

### `getPriceHistory(poolId, lastN?)` → `Promise<Candle[]>`

OHLCV candle history for a pool (most recent `lastN`, default 50). Same format as the HTTP API.

```js
const candles = await getPriceHistory("weth-usdc-uniswap", 20);
const closes  = candles.map(c => c.close);
const sma20   = closes.reduce((a, b) => a + b, 0) / closes.length;
const last    = closes.at(-1);
log(`SMA20: $${sma20.toFixed(2)}, last: $${last.toFixed(2)}, signal: ${last > sma20 ? "bullish" : "bearish"}`);
```

---

## Challenge contract access

These functions interact with contracts deployed by the challenge manifest (`contracts` array).

### `getContractAddress(contractId)` → `string`

Returns the deployed address of a challenge contract.

```js
const vaultAddr = getContractAddress("vault");
log(`Vault at: ${vaultAddr}`);
```

Throws if no challenge contracts are deployed or the ID is unknown.

---

### `readContract(contractId, method, args?)` → `Promise<any>`

Call a view/pure function on a challenge contract (read-only, no gas).

```js
const owner = await readContract("vault", "owner");
log(`Owner: ${owner}`);

const bal = await readContract("vault", "balanceOf", [playerAddr]);
log(`Balance: ${formatEther(bal)}`);
```

---

### `execContract(contractId, method, args?, value?)` → `Promise<{hash, blockNumber}>`

Call a state-changing function on a challenge contract using the player's signer. Forces a block mine so the transaction lands before the next trigger fires.

```js
// Call with no args
const { hash } = await execContract("vault", "drain");
log(`Drain tx: ${hash}`);

// Call with args and ETH value
await execContract("vault", "deposit", [], parseEther("1"));
```

---

### `callWithAbi(address, abi, method, args?, value?)` → `Promise<{hash, blockNumber}>`

Call any contract at any address with a custom ABI. Useful after proxy upgrades where the registered ABI no longer matches the live implementation.

```js
const { hash } = await callWithAbi(
  proxyAddress,
  ["function drainAll(address to)"],
  "drainAll",
  [getPlayerAddress()],
);
log(`Exploit tx: ${hash}`);
```

| Param | Type | Description |
|---|---|---|
| `address` | string | Target contract address |
| `abi` | string[] | ABI fragments, e.g. `["function foo(uint256) returns (bool)"]` |
| `method` | string | Method name |
| `args` | any[] | Arguments (default `[]`) |
| `value` | bigint | ETH value in wei to send with the call (default `0n`) |

---

### `approveToken(tokenSymbol, spender, amount)` → `Promise<void>`

Approve a spender to transfer a token on the player's behalf.

```js
await approveToken("USDC", vaultAddr, parseUnits("1000", 6));
```

---

## Chain history

### `getTransaction(txHash)` → `Promise<TransactionResponse | null>`

Fetch a transaction by hash. Returns `null` if not found. Useful for decoding calldata from historical transactions (e.g. finding the init calldata that reveals a proxy admin password).

```js
// Block 1 typically contains challenge setup transactions
const txs = await getBlockTransactions(1);
for (const tx of txs) {
  log(`tx ${tx.hash}: ${tx.data.slice(0, 10)} (selector)`);
}

const tx = await getTransaction(txs[0].hash);
if (tx) log(`to: ${tx.to}, data: ${tx.data}`);
```

---

### `getBlockTransactions(blockNumber)` → `Promise<TransactionResponse[]>`

Fetch all transactions in a block. Block 1 typically contains challenge setup transactions — useful for finding initialization calldata in upgradeable proxy challenges.

```js
const txs = await getBlockTransactions(1);
for (const tx of txs) {
  log(`${tx.hash}: to=${tx.to}, data=${tx.data.slice(0, 66)}`);
}
```

---

### `decodeCalldata(types, data)` → `ethers.Result`

Decode ABI-encoded calldata. Strip the 4-byte selector before passing `data` if the input includes one.

```js
// Decode the init calldata from a proxy transaction
const txs = await getBlockTransactions(1);
const initTx = txs.find(t => t.to?.toLowerCase() === proxyAddr.toLowerCase());
if (initTx) {
  // Strip 4-byte selector (first 10 hex chars after "0x")
  const data = "0x" + initTx.data.slice(10);
  const [adminPassword] = decodeCalldata(["string"], data);
  log(`Admin password: ${adminPassword}`);
}
```

| Param | Type | Description |
|---|---|---|
| `types` | string[] | Solidity type strings, e.g. `["string", "uint8", "address"]` |
| `data` | string | Hex-encoded ABI data (without 4-byte selector) |

Returns an `ethers.Result` — index-accessible like an array.

---

## Forge integration

### `runForgeScript(scriptPath, opts?)` → `Promise<{ success, exitCode, output }>`

Run a `forge script` from within a JS trigger callback. The script executes against the live Anvil chain using the player's private key — the same credentials used by the Solidity IDE's **Run Script** button.

Output is streamed to the Script Log panel in real time (prefixed with `[forge]`) and also collected into `result.output` for programmatic inspection.

```js
const result = await runForgeScript("script/Solve.s.sol");
// { success: true, exitCode: 0, output: "..." }
```

**Parameters**

| Param | Type | Description |
|---|---|---|
| `scriptPath` | string | Path to the `.sol` script, relative to the `solve/` workspace root (e.g. `"script/Solve.s.sol"`) |
| `opts.args` | string[] | Extra forge CLI arguments appended after the defaults (e.g. `["--sig", "run(uint256)", "42"]`). Optional. |
| `opts.contract` | string | Specific contract name within the `.sol` file when the file defines more than one contract. Optional. |

**Return value**

| Field | Type | Description |
|---|---|---|
| `success` | boolean | `true` if forge exited with code 0 |
| `exitCode` | number | Raw forge process exit code |
| `output` | string | Combined stdout + stderr, newline-separated |

**Path safety:** `scriptPath` is resolved relative to `solve/` and validated to prevent directory traversal. Paths containing `..` that escape the workspace throw an error.

```js
// Trigger a Solidity exploit when price drops below $2500
const triggerId = onPriceBelow("weth-usdc-uniswap", 2500, async (ctx) => {
  ctx.log(`Price at $${ctx.price.toFixed(2)} — running exploit`);
  const result = await runForgeScript("script/Solve.s.sol");
  if (result.success) {
    ctx.log("Exploit succeeded:", result.output.slice(-200));
    removeTrigger(triggerId);
  } else {
    ctx.log("Exploit failed (exit", result.exitCode + "):", result.output.slice(-300));
  }
});
```

---

## Utilities

| Function | Signature | Description |
|---|---|---|
| `parseEther(v)` | `(string) → bigint` | `"1.5"` → `1500000000000000000n` |
| `formatEther(v)` | `(bigint) → string` | `1500000000000000000n` → `"1.5"` |
| `parseUnits(v, d)` | `(string, number) → bigint` | `("100", 6)` → `100000000n` |
| `formatUnits(v, d)` | `(bigint, number) → string` | `(100000000n, 6)` → `"100.0"` |
| `getPlayerAddress()` | `() → string` | Player wallet address |
| `log(...args)` | `(...any) → void` | Write to Script Log (block 0) |
| `console.log/warn/error` | standard | Alias for `log` |
| `BigInt` | global | Native JS BigInt constructor |
