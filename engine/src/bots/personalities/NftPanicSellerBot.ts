import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";
import type { ContractRegistry } from "../../challenge/ContractRegistry.js";

const MARKETPLACE_ABI = [
  "function listToken(uint256 tokenId, uint256 price)",
  "function floorPrice() view returns (uint256)",
  "function listings(uint256) view returns (address seller, uint256 price, bool active)",
];

const NFT_ABI = [
  "function approve(address to, uint256 tokenId)",
  "function getTokensOfOwner(address owner) view returns (uint256[])",
];

/**
 * NftPanicSellerBot — occasionally dumps an owned NFT below the floor price,
 * simulating a distressed seller. Used for the floor-sweep challenge.
 *
 * Params:
 *   marketplaceId — contractId of the NFTMarketplace
 *   collectionId  — contractId of the CTFCollection
 *   blockInterval — fire every N blocks (default 25)
 *   discountPct   — list at floor * (1 - discountPct/100), e.g. 30 = floor - 30% (default 30)
 *   startBlock    — don't fire before this block (default 0)
 */
export class NftPanicSellerBot extends BotBase {
  private nftRegistry: ContractRegistry;

  constructor(
    config: BotConfig,
    signer: ethers.Wallet,
    pools: PoolRegistry,
    prng: SeededPRNG,
    contractRegistry: ContractRegistry,
  ) {
    super(config, signer, pools, prng);
    this.nftRegistry = contractRegistry;
  }

  async tick(blockNumber: number): Promise<void> {
    const interval   = this._p("blockInterval", 25);
    const startBlock = this._p("startBlock", 0);
    if (blockNumber < startBlock) return;
    if ((blockNumber - startBlock) % interval !== 0) return;

    const marketplaceId = this._s("marketplaceId", "marketplace");
    const collectionId  = this._s("collectionId", "collection");
    const discountPct   = this._p("discountPct", 30);

    let mktAddr: string;
    let collAddr: string;
    try {
      mktAddr  = this.nftRegistry.getAddress(marketplaceId);
      collAddr = this.nftRegistry.getAddress(collectionId);
    } catch {
      return;
    }

    const mkt  = new ethers.Contract(mktAddr,  MARKETPLACE_ABI, this.signer);
    const coll = new ethers.Contract(collAddr, NFT_ABI, this.signer);

    try {
      // Find an NFT this bot owns that is not already listed
      const ownedTokens: bigint[] = await coll.getTokensOfOwner(this.signerAddress);
      if (ownedTokens.length === 0) return;

      // Pick a random one we own and that's not currently listed
      const available: bigint[] = [];
      for (const tid of ownedTokens) {
        const [, , active]: [string, bigint, boolean] = await mkt.listings(tid);
        if (!active) available.push(tid);
      }
      if (available.length === 0) return;

      const chosen = available[Math.floor(this.prng.next() * available.length)];

      // Get floor and list below it
      const floor: bigint = await mkt.floorPrice();
      let dumpPrice: bigint;
      if (floor === 0n) {
        // No floor — list at 0.07 WETH as baseline
        dumpPrice = ethers.parseEther("0.07");
      } else {
        dumpPrice = floor - (floor * BigInt(discountPct)) / 100n;
        if (dumpPrice === 0n) dumpPrice = ethers.parseEther("0.01");
      }

      await (await coll.approve(mktAddr, chosen)).wait(1);
      await (await mkt.listToken(chosen, dumpPrice)).wait(1);

      console.log(
        `[NftPanicSellerBot:${this.id}] block ${blockNumber}: ` +
        `panic-listed #${chosen} @ ${ethers.formatEther(dumpPrice)} WETH (floor: ${ethers.formatEther(floor)})`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("not listed") && !msg.includes("insufficient")) {
        console.error(`[NftPanicSellerBot:${this.id}] block ${blockNumber}:`, msg.slice(0, 100));
      }
    }
  }
}
