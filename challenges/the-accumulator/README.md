# The Accumulator

**Category:** 🟢 Trading  
**Difficulty:** Medium  
**Blocks:** 600  
**Goal:** Grow your portfolio value (ETH equivalent) from 10 → 11 ETH

## Setup

- Pool: **weth-usdc-uniswap** (WETH/USDC on Uniswap)
- One WETH/USDC pool at $3,000/WETH
- Multiple bots active, generating a mix of noise and directional flow
- You start with 10 ETH

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const price   = await getPrice("weth-usdc-uniswap");
  const usdcBal = await getBalance("USDC");
  const wethBal = await getBalance("WETH");

  // Fetch recent candle history
  const candles = await getPriceHistory("weth-usdc-uniswap", 30);
  // candles[i] = { open, high, low, close, volume }

  await swap("weth-usdc-uniswap", "USDC", amount);
  await swap("weth-usdc-uniswap", "WETH", amount);
});
```
