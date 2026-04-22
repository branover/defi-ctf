import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";
import type { ContractRegistry } from "../../challenge/ContractRegistry.js";

const MARKETPLACE_ABI = [
  "function getListings() view returns (uint256[] tokenIds, address[] sellers, uint256[] prices)",
  "function floorPrice() view returns (uint256)",
  "function listToken(uint256 tokenId, uint256 price)",
  "function listings(uint256) view returns (address seller, uint256 price, bool active)",
];

const NFT_ABI = [
  "function approve(address to, uint256 tokenId)",
  "function setApprovalForAll(address operator, bool approved)",
  "function getTokensOfOwner(address owner) view returns (uint256[])",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
];

const AMM_ABI = [
  "function swapExactIn(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to) returns (uint256)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function depositNFT(address collection, uint256 tokenId)",
];

const NFT_FULL_ABI = [
  "function approve(address to, uint256 tokenId)",
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function getTokensOfOwner(address owner) view returns (uint256[])",
];

/**
 * NftCollectorBot — an NFT collector that interacts with the upgradeable pool.
 *
 * Two modes controlled by the `nftPoolMode` param:
 *
 * Default mode (nftPoolMode: false):
 *   - Lists its NFTs in the marketplace at setup
 *   - Every `tradeInterval` blocks, swaps WETH via the upgradeable pool
 *
 * NFT pool mode (nftPoolMode: true):
 *   - Once, calls setApprovalForAll(pool, true) on the collection
 *   - Every `depositInterval` blocks (starting at `startBlock`), deposits
 *     the next un-deposited NFT into the pool via depositNFT()
 *
 * The pool is the vulnerability vector: once upgraded to a malicious impl,
 * depositNFT() steals the NFT to the attacker instead.
 *
 * Params:
 *   marketplaceId   — contractId of the NFTMarketplace (default "marketplace")
 *   collectionId    — contractId of the CTFCollection (default "collection")
 *   poolId          — contractId of the UpgradeableAMM (default "upgradeable-pool")
 *   wethId          — symbol of the WETH token (default "WETH")
 *   nftPoolMode     — if true, deposit NFTs into pool instead of swapping (default false)
 *   depositInterval — (nftPoolMode) deposit one NFT every N blocks (default 25)
 *   tradeInterval   — (default mode) swap every N blocks (default 15)
 *   swapAmountEth   — (default mode) WETH to swap each tick, in ether (default "0.5")
 *   startBlock      — don't fire before this block (default 5)
 */
export class NftCollectorBot extends BotBase {
  private nftRegistry: ContractRegistry;
  private _approvedMarket = false;
  private _approvedPool   = false;
  private _depositedIds   = new Set<string>();

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
    const startBlock   = this._p("startBlock", 5);
    const nftPoolMode  = this._p("nftPoolMode", 0) !== 0;

    if (blockNumber < startBlock) return;

    const collectionId  = this._s("collectionId", "collection");
    const poolId        = this._s("poolId", "upgradeable-pool");

    let collAddr: string;
    let poolAddr: string;
    try {
      collAddr = this.nftRegistry.getAddress(collectionId);
      poolAddr = this.nftRegistry.getAddress(poolId);
    } catch {
      return; // contracts not yet deployed
    }

    if (nftPoolMode) {
      await this._tickNftPoolMode(blockNumber, collAddr, poolAddr);
    } else {
      const marketplaceId = this._s("marketplaceId", "marketplace");
      let mktAddr: string;
      try {
        mktAddr = this.nftRegistry.getAddress(marketplaceId);
      } catch {
        return;
      }
      await this._tickSwapMode(blockNumber, collAddr, poolAddr, mktAddr);
    }
  }

  /** NFT pool mode: approve pool once, then deposit one NFT per interval. */
  private async _tickNftPoolMode(blockNumber: number, collAddr: string, poolAddr: string): Promise<void> {
    const depositInterval = this._p("depositInterval", 25);
    const startBlock      = this._p("startBlock", 5);
    if ((blockNumber - startBlock) % depositInterval !== 0) return;

    const coll = new ethers.Contract(collAddr, NFT_FULL_ABI, this.signer);
    const amm  = new ethers.Contract(poolAddr, AMM_ABI, this.signer);

    try {
      // Approve pool as operator for all NFTs (once)
      if (!this._approvedPool) {
        const alreadyApproved: boolean = await coll.isApprovedForAll(this.signerAddress, poolAddr);
        if (!alreadyApproved) {
          await (await coll.setApprovalForAll(poolAddr, true)).wait(1);
          console.log(`[NftCollectorBot:${this.id}] block ${blockNumber}: approved pool ${poolAddr} for NFTs`);
        }
        this._approvedPool = true;
      }

      // Find the next NFT to deposit
      const owned: bigint[] = await coll.getTokensOfOwner(this.signerAddress);
      const nextNft = owned.find(tid => !this._depositedIds.has(tid.toString()));
      if (nextNft === undefined) {
        console.log(`[NftCollectorBot:${this.id}] block ${blockNumber}: no more NFTs to deposit`);
        return;
      }

      this._depositedIds.add(nextNft.toString());
      await (await amm.depositNFT(collAddr, nextNft)).wait(1);

      console.log(
        `[NftCollectorBot:${this.id}] block ${blockNumber}: ` +
        `deposited NFT #${nextNft} into pool ${poolAddr}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[NftCollectorBot:${this.id}] block ${blockNumber} (nft-pool):`, msg.slice(0, 120));
    }
  }

  /** Default mode: list unlisted NFTs, then swap WETH via upgradeable pool. */
  private async _tickSwapMode(
    blockNumber: number,
    collAddr: string,
    poolAddr: string,
    mktAddr: string,
  ): Promise<void> {
    const tradeInterval = this._p("tradeInterval", 15);
    const startBlock    = this._p("startBlock", 5);
    if ((blockNumber - startBlock) % tradeInterval !== 0) return;

    const swapAmountStr = this._s("swapAmountEth", "0.5");
    const swapAmount    = ethers.parseEther(swapAmountStr);

    // Find WETH address
    let wethAddr: string | undefined;
    const wethSym = this._s("wethId", "WETH").toUpperCase();
    for (const pool of this.pools.getAllPools()) {
      if (pool.symbol0.toUpperCase() === wethSym) { wethAddr = pool.token0; break; }
      if (pool.symbol1.toUpperCase() === wethSym) { wethAddr = pool.token1; break; }
    }
    if (!wethAddr) return;

    const weth = new ethers.Contract(wethAddr, ERC20_ABI, this.signer);
    const amm  = new ethers.Contract(poolAddr,  AMM_ABI,  this.signer);

    try {
      const coll = new ethers.Contract(collAddr, NFT_FULL_ABI, this.signer);
      const mkt  = new ethers.Contract(mktAddr,  MARKETPLACE_ABI, this.signer);

      if (!this._approvedMarket) {
        try {
          await (await coll.setApprovalForAll(mktAddr, true)).wait(1);
          this._approvedMarket = true;
        } catch { /* already approved */ }
      }

      const owned: bigint[] = await coll.getTokensOfOwner(this.signerAddress);
      for (const tid of owned) {
        const [, , active]: [string, bigint, boolean] = await mkt.listings(tid);
        if (!active) {
          const listPrice = ethers.parseEther("2");
          try {
            await (await mkt.listToken(tid, listPrice)).wait(1);
            console.log(`[NftCollectorBot:${this.id}] block ${blockNumber}: listed NFT #${tid} @ 2 WETH`);
          } catch { /* may already be listed */ }
        }
      }

      const bal: bigint = await weth.balanceOf(this.signerAddress);
      if (bal < swapAmount) {
        console.log(`[NftCollectorBot:${this.id}] block ${blockNumber}: insufficient WETH (${ethers.formatEther(bal)}), skipping swap`);
        return;
      }

      const allowed: bigint = await weth.allowance(this.signerAddress, poolAddr);
      if (allowed < swapAmount) {
        await (await weth.approve(poolAddr, ethers.MaxUint256)).wait(1);
      }

      await (await amm.swapExactIn(wethAddr, swapAmount, 0n, this.signerAddress)).wait(1);

      console.log(
        `[NftCollectorBot:${this.id}] block ${blockNumber}: ` +
        `swapped ${swapAmountStr} WETH via upgradeable pool @ ${poolAddr}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("not listed") && !msg.includes("slippage") && !msg.includes("AMM:")) {
        console.error(`[NftCollectorBot:${this.id}] block ${blockNumber}:`, msg.slice(0, 120));
      }
    }
  }
}
