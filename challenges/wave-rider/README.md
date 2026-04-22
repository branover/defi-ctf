# Riding the Wave

**Category:** 🟢 Trading  
**Difficulty:** Easy  
**Blocks:** 500  
**Goal:** Grow ETH balance from 10 → 13 ETH

## Setup

- Pool: **weth-usdc-uniswap** (WETH/USDC on Uniswap)
- One WETH/USDC pool starting at ~$3,000/WETH
- Multiple bots trading the pool with varying styles and trade sizes
- You start with 10 ETH and 150,000 USDC

> **New to DeFi?** Your 10 ETH is native (unwrapped). Pools trade WETH (an ERC-20 token
> worth exactly 1 ETH). Call `wrapEth(parseEther("10"))` at the start of your script to
> convert it before swapping.

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const price    = await getPrice("weth-usdc-uniswap");
  const usdcBal  = await getBalance("USDC");
  const wethBal  = await getBalance("WETH");

  // Swap USDC → WETH
  await swap("weth-usdc-uniswap", "USDC", amount);

  // Swap WETH → USDC
  await swap("weth-usdc-uniswap", "WETH", amount);

  // Wrap ETH to WETH / unwrap back
  await wrapEth(parseEther("1"));
  await unwrapEth(parseEther("1"));
});

// Price trigger helpers
onPriceBelow("weth-usdc-uniswap", 2700, async (ctx) => { /* ... */ });
onPriceAbove("weth-usdc-uniswap", 3300, async (ctx) => { /* ... */ });
```
