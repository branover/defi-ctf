# Peg Arbitrage

The USDS stablecoin has drifted 7% below its $1.00 peg due to panic selling.
The StablecoinIssuer contract will redeem USDS for USD at exactly $1.00 (minus a small fee).
Can you close the arb before the market corrects itself?

**Win condition:** Grow your USD balance from $10,000 to $10,700 (+$700 / +7%).

## Setup

- Pool: **usds-usdf-uniswap** (USDS/USDF on Uniswap)
- A `StablecoinIssuer` contract that redeems USDS at exactly $1.00 (minus 0.5% fee)
- You start with 10,000 USDF

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `StablecoinIssuer` | `lib/StablecoinIssuer.sol` | Fiat-backed stablecoin issuer that mints and redeems at a fixed rate |
