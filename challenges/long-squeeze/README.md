# Long Squeeze

Three heavily-leveraged long positions are hovering near their liquidation threshold.
The liquidation bonus goes to whoever calls `liquidate()` first.

**Win condition:** Grow your portfolio by 10 ETH equivalent.

## Setup

- Pool: **weth-usdc-uniswap** (WETH/USDC on Uniswap) at $2000/WETH (300 WETH deep — medium manipulation cost)
- MarginProtocol: `maxLTV` = 80%, `liquidationLTV` = 85%, `liquidationBonus` = 5%
- Three bot positions pre-seeded (all at ~75–77% LTV, below but near the 85% liquidation threshold):
  - Bot A: 30 WETH collateral, 45,000 USDC debt (75% LTV)
  - Bot B: 25 WETH collateral, 38,000 USDC debt (76% LTV)
  - Bot C: 20 WETH collateral, 31,000 USDC debt (77.5% LTV)
- Player starts with: 15 ETH + 125,000 USDC

::: spoiler Hint

The MarginProtocol reads WETH price from the AMM pool. Positions become liquidatable when their LTV rises above the threshold. What could cause an LTV to rise?

:::

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `MarginProtocol` | `lib/MarginProtocol.sol` | WETH-collateralized USDC borrowing with LTV-based liquidation |

## Contracts

- `MarginProtocol` — main contract. Key functions:
  - `getLTV(address borrower) → uint256` — current LTV in bps
  - `getPrice() → uint256` — current WETH price from oracle (USDC per WETH, 6 dec)
  - `liquidate(address borrower)` — liquidate an underwater position
  - `positions(address) → (collateral, debt, active)` — view a position
- Pool: `ConstantProductAMM` (Uniswap compatible) — `swapExactIn(tokenIn, amountIn, minOut, to)`
