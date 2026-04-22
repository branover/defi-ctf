/** Max trade size (in token0 human units) for given slippage % on a constant-product pool. */
export function maxTradeForImpact(alphaPct: number, r0Human: number): number {
  if (alphaPct <= 0) return 0;
  const alpha = alphaPct / 100;
  return alpha * r0Human * 1000 / (997 * (1 - alpha));
}

/** Depth in token0 human units needed to move price UP by alphaPct% (ask side). */
export function askDepth(alphaPct: number, r0Human: number): number {
  const alpha = alphaPct / 100;
  return r0Human * (1 - 1 / Math.sqrt(1 + alpha));
}

/** Depth in token0 human units needed to move price DOWN by alphaPct% (bid side). */
export function bidDepth(alphaPct: number, r0Human: number): number {
  const alpha = alphaPct / 100;
  return r0Human * (1 / Math.sqrt(1 - alpha) - 1);
}

export function fmtUSD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtToken(n: number, decimals: number): string {
  if (n >= 10_000) return n.toFixed(0);
  if (n >= 1_000)  return n.toFixed(1);
  if (n >= 1)      return n.toFixed(2);
  return n.toFixed(Math.min(4, decimals));
}
