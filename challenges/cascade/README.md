# Cascade

Five overleveraged positions near their liquidation threshold.
Each liquidation returns collateral to the liquidator.

**Win condition:** Grow your portfolio by 10 ETH equivalent.

## Setup

- Pool: **weth-usdc-uniswap** (WETH/USDC on Uniswap) at $2000/WETH (200 WETH)
- MarginProtocol: `maxLTV` = 80%, `liquidationLTV` = 83%, `liquidationBonus` = 6%
- Five bot positions pre-seeded at staggered LTVs (70–78%), each liquidating at a different price level:
  - Bot A: 50 WETH collateral, 78,000 USDC debt (78% LTV — liquidates first)
  - Bot B: 40 WETH collateral, 60,800 USDC debt (76% LTV)
  - Bot C: 35 WETH collateral, 51,800 USDC debt (74% LTV)
  - Bot D: 30 WETH collateral, 43,200 USDC debt (72% LTV)
  - Bot E: 25 WETH collateral, 35,000 USDC debt (70% LTV — liquidates last)
- Player starts with: 15 ETH + 305,000 USDC

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `MarginProtocol` | `lib/MarginProtocol.sol` | WETH-collateralized USDC borrowing with LTV-based liquidation |

## Contracts

- `MarginProtocol` — main contract. Key functions:
  - `getLTV(address borrower) → uint256` — current LTV in bps (>8300 = liquidatable)
  - `getPrice() → uint256` — WETH/USDC spot price from oracle (6 decimal precision)
  - `liquidate(address borrower)` — liquidate an underwater position
  - `positions(address) → (collateral, debt, active)` — inspect any position
- Pool: `ConstantProductAMM` (Uniswap compatible) — `swapExactIn(tokenIn, amountIn, minOut, to)`

## Bot addresses

Use `getLTV(address)` to check each position. Bot addresses are visible in the connection info
(available via the in-browser IDE or `GET /api/connection_info`).
