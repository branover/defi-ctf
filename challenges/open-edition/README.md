# Open Edition

**Category:** defi-exploit  
**Difficulty:** easy

## Overview

An NFT collection has been deployed. A collector bot is actively monitoring the marketplace
and buying any NFT with rarity ≥ 75 at 0.5 WETH each.

## Win Condition

Earn **1 ETH total** from NFT sales (starting from 0 ETH in sales profit).
Your 2 ETH starting balance is for gas and WETH wrapping if needed.

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `UnprotectedCollection` | `lib/UnprotectedCollection.sol` | ERC-721 NFT collection with open minting |
| `NFTMarketplace` | `lib/NFTMarketplace.sol` | Fixed-price NFT marketplace accepting WETH as payment |

## Contracts

- `collection` — `UnprotectedCollection`
- `marketplace` — NFTMarketplace (WETH-denominated)
