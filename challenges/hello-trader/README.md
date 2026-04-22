# Hello Trader

**Category:** Tutorial  
**Difficulty:** Beginner  
**Blocks:** 200  
**Goal:** Make a single swap — accumulate at least 500 USDC

Welcome! This is your first challenge. There are no bots, no tricks, and no time pressure.
Your only task is to execute one trade using the JavaScript SDK in the browser IDE.

## What You Need to Do

1. Click **Play** to open the trading view
2. The interactive guide will walk you through the UI
3. Open the **JS IDE** panel on the right
4. Your template script is pre-loaded — you only need to **fill in one line**
5. Click **Run** and watch your trade execute on-chain

## The Script

The template script is available in the IDE. Here is what it does:

```javascript
const id = onBlock(async (ctx) => {
  removeTrigger(id); // fire once

  // Step 1: Wrap ETH into WETH — keep some ETH as a gas reserve
  await wrapEth(parseEther("0.5"));

  // Step 2: Check your WETH balance
  const wethBal = await getBalance("WETH");
  ctx.log("WETH balance:", formatEther(wethBal));

  // Step 3: *** YOUR LINE HERE ***
  // Call swap() to exchange 0.5 WETH for USDC on the "weth-usdc-uniswap" pool.
  // Hint: await swap("weth-usdc-uniswap", "WETH", parseEther("0.5"), 0n);

  // Step 4: Verify
  const usdcBal = await getBalance("USDC");
  ctx.log("USDC balance:", formatUnits(usdcBal, 6));
});
```

## SDK Quick Reference

| Function | What it does |
|---|---|
| `wrapEth(amount)` | Convert native ETH → WETH (needed before swapping) |
| `unwrapEth(amount)` | Convert WETH → ETH |
| `getBalance("WETH")` | Check a token balance (returns bigint in wei) |
| `swap(poolId, tokenIn, amountIn, minOut)` | Execute a swap on a specific pool (use the pool ID, e.g. `"weth-usdc-uniswap"`) |
| `getPrice("weth-usdc-uniswap")` | Get the current ETH/USDC price |
| `parseEther("1")` | Convert "1" → 1000000000000000000n (wei) |
| `formatEther(bigint)` | Convert wei → human-readable string |
| `parseUnits("100", 6)` | Convert "100" → 100000000n (USDC, 6 decimals) |
| `formatUnits(bigint, 6)` | Convert USDC wei → human-readable string |

## Win Condition

Your USDC balance must reach at least **500 USDC**.
A single swap of 0.2 WETH yields ~577 USDC at the opening pool price — well above the target.
