import vm from "vm";
import { ethers } from "ethers";
import type { PoolRegistry } from "../market/PoolRegistry.js";
import type { MarketHistory } from "../market/MarketHistory.js";
import type { TriggerRegistry } from "../triggers/TriggerRegistry.js";
import type { PlayerSession } from "./PlayerSession.js";
import type { ContractRegistry } from "../challenge/ContractRegistry.js";

type BroadcastFn = (type: string, payload: unknown) => void;

/** Return type for the `runForgeScript` SDK function. */
export interface ForgeScriptResult {
  success:  boolean;
  exitCode: number;
  output:   string;
}

/**
 * Factory that the WSServer injects into the sandbox.
 * Given a script path (relative to the solve/ workspace) and optional args,
 * runs `forge script` and returns the collected output.
 */
export type RunForgeScriptFn = (
  scriptPath: string,
  opts?: { args?: string[]; contract?: string },
) => Promise<ForgeScriptResult>;

/**
 * Executes player JavaScript strategy scripts in an isolated Node.js VM context.
 *
 * ## Execution model
 * When `execute()` is called:
 *   1. All triggers from the previous script are cleared from this session.
 *   2. The script body is wrapped in an async IIFE and executed (5-second timeout
 *      on the synchronous portion) — typically to register one or more triggers via
 *      `onBlock`, `onPriceBelow`, or `onPriceAbove`.  Top-level `await` is supported.
 *   3. Triggers fire asynchronously on subsequent blocks as the engine mines them.
 *
 * ## SDK globals injected into every script
 * Triggers:     onBlock, onPriceBelow, onPriceAbove, removeTrigger
 * Trading:      swap, addLiquidity, removeLiquidity, wrapEth, unwrapEth
 * Market data:  getBalance, getPrice, getReserves, quoteOut, getLPBalance, getPriceHistory
 * Contracts:    getContractAddress, readContract, execContract, callWithAbi, approveToken
 * Chain history: getTransaction, getBlockTransactions, decodeCalldata
 * Forge:        runForgeScript
 * Utilities:    parseEther, formatEther, parseUnits, formatUnits, getPlayerAddress,
 *               log, console.log/warn/error, BigInt
 *
 * Full reference: docs/script-sdk.md
 */
export class ScriptSandbox {
  private _tokenAddresses: Map<string, string> = new Map();

  constructor(
    private pools:               PoolRegistry,
    private history:             MarketHistory,
    private broadcast:           BroadcastFn,
    private contractRegistry?:   ContractRegistry,
  ) {}

  /** Called by WSServer before execute() so token lookups work in pool-less challenges. */
  setTokenAddresses(map: ReadonlyMap<string, string>): void {
    this._tokenAddresses = new Map(map);
  }

  /**
   * Execute a player script source string inside the sandbox context.
   * Clears any triggers registered by this session's previous script before running.
   *
   * The script is wrapped in an async IIFE before execution, so **top-level `await`
   * is fully supported** — players can write `const bal = await getBalance("WETH");`
   * at the top level of their script without needing to wrap it themselves.
   *
   * The 5-second timeout still applies to the synchronous portion of the script
   * (i.e. the IIFE invocation itself); async callbacks that run after the initial
   * event-loop turn are not subject to this limit.
   *
   * @param runForgeScriptFn  Optional forge runner bound to this session's credentials.
   *   When provided, the `runForgeScript` SDK function is available inside the script.
   *   WSServer builds and supplies this for every script_run message.
   */
  execute(source: string, session: PlayerSession, runForgeScriptFn?: RunForgeScriptFn): void {
    session.clearTriggers();
    const sdk = this._buildSDK(session, runForgeScriptFn);

    // ## Sandbox threat model
    //
    // Node.js `vm.createContext` / `vm.runInContext` is NOT a security boundary
    // against a determined attacker.  A script can escape via prototype-chain
    // tricks such as:
    //
    //   this.constructor.constructor("return process")().exit(1)
    //
    // Because all JavaScript objects share the same built-in prototype chain
    // (Function, Object), a contextified sandbox still has a path back to the
    // host process.
    //
    // Mitigations applied here (defence-in-depth):
    //   1. vm.createContext() wraps the sandbox object in its own V8 context.
    //      Code running inside that context uses the sandbox's built-in
    //      Function/Object prototypes, not the host context's — so the most
    //      common `this.constructor.constructor("return process")()` prototype
    //      chain escape does NOT reach the host's Function constructor.
    //   2. Explicit null/undefined overrides for the most dangerous globals
    //      (process, require, __dirname, __filename, global) are injected into
    //      the context so they shadow any host-side references.
    //   3. The engine should be run as a low-privilege OS user (non-root) so
    //      that even a successful escape has limited blast radius.
    //
    // This is sufficient for a single-player CTF where the player is trusted
    // not to deliberately break out of the sandbox (they are solving a DeFi
    // challenge, not a pwn challenge).  For a fully adversarial multi-user
    // environment, use a separate OS process (e.g. via worker_threads + VM or
    // a subprocess with seccomp/landlock) rather than Node.js vm.

    const ctx = vm.createContext({
      ...sdk,
      BigInt,
      console: {
        log:   (...a: unknown[]) => session.log("log",   a.map(String).join(" "), 0),
        warn:  (...a: unknown[]) => session.log("warn",  a.map(String).join(" "), 0),
        error: (...a: unknown[]) => session.log("error", a.map(String).join(" "), 0),
      },
      // Shadow dangerous host globals so a naive lookup returns undefined
      // rather than the real host object.  This is not a complete escape guard
      // (see note above) but removes the lowest-hanging fruit.
      process:    undefined,
      require:    undefined,
      __dirname:  undefined,
      __filename: undefined,
      global:     undefined,
      globalThis: undefined,
    });
    // Wrap source in an async IIFE so players can use top-level `await` in their
    // scripts (e.g. `const bal = await getBalance("WETH");`).  Without the wrapper,
    // vm.runInContext runs synchronously and top-level await is a SyntaxError.
    // The returned Promise is intentionally not awaited here — async work continues
    // on the same event loop tick after execute() returns.  Unhandled rejections are
    // caught by the .catch() so they surface in the player's console rather than
    // crashing the engine.
    const wrapped = `(async () => {\n${source}\n})().catch(e => console.error("[script]", e instanceof Error ? e.message : String(e)));`;
    vm.runInContext(wrapped, ctx, { timeout: 5000, filename: "player_script.js" });
  }

  private _buildSDK(session: PlayerSession, runForgeScriptFn?: RunForgeScriptFn) {
    const { registry } = session;
    // Wrap with NonceManager so pending txs don't cause nonce collisions between
    // consecutive sends within the same block callback (e.g. approve + swapExactIn).
    // NonceManager has no synchronous .address, so we save it from the raw signer first.
    const playerAddress = session.signer.address;
    const signer        = new ethers.NonceManager(session.signer);
    const pools            = this.pools;
    const history          = this.history;
    const broadcast        = this.broadcast;
    const contractRegistry = this.contractRegistry;

    const makeLogger = (blockNumber: number) =>
      (...args: unknown[]) => {
        const msg = args.map(String).join(" ");
        session.log("log", msg, blockNumber);
        broadcast("script_log", { sessionId: session.sessionId, level: "log", message: msg, blockNumber });
      };

    // Wrap a trigger callback so any thrown error is broadcast to the player's
    // console (shown in red) instead of silently vanishing server-side.
    const wrapTriggerCallback = (userCallback: (ctx: unknown) => void) =>
      async (ctx: unknown) => {
        const bn = (ctx as { blockNumber?: number }).blockNumber ?? 0;
        (ctx as Record<string, unknown>)["log"] = makeLogger(bn);
        try {
          await userCallback(ctx);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          session.log("error", msg, bn);
          broadcast("script_log", { sessionId: session.sessionId, level: "error", message: msg, blockNumber: bn });
        }
      };

    const resolveToken = (tokenSymbol: string): string => {
      const sym = tokenSymbol.toUpperCase();
      for (const p of pools.getAllPools()) {
        if (sym === p.symbol0.toUpperCase()) return p.token0;
        if (sym === p.symbol1.toUpperCase()) return p.token1;
      }
      // Fallback: token addresses injected from ChallengeRunner (supports pool-less challenges)
      const fallback = this._tokenAddresses.get(sym);
      if (fallback) return fallback;
      throw new Error(`Unknown token: ${tokenSymbol}`);
    };

    return {
      // ── Triggers ──────────────────────────────────────────────────────────
      // Each trigger function returns a triggerId string that can be passed to
      // removeTrigger() to deregister it from inside the callback itself.
      // The optional `name` parameter sets the display label in the Trigger panel.

      /** Register a callback that fires once per mined block. */
      onBlock: (callback: (ctx: unknown) => void, name?: string) => {
        const description = name ?? "Every block";
        const id = registry.register({
          type: "onBlock", description,
          callback: wrapTriggerCallback(callback),
          once: false,
        });
        session.triggersRegistered.push(id);
        return id;
      },

      /**
       * Register a callback that fires every block while spot price is below `threshold`.
       * ctx.price is the current spot price that satisfied the condition.
       */
      onPriceBelow: (poolId: string, threshold: number, callback: (ctx: unknown) => void, name?: string) => {
        const description = name ?? `When ${poolId} < $${threshold}`;
        const id = registry.register({
          type: "onPriceBelow", description, poolId, pair: poolId, threshold,
          callback: wrapTriggerCallback(callback),
          once: false,
        });
        session.triggersRegistered.push(id);
        return id;
      },

      /**
       * Register a callback that fires every block while spot price is above `threshold`.
       * ctx.price is the current spot price that satisfied the condition.
       */
      onPriceAbove: (poolId: string, threshold: number, callback: (ctx: unknown) => void, name?: string) => {
        const description = name ?? `When ${poolId} > $${threshold}`;
        const id = registry.register({
          type: "onPriceAbove", description, poolId, pair: poolId, threshold,
          callback: wrapTriggerCallback(callback),
          once: false,
        });
        session.triggersRegistered.push(id);
        return id;
      },

      removeTrigger: (id: string) => {
        registry.remove(id);
        const idx = session.triggersRegistered.indexOf(id);
        if (idx >= 0) session.triggersRegistered.splice(idx, 1);
      },

      // ── Trading ───────────────────────────────────────────────────────────
      swap: async (poolId: string, tokenInSymbol: string, amountIn: bigint, minOut = 0n): Promise<bigint> => {
        const { info } = pools.getPool(poolId);
        const isToken0In = tokenInSymbol.toUpperCase() === info.symbol0.toUpperCase();
        const tokenInAddr = isToken0In ? info.token0 : info.token1;

        // Estimate amountOut via staticCall before executing so we can include it in the
        // trade event without waiting for a separate on-chain read after the swap.
        const poolContract = pools.getPoolWithSigner(poolId, signer);
        let estimatedOut = 0n;
        try {
          estimatedOut = BigInt(
            await poolContract.swapExactIn.staticCall(tokenInAddr, amountIn, minOut, playerAddress),
          );
        } catch { /* best-effort */ }

        await pools.getTokenWithSigner(tokenInAddr, signer).approve(info.address, amountIn);
        const tx = await poolContract.swapExactIn(tokenInAddr, amountIn, minOut, playerAddress) as ethers.ContractTransactionResponse;

        // Broadcast trade event for UI markers (Issue #32).
        // direction: "buy" = acquiring token0 (e.g. buying WETH with USDC), "sell" = spending token0.
        const direction: "buy" | "sell" = isToken0In ? "sell" : "buy";
        // tx.blockNumber is null for pending txs; use the receipt to get the confirmed block.
        let blockNumber = tx.blockNumber ?? 0;
        if (!blockNumber) {
          try {
            const rcpt = await tx.wait(1);
            blockNumber = rcpt?.blockNumber ?? 0;
          } catch { /* best-effort; marker will land at block 0 if mining is paused */ }
        }
        broadcast("trade", {
          blockNumber,
          pool:        poolId,
          direction,
          tokenIn:     tokenInAddr,
          amountIn:    amountIn.toString(),
          amountOut:   estimatedOut.toString(),
          txHash:      tx.hash,
        });

        return estimatedOut;
      },

      wrapEth: async (amount: bigint): Promise<void> => {
        for (const p of pools.getAllPools()) {
          const wethAddr = p.symbol0 === "WETH" ? p.token0 : p.symbol1 === "WETH" ? p.token1 : null;
          if (wethAddr) { await pools.getTokenWithSigner(wethAddr, signer).deposit({ value: amount }); return; }
        }
        const fallback = this._tokenAddresses.get("WETH");
        if (fallback) await pools.getTokenWithSigner(fallback, signer).deposit({ value: amount });
      },

      unwrapEth: async (amount: bigint): Promise<void> => {
        for (const p of pools.getAllPools()) {
          const wethAddr = p.symbol0 === "WETH" ? p.token0 : p.symbol1 === "WETH" ? p.token1 : null;
          if (wethAddr) { await pools.getTokenWithSigner(wethAddr, signer).withdraw(amount); return; }
        }
        const fallback = this._tokenAddresses.get("WETH");
        if (fallback) await pools.getTokenWithSigner(fallback, signer).withdraw(amount);
      },

      // ── Liquidity ─────────────────────────────────────────────────────────
      addLiquidity: async (poolId: string, amountA: bigint, amountB: bigint, minA = 0n, minB = 0n): Promise<bigint> => {
        const { info } = pools.getPool(poolId);
        await pools.getTokenWithSigner(info.token0, signer).approve(info.address, amountA);
        await pools.getTokenWithSigner(info.token1, signer).approve(info.address, amountB);
        const result = await pools.getPoolWithSigner(poolId, signer).addLiquidity(amountA, amountB, minA, minB, playerAddress);
        return result[2] as bigint; // (amount0, amount1, shares)
      },

      removeLiquidity: async (poolId: string, shares: bigint, min0 = 0n, min1 = 0n): Promise<{ amount0: bigint; amount1: bigint }> => {
        const { info } = pools.getPool(poolId);
        // LP token is the pool contract itself — approve self to burn shares
        await pools.getTokenWithSigner(info.address, signer).approve(info.address, shares);
        const result = await pools.getPoolWithSigner(poolId, signer).removeLiquidity(shares, min0, min1, playerAddress);
        return { amount0: result[0] as bigint, amount1: result[1] as bigint };
      },

      getLPBalance: async (poolId: string): Promise<bigint> => {
        const { info } = pools.getPool(poolId);
        return BigInt(await pools.getToken(info.address).balanceOf(playerAddress));
      },

      // ── Read-only ─────────────────────────────────────────────────────────
      getBalance: async (tokenSymbol: string): Promise<bigint> => {
        const sym = tokenSymbol.toUpperCase();
        if (sym === "ETH") return await session.signer.provider!.getBalance(playerAddress);
        for (const p of pools.getAllPools()) {
          const addr = sym === p.symbol0.toUpperCase() ? p.token0
                     : sym === p.symbol1.toUpperCase() ? p.token1
                     : null;
          if (addr) return BigInt(await pools.getToken(addr).balanceOf(playerAddress));
        }
        // Fallback for pool-less challenges
        const fallbackAddr = this._tokenAddresses.get(sym);
        if (fallbackAddr) return BigInt(await pools.getToken(fallbackAddr).balanceOf(playerAddress));
        throw new Error(`Unknown token: ${tokenSymbol}`);
      },

      getPrice: async (poolId: string): Promise<number> => pools.getSpotPrice(poolId),

      getReserves: async (poolId: string): Promise<{ reserve0: bigint; reserve1: bigint; price: number }> => {
        const { reserve0, reserve1 } = await pools.getReserves(poolId);
        const { info } = pools.getPool(poolId);
        const price = (Number(reserve1) / 10 ** info.decimals1) / (Number(reserve0) / 10 ** info.decimals0);
        return { reserve0, reserve1, price };
      },

      /** Simulate a swap without executing — returns expected output amount. */
      quoteOut: async (poolId: string, tokenInSymbol: string, amountIn: bigint): Promise<bigint> => {
        const { info } = pools.getPool(poolId);
        const { reserve0, reserve1 } = await pools.getReserves(poolId);
        const isT0In = tokenInSymbol.toUpperCase() === info.symbol0.toUpperCase();
        const [rIn, rOut] = isT0In ? [reserve0, reserve1] : [reserve1, reserve0];
        const fee = amountIn * 997n;
        return fee * rOut / (rIn * 1000n + fee);
      },

      approveToken: async (tokenSymbol: string, spender: string, amount: bigint): Promise<void> => {
        const addr = resolveToken(tokenSymbol);
        await pools.getTokenWithSigner(addr, signer).approve(spender, amount);
      },

      getPriceHistory: async (poolId: string, lastN = 50) => history.getCandles(poolId, lastN),

      // ── Challenge contracts ───────────────────────────────────────────────
      getContractAddress: (id: string): string => {
        if (!contractRegistry) throw new Error("No challenge contracts deployed");
        return contractRegistry.getAddress(id);
      },

      readContract: async (id: string, method: string, args: unknown[] = []): Promise<unknown> => {
        if (!contractRegistry) throw new Error("No challenge contracts deployed");
        const c = contractRegistry.getContract(id);
        return (c as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method](...args);
      },

      execContract: async (id: string, method: string, args: unknown[] = [], value = 0n): Promise<{ hash: string; blockNumber: number }> => {
        if (!contractRegistry) throw new Error("No challenge contracts deployed");
        const c   = contractRegistry.getContractWithSigner(id, signer);
        const tx  = await (c as unknown as Record<string, (...a: unknown[]) => Promise<ethers.ContractTransactionResponse>>)[method](...args, { value });
        // Mining is paused during block callbacks (await callback(ctx) holds the mining loop).
        // Force-mine all pending transactions so this tx lands on-chain before we poll for
        // the receipt — otherwise tx.wait(1) would deadlock waiting for the next block.
        await (session.signer.provider as ethers.JsonRpcProvider).send("evm_mine", []);
        const rcpt = await tx.wait(1);
        return { hash: tx.hash, blockNumber: rcpt?.blockNumber ?? 0 };
      },

      /**
       * Call any contract at a given address using a custom ABI.
       * Useful after proxy upgrades when the registered ABI no longer matches the live implementation.
       * @param address  Target contract address (e.g. a proxy whose implementation was just upgraded)
       * @param abi      ABI fragments as strings, e.g. ["function drain(address,address)"]
       * @param method   Method name
       * @param args     Arguments array
       * @param value    ETH value (wei) to send with the call
       */
      callWithAbi: async (address: string, abi: string[], method: string, args: unknown[] = [], value = 0n): Promise<{ hash: string; blockNumber: number }> => {
        const c  = new ethers.Contract(address, abi, signer);
        const tx = await (c as unknown as Record<string, (...a: unknown[]) => Promise<ethers.ContractTransactionResponse>>)[method](...args, { value });
        await (session.signer.provider as ethers.JsonRpcProvider).send("evm_mine", []);
        const rcpt = await tx.wait(1);
        return { hash: tx.hash, blockNumber: rcpt?.blockNumber ?? 0 };
      },

      // ── Chain history (for calldata forensics) ───────────────────────────

      /**
       * Fetch a transaction by hash.  Returns null if not found.
       * Useful for decoding calldata from historical transactions
       * (e.g., finding the init calldata that reveals a proxy password).
       */
      getTransaction: async (txHash: string): Promise<ethers.TransactionResponse | null> => {
        const provider = session.signer.provider as ethers.JsonRpcProvider;
        return await provider.getTransaction(txHash);
      },

      /**
       * Decode ABI-encoded calldata.
       * @param types  Array of Solidity type strings, e.g. ["string","string","uint8","uint256","address"]
       * @param data   Hex-encoded ABI data (strip the 4-byte selector first if present)
       * @returns      Array of decoded values
       */
      decodeCalldata: (types: string[], data: string): ethers.Result => {
        return ethers.AbiCoder.defaultAbiCoder().decode(types, data);
      },

      /**
       * Fetch all transactions in a block.
       * @param blockNumber  Block number to query (block 1 typically contains challenge setup txs)
       * @returns            Array of TransactionResponse objects (may be empty for empty blocks)
       */
      getBlockTransactions: async (blockNumber: number): Promise<ethers.TransactionResponse[]> => {
        const provider = session.signer.provider as ethers.JsonRpcProvider;
        const block    = await provider.getBlock(blockNumber, true /* prefetchTxs */);
        return block?.prefetchedTransactions ?? [];
      },

      // ── Forge integration ─────────────────────────────────────────────────

      /**
       * Run a `forge script` from within a JS trigger callback.
       *
       * @param scriptPath  Path to the .sol script, relative to the solve/ workspace
       *                    (e.g. `"script/Solve.s.sol"`).
       * @param opts.args   Extra forge CLI arguments appended after the defaults
       *                    (e.g. `["--sig", "run(uint256)", "42"]`).
       * @param opts.contract  Specific contract name within the .sol file (if the file
       *                    contains more than one contract).  Unused by the runner today
       *                    but accepted for forward compatibility.
       * @returns `{ success, exitCode, output }` where `output` is the combined
       *          stdout/stderr as a single string.
       *
       * Throws `Error: runForgeScript is not available` when the sandbox was
       * constructed without a forge runner (e.g. in unit tests).
       */
      runForgeScript: async (
        scriptPath: string,
        opts?: { args?: string[]; contract?: string },
      ): Promise<ForgeScriptResult> => {
        if (!runForgeScriptFn) {
          throw new Error("runForgeScript is not available in this sandbox context");
        }
        return runForgeScriptFn(scriptPath, opts);
      },

      /**
       * Deploy a contract using raw ABI + bytecode without forge.
       * Mining is paused by the engine between game blocks, so this manually
       * mines after sending the deployment transaction.
       */
      deployBytecode: async (abi: string[], bytecode: string, args: unknown[] = [], value = 0n): Promise<string> => {
        const factory  = new ethers.ContractFactory(abi, bytecode, signer);
        const contract = await factory.deploy(...args, { value });
        await (session.signer.provider as ethers.JsonRpcProvider).send("evm_mine", []);
        await contract.waitForDeployment();
        return await contract.getAddress();
      },

      // ── Utils ─────────────────────────────────────────────────────────────
      log:         makeLogger(0),
      getPlayerAddress: () => playerAddress,
      parseEther:  (v: string) => ethers.parseEther(v),
      formatEther: (v: bigint) => ethers.formatEther(v),
      parseUnits:  (v: string, d: number) => ethers.parseUnits(v, d),
      formatUnits: (v: bigint, d: number) => ethers.formatUnits(v, d),
    };
  }
}
