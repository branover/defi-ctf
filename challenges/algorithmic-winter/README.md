# Algorithmic Winter

The ALGOS algorithmic stablecoin is backed by WETH reserves and uses an AMM pool as its price oracle.
Recent redemptions have pushed the system close to insolvency.

**Win condition:** Drain the AlgorithmicStablecoin contract's WETH reserves below 10 WETH.

## Setup

- Pools: **weth-usdf-uniswap** (WETH/USDF on Uniswap), **algos-weth-uniswap** (ALGOS/WETH on Uniswap)
- An `AlgorithmicStablecoin` contract using the AMM pool as its price oracle
- You start with 10 ETH

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `AlgorithmicStablecoin` | `lib/AlgorithmicStablecoin.sol` | WETH-backed stablecoin using an AMM pool as its price oracle |
