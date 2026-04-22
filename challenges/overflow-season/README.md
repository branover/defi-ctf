# Overflow Season

**Category:** ☠️ DeFi Exploit  
**Difficulty:** Easy  
**Blocks:** 80  
**Goal:** Drain the `staking` contract below 0.1 ETH (it starts with 10 ETH)

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `VulnerableStaking` | `lib/VulnerableStaking.sol` | Two-step deposit→stake contract with block-based rewards |

## Setup

- One contract: `staking` (type: `VulnerableStaking`) holding 10 ETH as the reward pool
- No pools, no bots
- Contract source is visible in the Solidity IDE under `lib/`

::: spoiler Hint

Sometimes saving gas costs more than it saves.

:::

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const player = getPlayerAddress();

  // Step 1: Deposit ETH into the contract
  await execContract("staking", "deposit", [], parseEther("1"));

  // Step 2: Stake from your deposit balance
  await execContract("staking", "stake", [parseEther("1")]);

  // Preview expected reward at a given block
  const preview = await readContract("staking", "previewReward", [player, ctx.blockNumber + 10]);

  // Claim accumulated rewards
  await execContract("staking", "claimRewards", []);

  // Unstake and recover principal
  await execContract("staking", "unstake", []);
});
```
