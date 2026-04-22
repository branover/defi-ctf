// ═══════════════════════════════════════════════════════════════════════════════
// Tutorial 1: Hello Trader
// Your first trade on a live blockchain simulation.
//
// HOW TO USE THIS SCRIPT:
//   1. Start the "Hello Trader" challenge (click Start in the control panel)
//   2. The interactive guide bubbles will walk you through the UI
//   3. Find the one line marked "YOUR LINE HERE" below and fill it in
//   4. Click Run — watch the trade execute in real time on the Explorer tab!
//
// GOAL: Execute one swap to prove you know how to use the SDK.
//       Your USDC balance needs to reach 500 USDC (you start with 1 ETH).
// ═══════════════════════════════════════════════════════════════════════════════

// The JS SDK registers triggers at load time. To execute trades, wrap your code
// in a one-shot onBlock trigger that removes itself after firing.

const id = onBlock(async (ctx) => {
  // Remove this trigger immediately so it only fires once
  removeTrigger(id);

  // ── Step 1: Wrap your ETH into WETH ─────────────────────────────────────────
  // The trading pool works with WETH (an ERC-20 token), not native ETH.
  // wrapEth() locks your ETH in the WETH contract and gives you WETH in return.
  // It costs exactly 1:1 — 0.5 ETH in, 0.5 WETH out.
  // (Keep some ETH as a gas reserve — never wrap your entire balance.)

  ctx.log("Wrapping 0.5 ETH → WETH...");
  await wrapEth(parseEther("0.5"));

  // ── Step 2: Confirm your balance ─────────────────────────────────────────────
  // getBalance() returns a bigint in wei (the smallest ETH unit).
  // formatEther() converts it to a human-readable decimal string.

  const wethBalance = await getBalance("WETH");
  ctx.log("WETH balance:", formatEther(wethBalance));

  // ── Step 3: YOUR LINE HERE ────────────────────────────────────────────────────
  // Swap 0.5 WETH for USDC on the "weth-usdc-uniswap" pool.
  //
  // The swap() function signature is:
  //   await swap(poolId, tokenIn, amountIn, minAmountOut)
  //
  //   poolId       — the pool to trade on: "weth-usdc-uniswap"
  //   tokenIn      — the token you are selling: "WETH"
  //   amountIn     — how much to sell (as bigint in wei): parseEther("0.5")
  //   minAmountOut — minimum you'll accept (0n = no slippage protection, fine here)
  //
  // Delete the comment markers below and complete the call:

  // await swap("weth-usdc-uniswap", "WETH", parseEther("0.5"), 0n);

  // ── Step 4: Check the result ──────────────────────────────────────────────────
  // USDC uses 6 decimal places (not 18 like ETH/WETH).
  // formatUnits(amount, 6) converts the raw bigint into a readable USDC amount.

  const usdcBalance = await getBalance("USDC");
  ctx.log("USDC balance:", formatUnits(usdcBalance, 6));

  const ethBalance = await getBalance("ETH");
  ctx.log("Native ETH remaining:", formatEther(ethBalance));

  ctx.log("Done! Check the Explorer tab to see your transaction on-chain.");
});

log("Script loaded — trade will execute on the next block.");
