# Three-Way Street

**Category:** 🟢 Trading  
**Difficulty:** Medium  
**Blocks:** 400  
**Goal:** Grow portfolio by 1.5 ETH equivalent (from 13.33 ETH to 14.83 ETH)

## Setup

- Pools: **weth-usdc-uniswap** (WETH/USDC on Uniswap), **weth-dai-sushiswap** (WETH/DAI on SushiSwap), **usdc-dai-curve** (USDC/DAI on Curve)
- Three pools: WETH/USDC (Uniswap at $3,100/WETH), WETH/DAI (SushiSwap at $2,900/WETH), USDC/DAI (Curve at 1.05 DAI/USDC)
- Noise bots and a slow arbitrageur keep prices moving
- You start with 10 ETH, 5,000 USDC, and 5,000 DAI

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const priceWU = await getPrice("weth-usdc-uniswap");  // USDC per WETH
  const priceWD = await getPrice("weth-dai-sushiswap");   // DAI per WETH
  const priceUD = await getPrice("usdc-dai-curve");   // DAI per USDC

  const usdcBal = await getBalance("USDC");
  const daiBal  = await getBalance("DAI");
  const wethBal = await getBalance("WETH");

  // Simulate before committing
  const out = await quoteOut("weth-usdc-uniswap", "USDC", amount);

  await swap("weth-usdc-uniswap", "USDC", amount);
  await swap("weth-dai-sushiswap",  "WETH", amount);
  await swap("usdc-dai-curve",  "DAI",  amount);
});
```
