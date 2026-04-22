# The Spread

**Category:** 🟢 Trading  
**Difficulty:** Medium  
**Blocks:** 300  
**Goal:** Grow ETH balance from 10 → 12 ETH

## Setup

- Two WETH/USDC pools: Uniswap (`weth-usdc-uniswap`) and SushiSwap (`weth-usdc-sushiswap`)
- Several bots active across both pools
- You start with 10 ETH and 2,000 USDC

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const priceA  = await getPrice("weth-usdc-uniswap");
  const priceB  = await getPrice("weth-usdc-sushiswap");
  const usdcBal = await getBalance("USDC");
  const wethBal = await getBalance("WETH");

  await swap("weth-usdc-uniswap", "USDC", amount);
  await swap("weth-usdc-sushiswap", "WETH", amount);

  // Preview output before committing
  const wethOut = await quoteOut("weth-usdc-uniswap", "USDC", amount);
});
```
