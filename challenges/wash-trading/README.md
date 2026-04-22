# Wash Trading

A new NFT collection just dropped. Rarity scores are hidden — they'll be revealed at block 50.
The floor is thin. Some NFTs will be worth 10x more than others after reveal.
Can you figure out which tokens to buy before the market does?

**Win condition:** Earn **11.5 WETH in total NFT marketplace sales proceeds** (net +1.5 WETH from sales). The engine tracks WETH received from marketplace sales — buy low before rarity is revealed, sell high after.

::: spoiler Hint

The blockchain is transparent. Everything that exists on-chain can be read.

:::

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `CTFCollection` | `lib/CTFCollection.sol` | ERC-721 NFT collection with rarity scores revealed by the owner |
| `NFTMarketplace` | `lib/NFTMarketplace.sol` | Fixed-price NFT marketplace accepting WETH as payment |
