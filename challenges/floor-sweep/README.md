# Floor Sweep

The floor is getting hammered by a panic seller, but a market maker keeps buying the dips.
If you can front-run the market maker's buys and sweep the floor first, you can relist at a premium.

**Win condition:** Earn **5.5 WETH in total NFT marketplace sales proceeds** (net +0.5 WETH from sales). The engine tracks WETH received from marketplace sales.

::: spoiler Hint

The market maker has a price it will pay. Study its behavior and position accordingly.

:::

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `CTFCollection` | `lib/CTFCollection.sol` | ERC-721 NFT collection with rarity scores revealed by the owner |
| `NFTMarketplace` | `lib/NFTMarketplace.sol` | Fixed-price NFT marketplace accepting WETH as payment |
