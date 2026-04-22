# The Wash

**Category:** Market Manipulation
**Difficulty:** Easy
**Blocks:** 300
**Goal:** Grow your portfolio by 2.5 ETH equivalent (need +2.5 ETH above baseline)

## Setup

A group of momentum algorithms are watching the MEME/WETH pool for unusual trading
volume. When they see a volume spike — defined as trading activity 3x above the recent
rolling average — they pile in and buy aggressively.

The irony: they don't care *who* is generating that volume. They just buy when the
numbers go up.

- Pool: **weth-meme-uniswap** (WETH/MEME on Uniswap)
- One WETH/MEME pool with thin liquidity (50 WETH / 150,000 MEME)
- Three VolumeTrackerBot instances monitoring candle volume
- One background trader establishing a low-volume baseline
- You start with 5 WETH and 10,000 MEME

::: spoiler Hint

These bots respond to what the market looks like, not what it actually is. Volume is just a number. What happens after momentum buyers pile in — and who has inventory ready to sell?

:::

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const wethBal = await getBalance("WETH");
  const memeBal = await getBalance("MEME");

  // Buy MEME with WETH
  await swap("weth-meme-uniswap", "WETH", amount);
  // Sell MEME back to WETH
  await swap("weth-meme-uniswap", "MEME", amount);

  // Check candle data to time your moves
  const candles = await getPriceHistory("weth-meme-uniswap", 10);
  const latest = candles[candles.length - 1];
  // latest.volume — cumulative token0 volume in this candle period
  // latest.close  — current price
});
```
