# Whale Watch

**Category:** 🟡 MEV  
**Difficulty:** Easy  
**Blocks:** 400  
**Goal:** Grow ETH balance from 10 → 14.5 ETH

## Setup

- Pool: **weth-usdc-uniswap** (WETH/USDC on Uniswap)
- One WETH/USDC pool at $3,000/WETH
- A large bot making periodic trades alongside background noise bots
- You start with 10 ETH (no stablecoins — convert first)

> **New to DeFi?** Your 10 ETH is native (unwrapped). Pools trade WETH (an ERC-20 token
> worth exactly 1 ETH). Call `wrapEth(parseEther("10"))` at the start of your script to
> convert it before swapping.

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const block   = ctx.blockNumber;
  const price   = await getPrice("weth-usdc-uniswap");
  const usdcBal = await getBalance("USDC");
  const wethBal = await getBalance("WETH");

  await swap("weth-usdc-uniswap", "USDC", amount);
  await swap("weth-usdc-uniswap", "WETH", amount);

  await wrapEth(parseEther("1"));
  await unwrapEth(parseEther("1"));
});
```
