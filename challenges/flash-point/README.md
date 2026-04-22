# Flash Point

**Category:** ☠️ DeFi Exploit  
**Difficulty:** Medium  
**Blocks:** 100  
**Goal:** Grow portfolio to 12.5 ETH equivalent (from 10 ETH)

## Setup

- Pools: **weth-usdc-uniswap** (WETH/USDC on Uniswap), **weth-dai-sushiswap** (WETH/DAI on SushiSwap), **usdc-dai-curve** (USDC/DAI on Curve)
- Three deep pools: WETH/USDC (Uniswap) at $3,200, WETH/DAI (SushiSwap) at $2,900, USDC/DAI (Curve) at 1.05 DAI/USDC
- A `FlashLoanProvider` contract holding 10M USDC and 10M DAI
- A slow arbitrageur bot gradually closing the price gaps
- You start with 10 ETH only (no starting USDC or DAI)

::: spoiler Hint

The pools start at different prices. Flash loans let you act at scale without locking up your own capital.

:::

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const flashloanAddr = getContractAddress("flashloan");
  const player = getPlayerAddress();

  // Get token addresses via the connection_info API.
  // Token contracts are NOT challenge contracts, so getContractAddress() won't work.
  // Fetch them from the API once on block 1:
  const info = await fetch("/api/connection_info").then(r => r.json());
  const usdcAddr = info.tokens.USDC;   // e.g. "0x9fE467..."
  const daiAddr  = info.tokens.DAI;    // e.g. "0xDc64a..."

  // Flash loan (EIP-3156 — repayment enforced atomically via onFlashLoan callback).
  // Use the Solidity IDE (Script.s.sol) to write a contract that implements onFlashLoan.
  // JS-side scripts cannot issue same-transaction callbacks; use forge scripts for flash loans.
  const maxLoan = await readContract("flashloan", "maxFlashLoan", [usdcAddr]);
  const fee     = await readContract("flashloan", "flashFee",     [usdcAddr, maxLoan]);
  // Flash loan is issued to a contract that implements onFlashLoan(token, amount, fee, initiator, data)
  // and returns keccak256("FlashLoanProvider.onFlashLoan"). Fee is 0.05% (5 bps, ceiling-rounded).

  // ... execute your trades inside the onFlashLoan callback ...

  // Pool swaps — use poolId strings (not token addresses)
  await swap("weth-usdc-uniswap", "USDC", amount);
  await swap("weth-dai-sushiswap",  "WETH", amount);
  await swap("usdc-dai-curve",  "DAI",  amount);

  // Simulate output before committing
  const out = await quoteOut("weth-usdc-uniswap", "USDC", amount);
});
```

> **Tip:** You can also get token addresses from the Solidity IDE after running `./env.sh`
> (exported as `TOKEN_USDC`, `TOKEN_DAI`), or by calling `GET /api/connection_info` from any HTTP client.

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `FlashLoanProvider` | `lib/FlashLoanProvider.sol` | General-purpose flash loan provider charging 0.05% fee |
