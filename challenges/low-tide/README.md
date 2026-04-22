# Low Tide

**Category:** 🟠 Market Manipulation  
**Difficulty:** Medium  
**Blocks:** 400  
**Goal:** Grow portfolio by 4 ETH equivalent (from 11.67 ETH to 15.67 ETH)

## Setup

- Pool: **weth-usdc-uniswap** (WETH/USDC on Uniswap)
- A thin WETH/USDC pool with limited liquidity (50 WETH at $3,000/WETH)
- Bots that respond to market trends
- You start with 10 ETH and 5,000 USDC (no initial WETH)

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
