# Admin Who?

**Category:** ☠️ DeFi Exploit  
**Difficulty:** Easy  
**Blocks:** 40  
**Goal:** Drain the `vault` contract below 0.1 ETH (it starts with 3 ETH)

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `UnprotectedOwnership` | `lib/UnprotectedOwnership.sol` | Vault contract holding 3 ETH |

## Setup

- One contract: `vault` (type: `UnprotectedOwnership`) holding 3 ETH
- No pools, no bots
- Contract source is visible in the Solidity IDE under `lib/`

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const player = getPlayerAddress();

  // Inspect vault state
  const owner   = await readContract("vault", "owner", []);
  const balance = await readContract("vault", "vaultBalance", []);

  // Call vault functions
  await execContract("vault", "functionName", [arg]);
});
```
