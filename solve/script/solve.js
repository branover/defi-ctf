// ─────────────────────────────────────────────────────────────────────────────
// solve.js — Master JS solve template
//
// Scripts run in a Node.js vm sandbox with the SDK injected as globals.
// No require / import — everything is already in scope.
//
// Execution model:
//   - The script body runs ONCE on submit (≤5 second budget).
//   - Use that time to register triggers and set up state.
//   - Triggers (onBlock, onPriceBelow, onPriceAbove) fire each block asynchronously.
//   - All SDK calls are async — use await inside trigger callbacks.
// ─────────────────────────────────────────────────────────────────────────────

// ── Working example: buy-the-dip strategy ────────────────────────────────────
// Buys WETH when price drops below BUY_BELOW, sells when it rises above SELL_ABOVE.
// Remove or replace this with your own strategy.

const POOL   = "weth-usdc-uniswap";
const BUY_BELOW  = 2800;   // buy WETH when price drops here
const SELL_ABOVE = 3200;   // sell WETH when price rises here

let bought = false;

const buyId = onPriceBelow(POOL, BUY_BELOW, async (ctx) => {
  if (bought) return;
  const usdc = await getBalance("USDC");
  if (usdc < parseUnits("100", 6)) { ctx.log("Not enough USDC"); return; }

  const half = usdc / 2n;
  await swap(POOL, "USDC", half);
  bought = true;
  ctx.log(`Bought WETH @ $${ctx.price.toFixed(2)} (block ${ctx.blockNumber})`);
}, "Buy the dip");

onPriceAbove(POOL, SELL_ABOVE, async (ctx) => {
  if (!bought) return;
  const weth = await getBalance("WETH");
  if (weth === 0n) return;

  await swap(POOL, "WETH", weth);
  bought = false;
  ctx.log(`Sold WETH @ $${ctx.price.toFixed(2)} (block ${ctx.blockNumber})`);
  removeTrigger(buyId);  // optional: stop buying after first cycle
}, "Sell the rip");

// ─────────────────────────────────────────────────────────────────────────────
// SDK REFERENCE (everything below is commented out — uncomment what you need)
// ─────────────────────────────────────────────────────────────────────────────

// ── Balances & prices ─────────────────────────────────────────────────────────
//
// const eth  = await getBalance("ETH");    // native ETH in wei
// const weth = await getBalance("WETH");   // WETH in wei
// const usdc = await getBalance("USDC");   // USDC in 10^-6 units
// log(`ETH:  ${formatEther(eth)}`);
// log(`USDC: ${formatUnits(usdc, 6)}`);
//
// const price = await getPrice("weth-usdc-uniswap");         // spot price: USDC per WETH (number)
// const { reserve0, reserve1 } = await getReserves("weth-usdc-uniswap");
// log(`Price: $${price.toFixed(2)}, TVL: $${(Number(reserve1)/1e6*2).toLocaleString()}`);

// ── Swaps ─────────────────────────────────────────────────────────────────────
//
// Sell all USDC for WETH:
//   const usdc = await getBalance("USDC");
//   const wethOut = await swap("weth-usdc-uniswap", "USDC", usdc);
//   log(`Got ${formatEther(wethOut)} WETH`);
//
// With slippage protection (revert if output < 99% of quote):
//   const expected = await quoteOut("weth-usdc-uniswap", "WETH", parseEther("5"));
//   const minOut   = expected * 99n / 100n;
//   await swap("weth-usdc-uniswap", "WETH", parseEther("5"), minOut);

// ── Wrap / unwrap ETH ─────────────────────────────────────────────────────────
//
// await wrapEth(parseEther("10"));
// const weth = await getBalance("WETH");
// log(`WETH: ${formatEther(weth)}`);
//
// await unwrapEth(weth);
// log(`ETH: ${formatEther(await getBalance("ETH"))}`);

// ── Liquidity ─────────────────────────────────────────────────────────────────
//
// Add liquidity (token order = address-sorted; check symbol0/symbol1 via getReserves):
//   const { reserve0, reserve1 } = await getReserves("weth-usdc-uniswap");
//   const wethIn = parseEther("1");
//   const usdcIn = wethIn * reserve1 / reserve0;
//   const { shares } = await addLiquidity("weth-usdc-uniswap", wethIn, usdcIn);
//   log(`LP shares: ${shares}`);
//
// Remove liquidity:
//   const shares = await getLPBalance("weth-usdc-uniswap");
//   const { amount0, amount1 } = await removeLiquidity("weth-usdc-uniswap", shares);
//   log(`Got ${formatEther(amount0)} WETH + ${formatUnits(amount1, 6)} USDC`);

// ── Triggers ──────────────────────────────────────────────────────────────────
//
// Fire every block:
//   const id = onBlock(async (ctx) => {
//     ctx.log(`block ${ctx.blockNumber}, timestamp ${ctx.timestamp}`);
//     if (ctx.blockNumber >= 50) removeTrigger(id);
//   }, "My watcher");
//
// Fire while price < threshold:
//   const id = onPriceBelow("weth-usdc-uniswap", 2500, async (ctx) => {
//     ctx.log(`Dip! price=$${ctx.price.toFixed(2)}`);
//     removeTrigger(id);  // one-shot
//   });
//
// Fire while price > threshold:
//   onPriceAbove("weth-usdc-uniswap", 3500, async (ctx) => {
//     ctx.log(`Pump! price=$${ctx.price.toFixed(2)}`);
//   });
//
// Cancel a trigger from anywhere:
//   removeTrigger(id);

// ── Price history & candles ───────────────────────────────────────────────────
//
// const candles = await getPriceHistory("weth-usdc-uniswap", 20);  // last 20 blocks
// const closes  = candles.map(c => c.close);
// const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
// log(`SMA-${closes.length}: $${sma.toFixed(2)}`);

// ── Challenge contracts ───────────────────────────────────────────────────────
//
// Get a deployed contract address:
//   const addr = getContractAddress("vault");
//
// Read a view function:
//   const owner = await readContract("vault", "owner");
//   const bal   = await readContract("vault", "balanceOf", [getPlayerAddress()]);
//
// Call a state-changing function:
//   const { hash } = await execContract("vault", "drain");
//   await execContract("vault", "deposit", [], parseEther("1"));  // with ETH value
//
// Call any contract with a custom ABI:
//   const { hash } = await callWithAbi(
//     proxyAddress,
//     ["function drainAll(address to)"],
//     "drainAll",
//     [getPlayerAddress()],
//   );

// ── Token approval ────────────────────────────────────────────────────────────
//
// await approveToken("USDC", vaultAddr, parseUnits("1000", 6));

// ── Chain history ─────────────────────────────────────────────────────────────
//
// Block 1 contains challenge setup transactions — useful for decoding init calldata:
//   const txs = await getBlockTransactions(1);
//   for (const tx of txs) log(`${tx.hash}: ${tx.data.slice(0, 10)}`);
//
// Decode ABI-encoded calldata (strip 4-byte selector first):
//   const data = "0x" + tx.data.slice(10);
//   const [secret] = decodeCalldata(["string"], data);
//   log(`Secret: ${secret}`);

// ── Run a Solidity forge script from JS ───────────────────────────────────────
//
// const result = await runForgeScript("script/Solve.s.sol");
// if (result.success) {
//   log("Forge script succeeded:", result.output.slice(-200));
// } else {
//   log("Forge script failed (exit", result.exitCode + "):", result.output.slice(-300));
// }
//
// Trigger Solidity exploit on price condition:
//   const id = onPriceBelow("weth-usdc-uniswap", 2500, async (ctx) => {
//     ctx.log(`Price $${ctx.price.toFixed(2)} — running exploit`);
//     const res = await runForgeScript("script/Solve.s.sol");
//     if (res.success) removeTrigger(id);
//   });

// ── Utilities ─────────────────────────────────────────────────────────────────
//
// parseEther("1.5")           → 1500000000000000000n  (wei)
// formatEther(1500000000000000000n) → "1.5"
// parseUnits("100", 6)        → 100000000n            (USDC)
// formatUnits(100000000n, 6)  → "100.0"
// getPlayerAddress()          → "0xABCD..."
// log("hello", 42, { foo: 1 })          // writes to Script Log panel
// console.log / console.warn / console.error  // alias for log
