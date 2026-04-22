import { ethers } from "ethers";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ChallengeManifest } from "./ChallengeLoader.js";
import type { ChainClient } from "../chain/ChainClient.js";
import type { MiningController } from "../chain/MiningController.js";
import type { PoolRegistry } from "../market/PoolRegistry.js";
import type { MarketHistory } from "../market/MarketHistory.js";
import type { BotScheduler } from "../bots/BotScheduler.js";
import type { TriggerEngine } from "../triggers/TriggerEngine.js";
import type { ContractRegistry } from "./ContractRegistry.js";
import { WinConditionChecker } from "./WinConditionChecker.js";
import { clearAllSales } from "../market/NftSalesStore.js";
import { config } from "../config.js";

export type ChallengeStatus = "idle" | "running" | "paused" | "won" | "lost" | "complete";

export interface ChallengeState {
  id:             string;
  status:         ChallengeStatus;
  currentBlock:   number;
  totalBlocks:    number;
  playerBalance:  string;
  targetBalance:  string;
  metric:         string;
  winResult?:     { won: boolean; current: string; target: string };
  balances?:      Record<string, string>;
  addressBook?:   Record<string, string>;
  /** First block number of the challenge mining phase (excludes setup/deployment blocks). */
  challengeStartBlock?: number;
}

type BroadcastFn = (type: string, payload: unknown) => void;

/** Same index as the ETH seeder in `start()` — not a bot and not the player (0). */
const TREASURY_SIGNER_INDEX = 9;

export class ChallengeRunner {
  private _status: ChallengeStatus = "idle";
  private _currentBlock = 0;
  private _challengeStartBlock: number = -1;
  private _manifest: ChallengeManifest | null = null;
  private _tokenAddresses = new Map<string, string>();
  private winChecker: WinConditionChecker | null = null;
  private _starting = false;
  private _addressBook: Record<string, string> = {};
  /** Cached result from the last WinConditionChecker.check() call (updated by _broadcastState). */
  private _lastWinState: { playerBalance: string; targetBalance: string } | null = null;

  constructor(
    private client:           ChainClient,
    private mining:           MiningController,
    private pools:            PoolRegistry,
    private history:          MarketHistory,
    private bots:             BotScheduler,
    private triggers:         TriggerEngine,
    private contractRegistry: ContractRegistry,
    private broadcast:        BroadcastFn,
  ) {}

  get status(): ChallengeStatus { return this._status; }
  get manifest(): ChallengeManifest | null { return this._manifest; }
  get tokenAddresses(): ReadonlyMap<string, string> { return this._tokenAddresses; }

  /**
   * Start a challenge from scratch.
   *
   * Orchestration order:
   *   1. Revert chain to the last clean snapshot (or reset if the snapshot is stale)
   *   2. Deploy tokens → upgradeable-token contracts → AMM pools → other contracts → NFT mints
   *   3. Seed bot positions on MarginProtocol (if any)
   *   4. Set player starting balance overrides
   *   5. Initialise bots and win checker
   *   6. Commit the new clean snapshot and begin block mining
   *
   * The snapshot ID is written to process.env.CHAIN_SNAPSHOT_ID only after ALL setup steps
   * succeed — a failed start leaves the previous snapshot intact.
   *
   * Throws if a challenge is already running or a start is already in progress.
   */
  async start(manifest: ChallengeManifest): Promise<void> {
    if (this._status === "running") throw new Error("Challenge already running");
    if (this._starting) throw new Error("Challenge start already in progress");
    this._starting = true;

    try {
      this._manifest = manifest;
      this._status   = "idle";
      this._currentBlock = 0;
      this._challengeStartBlock = -1;
      this._tokenAddresses.clear();
      this.pools.clear();
      this.history.clear();
      this.contractRegistry.clear();

      // Revert to clean snapshot (preserves core protocol).
      // IMPORTANT: only update CHAIN_SNAPSHOT_ID AFTER successful setup so that a
      // failed start does not leave a partial-state snapshot as the new baseline.
      await this.client.rpc("evm_setAutomine", [false]);
      const prevSnapshotId = process.env.CHAIN_SNAPSHOT_ID;
      if (prevSnapshotId) {
        try {
          await this.client.rpc("evm_revert", [prevSnapshotId]);
        } catch (e) {
          // evm_revert can fail if the snapshot was already consumed or is invalid.
          // Fall back to a full Anvil reset.
          console.warn("[ChallengeRunner] evm_revert failed, resetting chain:", e instanceof Error ? e.message : String(e));
          try { await this.client.rpc("anvil_reset", []); } catch {}
          delete process.env.CHAIN_SNAPSHOT_ID;
        }
      }
      try { await this.client.rpc("anvil_dropAllTransactions", []); } catch {}
      await this.client.rpc("evm_setAutomine", [true]);
      // Take snapshot of the clean base state. Stored temporarily; committed to
      // CHAIN_SNAPSHOT_ID only after the full setup succeeds (see below).
      const newId = await this.client.rpc<string>("evm_snapshot", []);

      const addresses  = this._loadAddresses();
      // Signer 0 is the Forge deployer (DEPLOYER_PRIVATE_KEY = Anvil account 0).
      // Pre-deployed tokens (USDC, DAI) are owned by this account, so all
      // onlyOwner mints must use this signer, not an arbitrary index.
      const deployerNM = new ethers.NonceManager(this.client.getSigner(0));

      // Signer 9 is used exclusively for native ETH value deposits (WETH wrapping,
      // pool liquidity seeding). Signer 0 starts with ~10 000 ETH but large pools
      // (e.g. 5 000 WETH × 2 pools) exhaust its budget before gas can be paid.
      // Signer 9 is never the player, a bot, or an onlyOwner caller, so it has its
      // full 10 000 ETH Anvil default available for ETH-valued transactions.
      const seederNM = new ethers.NonceManager(this.client.getSigner(9));

      // 0b. Ensure key signers have enough ETH for setup (bots need 500 ETH to wrap
      // WETH; the pool seeder needs ETH for all WETH pools combined).  After many
      // challenge runs, signers spend ETH on gas and fall below required thresholds.
      // Use anvil_setBalance to top up — this is a test env.
      //
      // Compute total WETH needed by this manifest's pools (seeder funds all WETH legs).
      // Add a 100 ETH gas buffer. Cap the bot target at 10 000 ETH; cap the seeder
      // target at max(10 000 ETH, totalWethNeeded + 100 ETH) so challenges with very
      // large pools (e.g. flash-point: 5 000 + 5 000 WETH) don't run out mid-seeding.
      const wethDef = manifest.tokens.find(t => t.type === "weth");
      let totalWethInPools = 0n;
      if (wethDef) {
        for (const poolDef of manifest.pools) {
          const isA = poolDef.tokenA.toUpperCase() === wethDef.symbol.toUpperCase();
          const isB = poolDef.tokenB.toUpperCase() === wethDef.symbol.toUpperCase();
          if (isA) totalWethInPools += ethers.parseEther(poolDef.initialReserveA);
          if (isB) totalWethInPools += ethers.parseEther(poolDef.initialReserveB);
        }
      }
      const GAS_BUFFER         = ethers.parseEther("100");  // generous gas budget
      const BOT_TARGET_ETH     = ethers.parseEther("10000");
      const BOT_TARGET_HEX     = "0x" + BOT_TARGET_ETH.toString(16);
      const seederTargetEth    = totalWethInPools + GAS_BUFFER > BOT_TARGET_ETH
        ? totalWethInPools + GAS_BUFFER
        : BOT_TARGET_ETH;
      const seederTargetHex    = "0x" + seederTargetEth.toString(16);

      // Bot signers: need ≥ 501 ETH to wrap 500 WETH + pay gas.
      for (const bot of manifest.bots) {
        const botAddr = this.client.getSigner(bot.account).address;
        const bal = await this.client.provider.getBalance(botAddr);
        if (bal < ethers.parseEther("501")) {
          await this.client.rpc("anvil_setBalance", [botAddr, BOT_TARGET_HEX]);
        }
      }
      // Pool seeder (signer 9): always reset to exactly what this manifest needs so
      // gas spent by previous challenges never causes insufficient-funds mid-seeding.
      {
        const seederAddr = this.client.getSigner(9).address;
        await this.client.rpc("anvil_setBalance", [seederAddr, seederTargetHex]);
      }

      // 1. Tokens
      await this._setupTokens(manifest, addresses, deployerNM);

      // 1b. Upgradeable proxy contracts that act as tokens must be deployed BEFORE
      //     pool setup so their addresses can be registered in tokenAddresses.
      const upgradeableTokenContracts = manifest.contracts.filter(
        c => c.type === "upgradeable-erc20-impl" || c.type === "upgradeable-erc20" ||
             c.type === "vault-impl"              || c.type === "uninitialized-proxy" ||
             c.type === "amm-proxy-impl"          || c.type === "amm-proxy",
      );
      if (upgradeableTokenContracts.length > 0) {
        await this._deployUpgradeableContracts(manifest, upgradeableTokenContracts, deployerNM, seederNM);
      }

      // 2. AMM pools (must come before contracts so {{pool:id}} placeholders can resolve)
      await this._setupPools(manifest, addresses, deployerNM, seederNM);

      // 3. Challenge-specific contracts (can reference tokens, pools, and each other).
      //    Skip the upgradeable contracts already deployed in step 1b.
      const upgradeableIds = new Set(upgradeableTokenContracts.map(c => c.id));
      const remainingContracts = manifest.contracts.filter(c => !upgradeableIds.has(c.id));
      if (remainingContracts.length > 0) {
        const poolAddresses = new Map<string, string>(
          manifest.pools.map(p => [p.id, this.pools.getPool(p.id).info.address]),
        );
        await this.contractRegistry.deploy(remainingContracts, deployerNM, this._tokenAddresses, poolAddresses);
      }

      // 3b. NFT mints + auto-listings (for nft-collection/nft-marketplace challenges)
      if (manifest.nftMints && manifest.nftMints.length > 0) {
        await this._processNftMints(manifest, deployerNM);
      }

      // 4. Seed bot positions on MarginProtocol contracts (if any)
      if (manifest.botPositions && manifest.botPositions.length > 0) {
        await this._seedBotPositions(manifest, deployerNM, seederNM);
      }

      // 5. Player starting balance — always reset native ETH to a known amount so
      //    the Anvil default (~10 000 ETH) does not trivialise every challenge.
      //    Manifests that need more (or less) capital specify player.startingEth.
      await this._setupPlayerOverrides(manifest, deployerNM);

      // 6. Bots (supply token address map so bots can resolve {{token:SYM}} params)
      this.bots.setTokenAddresses(this._tokenAddresses);
      this.bots.init(
        manifest.bots.map(b => ({ ...b, params: { ...b.params } })),
        manifest.chain.botSeed,
      );

      // 7. Win condition checker
      this.winChecker = new WinConditionChecker(
        manifest, this.client, this.pools, this._tokenAddresses, this.contractRegistry,
      );
      await this.winChecker.recordStart();

      // 8. Mining — use the manifest's blockIntervalMs directly.
      this.mining.configure({
        blockIntervalMs: manifest.chain.blockIntervalMs,
        totalBlocks:     manifest.chain.blockCount,
      });
      this.mining.onBlock(async (blockNum) => {
        this._currentBlock = blockNum;
        await this._onBlock(blockNum);
      });

      // Setup completed successfully — commit the clean snapshot as the new baseline.
      // This must be done AFTER all setup steps so a failed start does not pollute the
      // baseline with a partial-state snapshot.
      process.env.CHAIN_SNAPSHOT_ID = newId;

      await this._broadcastState();
      this._buildAddressBook();
      this._status = "running";

      // Capture the first challenge mining block (everything before this is setup/deployment).
      const latestBeforeMining = await this.client.provider.getBlock("latest");
      this._challengeStartBlock = (latestBeforeMining?.number ?? 0) + 1;

      await this._broadcastState();
      await this.mining.start(Math.floor(Date.now() / 1000));
    } finally {
      this._starting = false;
    }
  }

  /** Stop the running challenge. Halts mining and clears bots, returns to idle. */
  async stop(): Promise<void> {
    await this.mining.stop();
    this.bots.clear();
    clearAllSales();
    this._status = "idle";
    this._addressBook = {};
    this._challengeStartBlock = -1;
    this._lastWinState = null;
    await this._broadcastState();
  }

  /** Pause block mining. Bots and triggers are frozen until resume() is called. */
  pause(): void {
    this.mining.pause();
    this._status = "paused";
    this._broadcastState();
  }

  /** Resume mining after a pause. */
  resume(): void {
    this.mining.resume();
    this._status = "running";
    this._broadcastState();
  }

  /** Mine `blocks` blocks instantly (ignoring blockIntervalMs), then resume normal cadence. */
  async fastForward(blocks: number): Promise<void> {
    await this.mining.fastForward(blocks);
  }

  /**
   * Check the win condition immediately against the current chain state.
   *
   * Called after a forge script or player-script `runForgeScript` completes so
   * that challenges solved entirely via `forge --broadcast` (e.g. broken-token,
   * spot-the-oracle) are detected without waiting for the next mined block.
   *
   * Skips silently when no challenge is running or no win checker is installed.
   */
  async checkWinConditionAfterForge(): Promise<void> {
    if (this._status !== "running" || !this.winChecker || !this._manifest) return;

    try {
      const latestBlock = await this.client.provider.getBlock("latest");
      const blockNumber = latestBlock?.number ?? this._currentBlock;

      const result = await this.winChecker.check(blockNumber);
      const m      = this._manifest;
      const win    = m.win;

      const targetBalance = this._targetBalanceForUi(win);
      const playerBalance = this._playerBalanceForUi(win, result.current);
      this._lastWinState  = { playerBalance, targetBalance };
      const balances      = await this._getPlayerBalances();

      this.broadcast("challenge", {
        id: m.id, status: this._status,
        currentBlock: blockNumber, totalBlocks: m.chain.blockCount,
        playerBalance, targetBalance, metric: win.metric,
        balances, addressBook: this._addressBook,
        challengeStartBlock: this._challengeStartBlock >= 0 ? this._challengeStartBlock : undefined,
      });

      if (result.won) {
        this._status = "won";
        await this.mining.stop();
        this.broadcast("win", { ...result, won: true });
      }
      // Note: do not check blocksRemaining here — the block counter is only
      // advanced by _onBlock(), so checking it outside that path would give a
      // stale value.  Time-expiry is still handled correctly by _onBlock().
    } catch (e) {
      console.error("[ChallengeRunner] checkWinConditionAfterForge error:", e);
    }
  }

  getState(): ChallengeState {
    const m   = this._manifest;
    const win = m?.win;
    let targetBalance = "0";
    if (win) {
      if (win.metric === "drainContract") {
        // Scale to 18-decimal-equivalent (matches _targetBalanceForUi)
        const sym      = (win as { tokenSymbol?: string }).tokenSymbol;
        const tokenDef = sym ? m!.tokens.find(t => t.symbol.toUpperCase() === sym.toUpperCase()) : null;
        const decimals = tokenDef?.decimals ?? 18;
        const hr       = ethers.formatUnits(BigInt(win.threshold), decimals);
        targetBalance  = ethers.parseEther(hr).toString();
      } else {
        targetBalance = "target" in win ? ethers.parseEther(win.target).toString() : "0";
      }
    }
    return {
      id:            m?.id ?? "",
      status:        this._status,
      currentBlock:  this._currentBlock,
      totalBlocks:   m?.chain.blockCount ?? 0,
      playerBalance: this._lastWinState?.playerBalance ?? "0",
      targetBalance: this._lastWinState?.targetBalance ?? targetBalance,
      metric:        win?.metric ?? "ethBalance",
      addressBook:   this._addressBook,
      challengeStartBlock: this._challengeStartBlock >= 0 ? this._challengeStartBlock : undefined,
    };
  }

  /** Build a map of address → human-readable name for the block explorer. */
  private _buildAddressBook(): void {
    const book: Record<string, string> = {};

    // Well-known signers
    // Signer 0 is the player AND the Forge deployer (same Anvil account 0).
    book[this.client.getSigner(0).address.toLowerCase()] = "Player";

    // Bots
    for (const def of (this._manifest?.bots ?? [])) {
      const addr = this.client.getSigner(def.account).address.toLowerCase();
      book[addr] = `Bot: ${def.id}`;
    }

    // Tokens (symbol → address is the map; we need address → symbol)
    for (const [sym, addr] of this._tokenAddresses) {
      book[addr.toLowerCase()] = sym;
    }

    // Pools
    for (const pool of this.pools.getAllPools()) {
      book[pool.address.toLowerCase()] = `Pool: ${pool.id}`;
    }

    // Registered contracts
    for (const id of this.contractRegistry.list()) {
      try {
        const addr = this.contractRegistry.getAddress(id);
        book[addr.toLowerCase()] = id;
      } catch { /* skip if getAddress throws */ }
    }

    this._addressBook = book;
  }

  /**
   * Per-block tick handler. Invoked by MiningController once per mined block.
   *
   * Execution sequence per block:
   *   0. NFT collection reveal (if configured for this block)
   *   1. Record on-chain prices → build OHLCV candles → broadcast `price` + `candle` events
   *   2. Tick all bots (deterministic, seeded)
   *   3. Fire registered player script triggers
   *   4. Evaluate win condition → broadcast `challenge` state update
   *      → if won or time expired, stop mining and broadcast `win` event
   *   5. Broadcast `block` event (chainBlockNumber, blocksRemaining)
   *      — sent after `challenge` so the status bar is current when the
   *        block-explorer triggers its get_blocks fetch
   *
   * Anvil automine is enabled for the entire duration of this handler so that any
   * transactions submitted by bots or trigger callbacks are mined immediately
   * (their tx.wait(1) calls resolve without deadlock). Automine is re-disabled in
   * the `finally` block so the mining controller resumes interval-based mining.
   */
  private async _onBlock(blockNumber: number): Promise<void> {
    // Enable automine for the duration of this block callback so that any
    // transactions sent by bots or trigger handlers (which call wait(1)) get
    // confirmed immediately.  The mining controller has interval mining disabled
    // while _onBlock runs, so we must manually enable/disable automine here.
    await this.client.rpc("evm_setAutomine", [true]).catch(() => {});

    try {
      this.mining.enterGameBlock();

      // Resolve the actual Anvil chain block number for the newly mined block.
      // `blockNumber` is the challenge-relative count (1, 2, 3 …) maintained by
      // MiningController; `chainBlockNumber` is what the block explorer, candle
      // recorder, and "block" WS event must use so that `get_blocks` requests and
      // `provider.getBlock()` calls refer to the correct on-chain block.
      //
      // Use a deterministic formula instead of getBlock("latest") to avoid timing
      // issues when automine is enabled at the start of each game tick.
      const chainBlockNumber = this._challengeStartBlock >= 0
        ? this._challengeStartBlock - 1 + blockNumber
        : blockNumber;

      // Fetch the on-chain block for timestamp only (separate from chainBlockNumber
      // derivation so the timestamp is always accurate regardless of automine timing).
      const latestChainBlock = await this.client.provider.getBlock("latest");

      // 0. NFT reveal trigger — uses challenge-relative blockNumber (matches manifest atBlock)
      const nftReveal = this._manifest?.nftReveal;
      if (nftReveal && blockNumber === nftReveal.atBlock) {
        try {
          const addr    = this.contractRegistry.getAddress(nftReveal.contractId);
          const deployer = new ethers.NonceManager(this.client.getSigner(0));
          const REVEAL_ABI = ["function reveal()"];
          const coll = new ethers.Contract(addr, REVEAL_ABI, deployer);
          await (await coll.reveal()).wait(1);
          console.log(`[ChallengeRunner] NFT collection ${nftReveal.contractId} revealed at block ${blockNumber}`);
          this.broadcast("nft_revealed", { contractId: nftReveal.contractId, blockNumber });
        } catch (e) {
          console.error("[ChallengeRunner] nftReveal error:", e);
        }
      }

      // 1. Record prices for all pools
      for (const poolDef of this._manifest!.pools) {
        try {
          const { reserve0, reserve1 } = await this.pools.getReserves(poolDef.id);
          const info      = this.pools.getPool(poolDef.id).info;
          const price     = (Number(reserve1) / 10 ** info.decimals1) /
                           (Number(reserve0) / 10 ** info.decimals0);
          // Use the actual chain block to get the correct on-chain timestamp.
          const timestamp = latestChainBlock?.timestamp ?? 0;

          const candleResult = this.history.recordTick(poolDef.id, {
            blockNumber, timestamp: Number(timestamp), price, reserve0, reserve1,
          });

          this.broadcast("price", {
            pair: poolDef.id, price, blockNumber,
            reserve0: reserve0.toString(), reserve1: reserve1.toString(),
            symbol0: info.symbol0, symbol1: info.symbol1,
            decimals0: info.decimals0, decimals1: info.decimals1,
          });

          if (candleResult) {
            this.broadcast("candle", {
              pair: poolDef.id, candle: candleResult.candle, isUpdate: !candleResult.isNew,
            });
          }
        } catch {}
      }

      // 2. Tick bots
      await this.bots.tick(blockNumber);

      // 3. Player script triggers
      await this.triggers.tick(blockNumber);

      // 4. Win/lose check — runs before the "block" broadcast so that the
      //    "challenge" status update (currentBlock, balances) is sent to the
      //    client before the "block" event triggers the block-explorer fetch.
      //    This ensures the status bar and block explorer update in sync: the
      //    client sees the new block count first, then the new block appears.
      const blocksRemaining = this.mining.getBlocksRemaining();
      if (this.winChecker) {
        const result = await this.winChecker.check(blockNumber);
        const m      = this._manifest!;
        const win    = m.win;

        const targetBalance = this._targetBalanceForUi(win);
        const playerBalance = this._playerBalanceForUi(win, result.current);
        // Cache so REST getState() always returns the latest computed balance.
        this._lastWinState = { playerBalance, targetBalance };
        const balances      = await this._getPlayerBalances();

        this.broadcast("challenge", {
          id: m.id, status: this._status,
          currentBlock: blockNumber, totalBlocks: m.chain.blockCount,
          playerBalance, targetBalance, metric: win.metric,
          balances, addressBook: this._addressBook,
          challengeStartBlock: this._challengeStartBlock >= 0 ? this._challengeStartBlock : undefined,
        });

        // 5. Block event — sent after "challenge" so the status bar is current
        //    when the block-explorer fetch fires.  Uses chainBlockNumber so that
        //    get_blocks resolves the correct on-chain block rather than the
        //    challenge-relative index (which is always < setup block numbers).
        this.broadcast("block", { blockNumber: chainBlockNumber, timestamp: Date.now(), blocksRemaining });

        if (result.won) {
          this._status = "won";
          await this.mining.stop();
          this.broadcast("win", { ...result, won: true });
          return;
        }
        if (blocksRemaining === 0) {
          this._status = "lost";
          await this.mining.stop();
          this.broadcast("win", { ...result, won: false });
        }
      } else {
        // No win checker — still broadcast "block" so the explorer stays live.
        this.broadcast("block", { blockNumber: chainBlockNumber, timestamp: Date.now(), blocksRemaining });
      }

    } finally {
      // Re-disable automine so the mining controller resumes interval mining — unless a
      // forge hold is active (player script / IDE) which keeps automine on for pending txs.
      if (!this.mining.isPlayerScriptHoldActive()) {
        await this.client.rpc("evm_setAutomine", [false]).catch(() => {});
      }
      this.mining.leaveGameBlock();
    }
  }

  // ── Setup helpers ─────────────────────────────────────────────────────────

  /**
   * Deploy upgradeable proxy contracts that must be registered as tokens before
   * AMM pool setup.  Handles multi-step orchestration that ContractRegistry's
   * generic deploy() cannot express:
   *
   *   upgradeable-erc20-impl  → deploys ERC20Implementation (no args)
   *   upgradeable-erc20       → deploys UpgradeableERC20(impl), calls initProxy(password)
   *                             [password permanently visible in that tx's calldata], then
   *                             calls initialize(name, symbol, decimals, supply, deployer).
   *                             Registers the proxy as manifest tokenSymbol.
   *   vault-impl              → deploys VaultImplementation (no args)
   *   uninitialized-proxy     → deploys UninitializedProxy(impl), funds with tokens/ETH
   */
  private async _deployUpgradeableContracts(
    manifest:   ChallengeManifest,
    specs:      ChallengeManifest["contracts"],
    deployer:   ethers.NonceManager,
    seeder:     ethers.NonceManager,
  ): Promise<void> {
    // Keep a local map: id → address (for impl references within this batch)
    const localAddresses = new Map<string, string>();

    for (const spec of specs) {
      const artifactName = this._upgradeableArtifactName(spec.type);
      const artifactPath = join(config.contractsOutDir, `${artifactName}.sol`, `${artifactName}.json`);
      if (!existsSync(artifactPath)) {
        throw new Error(
          `[ChallengeRunner] artifact not found: ${artifactPath}\n` +
          `  → Run \`forge build\` inside the contracts/ directory.`,
        );
      }
      const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
      const abi      = artifact.abi as ethers.InterfaceAbi;
      const bytecode = artifact.bytecode?.object as string | undefined;
      if (!bytecode || bytecode === "0x") {
        throw new Error(`[ChallengeRunner] no bytecode in artifact: ${artifactName}`);
      }

      if (spec.type === "upgradeable-erc20-impl" || spec.type === "vault-impl") {
        // Simple: deploy with no constructor args
        const factory  = new ethers.ContractFactory(abi, bytecode, deployer);
        const contract = await factory.deploy();
        await contract.waitForDeployment();
        const address  = await contract.getAddress();
        localAddresses.set(spec.id, address);
        this.contractRegistry.register(spec.id, address, abi, spec.type);
        console.log(`[ChallengeRunner] deployed ${spec.type} as "${spec.id}" @ ${address}`);

      } else if (spec.type === "upgradeable-erc20") {
        // params: [password, tokenSymbol, tokenName, decimals, supply]
        // (indices match manifest params array)
        const [password, , tokenName, decimalsStr, supplyStr] = spec.params as string[];
        const tokenSym    = spec.tokenSymbol ?? (spec.params[1] as string);
        const decimals    = parseInt(decimalsStr, 10);
        const supply      = ethers.parseUnits(supplyStr, decimals);

        // Find the impl address — must have been deployed earlier in this batch
        // Look for an upgradeable-erc20-impl contract in the local or registry
        const implId = specs.find(s => s.type === "upgradeable-erc20-impl")?.id;
        if (!implId) {
          throw new Error(
            `[ChallengeRunner] upgradeable-erc20 "${spec.id}" requires an upgradeable-erc20-impl contract to be listed first`,
          );
        }
        const implAddress = localAddresses.get(implId) ?? this.contractRegistry.getAddress(implId);

        // Deploy the proxy — constructor only needs the implementation address.
        // The password is set via a separate initProxy() call below, which permanently
        // exposes the plaintext in that transaction's calldata.
        const proxyFactory  = new ethers.ContractFactory(abi, bytecode, deployer);
        const proxyContract = await proxyFactory.deploy(implAddress);
        await proxyContract.waitForDeployment();
        const proxyAddress  = await proxyContract.getAddress();
        localAddresses.set(spec.id, proxyAddress);
        this.contractRegistry.register(spec.id, proxyAddress, abi, spec.type);
        console.log(`[ChallengeRunner] deployed UpgradeableERC20 proxy as "${spec.id}" @ ${proxyAddress}`);

        // Call initProxy(password) on the proxy — THIS transaction's calldata
        // permanently exposes the plaintext password on-chain.  Players scan the
        // init block, find this tx, decode the calldata, and recover the password.
        const PROXY_INIT_ABI = ["function initProxy(string calldata password)"];
        const proxyAdmin = new ethers.Contract(proxyAddress, PROXY_INIT_ABI, deployer);
        const initProxyTx   = await proxyAdmin.initProxy(password);
        const initProxyRcpt = await initProxyTx.wait(1);
        console.log(
          `[ChallengeRunner] initProxy called @ block ${initProxyRcpt?.blockNumber}.` +
          ` Password calldata tx hash: ${initProxyTx.hash}`,
        );

        // Call initialize(name, symbol, decimals, supply, deployer) through the proxy
        // to set up the ERC20 state (delegatecall to ERC20Implementation).
        const INIT_ABI = [
          "function initialize(string,string,uint8,uint256,address)",
        ];
        const proxyAsImpl = new ethers.Contract(proxyAddress, INIT_ABI, deployer);
        const deployerAddress = await deployer.getAddress();
        const initTx   = await proxyAsImpl.initialize(tokenName, tokenSym, decimals, supply, deployerAddress);
        const initRcpt = await initTx.wait(1);

        console.log(
          `[ChallengeRunner] ${tokenSym} token ERC20 initialized @ block ${initRcpt?.blockNumber}.`,
        );

        // Register the proxy address as the token in the pool token registry
        const sym = tokenSym.toUpperCase();
        this._tokenAddresses.set(sym, proxyAddress);
        console.log(`[ChallengeRunner] registered proxy ${proxyAddress} as token "${sym}"`);

        // The deployer (signer 0) now holds the full token supply from initialize().
        // Transfer the entire supply to the seeder (signer 9 / treasury) so that
        // _setupPools() can use its standard transfer-from-seeder path when adding
        // liquidity to any pool that pairs this token. Without this, _setupPools would
        // attempt to transfer from signer 9 which has zero balance, causing a revert.
        const PROXY_TRANSFER_ABI = ["function transfer(address to, uint256 amount) returns (bool)"];
        const seederAddress = await seeder.getAddress();
        const proxyToken = new ethers.Contract(proxyAddress, PROXY_TRANSFER_ABI, deployer);
        await (await proxyToken.transfer(seederAddress, supply)).wait(1);
        console.log(
          `[ChallengeRunner] transferred ${supplyStr} ${sym} from deployer to treasury (seeder) for pool seeding`,
        );

        // Fund the contract if requested (not typical for upgradeable-erc20)
        await this._fundContract(spec, proxyAddress, deployer, seeder);

      } else if (spec.type === "uninitialized-proxy") {
        // Find the vault-impl address
        const vaultImplId = specs.find(s => s.type === "vault-impl")?.id;
        if (!vaultImplId) {
          throw new Error(
            `[ChallengeRunner] uninitialized-proxy "${spec.id}" requires a vault-impl contract to be listed first`,
          );
        }
        const implAddress = localAddresses.get(vaultImplId) ?? this.contractRegistry.getAddress(vaultImplId);

        const factory  = new ethers.ContractFactory(abi, bytecode, deployer);
        const contract = await factory.deploy(implAddress);
        await contract.waitForDeployment();
        const address  = await contract.getAddress();
        localAddresses.set(spec.id, address);
        this.contractRegistry.register(spec.id, address, abi, spec.type);
        console.log(`[ChallengeRunner] deployed UninitializedProxy as "${spec.id}" @ ${address}`);

        // Fund with tokens or ETH
        await this._fundContract(spec, address, deployer, seeder);

      } else if (spec.type === "amm-proxy-impl") {
        // Deploy ConstantProductAMMImpl with no constructor args.
        const factory  = new ethers.ContractFactory(abi, bytecode, deployer);
        const contract = await factory.deploy();
        await contract.waitForDeployment();
        const address  = await contract.getAddress();
        localAddresses.set(spec.id, address);
        this.contractRegistry.register(spec.id, address, abi, spec.type);
        console.log(`[ChallengeRunner] deployed amm-proxy-impl as "${spec.id}" @ ${address}`);

      } else if (spec.type === "amm-proxy") {
        // Params: [token0Symbol, token1Symbol, reserveA, reserveB]
        // Deploy UpgradeableAMM(impl), then call initPool(token0, token1) through the
        // proxy, then seed liquidity via addLiquidity.
        const [symA, symB, reserveAStr, reserveBStr] = spec.params as string[];

        // Find the impl address
        const implId = specs.find(s => s.type === "amm-proxy-impl")?.id;
        if (!implId) {
          throw new Error(
            `[ChallengeRunner] amm-proxy "${spec.id}" requires an amm-proxy-impl contract listed first`,
          );
        }
        const implAddress = localAddresses.get(implId) ?? this.contractRegistry.getAddress(implId);

        // Deploy the upgradeable proxy
        const proxyFactory  = new ethers.ContractFactory(abi, bytecode, deployer);
        const proxyContract = await proxyFactory.deploy(implAddress);
        await proxyContract.waitForDeployment();
        const proxyAddress  = await proxyContract.getAddress();
        localAddresses.set(spec.id, proxyAddress);
        this.contractRegistry.register(spec.id, proxyAddress, abi, spec.type);
        console.log(`[ChallengeRunner] deployed UpgradeableAMM proxy as "${spec.id}" @ ${proxyAddress}`);

        // Resolve token addresses
        const addrA = this._tokenAddresses.get(symA.toUpperCase());
        const addrB = this._tokenAddresses.get(symB.toUpperCase());
        if (!addrA || !addrB) {
          throw new Error(
            `[ChallengeRunner] amm-proxy "${spec.id}": token addresses missing for ${symA}/${symB}`,
          );
        }

        // Call initPool(token0, token1) through the proxy (delegatecall into impl)
        const INIT_POOL_ABI = ["function initPool(address _token0, address _token1)"];
        const proxyAsImpl = new ethers.Contract(proxyAddress, INIT_POOL_ABI, deployer);
        await (await proxyAsImpl.initPool(addrA, addrB)).wait(1);
        console.log(`[ChallengeRunner] amm-proxy "${spec.id}": initPool(${addrA}, ${addrB}) called`);

        // Seed liquidity: determine which is token0/token1 after sorting
        const TOKEN_ABI = [
          "function decimals() view returns (uint8)",
          "function approve(address spender, uint256 amount) returns (bool)",
        ];
        const WETH_DEPOSIT = ["function deposit() payable"];
        const READ_AMM_ABI = ["function token0() view returns (address)"];

        const proxyReadOnly = new ethers.Contract(proxyAddress, READ_AMM_ABI, deployer);
        const t0 = (await proxyReadOnly.token0()).toLowerCase();
        const isAisT0 = addrA.toLowerCase() === t0;

        const tok0addr = isAisT0 ? addrA : addrB;
        const tok1addr = isAisT0 ? addrB : addrA;
        const sym0     = isAisT0 ? symA.toUpperCase() : symB.toUpperCase();
        const sym1     = isAisT0 ? symB.toUpperCase() : symA.toUpperCase();

        const tok0Info = manifest.tokens.find(t => t.symbol.toUpperCase() === sym0);
        const tok1Info = manifest.tokens.find(t => t.symbol.toUpperCase() === sym1);
        const dec0 = tok0Info?.decimals ?? 18;
        const dec1 = tok1Info?.decimals ?? 18;

        const amount0 = ethers.parseUnits(isAisT0 ? reserveAStr : reserveBStr, dec0);
        const amount1 = ethers.parseUnits(isAisT0 ? reserveBStr : reserveAStr, dec1);

        // Wrap ETH to WETH using the seeder signer (signer 9) so that large deposits
        // do not exhaust signer 0's ETH budget. The seeder has no other role and retains
        // its full 10 000 ETH Anvil default for these value-bearing transactions.
        // Transfer freshly-wrapped WETH from seeder → deployer so deployer can approve the pool.
        const WETH_TRANSFER_ABI = ["function transfer(address to, uint256 amount) returns (bool)"];
        const deployerAddrProxy = await deployer.getAddress();
        if (tok0Info?.type === "weth") {
          await (await new ethers.Contract(tok0addr, WETH_DEPOSIT, seeder).deposit({ value: amount0 })).wait(1);
          await (await new ethers.Contract(tok0addr, WETH_TRANSFER_ABI, seeder).transfer(deployerAddrProxy, amount0)).wait(1);
        }
        if (tok1Info?.type === "weth") {
          await (await new ethers.Contract(tok1addr, WETH_DEPOSIT, seeder).deposit({ value: amount1 })).wait(1);
          await (await new ethers.Contract(tok1addr, WETH_TRANSFER_ABI, seeder).transfer(deployerAddrProxy, amount1)).wait(1);
        }

        // Non-WETH legs: deployerMintAmount mints to the treasury (signer 9 = seeder),
        // not to the deployer. Transfer exactly what this pool needs to the deployer.
        if (tok0Info && tok0Info.type !== "weth") {
          await (await new ethers.Contract(tok0addr, WETH_TRANSFER_ABI, seeder).transfer(deployerAddrProxy, amount0)).wait(1);
        }
        if (tok1Info && tok1Info.type !== "weth") {
          await (await new ethers.Contract(tok1addr, WETH_TRANSFER_ABI, seeder).transfer(deployerAddrProxy, amount1)).wait(1);
        }

        // Approve and add liquidity
        await (await new ethers.Contract(tok0addr, TOKEN_ABI, deployer).approve(proxyAddress, amount0)).wait(1);
        await (await new ethers.Contract(tok1addr, TOKEN_ABI, deployer).approve(proxyAddress, amount1)).wait(1);

        const ADD_LIQ_ABI = [
          "function addLiquidity(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address to) returns (uint256, uint256, uint256)",
        ];
        const proxyLiq = new ethers.Contract(proxyAddress, ADD_LIQ_ABI, deployer);
        const deployerAddr = await deployer.getAddress();
        await (await proxyLiq.addLiquidity(amount0, amount1, 0n, 0n, deployerAddr)).wait(1);
        console.log(
          `[ChallengeRunner] amm-proxy "${spec.id}": seeded with ` +
          `${isAisT0 ? reserveAStr : reserveBStr} ${sym0} / ${isAisT0 ? reserveBStr : reserveAStr} ${sym1}`,
        );

        // Fund with any additional tokens/ETH specified in fund[]
        await this._fundContract(spec, proxyAddress, deployer, seeder);
      }
    }
  }

  /** Returns the Solidity artifact file name for a given upgradeable contract type. */
  private _upgradeableArtifactName(type: string): string {
    switch (type) {
      case "upgradeable-erc20-impl": return "ERC20Implementation";
      case "upgradeable-erc20":      return "UpgradeableERC20";
      case "vault-impl":             return "VaultImplementation";
      case "uninitialized-proxy":    return "UninitializedProxy";
      case "amm-proxy-impl":         return "ConstantProductAMMImpl";
      case "amm-proxy":              return "UpgradeableAMM";
      default: throw new Error(`[ChallengeRunner] unknown upgradeable contract type: ${type}`);
    }
  }

  /**
   * Fund a contract with ETH or tokens after deployment.
   * Mirrors the funding logic in ContractRegistry.deploy().
   *
   * @param seeder - Optional signer used exclusively for native ETH value deposits
   *   (WETH wrapping). If omitted, falls back to signer 0. Pass signer 9 from
   *   the call sites to avoid exhausting signer 0's ETH budget on large deposits.
   */
  private async _fundContract(
    spec:     { fund?: { tokenSymbol: string; amount: string }[] },
    address:  string,
    deployer: ethers.NonceManager,
    seeder?:  ethers.NonceManager,
  ): Promise<void> {
    if (!spec.fund) return;
    const ERC20_MINT_ABI = [
      "function decimals() view returns (uint8)",
      "function mint(address to, uint256 amount)",
      "function transfer(address to, uint256 amount) returns (bool)",
    ];

    // Use the raw (non-NonceManaged) signer with explicit nonce control.
    // NonceManager can skip a nonce if estimateGas fails (e.g. mint() on WETH),
    // leaving a gap that blocks all subsequent transactions from being mined.
    // By reading "latest" nonce from chain directly, we avoid any stale state.
    // Signer 0 is the Forge deployer — owner of all pre-deployed tokens.
    const rawSigner = this.client.getSigner(0);
    const deployerAddr = rawSigner.address;

    // Use direct RPC to bypass ethers.js provider's nonce cache.
    // provider.getTransactionCount() can return a stale cached value when called
    // shortly after contract deployments via NonceManager in the same setup sequence.
    const nonceHex = await this.client.rpc<string>("eth_getTransactionCount", [deployerAddr, "pending"]);
    let nonce = parseInt(nonceHex, 16);

    for (const f of spec.fund) {
      if (f.tokenSymbol.toUpperCase() === "ETH") {
        const amount = ethers.parseEther(f.amount);
        await (await rawSigner.sendTransaction({ to: address, value: amount, nonce })).wait(1);
        nonce++;
        console.log(`[ChallengeRunner] funded "${address}" with ${f.amount} ETH`);
      } else {
        const tokenAddr = this._tokenAddresses.get(f.tokenSymbol.toUpperCase());
        if (!tokenAddr) {
          console.warn(`[ChallengeRunner] fund: token not found: ${f.tokenSymbol}`);
          continue;
        }
        const decimals = Number(
          await new ethers.Contract(tokenAddr, ERC20_MINT_ABI, rawSigner).decimals()
        );
        const amount = ethers.parseUnits(f.amount, decimals);

        // Try mint first (works for MockERC20); fall back to WETH deposit+transfer.
        // Use explicit nonces to avoid NonceManager skipping on estimateGas failures.
        const mintContract = new ethers.Contract(tokenAddr, ERC20_MINT_ABI, rawSigner);
        let minted = false;
        try {
          await (await mintContract.mint(address, amount, { nonce })).wait(1);
          nonce++;
          minted = true;
        } catch { /* fall through to WETH deposit path; nonce not consumed */ }

        if (!minted) {
          const wethAbi = [
            "function deposit() payable",
            "function balanceOf(address) view returns (uint256)",
            "function transfer(address, uint256) returns (bool)",
          ];
          const wethC = new ethers.Contract(tokenAddr, wethAbi, rawSigner);
          const deployerBal = BigInt(await wethC.balanceOf(deployerAddr));
          if (deployerBal >= amount) {
            await (await wethC.transfer(address, amount, { nonce })).wait(1);
            nonce++;
          } else {
            // Use the seeder signer (signer 9) for native ETH value deposits so that
            // signer 0's ETH budget is not exhausted by large WETH wraps.
            if (seeder) {
              const wethSeeder = new ethers.Contract(tokenAddr, wethAbi, seeder);
              await (await wethSeeder.deposit({ value: amount })).wait(1);
              await (await wethSeeder.transfer(deployerAddr, amount)).wait(1);
              // Deployer now holds the freshly-wrapped WETH; transfer it to the contract.
              await (await wethC.transfer(address, amount, { nonce })).wait(1);
              nonce++;
            } else {
              await (await wethC.deposit({ value: amount, nonce })).wait(1);
              nonce++;
              await (await wethC.transfer(address, amount, { nonce })).wait(1);
              nonce++;
            }
          }
        }
        console.log(`[ChallengeRunner] funded "${address}" with ${f.amount} ${f.tokenSymbol}`);
      }
    }
  }



  private async _processNftMints(manifest: ChallengeManifest, deployer: ethers.NonceManager) {
    const NFT_ABI = [
      "function mintTo(address to, uint8 rarityScore) returns (uint256)",
      "function totalSupply() view returns (uint256)",
    ];
    const APPROVAL_ABI = [
      "function approve(address to, uint256 tokenId)",
      "function setApprovalForAll(address operator, bool approved)",
    ];
    const MARKETPLACE_ABI = [
      "function listToken(uint256 tokenId, uint256 price)",
    ];

    const recipientAddress = (recipient: string): string => {
      switch (recipient) {
        case "player": return this.client.getSigner(0).address;
        case "marketplace": {
          // find the first nft-marketplace contract in the manifest
          const mkt = manifest.contracts.find(c => c.type === "NFTMarketplace");
          if (!mkt) throw new Error("[ChallengeRunner] nftMints: no NFTMarketplace contract in manifest");
          return this.contractRegistry.getAddress(mkt.id);
        }
        case "bot0": return this.client.getSigner(1).address;
        case "bot1": return this.client.getSigner(2).address;
        case "bot2": return this.client.getSigner(3).address;
        case "bot3": return this.client.getSigner(4).address;
        case "bot4": return this.client.getSigner(5).address;
        case "bot5": return this.client.getSigner(6).address;
        default: throw new Error(`[ChallengeRunner] unknown nftMint recipient: ${recipient}`);
      }
    };

    // Group mints by contractId for efficiency
    const byContract = new Map<string, typeof manifest.nftMints>();
    for (const mint of manifest.nftMints) {
      if (!byContract.has(mint.contractId)) byContract.set(mint.contractId, []);
      byContract.get(mint.contractId)!.push(mint);
    }

    for (const [contractId, mints] of byContract) {
      const collectionAddr = this.contractRegistry.getAddress(contractId);
      const collection     = new ethers.Contract(collectionAddr, [...NFT_ABI, ...APPROVAL_ABI], deployer);

      // Pre-approve: call setApprovalForAll once per (seller account, marketplace) pair.
      // Use explicit nonce tracking (not NonceManager) to avoid nonce collisions with
      // bot signers that may have pending/prior transactions from _setupTokens.
      const approvedPairs = new Set<string>(); // "sellerAddr:mktAddr"
      // Track current nonce per signer index; read from chain lazily (latest block).
      const signerNonces = new Map<number, number>();
      const getAndBumpNonce = async (signerIdx: number): Promise<number> => {
        if (!signerNonces.has(signerIdx)) {
          const wallet = this.client.getSigner(signerIdx);
          const onChain = await this.client.provider.getTransactionCount(wallet.address, "latest");
          console.log(`[ChallengeRunner] nftMints: signer${signerIdx} (${wallet.address}) on-chain nonce: ${onChain}`);
          signerNonces.set(signerIdx, onChain);
        }
        const nonce = signerNonces.get(signerIdx)!;
        signerNonces.set(signerIdx, nonce + 1);
        return nonce;
      };

      for (const mint of mints) {
        if (!mint.listed || !mint.listingPrice) continue;
        const mktId = mint.marketplaceId ?? manifest.contracts.find(c => c.type === "NFTMarketplace")?.id;
        if (!mktId) continue;
        const mktAddr = this.contractRegistry.getAddress(mktId);

        let signerIdx: number | null = null;
        if (mint.recipient === "player") signerIdx = 0;
        else if (mint.recipient.startsWith("bot")) signerIdx = parseInt(mint.recipient.slice(3)) + 1;
        if (signerIdx === null) continue;

        const sellerAddr = this.client.getSigner(signerIdx).address;
        const pairKey    = `${sellerAddr}:${mktAddr}`;
        if (!approvedPairs.has(pairKey)) {
          const wallet    = this.client.getSigner(signerIdx);
          const nonce     = await getAndBumpNonce(signerIdx);
          const approvalC = new ethers.Contract(collectionAddr, APPROVAL_ABI, wallet);
          await (await approvalC.setApprovalForAll(mktAddr, true, { nonce })).wait(1);
          approvedPairs.add(pairKey);
        }
      }

      for (const mint of mints) {
        const to = recipientAddress(mint.recipient);

        // Mint returns the actual tokenId
        const tx   = await collection.mintTo(to, mint.rarityScore);
        const rcpt = await tx.wait(1);
        // Extract tokenId from the Transfer event (topic[3]) or infer from totalSupply
        let actualTokenId: bigint;
        try {
          // The Transfer event: Transfer(from=0, to, tokenId)
          const iface = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);
          const log = rcpt.logs.find((l: ethers.Log) => {
            try { iface.parseLog({ topics: [...l.topics], data: l.data }); return true; } catch { return false; }
          });
          if (log) {
            const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
            actualTokenId = parsed!.args[2];
          } else {
            const supply = await collection.totalSupply();
            actualTokenId = BigInt(supply) - 1n;
          }
        } catch {
          const supply = await collection.totalSupply();
          actualTokenId = BigInt(supply) - 1n;
        }

        console.log(`[ChallengeRunner] minted NFT #${actualTokenId} (rarity=${mint.rarityScore}) to ${to}`);

        // Auto-list if requested
        if (mint.listed && mint.listingPrice) {
          const mktId = mint.marketplaceId ?? manifest.contracts.find(c => c.type === "NFTMarketplace")?.id;
          if (!mktId) {
            console.warn(`[ChallengeRunner] nftMints: no marketplace contract found for auto-listing token ${actualTokenId}`);
            continue;
          }
          const mktAddr = this.contractRegistry.getAddress(mktId);

          // Use explicit nonce tracking for the seller signer.
          let signerIdx: number | null = null;
          if (mint.recipient === "player") signerIdx = 0;
          else if (mint.recipient.startsWith("bot")) signerIdx = parseInt(mint.recipient.slice(3)) + 1;
          if (signerIdx === null) continue; // marketplace recipient: skip

          const wallet = this.client.getSigner(signerIdx);
          const nonce  = await getAndBumpNonce(signerIdx);
          const price  = ethers.parseEther(mint.listingPrice);
          const mktC   = new ethers.Contract(mktAddr, MARKETPLACE_ABI, wallet);
          await (await mktC.listToken(actualTokenId, price, { nonce })).wait(1);

          console.log(`[ChallengeRunner] listed NFT #${actualTokenId} at ${mint.listingPrice} WETH on ${mktId}`);
        }
      }
    }
  }

  private async _setupTokens(
    manifest: ChallengeManifest,
    addresses: Record<string, string>,
    deployer: ethers.NonceManager,
  ) {
    const ERC20_ABI = [
      "function mint(address to, uint256 amount)",
      "function balanceOf(address) view returns (uint256)",
    ];
    const WETH_ABI = ["function deposit() payable", "function balanceOf(address) view returns (uint256)"];

    // Artifact for deploying challenge-specific ERC20 tokens not in base addresses.json
    const mockErc20ArtifactPath = join(config.contractsOutDir, "MockERC20.sol", "MockERC20.json");

    for (const tokenDef of manifest.tokens) {
      const sym  = tokenDef.symbol.toUpperCase();
      let addr = addresses[sym.toLowerCase()] ?? addresses[sym];

      // If not in base addresses and it's a deployable token type, deploy a fresh MockERC20.
      if (!addr && (tokenDef.type === "erc20" || tokenDef.type === "usd")) {
        if (!existsSync(mockErc20ArtifactPath)) {
          console.warn(`[ChallengeRunner] MockERC20 artifact not found; cannot deploy token ${sym}`);
          continue;
        }
        const artifact   = JSON.parse(readFileSync(mockErc20ArtifactPath, "utf-8"));
        const mockFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployer);
        // MockERC20 constructor: (name, symbol, decimals)
        const tokenName = sym === "USDF" ? "USD Fiat" : sym === "USDS" ? "USD Stablecoin" : sym;
        const mockToken  = await mockFactory.deploy(tokenName, tokenDef.symbol, tokenDef.decimals);
        await mockToken.waitForDeployment();
        addr = await mockToken.getAddress();
        console.log(`[ChallengeRunner] deployed MockERC20 "${sym}" @ ${addr}`);
      }

      if (!addr) { console.warn(`[ChallengeRunner] no address for token ${sym}`); continue; }
      this._tokenAddresses.set(sym, addr);

      if (tokenDef.type === "erc20" || tokenDef.type === "usd") {
        const tok = new ethers.Contract(addr, ERC20_ABI, deployer);
        if (tokenDef.deployerMintAmount) {
          // Credit the treasury (signer 9), not signer 0.  The player *is* signer 0;
          // minting deployer liquidity here would leave the post-pool remainder spendable
          // by the player (e.g. 900k − 600k = 300k USDC on The Accumulator).
          const treasuryAddr = this.client.getSigner(TREASURY_SIGNER_INDEX).address;
          await (await tok.mint(
            treasuryAddr,
            ethers.parseUnits(tokenDef.deployerMintAmount, tokenDef.decimals),
          )).wait(1);
        }
        if (tokenDef.mintAmount) {
          const amount = ethers.parseUnits(tokenDef.mintAmount, tokenDef.decimals);
          // NOTE: intentionally no player mint here — use player.startingTokens instead
          for (const bot of manifest.bots) {
            await (await tok.mint(this.client.getSigner(bot.account).address, amount)).wait(1);
          }
        }
        if (tokenDef.botMintAmount) {
          const amount = ethers.parseUnits(tokenDef.botMintAmount, tokenDef.decimals);
          for (const bot of manifest.bots) {
            await (await tok.mint(this.client.getSigner(bot.account).address, amount)).wait(1);
          }
        }
      }
    }

    // WETH: wrap 500 ETH for each bot
    const wethAddr = this._tokenAddresses.get("WETH");
    if (wethAddr) {
      const wethAmt = ethers.parseEther("500");
      for (const bot of manifest.bots) {
        const botSigner = new ethers.NonceManager(this.client.getSigner(bot.account));
        const weth      = new ethers.Contract(wethAddr, WETH_ABI, botSigner);
        await (await weth.deposit({ value: wethAmt })).wait(1);
      }
    }
  }

  private async _setupPools(
    manifest: ChallengeManifest,
    addresses: Record<string, string>,
    deployer: ethers.NonceManager,
    seeder: ethers.NonceManager,
  ) {
    const FACTORY_ABI = [
      "function createPool(address, address) returns (address)",
      "function getPool(address, address) view returns (address)",
    ];
    const AMM_ABI = [
      "function addLiquidity(uint256, uint256, uint256, uint256, address) returns (uint256, uint256, uint256)",
      "function token0() view returns (address)",
    ];
    const ERC20_ABI = ["function approve(address, uint256) returns (bool)"];
    const WETH_DEPOSIT = ["function deposit() payable"];

    const factory = new ethers.Contract(addresses["factory"]!, FACTORY_ABI, deployer);

    for (const poolDef of manifest.pools) {
      const addrA = this._tokenAddresses.get(poolDef.tokenA.toUpperCase())!;
      const addrB = this._tokenAddresses.get(poolDef.tokenB.toUpperCase())!;
      if (!addrA || !addrB) throw new Error(`Token addresses missing for pool ${poolDef.id}`);

      let poolAddr: string = await factory.getPool(addrA, addrB);
      if (poolAddr === ethers.ZeroAddress) {
        // New pair — create via factory
        poolAddr = await factory.createPool.staticCall(addrA, addrB);
        await (await factory.createPool(addrA, addrB)).wait(1);
      } else {
        // Factory has a pool for this pair. Check if it's already claimed by
        // an earlier pool definition in this challenge. If so, deploy a fresh
        // ConstantProductAMM directly (bypasses factory's single-pool-per-pair limit).
        const existingPools = this.pools.getAllPools();
        const alreadyUsed = existingPools.some(p => p.address.toLowerCase() === poolAddr.toLowerCase());
        if (alreadyUsed) {
          const artifactPath = join(config.contractsOutDir, "ConstantProductAMM.sol", "ConstantProductAMM.json");
          if (!existsSync(artifactPath)) throw new Error(`[ChallengeRunner] ConstantProductAMM artifact not found at ${artifactPath}`);
          const artifact  = JSON.parse(readFileSync(artifactPath, "utf-8"));
          const ammFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployer);
          const [t0, t1]  = addrA.toLowerCase() < addrB.toLowerCase() ? [addrA, addrB] : [addrB, addrA];
          const newAMM    = await ammFactory.deploy(t0, t1);
          await newAMM.waitForDeployment();
          poolAddr = await newAMM.getAddress();
          console.log(`[ChallengeRunner] deployed fresh AMM for pool ${poolDef.id} @ ${poolAddr}`);
        }
      }

      await this.pools.registerPool(poolDef.id, poolAddr, poolDef.exchange, poolDef.displayName);
      this.history.registerPool(poolDef.id, manifest.chain.blocksPerCandle);

      const pool     = new ethers.Contract(poolAddr, AMM_ABI, deployer);
      const t0       = await pool.token0();
      const isAisT0  = t0.toLowerCase() === addrA.toLowerCase();

      const symA = poolDef.tokenA.toUpperCase();
      const symB = poolDef.tokenB.toUpperCase();
      const tok0  = this._tokenAddresses.get(isAisT0 ? symA : symB)!;
      const tok1  = this._tokenAddresses.get(isAisT0 ? symB : symA)!;
      const info0 = manifest.tokens.find(t => t.symbol.toUpperCase() === (isAisT0 ? symA : symB))!;
      const info1 = manifest.tokens.find(t => t.symbol.toUpperCase() === (isAisT0 ? symB : symA))!;

      const reserveA = ethers.parseUnits(poolDef.initialReserveA, isAisT0 ? info0.decimals : info1.decimals);
      const reserveB = ethers.parseUnits(poolDef.initialReserveB, isAisT0 ? info1.decimals : info0.decimals);
      const amount0  = isAisT0 ? reserveA : reserveB;
      const amount1  = isAisT0 ? reserveB : reserveA;

      // Wrap ETH → WETH using the seeder signer (signer 9) to avoid exhausting
      // signer 0's ETH budget on large pool deposits. After wrapping, transfer
      // WETH to the deployer so it can approve and add liquidity.
      const WETH_TRANSFER_ABI = ["function transfer(address to, uint256 amount) returns (bool)"];
      const deployerAddr = await deployer.getAddress();
      if (info0.type === "weth") {
        await (await new ethers.Contract(tok0, WETH_DEPOSIT, seeder).deposit({ value: amount0 })).wait(1);
        await (await new ethers.Contract(tok0, WETH_TRANSFER_ABI, seeder).transfer(deployerAddr, amount0)).wait(1);
      }
      if (info1.type === "weth") {
        await (await new ethers.Contract(tok1, WETH_DEPOSIT, seeder).deposit({ value: amount1 })).wait(1);
        await (await new ethers.Contract(tok1, WETH_TRANSFER_ABI, seeder).transfer(deployerAddr, amount1)).wait(1);
      }

      // Non-WETH legs were minted to the treasury (signer 9); move only what this
      // pool needs to the deployer for addLiquidity — avoids leaving dust on the player.
      // Must use `seeder` (NonceManager on signer 9), not a raw getSigner(9): the seeder
      // already sent WETH deposit/transfer txs above; a second wallet instance reuses
      // the same on-chain nonce and triggers "nonce has already been used".
      const TRANSFER_ABI = ["function transfer(address to, uint256 amount) returns (bool)"];
      if (info0.type !== "weth") {
        await (await new ethers.Contract(tok0, TRANSFER_ABI, seeder).transfer(deployerAddr, amount0)).wait(1);
      }
      if (info1.type !== "weth") {
        await (await new ethers.Contract(tok1, TRANSFER_ABI, seeder).transfer(deployerAddr, amount1)).wait(1);
      }

      await (await new ethers.Contract(tok0, ERC20_ABI, deployer).approve(poolAddr, amount0)).wait(1);
      await (await new ethers.Contract(tok1, ERC20_ABI, deployer).approve(poolAddr, amount1)).wait(1);
      await (await pool.addLiquidity(amount0, amount1, 0n, 0n, await deployer.getAddress())).wait(1);

      console.log(`[ChallengeRunner] pool ${poolDef.id} seeded`);
    }
  }

  private async _seedBotPositions(manifest: ChallengeManifest, deployer: ethers.NonceManager, seeder: ethers.NonceManager) {
    const MARGIN_ABI = [
      "function openPositionFor(address borrower, uint256 wethAmount, uint256 usdcToBorrow) external",
    ];
    const WETH_ABI = [
      "function deposit() payable",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function balanceOf(address) view returns (uint256)",
      "function transfer(address to, uint256 amount) returns (bool)",
    ];

    const wethAddr = this._tokenAddresses.get("WETH");
    if (!wethAddr) {
      console.warn("[ChallengeRunner] seedBotPositions: no WETH token found, skipping");
      return;
    }

    // Find WETH decimals (always 18, but be explicit)
    const wethDef = manifest.tokens.find(t => t.symbol.toUpperCase() === "WETH");
    const wethDec = wethDef?.decimals ?? 18;

    // Find USD-stable decimals (typically USDC at 6 dec)
    const usdcDef = manifest.tokens.find(t => t.type === "usd" || t.symbol.toUpperCase() === "USDC");
    const usdcDec = usdcDef?.decimals ?? 6;

    const weth = new ethers.Contract(wethAddr, WETH_ABI, deployer);

    // Total WETH needed across all positions — wrap ETH → WETH up front.
    let totalWethNeeded = 0n;
    const posSpecs: { botAddr: string; wethAmount: bigint; usdcAmount: bigint; contractId: string }[] = [];
    for (const pos of manifest.botPositions) {
      const botAddr    = this.client.getSigner(pos.botAccount).address;
      const wethAmount = ethers.parseUnits(pos.wethCollateral, wethDec);
      const usdcAmount = ethers.parseUnits(pos.usdcToBorrow,   usdcDec);
      totalWethNeeded += wethAmount;
      posSpecs.push({ botAddr, wethAmount, usdcAmount, contractId: pos.contractId });
    }

    // Wrap native ETH → WETH using the seeder signer (signer 9) to avoid
    // exhausting signer 0's ETH budget on large bot-position collateral deposits.
    if (totalWethNeeded > 0n) {
      const wethSeeder = new ethers.Contract(wethAddr, WETH_ABI, seeder);
      await (await wethSeeder.deposit({ value: totalWethNeeded })).wait(1);
      const deployerAddr = await deployer.getAddress();
      await (await wethSeeder.transfer(deployerAddr, totalWethNeeded)).wait(1);
    }

    for (const pos of posSpecs) {
      const contractAddr   = this.contractRegistry.getAddress(pos.contractId);
      const marginProtocol = new ethers.Contract(contractAddr, MARGIN_ABI, deployer);

      // Approve each per-position (approve exact amount to avoid leftover allowance).
      await (await weth.approve(contractAddr, pos.wethAmount)).wait(1);
      await (await marginProtocol.openPositionFor(pos.botAddr, pos.wethAmount, pos.usdcAmount)).wait(1);

      console.log(
        `[ChallengeRunner] seeded margin position for ${pos.botAddr}:` +
        ` collateral=${ethers.formatUnits(pos.wethAmount, wethDec)} WETH,` +
        ` debt=${ethers.formatUnits(pos.usdcAmount, usdcDec)} USDC`,
      );
    }
  }

  private async _setupPlayerOverrides(manifest: ChallengeManifest, deployer: ethers.NonceManager) {
    const player = manifest.player;
    const playerAddr = this.client.getSigner(0).address;
    const rawDeployer = this.client.getSigner(0);

    // evm_revert restores the player wallet *including* ERC-20 balances from the
    // previous challenge snapshot.  Stopping mintAmount→player (#188) prevents
    // fresh double-mints, but it does not strip carry-over USDC/WETH/etc.  Zero
    // those balances before applying this manifest's startingTokens so every
    // start matches the manifest exactly.
    const WETH_UNWRAP_ABI = [
      "function balanceOf(address) view returns (uint256)",
      "function withdraw(uint256 wad)",
    ];
    const MOCK_BAL_BURN_ABI = [
      "function balanceOf(address) view returns (uint256)",
      "function burn(address from, uint256 amount)",
    ];
    for (const tokenDef of manifest.tokens) {
      if (tokenDef.type !== "erc20" && tokenDef.type !== "usd") continue;
      const sym  = tokenDef.symbol.toUpperCase();
      const addr = this._tokenAddresses.get(sym);
      if (!addr) continue;

      if (sym === "WETH") {
        const weth = new ethers.Contract(addr, WETH_UNWRAP_ABI, rawDeployer);
        const wBal = await weth.balanceOf(playerAddr);
        if (wBal > 0n) {
          await (await weth.withdraw(wBal)).wait(1);
          console.log(`[ChallengeRunner] unwrapped ${ethers.formatEther(wBal)} WETH for player reset`);
        }
        continue;
      }

      const tok = new ethers.Contract(addr, MOCK_BAL_BURN_ABI, rawDeployer);
      let bal: bigint;
      try { bal = await tok.balanceOf(playerAddr); } catch { continue; }
      if (bal === 0n) continue;
      try {
        await (await tok.burn(playerAddr, bal)).wait(1);
        console.log(`[ChallengeRunner] burned ${ethers.formatUnits(bal, tokenDef.decimals)} ${sym} from player (carry-over reset)`);
      } catch {
        console.warn(`[ChallengeRunner] could not burn carry-over ${sym} for player — trying transfer to treasury`);
        try {
          const playerSigner = this.client.getSigner(0);
          const treasuryAddr = this.client.getSigner(TREASURY_SIGNER_INDEX).address;
          const xferAbi = [
            "function transfer(address to, uint256 amount) returns (bool)",
            "function balanceOf(address) view returns (uint256)",
          ];
          const xfer = new ethers.Contract(addr, xferAbi, playerSigner);
          const bal2 = BigInt(await xfer.balanceOf(playerAddr));
          if (bal2 > 0n) {
            await (await xfer.transfer(treasuryAddr, bal2)).wait(1);
            console.log(
              `[ChallengeRunner] swept ${ethers.formatUnits(bal2, tokenDef.decimals)} ${sym} carry-over from player to treasury`,
            );
          }
        } catch (e2) {
          console.warn(
            `[ChallengeRunner] could not sweep carry-over ${sym}:`,
            e2 instanceof Error ? e2.message : String(e2),
          );
        }
      }
    }

    // Always set native ETH to a known amount so the Anvil default (~10 000 ETH)
    // does not trivialise challenges.  If the manifest specifies player.startingEth,
    // use that; otherwise fall back to a safe default of 10 ETH (enough for gas).
    const ethAmount = player?.startingEth ?? "10";
    const weiHex    = "0x" + ethers.parseEther(ethAmount).toString(16);
    await this.client.rpc("anvil_setBalance", [playerAddr, weiHex]);
    console.log(`[ChallengeRunner] set native ETH balance to ${ethAmount} ETH for player`);

    if (player?.startingTokens) {
      // Use direct RPC to bypass ethers.js provider's nonce cache.
      // provider.getTransactionCount() can return a stale cached value when called
      // shortly after contract deployments via NonceManager in the same setup sequence.
      const deployerAddr   = await deployer.getAddress();
      const deployerNonceHex = await this.client.rpc<string>("eth_getTransactionCount", [deployerAddr, "pending"]);
      let nonce = parseInt(deployerNonceHex, 16);

      // Use the deployer (signer 0) as the mint caller — it owns the token contracts.
      // The player's address is the mint recipient; the deployer is the authorized minter.
      const MINT_ABI = ["function mint(address, uint256)"];
      for (const ov of player.startingTokens) {
        const addr = this._tokenAddresses.get(ov.symbol.toUpperCase());
        if (!addr) continue;
        const def  = manifest.tokens.find(t => t.symbol.toUpperCase() === ov.symbol.toUpperCase());
        if (!def || (def.type !== "erc20" && def.type !== "usd")) continue;
        await (await new ethers.Contract(addr, MINT_ABI, rawDeployer).mint(
          playerAddr, ethers.parseUnits(ov.amount, def.decimals), { nonce }
        )).wait(1);
        nonce++;
      }
    }

    // Burn any excess ERC20/USD tokens left in the player's wallet from pool seeding.
    //
    // Root cause: deployerMintAmount mints to signer(0) = player = deployer.
    // Pool seeding consumes only part of those tokens; the remainder sits in the
    // player's wallet, trivialising challenges.  We burn the excess so that the
    // player's balance is EXACTLY what player.startingTokens specifies (0 if not listed).
    //
    // WETH is intentionally excluded — the player's ETH balance is already reset above
    // via anvil_setBalance, and any WETH the player holds comes from explicit wrapping.
    const ERC20_BURN_ABI = [
      "function balanceOf(address) view returns (uint256)",
      "function burn(address from, uint256 amount)",
    ];
    const burnDeployer = this.client.getSigner(0);
    const burnDeployerAddr = await deployer.getAddress();
    const burnNonceHex = await this.client.rpc<string>("eth_getTransactionCount", [burnDeployerAddr, "pending"]);
    let burnNonce = parseInt(burnNonceHex, 16);

    for (const tokenDef of manifest.tokens) {
      if (tokenDef.type !== "erc20" && tokenDef.type !== "usd") continue;
      const sym  = tokenDef.symbol.toUpperCase();
      const addr = this._tokenAddresses.get(sym);
      if (!addr) continue;

      const tok = new ethers.Contract(addr, ERC20_BURN_ABI, burnDeployer);
      const currentBalance: bigint = await tok.balanceOf(playerAddr);

      // Desired balance: find in player.startingTokens, default to 0
      const desired = player?.startingTokens?.find(
        t => t.symbol.toUpperCase() === sym,
      );
      const desiredAmount = desired
        ? ethers.parseUnits(desired.amount, tokenDef.decimals)
        : 0n;

      if (currentBalance > desiredAmount) {
        const excess = currentBalance - desiredAmount;
        await (await tok.burn(playerAddr, excess, { nonce: burnNonce })).wait(1);
        burnNonce++;
        console.log(
          `[ChallengeRunner] burned ${ethers.formatUnits(excess, tokenDef.decimals)} ${sym}` +
          ` from player (deployerMintAmount leftover)`,
        );
      }
    }
  }

  private _loadAddresses(): Record<string, string> {
    const f = config.addressesFile;
    if (!existsSync(f)) throw new Error(`addresses.json not found at ${f}. Run forge script Deploy.s.sol first.`);
    return JSON.parse(readFileSync(f, "utf-8"));
  }

  private async _broadcastState() {
    const state = this.getState();
    let playerBalance = this._lastWinState?.playerBalance ?? "0";
    let targetBalance = this._lastWinState?.targetBalance ?? state.targetBalance;
    let balances: Record<string, string> = {};
    if (this.winChecker) {
      try {
        const result  = await this.winChecker.check(this._currentBlock);
        const win     = this._manifest!.win;
        playerBalance = this._playerBalanceForUi(win, result.current);
        targetBalance = this._targetBalanceForUi(win);
        // Cache so REST getState() returns the live value immediately.
        this._lastWinState = { playerBalance, targetBalance };
      } catch {}
    }
    try {
      balances = await this._getPlayerBalances();
    } catch {}
    this.broadcast("challenge", { ...state, playerBalance, targetBalance, balances });
  }

  /** Fetch all token balances (ETH + manifest tokens) for the player address. */
  private async _getPlayerBalances(): Promise<Record<string, string>> {
    const m = this._manifest;
    if (!m) return {};
    const playerAddr = this.client.getSigner(0).address;
    const result: Record<string, string> = {};

    // Native ETH
    try {
      const ethBal = await this.client.getBalance(playerAddr);
      result["ETH"] = parseFloat(ethers.formatEther(ethBal)).toFixed(4);
    } catch {}

    // Manifest tokens
    const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
    for (const tokenDef of m.tokens) {
      const sym  = tokenDef.symbol.toUpperCase();
      const addr = this._tokenAddresses.get(sym);
      if (!addr) continue;
      try {
        const contract = new ethers.Contract(addr, ERC20_ABI, this.client.provider);
        const raw      = await contract.balanceOf(playerAddr);
        if (tokenDef.decimals === 6) {
          result[sym] = parseFloat(ethers.formatUnits(raw, 6)).toFixed(2);
        } else {
          result[sym] = parseFloat(ethers.formatEther(raw)).toFixed(4);
        }
      } catch {}
    }

    return result;
  }

  private _targetBalanceForUi(win: ChallengeManifest["win"]): string {
    if (win.metric === "drainContract") {
      // Scale raw token units to 18-decimal-equivalent so the frontend's ÷1e18 is correct.
      // e.g. 10000 USDC (6 dec) → formatUnits(1e10, 6) = "10000.0" → parseEther = 10000e18
      const sym      = (win as { tokenSymbol?: string }).tokenSymbol;
      const tokenDef = sym ? this._manifest?.tokens.find(
        t => t.symbol.toUpperCase() === sym.toUpperCase(),
      ) : null;
      const decimals = tokenDef?.decimals ?? 18;
      const humanReadable = ethers.formatUnits(BigInt(win.threshold), decimals);
      return ethers.parseEther(humanReadable).toString();
    }
    return ethers.parseEther(win.target).toString();
  }

  private _playerBalanceForUi(win: ChallengeManifest["win"], currentFromChecker: string): string {
    if (win.metric === "drainContract") {
      return ethers.parseEther(currentFromChecker).toString();
    }
    const start = ethers.parseEther(win.startingValue);
    const profit = ethers.parseEther(currentFromChecker);
    return (start + profit).toString();
  }
}
