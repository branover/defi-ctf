# Leaky Vault

**Category:** ☠️ DeFi Exploit  
**Difficulty:** Easy  
**Blocks:** 60  
**Goal:** Drain the `vault` contract below 0.1 ETH (it starts with 5 ETH)

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `VulnerableVault` | `lib/VulnerableVault.sol` | ETH vault contract |
| `ReentrancyAttacker` | `lib/ReentrancyAttacker.sol` | Helper contract for interacting with the vault |

## Setup

- Two contracts: `vault` (type: `VulnerableVault`) holding 5 ETH, and `attacker` (type: `ReentrancyAttacker`) already pointed at the vault
- No pools, no bots
- Contract sources are visible in the Solidity IDE under `lib/`

## SDK Reference

```javascript
onBlock(async (ctx) => {
  // Inspect vault state
  const totalBal = await readContract("vault", "totalBalance", []);
  const myBal    = await readContract("vault", "balances", [getPlayerAddress()]);

  // VulnerableVault functions
  await execContract("vault", "deposit", [], parseEther("1"));  // deposit ETH
  await execContract("vault", "withdraw", [amount]);

  // ReentrancyAttacker functions
  await execContract("attacker", "attack", [], parseEther("1"));
  await execContract("attacker", "withdraw", []);
  const attackerBal = await readContract("attacker", "balance", []);
});
```
