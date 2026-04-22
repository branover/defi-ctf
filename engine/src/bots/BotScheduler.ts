import { ethers } from "ethers";
import type { ChainClient } from "../chain/ChainClient.js";
import type { PoolRegistry } from "../market/PoolRegistry.js";
import type { ContractRegistry } from "../challenge/ContractRegistry.js";
import type { MarketHistory } from "../market/MarketHistory.js";
import { SeededPRNG } from "./SeededPRNG.js";
import { BotBase } from "./BotBase.js";
import { VolatileBot } from "./personalities/VolatileBot.js";
import { MeanReversionBot } from "./personalities/MeanReversionBot.js";
import { ArbitrageBot } from "./personalities/ArbitrageBot.js";
import { MarketMakerBot } from "./personalities/MarketMakerBot.js";
import { AccumulatorBot } from "./personalities/AccumulatorBot.js";
import { PeriodicBot } from "./personalities/PeriodicBot.js";
import { MomentumBot } from "./personalities/MomentumBot.js";
import { SniperBot } from "./personalities/SniperBot.js";
import { NftBuyerBot } from "./personalities/NftBuyerBot.js";
import { NftPanicSellerBot } from "./personalities/NftPanicSellerBot.js";
import { NftCollectorBot } from "./personalities/NftCollectorBot.js";
import { VolumeTrackerBot } from "./personalities/VolumeTrackerBot.js";

export interface BotDef {
  id:          string;
  personality: string;
  account:     number;
  params:      Record<string, number | string>;
}

export class BotScheduler {
  private bots: BotBase[] = [];
  private tokenAddresses: Map<string, string> = new Map();

  constructor(
    private client:            ChainClient,
    private pools:             PoolRegistry,
    private contractRegistry?: ContractRegistry,
    private marketHistory?:    MarketHistory,
  ) {}

  /** Supply the token address map so bots can look up token addresses by symbol. */
  setTokenAddresses(map: Map<string, string>) {
    this.tokenAddresses = map;
  }

  init(defs: BotDef[], botSeed: number) {
    this.bots = defs.map((def, idx) => {
      const signer = this.client.getSigner(def.account);
      const prng   = new SeededPRNG(botSeed + idx);
      // Resolve {{token:SYM}} placeholders in bot params
      const resolvedParams: Record<string, number | string> = {};
      for (const [key, val] of Object.entries(def.params)) {
        if (typeof val === "string") {
          const m = val.match(/^\{\{token:([^}]+)\}\}$/);
          if (m) {
            const sym = m[1].toUpperCase();
            resolvedParams[key] = this.tokenAddresses.get(sym) ?? val;
          } else {
            resolvedParams[key] = val;
          }
        } else {
          resolvedParams[key] = val;
        }
      }
      const params = resolvedParams as Record<string, number>;
      const config = { id: def.id, personality: def.personality, account: def.account, params };
      switch (def.personality) {
        case "volatile":          return new VolatileBot(config, signer, this.pools, prng);
        case "meanReversion":     return new MeanReversionBot(config, signer, this.pools, prng);
        case "arbitrageur":       return new ArbitrageBot(config, signer, this.pools, prng);
        case "marketmaker":       return new MarketMakerBot(config, signer, this.pools, prng);
        case "accumulator":       return new AccumulatorBot(config, signer, this.pools, prng);
        case "periodic":          return new PeriodicBot(config, signer, this.pools, prng);
        case "momentum":          return new MomentumBot(config, signer, this.pools, prng);
        case "sniper":            return new SniperBot(config, signer, this.pools, prng);
        case "nft-buyer":         return new NftBuyerBot(config, signer, this.pools, prng, this.contractRegistry!);
        case "nft-panic-seller":  return new NftPanicSellerBot(config, signer, this.pools, prng, this.contractRegistry!);
        case "nft-collector":     return new NftCollectorBot(config, signer, this.pools, prng, this.contractRegistry!);
        case "volume-tracker":    return new VolumeTrackerBot(config, signer, this.pools, prng, undefined, this.marketHistory);
        default: throw new Error(`Unknown bot personality: ${def.personality}`);
      }
    });
  }

  async tick(blockNumber: number): Promise<void> {
    for (const bot of this.bots) {
      await bot.tick(blockNumber);
    }
  }

  clear() { this.bots = []; }
}
