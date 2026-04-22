# Rarity Reveal

**Category:** trading-strategy  
**Difficulty:** medium

## Overview

40 NFTs are listed at a flat 0.1 WETH each — but their rarity scores are hidden.
All you see are "Hidden" badges.

At block 50 the owner calls `reveal()`, making rarity scores visible on-chain.

At block 80 a collector bot enters the market and eagerly buys any NFT with rarity ≥ 70
at 0.5 WETH each — a 5× premium over the list price.

## Win Condition

Grow your 5 ETH starting balance to **6 ETH** in profits from NFT sales.

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `CTFCollection` | `lib/CTFCollection.sol` | ERC-721 NFT collection with rarity scores revealed by the owner |
| `NFTMarketplace` | `lib/NFTMarketplace.sol` | Fixed-price NFT marketplace accepting WETH as payment |

## Contracts

- `collection` — CTFCollection (ERC-721 with hidden rarity)
- `marketplace` — NFTMarketplace (WETH-denominated)
