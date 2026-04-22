import { ethers } from "ethers";
import type { ChallengeManifest } from "./ChallengeLoader.js";
import type { ChainClient } from "../chain/ChainClient.js";
import type { PoolRegistry } from "../market/PoolRegistry.js";
import type { ContractRegistry } from "./ContractRegistry.js";

export interface WinResult {
  won:          boolean;
  metric:       string;
  current:      string;
  target:       string;
  blocksUsed:   number;
}

export class WinConditionChecker {
  private _startBalance: bigint | null = null;
  /**
   * For nftSalesProfit: native ETH + WETH (wei) at challenge start.
   * Wrap/unwrap move value between the two buckets without changing the sum; a
   * WETH-only delta incorrectly counted wraps as marketplace profit (#145 follow-up).
   */
  private _startNftNotionalWei: bigint | null = null;

  constructor(
    private manifest:          ChallengeManifest,
    private client:            ChainClient,
    private pools:             PoolRegistry,
    private tokenAddresses:    Map<string, string>,
    private contractRegistry?: ContractRegistry,
  ) {}

  /** Call once after challenge setup to record the player's starting balance. */
  async recordStart(): Promise<void> {
    const win           = this.manifest.win;
    const playerAddress = this.client.getSigner(win.playerAccount).address;
    if (win.metric === "tokenBalance") {
      const sym = win.tokenSymbol!;
      const addr = this.tokenAddresses.get(sym.toUpperCase());
      if (!addr) throw new Error(`Token not found: ${sym}`);
      const token = this.pools.getToken(addr);
      this._startBalance = BigInt(await token.balanceOf(playerAddress));
      return;
    }
    if (win.metric === "usdBalance") {
      const usdAddr = this._findUsdTokenAddress();
      if (!usdAddr) throw new Error("[WinConditionChecker] usdBalance: no token with type 'usd' found in manifest");
      const token = this.pools.getToken(usdAddr);
      this._startBalance = BigInt(await token.balanceOf(playerAddress));
      return;
    }
    if (win.metric === "portfolioValueInEth") {
      // Issue #45: anchor the start balance to the manifest's startingValue rather than
      // the live portfolio computation.  The live portfolio includes non-ETH tokens whose
      // ETH-equivalent value fluctuates with every AMM trade — even when the player has
      // not traded at all — because the pool spot price changes.  Using the manifest value
      // means that a player who holds only native ETH (or WETH) sees a rock-stable
      // starting point of exactly win.startingValue ETH, and any deviation is genuine
      // trading profit/loss rather than AMM noise.
      this._startBalance = ethers.parseEther(win.startingValue);
      return;
    }
    if (win.metric === "nftSalesProfit") {
      // Baseline score comes from the manifest; gains come from increases in
      // (native ETH + WETH) so marketplace payouts (WETH in) still count while
      // wrap/unwrap (ETH out, WETH in or the reverse) do not move the notional sum.
      this._startBalance = ethers.parseEther(win.startingValue);
      const ethWei = await this.client.getBalance(playerAddress);
      const wethAddr = this.tokenAddresses.get("WETH");
      let wethWei = 0n;
      if (wethAddr) {
        const weth = this.pools.getToken(wethAddr);
        wethWei = BigInt(await weth.balanceOf(playerAddress));
      }
      this._startNftNotionalWei = ethWei + wethWei;
      return;
    }
    // ethBalance metric: include WETH so wrapping ETH to trade doesn't
    // reset the player's apparent starting balance.
    this._startBalance = await this.client.getBalance(playerAddress);
    const wethAddr = this.tokenAddresses.get("WETH");
    if (wethAddr) {
      const weth = this.pools.getToken(wethAddr);
      this._startBalance += BigInt(await weth.balanceOf(playerAddress));
    }
  }

  async check(blockNumber: number): Promise<WinResult> {
    const win = this.manifest.win;

    // ── drainContract ────────────────────────────────────────────────────────
    if (win.metric === "drainContract") {
      if (!this.contractRegistry) {
        throw new Error("[WinConditionChecker] drainContract requires ContractRegistry");
      }
      const addr = this.contractRegistry.getAddress(win.contractId);
      let balance: bigint;

      let decimals = 18;
      if (win.tokenSymbol && win.tokenSymbol.toUpperCase() !== "ETH") {
        const tokenAddr = this.tokenAddresses.get(win.tokenSymbol.toUpperCase());
        if (!tokenAddr) throw new Error(`Token not found: ${win.tokenSymbol}`);
        const token = this.pools.getToken(tokenAddr);
        balance = BigInt(await token.balanceOf(addr));
        const tokenDef = this.manifest.tokens.find(
          t => t.symbol.toUpperCase() === win.tokenSymbol!.toUpperCase(),
        );
        decimals = tokenDef?.decimals ?? 18;
      } else {
        // No tokenSymbol or tokenSymbol="ETH" → check native ETH balance
        balance = await this.client.getBalance(addr);
      }

      const threshold = BigInt(win.threshold);
      // Format with correct decimals so _playerBalanceForUi's parseEther() round-trip
      // produces a correct 18-decimal-equivalent value for the progress panel (÷1e18).
      return {
        won:        balance < threshold,
        metric:     "drainContract",
        current:    ethers.formatUnits(balance, decimals),
        target:     ethers.formatUnits(threshold, decimals),
        blocksUsed: blockNumber,
      };
    }

    // ── profit-relative metrics ───────────────────────────────────────────────
    const playerAddress = this.client.getSigner(win.playerAccount).address;
    let current = 0n;
    let unitDecimals = 18;
    const asUnits = (v: string) => ethers.parseUnits(v, unitDecimals);
    const fmtUnits = (v: bigint) => ethers.formatUnits(v, unitDecimals);

    switch (win.metric) {
      case "ethBalance": {
        unitDecimals = 18;
        current = await this.client.getBalance(playerAddress);
        const wethAddr = this.tokenAddresses.get("WETH");
        if (wethAddr) {
          const weth = this.pools.getToken(wethAddr);
          current += BigInt(await weth.balanceOf(playerAddress));
        }
        break;
      }
      case "tokenBalance": {
        const sym  = win.tokenSymbol!;
        const addr = this.tokenAddresses.get(sym.toUpperCase());
        if (!addr) throw new Error(`Token not found: ${sym}`);
        const token = this.pools.getToken(addr);
        unitDecimals = Number(await token.decimals());
        current = BigInt(await token.balanceOf(playerAddress));
        break;
      }
      case "usdBalance": {
        const usdAddr = this._findUsdTokenAddress();
        if (!usdAddr) throw new Error("[WinConditionChecker] usdBalance: no token with type 'usd' found in manifest");
        const token = this.pools.getToken(usdAddr);
        unitDecimals = Number(await token.decimals());
        current = BigInt(await token.balanceOf(playerAddress));
        break;
      }
      case "portfolioValueInEth": {
        unitDecimals = 18;
        current = await this._computePortfolioEthWei(playerAddress);
        break;
      }
      case "nftSalesProfit": {
        unitDecimals = 18;
        const ethNow = await this.client.getBalance(playerAddress);
        const wethAddr = this.tokenAddresses.get("WETH");
        let wethNow = 0n;
        if (wethAddr) {
          const weth = this.pools.getToken(wethAddr);
          wethNow = BigInt(await weth.balanceOf(playerAddress));
        }
        const startNotional = this._startNftNotionalWei ?? 0n;
        const notionalNow   = ethNow + wethNow;
        const rawGain       = notionalNow - startNotional;
        // Same spirit as the old WETH-only max(0, Δ): ignore slow gas bleed so
        // native ETH ticking down does not punish the score every block.
        const posGain = rawGain > 0n ? rawGain : 0n;
        current = (this._startBalance ?? 0n) + posGain;
        break;
      }
    }

    const targetProfit    = asUnits(win.target) - asUnits(win.startingValue);
    const startBal        = this._startBalance ?? current;
    const requiredBalance = startBal + targetProfit;

    const profitCurrent          = current - startBal;  // allow negative so players see losses
    const profitCurrentFormatted = fmtUnits(profitCurrent);
    const profitTarget           = fmtUnits(targetProfit > 0n ? targetProfit : 0n);

    return {
      won:        current >= requiredBalance,
      metric:     win.metric,
      current:    profitCurrentFormatted,
      target:     profitTarget,
      blocksUsed: blockNumber,
    };
  }

  /** Find the address of the token with type "usd" in the manifest, if any. */
  private _findUsdTokenAddress(): string | undefined {
    for (const tokenDef of this.manifest.tokens) {
      if (tokenDef.type === "usd") {
        const sym = tokenDef.symbol.toUpperCase();
        return this.tokenAddresses.get(sym);
      }
    }
    return undefined;
  }

  private async _computePortfolioEthWei(playerAddress: string): Promise<bigint> {
    // Include native ETH in the portfolio calculation.
    // Players start with native ETH set by the manifest's player.startingEth field and
    // must intentionally wrap it to WETH via wrapEth() to trade.  Native ETH balance
    // is therefore meaningful and should count toward portfolio value.
    let ethValWei = await this.client.getBalance(playerAddress);
    const wethAddr = this.tokenAddresses.get("WETH")?.toLowerCase();
    if (!wethAddr) return ethValWei;

    // Marginal pool price in WETH wei per 1 smallest unit of the paired token.
    // Using bigint avoids Number overflow / RangeError on BigInt(...) when the player
    // still holds large carry-over ERC20 balances (e.g. hundreds of thousands of USDC).
    const wethPerTokenAtom = new Map<string, { num: bigint; den: bigint }>();

    for (const pool of this.pools.getAllPools()) {
      const { reserve0, reserve1 } = await this.pools.getReserves(pool.id);
      if (reserve0 === 0n || reserve1 === 0n) continue;
      const t0 = pool.token0.toLowerCase();
      const t1 = pool.token1.toLowerCase();

      if (t0 === wethAddr) {
        wethPerTokenAtom.set(t1, { num: reserve0, den: reserve1 });
      } else if (t1 === wethAddr) {
        wethPerTokenAtom.set(t0, { num: reserve1, den: reserve0 });
      }
    }

    for (const tokenAddr of this.tokenAddresses.values()) {
      const tokenAddrLc = tokenAddr.toLowerCase();
      const token = this.pools.getToken(tokenAddr);
      const balance = BigInt(await token.balanceOf(playerAddress));
      if (balance === 0n) continue;

      if (tokenAddrLc === wethAddr) {
        ethValWei += balance;
        continue;
      }

      const frac = wethPerTokenAtom.get(tokenAddrLc);
      if (!frac || frac.den === 0n) continue;
      ethValWei += (balance * frac.num) / frac.den;
    }

    return ethValWei;
  }
}
