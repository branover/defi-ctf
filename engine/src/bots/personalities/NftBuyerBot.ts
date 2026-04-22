import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";
import type { ContractRegistry } from "../../challenge/ContractRegistry.js";

const MARKETPLACE_ABI = [
  "function getListings() view returns (uint256[] tokenIds, address[] sellers, uint256[] prices)",
  "function floorPrice() view returns (uint256)",
  "function listToken(uint256 tokenId, uint256 price)",
  "function buyToken(uint256 tokenId)",
  "function listings(uint256) view returns (address seller, uint256 price, bool active)",
];

const NFT_APPROVE_ABI = [
  "function approve(address to, uint256 tokenId)",
  "function getTokensOfOwner(address owner) view returns (uint256[])",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
];

/**
 * NftBuyerBot — periodically buys floor-priced NFTs from the marketplace and
 * re-lists them at a higher price. Used for NFT challenge simulations.
 *
 * Params:
 *   marketplaceId — contractId of the NFTMarketplace (from manifest)
 *   collectionId  — contractId of the CTFCollection (from manifest)
 *   wethId        — symbol of the WETH token (default "WETH")
 *   blockInterval — fire every N blocks (default 20)
 *   markupPct     — relist at floor * (1 + markupPct/100), e.g. 20 = +20% (default 20)
 *   maxFloor      — only buy if floor price ≤ maxFloor WETH (default 100). Alias: maxBuyPrice.
 *   minRarity     — only buy NFTs with rarityScore >= minRarity (default 0, buy any)
 *   startBlock    — don't fire before this block (default 0)
 *
 * The bot holds a ContractRegistry reference passed via the scheduler.
 */
export class NftBuyerBot extends BotBase {
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
    const interval   = this._p("blockInterval", 20);
    const startBlock = this._p("startBlock", 0);
    if (blockNumber < startBlock) return;
    if ((blockNumber - startBlock) % interval !== 0) return;

    const marketplaceId = this._s("marketplaceId", "marketplace");
    const collectionId  = this._s("collectionId", "collection");
    const markupPct     = this._p("markupPct", 20);
    // maxBuyPrice is an alias for maxFloor for clarity in new manifests
    const maxFloor      = ethers.parseEther(String(this._p("maxBuyPrice", this._p("maxFloor", 100))));
    const minRarity     = this._p("minRarity", 0);

    let mktAddr: string;
    let collAddr: string;
    try {
      mktAddr  = this.nftRegistry.getAddress(marketplaceId);
      collAddr = this.nftRegistry.getAddress(collectionId);
    } catch {
      return; // contracts not deployed yet
    }

    // Find WETH token address — prefer explicit param, then pool registry lookup.
    let wethAddr: string | undefined;
    const wethParam = this._s("wethAddress", "");
    if (wethParam) {
      wethAddr = wethParam;
    } else {
      const wethSym = this._s("wethId", "WETH").toUpperCase();
      for (const pool of this.pools.getAllPools()) {
        if (pool.symbol0.toUpperCase() === wethSym) { wethAddr = pool.token0; break; }
        if (pool.symbol1.toUpperCase() === wethSym) { wethAddr = pool.token1; break; }
      }
    }
    if (!wethAddr) return;

    const RARITY_ABI = [
      "function rarityScore(uint256 tokenId) view returns (uint8)",
      "function revealed() view returns (bool)",
    ];

    const mkt      = new ethers.Contract(mktAddr,  MARKETPLACE_ABI, this.signer);
    const weth     = new ethers.Contract(wethAddr, ERC20_ABI, this.signer);
    const coll     = new ethers.Contract(collAddr, [...NFT_APPROVE_ABI, ...RARITY_ABI], this.signer);

    try {
      // Check floor price
      const floor: bigint = await mkt.floorPrice();
      if (floor === 0n || floor > maxFloor) return;

      // Check WETH balance
      const wethBal: bigint = await weth.balanceOf(this.signerAddress);
      if (wethBal < floor) return;

      // Find the cheapest listing that passes rarity filter and is not owned by this bot
      const [tIds, sellers, prices]: [bigint[], string[], bigint[]] = await mkt.getListings();
      const isRevealed: boolean = await coll.revealed().catch(() => true);

      let targetId: bigint | null = null;
      let targetPrice = 0n;
      for (let i = 0; i < tIds.length; i++) {
        if (sellers[i].toLowerCase() === this.signerAddress.toLowerCase()) continue;
        if (prices[i] > maxFloor) continue;

        // Rarity filter: only apply when collection is revealed and minRarity > 0
        if (minRarity > 0 && isRevealed) {
          try {
            const rarity = Number(await coll.rarityScore(tIds[i]));
            if (rarity < minRarity) continue;
          } catch {
            continue;
          }
        }

        if (targetId === null || prices[i] < targetPrice) {
          targetId    = tIds[i];
          targetPrice = prices[i];
        }
      }
      if (targetId === null) return;

      // Approve WETH and buy
      const allowed: bigint = await weth.allowance(this.signerAddress, mktAddr);
      if (allowed < targetPrice) {
        await (await weth.approve(mktAddr, ethers.MaxUint256)).wait(1);
      }
      await (await mkt.buyToken(targetId)).wait(1);

      // Re-list at markup
      const relistPrice = targetPrice + (targetPrice * BigInt(markupPct)) / 100n;
      await (await coll.approve(mktAddr, targetId)).wait(1);
      await (await mkt.listToken(targetId, relistPrice)).wait(1);

      console.log(
        `[NftBuyerBot:${this.id}] block ${blockNumber}: ` +
        `bought #${targetId} @ ${ethers.formatEther(targetPrice)} WETH, ` +
        `relisted @ ${ethers.formatEther(relistPrice)} WETH`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("not listed") && !msg.includes("insufficient")) {
        console.error(`[NftBuyerBot:${this.id}] block ${blockNumber}:`, msg.slice(0, 100));
      }
    }
  }
}
