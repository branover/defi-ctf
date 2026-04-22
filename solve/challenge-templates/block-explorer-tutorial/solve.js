// ═══════════════════════════════════════════════════════════════════════════════
// Tutorial 4: Follow the Money
// Make a swap and find your transaction in the Block Explorer.
//
// HOW TO USE THIS SCRIPT:
//   1. Start the "Follow the Money" challenge (click Start in the control panel)
//   2. Open the Block Explorer tab to see incoming bot transactions
//   3. Click Run — the script executes on the next block and your transaction
//      will appear in the Block Explorer!
//   4. Switch to the Explorer tab to see your transaction in the latest block.
//
// GOAL: Swap WETH for USDC to reach 400 USDC.
//       Then find your transaction in the Block Explorer.
// ═══════════════════════════════════════════════════════════════════════════════

// The JS SDK runs code once at load time to register triggers.
// To execute a trade immediately, register a one-shot onBlock trigger that
// removes itself after firing — this runs your code on the very next block.

const id = onBlock(async (ctx) => {
  // Remove this trigger immediately so it only fires once
  removeTrigger(id);

  // ── Step 1: Wrap your ETH into WETH ─────────────────────────────────────
  ctx.log("Wrapping 0.15 ETH → WETH...");
  await wrapEth(parseEther("0.15"));

  const wethBalance = await getBalance("WETH");
  ctx.log("WETH balance:", formatEther(wethBalance));

  // ── Step 2: Swap WETH → USDC ─────────────────────────────────────────────
  // swap(poolId, tokenIn, amountIn, minAmountOut)
  //   poolId       — "weth-usdc-uniswap"
  //   tokenIn      — "WETH"
  //   amountIn     — how much WETH to sell (as bigint in wei)
  //   minAmountOut — minimum USDC out (0n = accept any, fine for a tutorial)
  ctx.log("Swapping 0.15 WETH → USDC...");
  await swap("weth-usdc-uniswap", "WETH", parseEther("0.15"), 0n);

  // ── Step 3: Check your USDC balance ──────────────────────────────────────
  const usdcBalance = await getBalance("USDC");
  ctx.log("USDC balance:", formatUnits(usdcBalance, 6));

  // ── Step 4: Head to the Block Explorer ───────────────────────────────────
  // Click the "Explorer" tab at the top of the screen.
  // Find your transaction — it's in the most recent block and comes FROM your
  // player address. You can see: block number, gas used, calldata, and more.
  ctx.log("Done! Open the Explorer tab to see your transactions on-chain.");
});

log("Script loaded — will execute trade on the next block.");
