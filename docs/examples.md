# Examples

Complete, runnable scripts for the Script Sandbox. Paste any of these into the Script panel in the frontend.

> **SDK coverage note:** Examples in sections 1–9 use only functions documented in [script-sdk.md](script-sdk.md). Examples in sections 10–16 use functions (`getPendingTransactions`, `getLogs`, `callContract`, `sendContract`, `Interface`, `id`, `rpc`) that are **not** part of the current Script Sandbox SDK. Those sections are provided as conceptual patterns; adapt them using `callWithAbi` / `execContract` / `readContract` and the Foundry CLI as needed. Each stale section is marked with a warning inline.
>
> **For working copy-paste scripts, use sections 1–9 and the utility snippets at the bottom.**

---

## Basic strategies

### 1. Price logger

The simplest possible script — log the price every block.

```js
onBlock(async (ctx) => {
  const price = await getPrice("weth-usdc-uniswap");
  ctx.log(`[${ctx.blockNumber}] $${price.toFixed(2)}`);
});
```

---

### 2. Balance snapshot

Show all balances at the start.

```js
onBlock(async (ctx) => {
  if (ctx.blockNumber !== 1) return;

  const eth  = await getBalance("ETH");
  const weth = await getBalance("WETH");
  const usdc = await getBalance("USDC");

  log(`ETH:  ${formatEther(eth)}`);
  log(`WETH: ${formatEther(weth)}`);
  log(`USDC: ${formatUnits(usdc, 6)}`);
  log(`Addr: ${getPlayerAddress()}`);
});
```

---

### 3. Buy-the-dip with slippage guard

Wait for a 3% dip from the opening price, then buy. Sell when it recovers 2%.

```js
const PAIR = "weth-usdc-uniswap";
let openPrice  = 0;
let holding    = "usdc";
let entryPrice = 0;

onBlock(async (ctx) => {
  const price = await getPrice(PAIR);
  if (openPrice === 0) { openPrice = price; return; }

  const usdc = await getBalance("USDC");
  const weth = await getBalance("WETH");

  // Buy signal: price dipped 3% below open
  if (holding === "usdc" && price < openPrice * 0.97 && usdc > parseUnits("100", 6)) {
    const tradeAmt = usdc * 90n / 100n;
    const expectedOut = await quoteOut(PAIR, "USDC", tradeAmt);
    await swap(PAIR, "USDC", tradeAmt, expectedOut * 99n / 100n);
    entryPrice = price;
    holding    = "weth";
    ctx.log(`BUY @ $${price.toFixed(2)}`);
  }

  // Sell signal: recovered 2% from entry
  if (holding === "weth" && price > entryPrice * 1.02 && weth > 0n) {
    await swap(PAIR, "WETH", weth * 95n / 100n);
    holding = "usdc";
    ctx.log(`SELL @ $${price.toFixed(2)}`);
  }
});
```

---

### 4. SMA crossover

Buy when the 5-block SMA crosses above the 20-block SMA; sell on the reverse.

```js
const PAIR       = "weth-usdc-uniswap";
const FAST       = 5;
const SLOW       = 20;
let prices       = [];
let holding      = false;

onBlock(async (ctx) => {
  const price = await getPrice(PAIR);
  prices.push(price);
  if (prices.length > SLOW + 1) prices.shift();
  if (prices.length < SLOW) return;

  const fast = prices.slice(-FAST).reduce((a, b) => a + b) / FAST;
  const slow = prices.slice(-SLOW).reduce((a, b) => a + b) / SLOW;
  const prev_fast = prices.slice(-FAST - 1, -1).reduce((a, b) => a + b) / FAST;
  const prev_slow = prices.slice(-SLOW - 1, -1).reduce((a, b) => a + b) / SLOW;

  const crossedUp   = prev_fast <= prev_slow && fast > slow;
  const crossedDown = prev_fast >= prev_slow && fast < slow;

  if (crossedUp && !holding) {
    const usdc = await getBalance("USDC");
    if (usdc > parseUnits("1000", 6)) {
      await swap(PAIR, "USDC", usdc * 80n / 100n);
      holding = true;
      ctx.log(`[${ctx.blockNumber}] SMA cross UP — bought`);
    }
  }

  if (crossedDown && holding) {
    const weth = await getBalance("WETH");
    if (weth > 0n) {
      await swap(PAIR, "WETH", weth);
      holding = false;
      ctx.log(`[${ctx.blockNumber}] SMA cross DOWN — sold`);
    }
  }
});
```

---

### 5. SMA-triggered buy with pool-depth size estimate

Buy when price is 2% below the 10-candle SMA. Size the trade conservatively using reserve math.

```js
const PAIR = "weth-usdc-uniswap";

onBlock(async (ctx) => {
  if (ctx.blockNumber % 3 !== 0) return;  // check every 3 blocks

  const price   = await getPrice(PAIR);
  const candles = await getPriceHistory(PAIR, 10);
  if (candles.length < 10) return;

  const closes = candles.map(c => c.close);
  const sma10  = closes.reduce((a, b) => a + b) / closes.length;

  if (price < sma10 * 0.98) {
    // Price 2% below SMA — buy up to ~0.5% of USDC reserves
    const { reserve1 } = await getReserves(PAIR);
    const tradeUsdc = reserve1 / 200n;  // ~0.5% of pool
    const usdc = await getBalance("USDC");
    const buyAmt = tradeUsdc < usdc ? tradeUsdc : usdc;
    if (buyAmt > parseUnits("100", 6)) {
      await swap(PAIR, "USDC", buyAmt);
      ctx.log(`[${ctx.blockNumber}] SMA-triggered BUY at $${price.toFixed(2)}`);
    }
  }
});
```

---

## Arbitrage

### 6. Cross-pool arbitrage (The Spread)

For the `the-spread` challenge — arb between pool-a and pool-b.

```js
const POOL_A = "weth-usdc-uniswap";
const POOL_B = "weth-usdc-sushiswap";
const MIN_SPREAD_BPS = 60;   // 0.6% net of 2× 0.3% fee

let initialized = false;

onBlock(async (ctx) => {
  // Setup on block 1
  if (ctx.blockNumber === 1 && !initialized) {
    await wrapEth(parseEther("50"));
    const weth = await getBalance("WETH");
    await swap(POOL_A, "WETH", weth / 2n);
    initialized = true;
    ctx.log("Initialized with WETH + USDC");
    return;
  }
  if (!initialized) return;

  const [pA, pB] = await Promise.all([getPrice(POOL_A), getPrice(POOL_B)]);
  const spreadBps = Math.round(Math.abs(pA - pB) / Math.min(pA, pB) * 10000);
  if (spreadBps < MIN_SPREAD_BPS) return;

  const [cheap, dear] = pA < pB ? [POOL_A, POOL_B] : [POOL_B, POOL_A];
  const usdc = await getBalance("USDC");
  if (usdc < parseUnits("1000", 6)) {
    // Replenish USDC
    const weth = await getBalance("WETH");
    if (weth > parseEther("2")) await swap(dear, "WETH", weth / 3n);
    return;
  }

  const tradeAmt = usdc * 25n / 100n;
  // Check slippage with quoteOut before committing
  const cheapPool = cheap === POOL_A ? POOL_A : POOL_B;
  const expectedWeth = await quoteOut(cheap, "USDC", tradeAmt);
  const minWeth = expectedWeth * 99n / 100n;  // 1% slippage tolerance

  try {
    await swap(cheap, "USDC", tradeAmt, minWeth);
    const weth = await getBalance("WETH");
    if (weth > 0n) await swap(dear, "WETH", weth);
    ctx.log(`[${ctx.blockNumber}] Arb ${spreadBps}bps`);
  } catch (e) {
    ctx.log(`Arb failed: ${e}`);
  }
});
```

---

### 7. Triangular arbitrage (when DAI pool exists)

If WETH/DAI and WETH/USDC are both active:

```js
// WETH → USDC → WETH (via different pool pair)
// Requires a USDC/DAI pool to exist

const WETH_USDC = "weth-usdc-uniswap";
const WETH_DAI  = "weth-dai-sushiswap";

onBlock(async (ctx) => {
  const wethUsdcPrice = await getPrice(WETH_USDC);  // USDC per WETH
  const wethDaiPrice  = await getPrice(WETH_DAI);   // DAI per WETH

  // If WETH is cheaper in DAI terms (normalized), buy in DAI pool, sell in USDC pool
  const usdcInDai = 1.0;  // assume 1 USDC ≈ 1 DAI
  const spreadBps = Math.round((wethUsdcPrice - wethDaiPrice) / wethDaiPrice * 10000);

  ctx.log(`WETH/USDC: $${wethUsdcPrice.toFixed(2)}, WETH/DAI: $${wethDaiPrice.toFixed(2)}, spread: ${spreadBps}bps`);
});
```

---

## Liquidity provision

> **Note:** Sections 8–9 use `addLiquidity` and `removeLiquidity` which ARE in the current SDK. The `getLPTotalSupply` call in section 9 comments is illustrative only — use `callWithAbi` on the pool to read `totalSupply()` directly.

### 8. Passive LP

Provide liquidity and track your position over time.

```js
const PAIR = "weth-usdc-uniswap";
let initialShares = 0n;

onBlock(async (ctx) => {
  if (ctx.blockNumber !== 1) return;

  await wrapEth(parseEther("2"));

  const { reserve0, reserve1 } = await getReserves(PAIR);
  const wethIn = parseEther("1");
  const usdcIn = wethIn * reserve1 / reserve0;

  const shares = await addLiquidity(PAIR, wethIn, usdcIn);
  initialShares = shares;
  log(`Provided liquidity. Shares: ${shares}`);
});

onBlock(async (ctx) => {
  if (ctx.blockNumber % 10 !== 0) return;

  // LP total supply is tracked off-chain; use removeLiquidity to check position value
  const shares = await getLPBalance(PAIR);
  if (shares === 0n) return;
  // Estimate position: ratio of our shares to total shares is not directly available
  // via the SDK, but we can estimate value by querying reserves directly.
  // (For precise share percentage, use callWithAbi on the pool to read totalSupply.)
  ctx.log(`[${ctx.blockNumber}] LP shares: ${shares}`);
});
```

---

### 9. Impermanent loss tracker

Compare LP position value vs. just holding the tokens.

```js
const PAIR = "weth-usdc-uniswap";
let startWeth = 0n;
let startUsdc = 0n;
let startEthPrice = 0;

onBlock(async (ctx) => {
  if (ctx.blockNumber !== 1) return;

  startWeth = parseEther("1");
  startEthPrice = await getPrice(PAIR);
  await wrapEth(startWeth);

  // Use reserve ratio to get correct proportional USDC (in 6-decimal units)
  const { reserve0, reserve1 } = await getReserves(PAIR);
  startUsdc = startWeth * reserve1 / reserve0;

  await addLiquidity(PAIR, startWeth, startUsdc);

  log(`Starting position: ${formatEther(startWeth)} WETH + ${formatUnits(startUsdc, 6)} USDC at $${startEthPrice.toFixed(2)}`);
});

onBlock(async (ctx) => {
  if (ctx.blockNumber % 20 !== 0) return;

  const myShares = await getLPBalance(PAIR);
  if (myShares === 0n) return;
  // To compute exact IL, read total LP supply via callWithAbi on the pool:
  // const [totalSupply] = await callWithAbi(poolAddr, ["function totalSupply() view returns (uint256)"], "totalSupply");
  // Then: lpWeth = reserve0 * myShares / totalSupply, etc.
  const currentPrice = await getPrice(PAIR);
  const hodlValueEth = Number(formatEther(startWeth)) + Number(formatUnits(startUsdc, 6)) / currentPrice;
  ctx.log(`[${ctx.blockNumber}] LP shares: ${myShares}, HODL equiv: ${hodlValueEth.toFixed(4)} ETH`);
});
```

---

## Mempool & frontrunning

> **Warning: sections 10–12 use `getPendingTransactions()`, `Interface`, and `id()` which are NOT in the current SDK.** These examples are conceptual patterns only — they will throw `ReferenceError` if you run them as-is. For mempool-style challenges, use the Foundry CLI (`cast block --pending`) or read confirmed block transactions with `getBlockTransactions()`.

### 10. Mempool monitor

Watch what bots are doing between blocks.

```js
onBlock(async (ctx) => {
  const { pending, queued } = await getPendingTransactions();
  const pendingAddrs = Object.keys(pending);

  if (pendingAddrs.length === 0) return;

  ctx.log(`[${ctx.blockNumber}] Mempool: ${pendingAddrs.length} addresses`);
  for (const addr of pendingAddrs) {
    const txs = Object.values(pending[addr]);
    for (const tx of txs) {
      ctx.log(`  ${addr.slice(0,8)}: to ${String(tx.to).slice(0,10)}, input ${String(tx.input).slice(0,18)}...`);
    }
  }
});
```

---

### 11. Bot transaction decoder

Decode what the bots are actually doing by parsing calldata.

```js
const SWAP_ABI = [
  "function swapExactIn(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to) returns (uint256)",
];
const iface    = new Interface(SWAP_ABI);
const POOL_ADDR = "0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81";
const WETH_ADDR = "0x5fbd".toLowerCase();

onBlock(async (ctx) => {
  const { pending } = await getPendingTransactions();

  for (const [sender, senderTxs] of Object.entries(pending)) {
    for (const tx of Object.values(senderTxs)) {
      const t = tx;
      if (String(t.to).toLowerCase() !== POOL_ADDR.toLowerCase()) continue;

      try {
        const decoded = iface.parseTransaction({ data: String(t.input) });
        if (!decoded) continue;

        const tokenIn = String(decoded.args.tokenIn).toLowerCase();
        const amtIn   = BigInt(String(decoded.args.amountIn));
        const buying  = !tokenIn.startsWith(WETH_ADDR);

        ctx.log(buying
          ? `BOT ${sender.slice(0,8)} BUYING ~${formatUnits(amtIn, 6)} USDC worth of WETH`
          : `BOT ${sender.slice(0,8)} SELLING ${formatEther(amtIn)} WETH`
        );
      } catch {}
    }
  }
});
```

---

### 12. Sandwich attack (frontrun + backrun)

Detect a large bot buy, front-run it, then sell after the bot moves the price.

```js
const POOL_ADDR = "0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81".toLowerCase();
const WETH_ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const SWAP_SIG  = "swapExactIn(address,uint256,uint256,address)";

const SWAP_ABI = [
  `function ${SWAP_SIG} returns (uint256)`,
  "function approve(address, uint256) returns (bool)",
];
const iface = new Interface([`function ${SWAP_SIG} returns (uint256)`]);

const MIN_BOT_USDC = parseUnits("5000", 6);   // only sandwich large buys
let frontranBlock = -1;
let frontranWeth  = 0n;

// ── Front leg: detect large pending buy, front-run it ────────────────────
onBlock(async (ctx) => {
  const { pending } = await getPendingTransactions();

  for (const [sender, senderTxs] of Object.entries(pending)) {
    if (sender.toLowerCase() === getPlayerAddress().toLowerCase()) continue;

    for (const tx of Object.values(senderTxs)) {
      if (String(tx.to).toLowerCase() !== POOL_ADDR) continue;
      let decoded;
      try { decoded = iface.parseTransaction({ data: String(tx.input) }); } catch { continue; }

      const tokenIn = String(decoded.args.tokenIn).toLowerCase();
      const amtIn   = BigInt(String(decoded.args.amountIn));
      const botIsBuying = tokenIn !== WETH_ADDR.toLowerCase();

      if (!botIsBuying || amtIn < MIN_BOT_USDC) continue;

      ctx.log(`[${ctx.blockNumber}] Bot buying ${formatUnits(amtIn, 6)} USDC — sandwiching`);

      // Front-run: buy WETH before the bot
      const usdc = await getBalance("USDC");
      const frontAmt = usdc > parseUnits("2000", 6) ? parseUnits("2000", 6) : usdc;
      if (frontAmt < parseUnits("100", 6)) return;

      await swap("weth-usdc-uniswap", "USDC", frontAmt);
      frontranWeth  = await getBalance("WETH");
      frontranBlock = ctx.blockNumber;
      ctx.log(`Front leg: bought ${formatEther(frontranWeth)} WETH`);
      return;
    }
  }
});

// ── Back leg: sell after bot pumped the price ─────────────────────────────
onBlock(async (ctx) => {
  if (frontranBlock < 0 || ctx.blockNumber !== frontranBlock + 1) return;
  if (frontranWeth === 0n) return;

  const priceNow = await getPrice("weth-usdc-uniswap");
  ctx.log(`[${ctx.blockNumber}] Back leg: selling ${formatEther(frontranWeth)} WETH @ $${priceNow.toFixed(2)}`);
  await swap("weth-usdc-uniswap", "WETH", frontranWeth);
  frontranWeth  = 0n;
  frontranBlock = -1;
});
```

---

### 13. Event log scanner (past blocks)

> **Warning: uses `getLogs()`, `Interface`, and `id()` — NOT in the current SDK.** Conceptual example only.

Read Swap events from the last 5 blocks to reconstruct bot activity.

```js
const POOL_ADDR = "0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81";
const SWAP_EVENT = "Swap(address,uint256,uint256,uint256,uint256,address)";
const SWAP_ABI = [`event ${SWAP_EVENT}`];
const iface = new Interface(SWAP_ABI);

onBlock(async (ctx) => {
  if (ctx.blockNumber % 5 !== 0) return;

  const swapTopic = id(SWAP_EVENT);
  const logs = await getLogs({
    address:     POOL_ADDR,
    topics:      [swapTopic],
    lastNBlocks: 5,
  });

  ctx.log(`Last 5 blocks: ${logs.length} swaps`);
  let totalWethIn = 0n;
  let totalWethOut = 0n;

  for (const log of logs) {
    const decoded = iface.parseLog({ topics: log.topics, data: log.data });
    const { amount0In, amount0Out } = decoded.args;
    totalWethIn  += BigInt(String(amount0In));
    totalWethOut += BigInt(String(amount0Out));
  }

  ctx.log(`  Net WETH flow: ${formatEther(totalWethIn - totalWethOut)} (+ = net buy pressure)`);
});
```

---

## Smart contract interaction

> **Warning: sections 14–15 use `callContract()` and `sendContract()` — NOT in the current SDK.** Use `callWithAbi()` and `execContract()` / `readContract()` instead (documented in [script-sdk.md](script-sdk.md)). Section 16 uses `rpc()` which is also not in the current SDK.

### 14. Direct AMM call (bypass SDK swap)

> **Uses `callContract` / `sendContract` — NOT in current SDK.** Replace with `callWithAbi()` and `execContract()`.

Call `swapExactIn` directly with full control over params.

```js
const POOL_ADDR = "0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81";
const WETH_ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const USDC_ADDR = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

const ERC20_ABI = ["function approve(address, uint256) returns (bool)"];
const POOL_ABI  = [
  "function swapExactIn(address, uint256, uint256, address) returns (uint256)",
  "function getAmountOut(uint256, uint256, uint256) pure returns (uint256)",
  "function getReserves() view returns (uint112, uint112, uint32)",
];

onBlock(async (ctx) => {
  if (ctx.blockNumber !== 1) return;

  await wrapEth(parseEther("5"));

  // Get quote
  const [r0, r1] = await callContract(POOL_ADDR, POOL_ABI, "getReserves");
  const amtIn    = parseEther("1");
  const expected = await callContract(POOL_ADDR, POOL_ABI, "getAmountOut", amtIn, r0, r1);
  const minOut   = BigInt(String(expected)) * 99n / 100n;

  ctx.log(`Quote: 1 WETH → ${formatUnits(expected, 6)} USDC (min: ${formatUnits(minOut, 6)})`);

  // Approve
  await sendContract(WETH_ADDR, ERC20_ABI, "approve", [POOL_ADDR, amtIn]);

  // Swap
  const { hash, gasUsed } = await sendContract(
    POOL_ADDR, POOL_ABI, "swapExactIn",
    [WETH_ADDR, amtIn, minOut, getPlayerAddress()],
  );

  const usdcBal = await getBalance("USDC");
  ctx.log(`Swapped. USDC: ${formatUnits(usdcBal, 6)}, gas: ${gasUsed}, tx: ${hash}`);
});
```

---

### 15. Deploy and call a custom contract

Deploy `AtomicArb` (from [smart-contracts.md](smart-contracts.md)) using cast, then use it from a script.

```bash
# In terminal (engine must be running):
forge create contracts/src/AtomicArb.sol:AtomicArb \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Note the deployed address, e.g.:
# Deployed to: 0x5FC8d32690cc91D4c39d9d3abcBD16989F875707
```

```js
// Use the deployed contract from a script
const ARB_ADDR  = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
const POOL_A    = "0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81";  // weth-usdc-uniswap
const POOL_B    = "0x...second pool...";
const USDC_ADDR = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const WETH_ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const ARB_ABI = [
  "function arb(address, address, address, address, uint256, uint256) returns (uint256)",
  "function withdraw(address)",
];
const ERC20_ABI = ["function transfer(address, uint256) returns (bool)"];

onBlock(async (ctx) => {
  const [pA, pB] = await Promise.all([getPrice("weth-usdc-uniswap"), getPrice("weth-usdc-sushiswap")]);
  const spread = Math.abs(pA - pB) / Math.min(pA, pB);
  if (spread < 0.006) return;

  const [cheap, dear] = pA < pB ? [POOL_A, POOL_B] : [POOL_B, POOL_A];
  const usdc = await getBalance("USDC");
  const tradeAmt = usdc * 20n / 100n;
  if (tradeAmt < parseUnits("500", 6)) return;

  // Fund the contract
  await sendContract(USDC_ADDR, ERC20_ABI, "transfer", [ARB_ADDR, tradeAmt]);

  // Execute atomic arb
  const { hash } = await sendContract(ARB_ADDR, ARB_ABI, "arb",
    [cheap, dear, USDC_ADDR, WETH_ADDR, tradeAmt, tradeAmt]);

  // Withdraw profits
  await sendContract(ARB_ADDR, ARB_ABI, "withdraw", [USDC_ADDR]);
  await sendContract(ARB_ADDR, ARB_ABI, "withdraw", [WETH_ADDR]);

  ctx.log(`[${ctx.blockNumber}] Atomic arb — ${(spread*100).toFixed(2)}% spread — tx: ${hash}`);
});
```

---

### 16. Storage slot inspection

Read internal state directly from contract storage slots.

```js
const POOL_ADDR = "0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81";

onBlock(async (ctx) => {
  if (ctx.blockNumber !== 1) return;

  // ConstantProductAMM storage layout:
  // slot 0: factory (address, 20 bytes)
  // slot 1: token0  (address, 20 bytes)
  // slot 2: token1  (address, 20 bytes)
  // slot 3: packed (reserve0 uint112, reserve1 uint112, blockTimestampLast uint32)

  const slot3 = await rpc("eth_getStorageAt", [POOL_ADDR, "0x3", "latest"]);
  log(`Raw slot 3: ${slot3}`);

  // Parse packed reserves (reserve0 = bits 0-111, reserve1 = bits 112-223)
  const packed = BigInt(slot3);
  const MASK112 = (1n << 112n) - 1n;
  const reserve0 = packed & MASK112;
  const reserve1 = (packed >> 112n) & MASK112;
  log(`reserve0: ${formatEther(reserve0)} WETH`);
  log(`reserve1: ${formatUnits(reserve1, 6)} USDC`);

  // LP balances are in a mapping at slot 5
  // To read balanceOf[myAddress]:
  const addr = getPlayerAddress();
  const paddedAddr = addr.slice(2).padStart(64, "0");
  const slot5 = "0000000000000000000000000000000000000000000000000000000000000005";
  const mapSlot = "0x" + (await rpc("eth_call", [{
    to: "0x" + "0".repeat(40),
    data: "0x" + paddedAddr + slot5,
  }, "latest"]));
  // The mapping slot key is keccak256(abi.encode(addr, slotIndex))
  // Compute this off-chain with cast or a Forge test; keccak256 is not in the SDK.
  log(`Your address: ${addr}`);
});
```

---

## Utility snippets

### Compute optimal arb size off-chain

Given two reserves and a spread, calculate how much to trade for maximum profit.

```js
// Off-chain optimal trade size for cross-pool arb
function optimalArbAmount(rIn1, rOut1, rIn2, rOut2, decimals) {
  // Newton's method on the profit function
  // Simplified: use depth to find the midpoint between the two prices
  const p1 = Number(rOut1) / Number(rIn1);
  const p2 = Number(rOut2) / Number(rIn2);
  if (p1 >= p2) return 0n;  // no arb

  // Optimal in USDC units: geometric mean of pool depths
  const opt = Math.sqrt(
    Number(rIn1) / 10 ** decimals *
    Number(rIn2) / 10 ** decimals
  ) * (Math.sqrt(p2 / p1) - 1);

  return BigInt(Math.floor(opt * 10 ** decimals));
}

onBlock(async (ctx) => {
  const { reserve0: rA0, reserve1: rA1 } = await getReserves("weth-usdc-uniswap");
  const { reserve0: rB0, reserve1: rB1 } = await getReserves("weth-usdc-sushiswap");

  // Arb: buy WETH in B (spend USDC), sell in A
  const optUsdc = optimalArbAmount(rB1, rB0, rA0, rA1, 6);
  ctx.log(`Optimal arb: ${formatUnits(optUsdc, 6)} USDC`);
});
```

---

### Time-weighted average price (TWAP)

```js
const prices = [];
let twap20 = 0;

onBlock(async (ctx) => {
  const p = await getPrice("weth-usdc-uniswap");
  prices.push(p);
  if (prices.length > 20) prices.shift();
  if (prices.length < 20) return;

  twap20 = prices.reduce((a, b) => a + b) / prices.length;
  ctx.log(`Price: $${p.toFixed(2)}, TWAP20: $${twap20.toFixed(2)}, dev: ${((p - twap20) / twap20 * 100).toFixed(2)}%`);
});
```

---

## Forge script integration

### Price-triggered Solidity exploit

Wait for a specific market condition, then execute a `forge script` automatically. Useful when the exploit logic is complex enough to warrant Solidity but the trigger timing depends on price.

```js
// When price drops below $2500, run the flash-loan exploit script
const triggerId = onPriceBelow("weth-usdc-uniswap", 2500, async (ctx) => {
  ctx.log(`Price at $${ctx.price.toFixed(2)} — launching exploit`);

  const result = await runForgeScript("script/FlashAttack.s.sol");

  if (result.success) {
    ctx.log("Exploit executed! Output:", result.output.slice(-200));
    removeTrigger(triggerId);  // fire once — remove the trigger after success
  } else {
    ctx.log(`Exploit failed (exit ${result.exitCode}):`, result.output.slice(-300));
  }
});
```

---

### Forge script with a custom entry-point signature

Forge scripts default to calling `run()`. Pass `--sig` in `opts.args` to call a different function or pass arguments:

```js
onBlock(async (ctx) => {
  if (ctx.blockNumber !== 10) return;  // run once at block 10

  const result = await runForgeScript("script/Solve.s.sol", {
    args: ["--sig", "attack(uint256)", "42"],
  });

  ctx.log(result.success
    ? `Done: ${result.output.slice(-150)}`
    : `Failed (${result.exitCode}): ${result.output.slice(-150)}`
  );
});
```

---

### Final close helper

Convert all positions back to ETH at the end of a challenge.

```js
// Call this from your existing onBlock — checks if we're near the end
async function finalClose(ctx, totalBlocks, pair) {
  if (ctx.blockNumber < totalBlocks - 3) return;
  ctx.log("Final close...");

  const weth = await getBalance("WETH");
  if (weth > 0n) await unwrapEth(weth);

  const usdc = await getBalance("USDC");
  if (usdc > parseUnits("100", 6)) {
    await swap(pair, "USDC", usdc);
    const wethFinal = await getBalance("WETH");
    if (wethFinal > 0n) await unwrapEth(wethFinal);
  }

  const eth = await getBalance("ETH");
  ctx.log(`Final ETH: ${formatEther(eth)}`);
}

const TOTAL = 500;
onBlock(async (ctx) => {
  await finalClose(ctx, TOTAL, "weth-usdc-uniswap");
  // ... rest of strategy
});
```
