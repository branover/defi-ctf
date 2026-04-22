import type { ChallengeManifest } from "./ChallengeLoader.js";

/** Unified field set returned by both HTTP /api/challenges and WS `challenges` messages. */
export interface ChallengeCard {
  id:           string;
  name:         string;
  description:  string;
  category:     string | null;
  difficulty:   string | null;
  tags:         string[];
  hasNft:       boolean;
  blockCount:   number;
  metric:       string;
  target:       string;
  targetToken:  string;
  startingValue: string;
  order:        number | null;
  pools: Array<{
    id:          string;
    tokenA:      string;
    tokenB:      string;
    exchange:    string;
    displayName: string;
  }>;
}

/** Convert a raw-wei threshold string to a human-readable amount using the token's decimals. */
function formatThreshold(thresholdStr: string, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const val     = BigInt(thresholdStr);
  const whole   = val / divisor;
  const frac    = val % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 4);
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/**
 * Build a unified challenge catalogue card from a manifest.
 * Used by both the HTTP /api/challenges endpoint and the WS `challenges` message
 * to guarantee both transports return identical field sets.
 */
export function buildChallengeCard(c: ChallengeManifest): ChallengeCard {
  let target: string;
  let targetToken: string;
  if ("target" in c.win) {
    target      = c.win.target;
    targetToken = "ETH";
  } else {
    // drainContract: threshold is in the token's native units (wei for 18-dec, μUSDC for 6-dec)
    const sym      = c.win.tokenSymbol ?? "ETH";
    const tokenDef = c.tokens.find(t => t.symbol.toUpperCase() === sym.toUpperCase());
    const decimals = tokenDef?.decimals ?? 18;
    target      = formatThreshold(c.win.threshold, decimals);
    targetToken = sym;
  }

  return {
    id:           c.id,
    name:         c.name,
    description:  c.description,
    category:     c.category ?? null,
    difficulty:   c.difficulty ?? null,
    tags:         c.tags,
    hasNft:       c.nftMints.length > 0 || c.contracts.some(x => x.type === "NFTMarketplace"),
    blockCount:   c.chain.blockCount,
    metric:       c.win.metric,
    target,
    targetToken,
    startingValue: "startingValue" in c.win
      ? c.win.startingValue
      : (c.player?.startingEth ?? "10"),
    order:        c.order ?? null,
    pools: c.pools.map(p => ({
      id:          p.id,
      tokenA:      p.tokenA,
      tokenB:      p.tokenB,
      exchange:    p.exchange ?? "unknown",
      displayName: p.displayName ?? "DEX",
    })),
  };
}
