/**
 * Off-chain replicas of the ConstantProductAMM math.
 * All formulas mirror the Solidity contract (997/1000 fee) for accurate simulation.
 */

export interface TradeEstimate {
  amountOut:    bigint;
  spotPrice:    number;    // token1 per token0 before trade (human units)
  execPrice:    number;    // effective fill price (token1 per token0, human units)
  priceImpact:  number;    // fraction, e.g. 0.01 = 1%
  feeAmount:    bigint;    // tokenIn units consumed as fee (approximate)
}

export interface DepthLevel {
  bps:         number;    // price band in basis points (10 = 0.1%, 100 = 1%, etc.)
  token0Delta: bigint;    // token0 raw units needed to move price by this bps band
  usdApprox:   number;    // approximate USD value (token0Delta × spotPrice)
}

export interface DepthData {
  spotPrice: number;
  tvlUSD:    number;      // ≈ 2 × reserve1 in human units (rough TVL estimate)
  ask:       DepthLevel[];  // cost to push price UP (buy token0)
  bid:       DepthLevel[];  // cost to push price DOWN (sell token0)
}

// ── Core AMM math ──────────────────────────────────────────────────────────────

/** Mirrors ConstantProductAMM.getAmountOut: (amountIn*997*rOut) / (rIn*1000 + amountIn*997) */
export function ammAmountOut(
  amountIn:   bigint,
  reserveIn:  bigint,
  reserveOut: bigint,
): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n;
  const withFee = amountIn * 997n;
  return withFee * reserveOut / (reserveIn * 1000n + withFee);
}

/** Estimate output and price impact for a trade (no transaction executed). */
export function calcTradeEstimate(
  amountIn:    bigint,
  reserveIn:   bigint,
  reserveOut:  bigint,
  decimalsIn:  number,
  decimalsOut: number,
): TradeEstimate {
  const scaleIn  = 10 ** decimalsIn;
  const scaleOut = 10 ** decimalsOut;

  const spotPrice   = (Number(reserveOut) / scaleOut) / (Number(reserveIn) / scaleIn);
  const amountOut   = ammAmountOut(amountIn, reserveIn, reserveOut);
  const inNorm      = Number(amountIn)  / scaleIn;
  const outNorm     = Number(amountOut) / scaleOut;
  const execPrice   = inNorm > 0 ? outNorm / inNorm : 0;
  const priceImpact = spotPrice > 0 ? Math.abs(spotPrice - execPrice) / spotPrice : 0;
  const feeAmount   = amountIn * 3n / 1000n;

  return { amountOut, spotPrice, execPrice, priceImpact, feeAmount };
}

/**
 * Maximum amountIn (in tokenIn raw units) such that price impact ≤ maxImpactFraction.
 *
 * Derivation for constant-product with fee:
 *   impact = f * amountIn / (rIn + f * amountIn)   where f = 997/1000
 *   → amountIn = impact * rIn / (f * (1 - impact))
 *             = impact * rIn * 1000 / (997 * (1 - impact))
 *
 * Converts to/from human units to avoid float precision loss on large raw reserves.
 */
export function maxTradeForImpact(
  maxImpactFraction: number,   // e.g. 0.02 for 2%
  reserveIn:         bigint,
  decimalsIn:        number,
): bigint {
  if (maxImpactFraction <= 0) return 0n;
  if (maxImpactFraction >= 1) return reserveIn;
  // Work in human units to avoid overflow with 18-decimal reserves
  const rHuman = Number(reserveIn) / 10 ** decimalsIn;
  const result = maxImpactFraction * rHuman * 1000 / (997 * (1 - maxImpactFraction));
  return BigInt(Math.max(0, Math.floor(result * 10 ** decimalsIn)));
}

// ── Depth calculation ─────────────────────────────────────────────────────────

const DEPTH_BANDS_BPS = [10, 50, 100, 500, 1000] as const;

/**
 * Liquidity depth at various price bands for a constant-product pool.
 *
 * Math: for x*y = k, to move price from p to p*(1+α):
 *   r0_new = r0 / sqrt(1 + α)
 *   Δr0 (ask) = r0 - r0_new = r0 * (1 - 1/sqrt(1+α))   [token0 bought from pool]
 *
 * To move price from p to p*(1-α):
 *   r0_new = r0 / sqrt(1 - α)
 *   Δr0 (bid) = r0_new - r0 = r0 * (1/sqrt(1-α) - 1)   [token0 sold into pool]
 *
 * Note: depth is in raw token0 units (bigint). Caller normalises with decimals0.
 */
export function calcDepth(
  reserve0:  bigint,
  reserve1:  bigint,
  decimals0: number,
  decimals1: number,
): DepthData {
  const r0raw     = Number(reserve0);
  const r1raw     = Number(reserve1);
  const scale0    = 10 ** decimals0;
  const scale1    = 10 ** decimals1;
  const spotPrice = (r1raw / scale1) / (r0raw / scale0);
  const tvlUSD    = 2 * (r1raw / scale1);

  const ask: DepthLevel[] = [];
  const bid: DepthLevel[] = [];

  for (const bps of DEPTH_BANDS_BPS) {
    const alpha = bps / 10000;

    // Ask: buy token0 from pool → price moves UP
    const askDeltaRaw = r0raw * (1 - 1 / Math.sqrt(1 + alpha));
    const askToken0   = BigInt(Math.max(0, Math.floor(askDeltaRaw)));
    ask.push({ bps, token0Delta: askToken0, usdApprox: askDeltaRaw / scale0 * spotPrice });

    // Bid: sell token0 into pool → price moves DOWN
    const bidDeltaRaw = r0raw * (1 / Math.sqrt(1 - alpha) - 1);
    const bidToken0   = BigInt(Math.max(0, Math.floor(bidDeltaRaw)));
    bid.push({ bps, token0Delta: bidToken0, usdApprox: bidDeltaRaw / scale0 * spotPrice });
  }

  return { spotPrice, tvlUSD, ask, bid };
}
