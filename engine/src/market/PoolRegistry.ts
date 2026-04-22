import { ethers } from "ethers";
import type { ChainClient } from "../chain/ChainClient.js";
import { calcTradeEstimate, calcDepth, type TradeEstimate, type DepthData } from "./AmmMath.js";

const AMM_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) pure returns (uint256)",
  "function swapExactIn(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to) returns (uint256)",
  "function addLiquidity(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address to) returns (uint256, uint256, uint256)",
  "function removeLiquidity(uint256 shares, uint256 amount0Min, uint256 amount1Min, address to) returns (uint256, uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address, uint256) returns (bool)",
  "function transferFrom(address, address, uint256) returns (bool)",
  "function deposit() payable",  // WETH
  "function withdraw(uint256)",  // WETH
];

export interface PoolInfo {
  id:          string;
  address:     string;
  token0:      string;
  token1:      string;
  symbol0:     string;
  symbol1:     string;
  decimals0:   number;
  decimals1:   number;
  exchange:    string;   // e.g. "uniswap", "sushiswap", "curve"
  displayName: string;   // e.g. "Uniswap", "SushiSwap"
}

export class PoolRegistry {
  private pools = new Map<string, { info: PoolInfo; contract: ethers.Contract }>();
  private tokens = new Map<string, ethers.Contract>();

  constructor(private client: ChainClient) {}

  async registerPool(
    id: string,
    address: string,
    exchange = "uniswap",
    displayName = "",
  ): Promise<PoolInfo> {
    const contract = new ethers.Contract(address, AMM_ABI, this.client.provider);
    const [t0, t1] = await Promise.all([contract.token0(), contract.token1()]);
    const tok0 = this._getOrCreateToken(t0);
    const tok1 = this._getOrCreateToken(t1);
    const [sym0, sym1, dec0, dec1] = await Promise.all([
      tok0.symbol(), tok1.symbol(), tok0.decimals(), tok1.decimals(),
    ]);
    const info: PoolInfo = {
      id, address, token0: t0, token1: t1,
      symbol0: sym0, symbol1: sym1,
      decimals0: Number(dec0), decimals1: Number(dec1),
      exchange,
      displayName: displayName || `${sym0}/${sym1}`,
    };
    this.pools.set(id, { info, contract });
    return info;
  }

  getPool(id: string) {
    const p = this.pools.get(id);
    if (!p) throw new Error(`Pool not found: ${id}`);
    return p;
  }

  getAllPools(): PoolInfo[] {
    return [...this.pools.values()].map(p => p.info);
  }

  clear() {
    this.pools.clear();
    this.tokens.clear();
  }

  getToken(address: string): ethers.Contract {
    return this._getOrCreateToken(address);
  }

  getTokenWithSigner(address: string, signer: ethers.Signer): ethers.Contract {
    return new ethers.Contract(address, ERC20_ABI, signer);
  }

  getPoolWithSigner(id: string, signer: ethers.Signer): ethers.Contract {
    const { info } = this.getPool(id);
    return new ethers.Contract(info.address, AMM_ABI, signer);
  }

  async getReserves(id: string): Promise<{ reserve0: bigint; reserve1: bigint }> {
    const { contract } = this.getPool(id);
    const [r0, r1] = await contract.getReserves();
    return { reserve0: BigInt(r0), reserve1: BigInt(r1) };
  }

  /** Estimate trade output and price impact without executing */
  async calcTradeImpact(poolId: string, tokenInAddr: string, amountIn: bigint): Promise<TradeEstimate> {
    const { info } = this.getPool(poolId);
    const { reserve0, reserve1 } = await this.getReserves(poolId);
    const isT0In = tokenInAddr.toLowerCase() === info.token0.toLowerCase();
    const [rIn, rOut, dIn, dOut] = isT0In
      ? [reserve0, reserve1, info.decimals0, info.decimals1]
      : [reserve1, reserve0, info.decimals1, info.decimals0];
    return calcTradeEstimate(amountIn, rIn, rOut, dIn, dOut);
  }

  /** Liquidity depth at ±0.1%, ±0.5%, ±1%, ±5%, ±10% price bands */
  async getDepth(poolId: string): Promise<DepthData> {
    const { info } = this.getPool(poolId);
    const { reserve0, reserve1 } = await this.getReserves(poolId);
    return calcDepth(reserve0, reserve1, info.decimals0, info.decimals1);
  }

  /** Spot price of token1 per token0 (e.g. USDC per WETH if token0=WETH) */
  async getSpotPrice(id: string): Promise<number> {
    const { info } = this.getPool(id);
    const { reserve0, reserve1 } = await this.getReserves(id);
    if (reserve0 === 0n) return 0;
    const r0Norm = Number(reserve0) / 10 ** info.decimals0;
    const r1Norm = Number(reserve1) / 10 ** info.decimals1;
    return r1Norm / r0Norm;
  }

  private _getOrCreateToken(address: string): ethers.Contract {
    let tok = this.tokens.get(address.toLowerCase());
    if (!tok) {
      tok = new ethers.Contract(address, ERC20_ABI, this.client.provider);
      this.tokens.set(address.toLowerCase(), tok);
    }
    return tok;
  }
}
