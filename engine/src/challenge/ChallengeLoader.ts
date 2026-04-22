import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { config } from "../config.js";

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const TokenSchema = z.object({
  symbol:             z.string(),
  decimals:           z.number().int(),
  type:               z.enum(["weth", "erc20", "usd"]),
  mintAmount:         z.string().optional(), // minted to player + each bot
  botMintAmount:      z.string().optional(), // minted to each bot ONLY (not player)
  deployerMintAmount: z.string().optional(), // minted to treasury (signer 9) for pool seeding
});

const PoolSchema = z.object({
  id:              z.string(),
  tokenA:          z.string(),
  tokenB:          z.string(),
  initialReserveA: z.string(),
  initialReserveB: z.string(),
  exchange:        z.string().default("uniswap"),  // e.g. "uniswap", "sushiswap"
  displayName:     z.string().optional(),             // e.g. "Uniswap", "SushiSwap"
});

const BotSchema = z.object({
  id:          z.string(),
  personality: z.string(),
  account:     z.number().int(),
  params:      z.record(z.union([z.number(), z.string()])),
});

/** One extra contract to deploy at challenge start. */
const ContractDeploySchema = z.object({
  id:     z.string(),
  type:   z.string(),  // must match forge artifact: contracts/out/{type}.sol/{type}.json
  params: z.array(z.union([z.string(), z.number(), z.boolean()])).default([]),
  /** Seed the contract with tokens/ETH after deployment */
  fund: z.array(z.object({
    tokenSymbol: z.string(),   // "ETH" or a token symbol from the tokens array
    amount:      z.string(),   // human-readable amount (ether / token units)
  })).optional(),
  /**
   * ETH (in ether) to send as msg.value with the constructor call.
   * Use this for payable constructors that must receive ETH at deployment time
   * (e.g. a prize-pool contract that sets prizePool = msg.value).
   */
  constructorValue: z.string().optional(),
  /** For nft-collection: reference to the collection contractId (resolved to address at deploy time) */
  collectionId: z.string().optional(),
  /**
   * For upgradeable-erc20: register the deployed proxy address as this token symbol
   * in the pool registry so AMM pools can reference it.
   */
  tokenSymbol: z.string().optional(),
  /**
   * Bot volume seeds for trading-competition contracts.
   * Each entry causes the specified bot signer to call recordTrade() with the
   * given volume amount immediately after deployment, before the competition ends.
   */
  botVolumes: z.array(z.object({
    /** Signer index (1 = first bot account, 2 = second, etc.) */
    signerIndex: z.number().int(),
    /** Volume to record (in whole units — passed directly as uint256 to recordTrade) */
    volume:      z.string(),
  })).optional(),
});

/** A single NFT mint to perform after collection + marketplace are deployed. */
const NftMintSchema = z.object({
  contractId:   z.string(),  // which nft-collection contract to mint from
  tokenId:      z.number(),  // expected tokenId (informational; actual is sequential)
  recipient:    z.enum(["player", "marketplace", "bot0", "bot1", "bot2", "bot3", "bot4", "bot5"]),
  rarityScore:  z.number().min(1).max(100),
  listed:       z.boolean().optional(),        // auto-list in marketplace after minting
  listingPrice: z.string().optional(),         // WETH amount (human-readable)
  marketplaceId: z.string().optional(),        // which marketplace contractId to list on
});

/** Optional player-specific balance overrides. */
const PlayerSchema = z.object({
  startingEth:    z.string().optional(),  // set native ETH balance for player (via anvil_setBalance)
  startingTokens: z.array(z.object({
    symbol: z.string(),
    amount: z.string(),
  })).optional(),
}).optional();

// ── Win condition — discriminated union ───────────────────────────────────────

/** Classic profit-relative win: grow your portfolio past the target. */
const WinSchemaProfit = z.object({
  playerAccount: z.number().int().default(0),
  metric:        z.enum(["ethBalance", "tokenBalance", "portfolioValueInEth", "usdBalance", "nftSalesProfit"]),
  tokenSymbol:   z.string().optional(),
  startingValue: z.string(),
  target:        z.string(),
});

/**
 * Drain win: a deployed challenge contract must have its ETH (or token) balance
 * drop below `threshold` (raw wei string).
 */
const WinSchemaDrain = z.object({
  playerAccount: z.number().int().default(0),
  metric:        z.literal("drainContract"),
  contractId:    z.string(),             // id from contracts array
  threshold:     z.string(),             // win when balance < threshold (wei)
  tokenSymbol:   z.string().optional(),  // omit → check native ETH balance
});

const WinSchema = z.discriminatedUnion("metric", [
  WinSchemaProfit,
  WinSchemaDrain,
]);

/** A leveraged position to seed on behalf of a bot account at challenge start. */
const BotPositionSchema = z.object({
  /** Bot account index (matches bot.account in the bots array). */
  botAccount:     z.number().int(),
  /** WETH collateral to deposit (human-readable, e.g. "30"). */
  wethCollateral: z.string(),
  /** USDC to borrow (human-readable, e.g. "40000"). */
  usdcToBorrow:   z.string(),
  /** Id of the margin-protocol contract (from contracts array) to open the position on. */
  contractId:     z.string(),
});

// ── Root manifest schema ──────────────────────────────────────────────────────

export const ChallengeManifestSchema = z.object({
  id:          z.string(),
  name:        z.string(),
  description: z.string(),
  version:     z.string().default("1.0.0"),

  // Metadata
  category:   z.enum(["tutorial", "trading-strategy", "market-manipulation", "defi-exploit"]).optional(),
  difficulty: z.enum(["beginner", "easy", "medium", "hard", "expert"]).optional(),
  tags:       z.array(z.string()).default([]),
  order:      z.number().int().optional(),

  chain: z.object({
    blockCount:      z.number().int(),
    blockIntervalMs: z.number().int(),
    botSeed:         z.number().int(),
    blocksPerCandle: z.number().int().default(10),
  }),

  tokens:    z.array(TokenSchema),
  pools:     z.array(PoolSchema),
  bots:      z.array(BotSchema),
  contracts:    z.array(ContractDeploySchema).default([]),
  botPositions: z.array(BotPositionSchema).default([]),
  nftMints:     z.array(NftMintSchema).default([]),
  /** Trigger reveal() on an nft-collection contract at a specific block. */
  nftReveal:    z.object({
    contractId: z.string(),
    atBlock:    z.number().int(),
  }).optional(),
  player:       PlayerSchema,
  win:          WinSchema,
});

export type ChallengeManifest = z.infer<typeof ChallengeManifestSchema>;
export type ContractDeploySpec = z.infer<typeof ContractDeploySchema>;

// ── Loader ────────────────────────────────────────────────────────────────────

export class ChallengeLoader {
  private challenges    = new Map<string, ChallengeManifest>();
  /** Absolute path to each challenge's directory (for README serving). */
  private challengeDirs = new Map<string, string>();

  load(): Map<string, ChallengeManifest> {
    const root = config.challengesDir;
    if (!existsSync(root)) {
      console.warn(`[ChallengeLoader] directory not found: ${root}`);
      return this.challenges;
    }

    for (const topEntry of readdirSync(root, { withFileTypes: true })) {
      if (!topEntry.isDirectory()) continue;
      const topPath = join(root, topEntry.name);

      if (existsSync(join(topPath, "manifest.json"))) {
        this._tryLoad(join(topPath, "manifest.json"), topPath);
      }
    }

    return this.challenges;
  }

  get(id: string): ChallengeManifest | undefined {
    return this.challenges.get(id);
  }

  list(): ChallengeManifest[] {
    return [...this.challenges.values()];
  }

  /** Returns the absolute path to the challenge's directory (for README lookup). */
  getDir(id: string): string | undefined {
    return this.challengeDirs.get(id);
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _tryLoad(manifestPath: string, challengeDir: string): void {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const manifest = ChallengeManifestSchema.parse(raw);
      this.challenges.set(manifest.id, manifest);
      this.challengeDirs.set(manifest.id, challengeDir);
      console.log(`[ChallengeLoader] loaded: ${manifest.id} (${manifest.name})`);
    } catch (e) {
      console.error(`[ChallengeLoader] failed to load ${manifestPath}:`, e);
    }
  }
}
