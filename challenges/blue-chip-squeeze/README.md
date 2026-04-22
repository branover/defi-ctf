# Blue Chip Squeeze

**Category:** market-manipulation  
**Difficulty:** hard

## Overview

The marketplace has 10 rare NFTs (rarity 90-100) priced at 2 WETH each. You
start with 10 ETH, 5 common NFTs (rarity 3-9), and 2 rare NFTs (rarity 85 and 90).

Two bots are watching the marketplace:

- **FOMO Buyer**: Snaps up cheap listings below a certain price threshold — watch the tx history to learn its timing.
- **Collector**: Pays a premium for high-rarity NFTs — it enters the scene later in the challenge.

## Win Condition

Earn **11.5 WETH in total NFT marketplace sales proceeds** before the timer expires. The engine tracks WETH received from NFT sales — position ahead of the bots to capture their demand.

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `CTFCollection` | `lib/CTFCollection.sol` | ERC-721 NFT collection with rarity scores revealed by the owner |
| `NFTMarketplace` | `lib/NFTMarketplace.sol` | Fixed-price NFT marketplace accepting WETH as payment |

## Contracts

- `collection` — CTFCollection (revealed at block 1)
- `marketplace` — NFTMarketplace (WETH-denominated)
