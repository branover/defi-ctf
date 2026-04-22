# Pool Snatcher

**Category:** ☠️ DeFi Exploit  
**Difficulty:** Hard  
**Goal:** Earn 12 WETH in total NFT marketplace sales proceeds

---

## Background

A well-funded collector is slowly building a portfolio of rare NFTs. Rather than listing
them on the open market, they're depositing the NFTs directly into a liquidity vault —
a cutting-edge Sudoswap-style pool that holds ERC-721 positions alongside token reserves.

The collector makes deposits on a regular schedule. Watch the block explorer and you'll
see the pattern.

There's just one problem: this pool smells off. Pull up the source code in the IDE and
look carefully at the contract that sits behind the vault. Something important was
never finished.

---

## Setup

- Pool: **weth-meme-uniswap** (WETH/MEME on Uniswap)
- An `UpgradeableAMM` proxy vault with an uninitialized implementation
- A collector bot depositing NFTs on a regular schedule
- You start with 10 ETH

---

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `UpgradeableAMM` | `lib/UpgradeableAMM.sol` | Upgradeable proxy vault used by the collector to deposit NFTs |
| `ConstantProductAMMImpl` | `lib/ConstantProductAMMImpl.sol` | Pool implementation with NFT deposit/withdraw support |
| `CTFCollection` | `lib/CTFCollection.sol` | ERC-721 NFT collection holding the collector's rare items |
| `NFTMarketplace` | `lib/NFTMarketplace.sol` | Fixed-price NFT marketplace accepting WETH as payment |

---

::: spoiler Hints

- Not every deployed contract is a finished contract.
- Ownerless proxies have a very interesting property.
- The collector trusts the vault completely before handing anything over. That trust is granted once and never revoked.
- Stealing the NFTs is step one. Step two is turning them into WETH.
- There's already a buyer in the market — you just need to give them something to buy.

:::

---

## Win Condition

Accumulate **12 WETH in total NFT sales proceeds** before the 250-block timer expires.

Stealing the NFTs gets you the raw assets. To win, you must **sell them** on the
NFTMarketplace. There is already a bot eager to buy — but only at the right price.
