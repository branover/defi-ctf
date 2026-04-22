# Sandwich Artist

**Category:** 🟡 MEV  
**Difficulty:** Medium  
**Blocks:** 350  
**Goal:** Grow ETH balance from 10 → 13 ETH

## Setup

- Pool: **weth-usdc-uniswap** (WETH/USDC on Uniswap)
- One WETH/USDC pool at $3,000/WETH
- A well-capitalized bot that responds strongly to certain price conditions
- Background noise and occasional large random sells
- You start with 10 ETH and 200,000 USDC

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const price   = await getPrice("weth-usdc-uniswap");
  const usdcBal = await getBalance("USDC");
  const wethBal = await getBalance("WETH");

  await swap("weth-usdc-uniswap", "USDC", amount);
  await swap("weth-usdc-uniswap", "WETH", amount);

  await wrapEth(parseEther("1"));
  await unwrapEth(parseEther("1"));
});
```
