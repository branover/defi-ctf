# The Breakout

**Category:** 🟢 Trading  
**Difficulty:** Easy  
**Blocks:** 300  
**Goal:** Grow your portfolio value (ETH equivalent) from 77 → 80 ETH

## Setup

- Pool: **weth-usdc-uniswap** (WETH/USDC on Uniswap)
- One WETH/USDC pool at $3,000/WETH
- Several bots trading the pool: a range-keeper holding price tight, and one large actor waiting in the wings
- You start with 10 ETH and 200,000 USDC (total portfolio ~77 ETH equivalent)

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const price   = await getPrice("weth-usdc-uniswap");
  const usdcBal = await getBalance("USDC");
  const wethBal = await getBalance("WETH");

  await swap("weth-usdc-uniswap", "USDC", amount);
  await swap("weth-usdc-uniswap", "WETH", amount);
});

// Price trigger helpers
onPriceAbove("weth-usdc-uniswap", targetPrice, async (ctx) => { /* ... */ });
onPriceBelow("weth-usdc-uniswap", targetPrice, async (ctx) => { /* ... */ });
```
