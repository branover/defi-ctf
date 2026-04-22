# Bots

Bots are autonomous agents that trade on every block. The engine runs each bot's `tick()` sequentially before firing player triggers. All bots share the pool and token infrastructure with the player — they're real on-chain accounts making real transactions.

---

## How bots work

Each bot:

1. Is assigned an HD wallet account index (`account: 1`, `2`, …)
2. Receives `mintAmount` of each ERC-20 token at challenge start
3. Receives 500 WETH via `wrapEth` at challenge start (from their ETH balance)
4. Runs `tick(blockNumber)` once per block, after the block is mined
5. Uses a seeded PRNG (`botSeed + botIndex`) for deterministic behaviour

All bots apply a **slippage cap**: the trade size is reduced to the maximum amount that won't exceed `maxSlippageBps` price impact. This prevents bots from crashing the pool with a single trade.

---

## Personalities

### `volatile`

Makes random large swaps to create price volatility. Randomly buys or sells at each tick.

**How it works:** On each tick, rolls `tradeFrequency` probability. If active, randomly picks buy-token0 or sell-token0, sizes the trade in ETH-equivalent terms, caps for slippage, then swaps.

**Use cases:** Chaos bots that create wide price swings for momentum strategies to exploit.

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `poolId` | string | `"weth-usdc-uniswap"` | Pool to trade on |
| `swapSizeMinEth` | number | 0.5 | Minimum trade size in ETH-equivalent units |
| `swapSizeMaxEth` | number | 3.0 | Maximum trade size in ETH-equivalent units |
| `tradeFrequency` | number 0–1 | 0.3 | Probability of trading each block |
| `maxSlippageBps` | number | 300 | Maximum acceptable price impact in basis points |

**Example**

```json
{
  "id": "chaos-charlie",
  "personality": "volatile",
  "account": 1,
  "params": {
    "poolId":            "weth-usdc-uniswap",
    "swapSizeMinEth":    5.0,
    "swapSizeMaxEth":    20.0,
    "tradeFrequency":    0.35,
    "maxSlippageBps":    400
  }
}
```

**Tuning tips**

- `tradeFrequency: 0.6` + `swapSizeMaxEth: 3` → continuous small volatility (noise)
- `tradeFrequency: 0.2` + `swapSizeMaxEth: 30` → infrequent large shocks
- Multiple volatile bots with different sizes create layered, realistic price action

---

### `meanReversion`

Trades toward a target price (or its own rolling TWAP) when deviation exceeds a threshold. Trade size scales proportionally to how far off the target price is.

**How it works:** Tracks a rolling price window to compute TWAP. If spot deviates more than `revertThreshold` from the target, trades to push it back. Trade size scales from `swapSizeMinEth` at the threshold to `swapSizeMaxEth` at 5× the threshold.

**Use cases:**
- Slow price recovery bots after a crash
- Anchoring a "fair value" that noise bots disrupt
- Creating predictable mean-reversion patterns for player strategies to exploit

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `poolId` | string | `"weth-usdc-uniswap"` | Pool to trade on |
| `targetPrice` | number | TWAP | Target spot price (token1/token0). If omitted, uses its own rolling TWAP |
| `swapSizeMinEth` | number | 0.2 | Minimum trade ETH size (at threshold deviation) |
| `swapSizeMaxEth` | number | 1.5 | Maximum trade ETH size (at 5× threshold) |
| `tradeFrequency` | number 0–1 | 0.2 | Probability of checking/trading each block |
| `revertThreshold` | number | 0.05 | Fractional deviation before trading (0.05 = 5%) |
| `twapWindow` | number | 20 | Blocks of price history for TWAP calculation |
| `maxSlippageBps` | number | 200 | Maximum acceptable price impact in basis points |

**Example — pegged to $3000**

```json
{
  "id": "steady-sam",
  "personality": "meanReversion",
  "account": 4,
  "params": {
    "poolId":           "weth-usdc-uniswap",
    "targetPrice":      3000,
    "swapSizeMinEth":   2.0,
    "swapSizeMaxEth":   8.0,
    "tradeFrequency":   0.25,
    "revertThreshold":  0.04,
    "twapWindow":       20
  }
}
```

**Example — TWAP follower (no fixed target)**

```json
{
  "id": "twap-tracker",
  "personality": "meanReversion",
  "account": 5,
  "params": {
    "poolId":          "weth-usdc-uniswap",
    "swapSizeMinEth":  1.0,
    "swapSizeMaxEth":  3.0,
    "tradeFrequency":  0.3,
    "revertThreshold": 0.03,
    "twapWindow":      30
  }
}
```

---

### `arbitrageur`

Watches two pools for the same pair and arbitrages when the spread exceeds a minimum profit threshold.

**How it works:** Compares spot prices on both pools. If the spread exceeds `minProfitBps`, buys token0 from the cheaper pool using token1, then immediately sells the token0 into the more expensive pool. This closes the spread over time.

**Use cases:**
- Creating cross-pool convergence pressure the player must race against
- Making the two-pool spread challenge harder as the arb window closes

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `poolIdA` | string | `"weth-usdc-uniswap"` | First pool |
| `poolIdB` | string | `"weth-usdc-sushiswap"` | Second pool |
| `swapSizeMinEth` | number | 0.1 | Min trade size (ETH units) |
| `swapSizeMaxEth` | number | 1.0 | Max trade size |
| `minProfitBps` | number | 20 | Minimum spread in basis points before arbing (0.2%) |
| `tradeFrequency` | number 0–1 | 0.5 | Probability of checking each block |

**Example**

```json
{
  "id": "arb-hawk",
  "personality": "arbitrageur",
  "account": 5,
  "params": {
    "poolIdA":        "weth-usdc-uniswap",
    "poolIdB":        "weth-usdc-sushiswap",
    "swapSizeMinEth": 0.5,
    "swapSizeMaxEth": 3.0,
    "minProfitBps":   30,
    "tradeFrequency": 0.6
  }
}
```

**Tuning tips**

- Low `minProfitBps` (10–20) → aggressive arb, spread closes fast
- High `minProfitBps` (100+) → leaves room for player to extract the spread first
- High `tradeFrequency` → arb bot is active most blocks

---

### `marketmaker`

A high-frequency TWAP stabilizer that runs nearly every block and nudges price back toward the rolling average with small, tightly-capped trades.

**How it works:** Tracks its own rolling TWAP (`twapWindow` blocks). Every block (controlled by `tradeFrequency ≈ 1.0`), if spot deviates more than `mmThreshold` from TWAP, it trades proportionally to close the gap. Uses a tight 1% slippage cap to avoid destabilising the pool.

**Difference from `meanReversion`:**
- `meanReversion` is probabilistic (fires at `tradeFrequency`), medium trade sizes, fixed or TWAP target
- `marketmaker` is nearly deterministic (fires almost every block), small trades, TWAP-only

**Use cases:**
- Suppressing large price swings — makes volatile bots less effective
- Creating realistic market microstructure with a passive bid-ask spread
- Making momentum strategies harder while leaving mean-reversion opportunities

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `poolId` | string | `"weth-usdc-uniswap"` | Pool to stabilize |
| `twapWindow` | number | 20 | TWAP window in blocks |
| `mmThreshold` | number | 0.008 | Deviation fraction before acting (0.008 = 0.8%) |
| `swapSizeMinEth` | number | 0.1 | Min trade size at threshold |
| `swapSizeMaxEth` | number | 0.5 | Max trade size at 5× threshold |
| `tradeFrequency` | number 0–1 | 1.0 | Probability of acting each block |
| `maxSlippageBps` | number | 100 | Very tight slippage cap (1%) |

**Example**

```json
{
  "id": "mm-mabel",
  "personality": "marketmaker",
  "account": 6,
  "params": {
    "poolId":         "weth-usdc-uniswap",
    "twapWindow":     15,
    "mmThreshold":    0.006,
    "swapSizeMinEth": 0.05,
    "swapSizeMaxEth": 0.3,
    "tradeFrequency": 1.0,
    "maxSlippageBps": 80
  }
}
```

---

## Bot funding

At challenge start, the engine provides each bot with:

- **ERC-20 tokens:** `mintAmount` of each token (minted during setup)
- **WETH:** 500 WETH (deposited via `wrapEth()` using the account's native ETH)
- **Native ETH:** Test accounts start with ~10,000 ETH each

Bots do not receive additional funds mid-challenge. If a bot runs out of a token, it silently skips trades requiring that token.

---

## Determinism

All bot PRNGs use **Mulberry32** seeded from `botSeed + botIndex`. The same `botSeed` always produces identical bot behaviour, making challenges deterministic and reproducible.

To create a different-feeling version of the same challenge:

```json
"chain": { "botSeed": 9999 }
```

Different seeds → different trade timing, sizes, and directions.

---

### `accumulator`

Makes small, consistent directional buys at a fixed block interval. Deterministic — no PRNG. The steady volume creates a visible trend in candle analysis.

**Use cases:** Creating an unmistakable accumulation/distribution signal for players to detect and ride. The `the-accumulator` challenge is built around this.

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `poolId` | string | `"weth-usdc-uniswap"` | Pool to trade on |
| `direction` | string | `"buy"` | `"buy"` \| `"sell"` \| `"random"` |
| `swapSizeEth` | number | 0.5 | Fixed trade size in ETH-equivalent units |
| `blockInterval` | number | 5 | Fire every N blocks |

**Example**

```json
{
  "id": "steady-accumulator",
  "personality": "accumulator",
  "account": 2,
  "params": {
    "poolId":        "weth-usdc-uniswap",
    "direction":     "buy",
    "swapSizeEth":   0.5,
    "blockInterval": 5
  }
}
```

---

### `periodic`

Makes a single large trade at exactly every `blockInterval` blocks. Highly predictable and front-runnable by design.

**Use cases:** Creating scheduled whale events for players to front-run (`the-spread`, `whale-watch`).

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `poolId` | string | `"weth-usdc-uniswap"` | Pool to trade on |
| `direction` | string | `"buy"` | `"buy"` \| `"sell"` \| `"random"` (uses PRNG per firing) |
| `swapSizeEth` | number | 30 | Trade size in ETH-equivalent units |
| `blockInterval` | number | 30 | Fire every N blocks |
| `maxSlippageBps` | number | 500 | Maximum acceptable price impact |

**Example**

```json
{
  "id": "clockwork-whale",
  "personality": "periodic",
  "account": 3,
  "params": {
    "poolId":        "weth-usdc-uniswap",
    "direction":     "buy",
    "swapSizeEth":   30,
    "blockInterval": 30
  }
}
```

---

### `momentum`

Trend-following: compares the first half vs second half of a rolling price window. If sustained directional drift exceeds the threshold, it joins the trend.

**Use cases:** Making momentum strategies self-reinforcing; creating the pile-in bots for pump-and-dump challenges.

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `poolId` | string | `"weth-usdc-uniswap"` | Pool to trade on |
| `trendWindow` | number | 10 | Rolling price window in blocks |
| `threshold` | number | 0.02 | Minimum fractional trend to act (0.02 = 2%) |
| `swapSizeMinEth` | number | 0.5 | Minimum trade size |
| `swapSizeMaxEth` | number | 3.0 | Maximum trade size |
| `maxSlippageBps` | number | 300 | Maximum acceptable price impact |

**Example**

```json
{
  "id": "momentum-mike",
  "personality": "momentum",
  "account": 4,
  "params": {
    "poolId":          "weth-usdc-uniswap",
    "trendWindow":     10,
    "threshold":       0.02,
    "swapSizeMinEth":  0.5,
    "swapSizeMaxEth":  3.0
  }
}
```

---

### `sniper`

Fires a single large trade at exactly `triggerBlock`. Resets its `fired` flag on challenge restart so the shot fires fresh each run.

**Use cases:** A known upcoming event that players can position around (`the-breakout`, `jit-liquidity`).

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `poolId` | string | `"weth-usdc-uniswap"` | Pool to trade on |
| `direction` | string | `"buy"` | `"buy"` \| `"sell"` |
| `swapSizeEth` | number | 100 | Trade size in ETH-equivalent units |
| `triggerBlock` | number | 100 | Block number at which to fire |
| `maxSlippageBps` | number | 1000 | Maximum acceptable price impact |

**Example**

```json
{
  "id": "the-sniper",
  "personality": "sniper",
  "account": 5,
  "params": {
    "poolId":        "weth-usdc-uniswap",
    "direction":     "buy",
    "swapSizeEth":   100,
    "triggerBlock":  100
  }
}
```

---

### `nft-buyer`

Periodically buys the floor-priced NFT from the marketplace and re-lists it at a higher price. Simulates organic NFT demand. Requires `ContractRegistry` (set automatically when challenge has contracts).

**Use cases:** Maintaining upward price pressure in NFT marketplace challenges.

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `marketplaceId` | string | `"marketplace"` | ContractId of the NFTMarketplace |
| `collectionId` | string | `"collection"` | ContractId of the CTFCollection |
| `wethId` | string | `"WETH"` | Symbol of the WETH token |
| `blockInterval` | number | 20 | Fire every N blocks |
| `markupPct` | number | 20 | Relist at floor × (1 + markupPct/100) |
| `maxFloor` | number | 100 | Only buy if floor price ≤ maxFloor WETH |
| `startBlock` | number | 0 | Don't fire before this block |

**Example**

```json
{
  "id": "nft-buyer-bot",
  "personality": "nft-buyer",
  "account": 2,
  "params": {
    "marketplaceId": "marketplace",
    "collectionId":  "collection",
    "blockInterval": 15,
    "markupPct":     25,
    "maxFloor":      2.0
  }
}
```

---

### `nft-panic-seller`

Occasionally dumps an owned NFT below the current floor price, simulating a distressed seller. Used in floor-sweep challenges.

**Use cases:** Creating underpriced listing opportunities for players to arbitrage.

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `marketplaceId` | string | `"marketplace"` | ContractId of the NFTMarketplace |
| `collectionId` | string | `"collection"` | ContractId of the CTFCollection |
| `blockInterval` | number | 25 | Fire every N blocks |
| `discountPct` | number | 30 | List at floor × (1 − discountPct/100) |
| `startBlock` | number | 0 | Don't fire before this block |

**Example**

```json
{
  "id": "panic-pete",
  "personality": "nft-panic-seller",
  "account": 3,
  "params": {
    "marketplaceId": "marketplace",
    "collectionId":  "collection",
    "blockInterval": 20,
    "discountPct":   35
  }
}
```

---

### `nft-collector`

Periodically swaps WETH for a second token through an upgradeable pool, and re-lists any NFTs it
owns in the marketplace. Designed for challenges where the player can upgrade the pool's
implementation to redirect the bot's own WETH elsewhere.

**Use cases:** Creating continuous WETH demand through an upgradeable pool (upgradeable-AMM
challenges); maintaining NFT marketplace liquidity.

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `marketplaceId` | string | `"marketplace"` | ContractId of the NFTMarketplace |
| `collectionId` | string | `"collection"` | ContractId of the CTFCollection |
| `poolId` | string | `"upgradeable-pool"` | ContractId of the UpgradeableAMM to trade through |
| `wethId` | string | `"WETH"` | Symbol of the WETH token |
| `tradeInterval` | number | 15 | Swap every N blocks |
| `swapAmountEth` | string | `"0.5"` | WETH to swap each tick (human-readable ETH string) |
| `startBlock` | number | 5 | Don't fire before this block |

**Example**

```json
{
  "id": "nft-collector-bot",
  "personality": "nft-collector",
  "account": 3,
  "params": {
    "marketplaceId": "marketplace",
    "collectionId":  "collection",
    "poolId":        "upgradeable-pool",
    "tradeInterval": 10,
    "swapAmountEth": "1.0"
  }
}
```

---

### `volume-tracker`

Monitors OHLCV candle volume for a pool. When the most recently closed candle's volume exceeds a
rolling baseline by `spikeMultiplier`, it buys `buyAmountEth` worth of the non-WETH token. After
`sellDelayBlocks` it sells the entire position back.

**Use cases:** Creating a volume-sensitive bot players can manipulate by generating wash-trade
volume (`the-wash` style challenges).

**Params**

| Param | Type | Default | Description |
|---|---|---|---|
| `poolId` | string | `"weth-meme-uniswap"` | Pool to watch and trade on |
| `baselineCandles` | number | 5 | Closed candles used to compute the rolling average |
| `spikeMultiplier` | number | 3.0 | Volume ratio above baseline that triggers a buy |
| `buyAmountEth` | number | 0.5 | WETH equivalent to spend per buy-trigger |
| `sellDelayBlocks` | number | 10 | Blocks to hold the position before selling |

**Example**

```json
{
  "id": "vol-watcher",
  "personality": "volume-tracker",
  "account": 4,
  "params": {
    "poolId":           "weth-meme-uniswap",
    "baselineCandles":  5,
    "spikeMultiplier":  3.0,
    "buyAmountEth":     1.0,
    "sellDelayBlocks":  15
  }
}
```

---

## Writing a custom bot personality

The engine supports twelve built-in personalities. To add a new one:

### 1. Create the class

```typescript
// engine/src/bots/personalities/TrendFollowerBot.ts
import { ethers } from "ethers";
import { BotBase, type BotConfig } from "../BotBase.js";
import type { SeededPRNG } from "../SeededPRNG.js";
import type { PoolRegistry } from "../../market/PoolRegistry.js";

/**
 * TrendFollowerBot — buys when price is rising, sells when falling.
 * Params: poolId, swapSizeMinEth, swapSizeMaxEth, tradeFrequency,
 *         lookback (default 5 blocks), threshold (default 0.01 = 1%)
 */
export class TrendFollowerBot extends BotBase {
  private poolId: string;
  private priceHistory: number[] = [];

  constructor(config: BotConfig, signer: ethers.Wallet, pools: PoolRegistry, prng: SeededPRNG) {
    super(config, signer, pools, prng);
    this.poolId = config.params.poolId as unknown as string ?? "weth-usdc-uniswap";
  }

  async tick(blockNumber: number): Promise<void> {
    if (!this.prng.chance(this.config.params.tradeFrequency ?? 0.3)) return;

    const currentPrice = await this.pools.getSpotPrice(this.poolId);
    this.priceHistory.push(currentPrice);
    const lookback = this.config.params.lookback ?? 5;
    if (this.priceHistory.length > lookback + 1) this.priceHistory.shift();
    if (this.priceHistory.length < lookback) return;

    const old      = this.priceHistory[0];
    const momentum = (currentPrice - old) / old;
    const threshold = this.config.params.threshold ?? 0.01;
    if (Math.abs(momentum) < threshold) return;

    const { info } = this.pools.getPool(this.poolId);
    const minEth   = this.config.params.swapSizeMinEth ?? 0.5;
    const maxEth   = this.config.params.swapSizeMaxEth ?? 2.0;
    const tradeEth = this.prng.range(minEth, maxEth);

    try {
      if (momentum > 0) {
        // Trend up — buy token0 (spend token1)
        const { reserve0, reserve1 } = await this.pools.getReserves(this.poolId);
        const price  = Number(reserve1) / 10 ** info.decimals1 / (Number(reserve0) / 10 ** info.decimals0);
        const rawIn  = BigInt(Math.floor(tradeEth * price * 10 ** info.decimals1));
        const amountIn = await this._slippageCap(this.poolId, info.token1, rawIn, 300);
        const tok1 = this.pools.getTokenWithSigner(info.token1, this.signer);
        if (BigInt(await tok1.balanceOf(this.signerAddress)) < amountIn) return;
        await tok1.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token1, amountIn, 0n, this.signerAddress);
      } else {
        // Trend down — sell token0
        const rawIn    = ethers.parseUnits(tradeEth.toFixed(6), info.decimals0);
        const amountIn = await this._slippageCap(this.poolId, info.token0, rawIn, 300);
        const tok0 = this.pools.getTokenWithSigner(info.token0, this.signer);
        if (BigInt(await tok0.balanceOf(this.signerAddress)) < amountIn) return;
        await tok0.approve(info.address, amountIn);
        const pool = this.pools.getPoolWithSigner(this.poolId, this.signer);
        await pool.swapExactIn(info.token0, amountIn, 0n, this.signerAddress);
      }
    } catch {}
  }
}
```

### 2. Register in the scheduler

```typescript
// engine/src/bots/BotScheduler.ts — add import:
import { TrendFollowerBot } from "./personalities/TrendFollowerBot.js";

// In the switch statement:
case "trendfollower": return new TrendFollowerBot(config, signer, this.pools, prng);
```

### 3. Use in a manifest

```json
{
  "id": "trend-ted",
  "personality": "trendfollower",
  "account": 3,
  "params": {
    "poolId":         "weth-usdc-uniswap",
    "swapSizeMinEth": 1.0,
    "swapSizeMaxEth": 4.0,
    "tradeFrequency": 0.4,
    "lookback":       5,
    "threshold":      0.015
  }
}
```

### Bot base class API

All bots extend `BotBase`:

```typescript
abstract class BotBase {
  protected signer:        ethers.NonceManager;  // player signer with nonce tracking
  protected signerAddress: string;               // wallet address (string, sync)
  protected config:        BotConfig;            // { id, personality, account, params }
  protected pools:         PoolRegistry;         // pool/token access
  protected prng:          SeededPRNG;           // seeded randomness

  abstract tick(blockNumber: number): Promise<void>;

  // Cap trade size to avoid exceeding maxBps price impact
  protected async _slippageCap(
    poolId: string,
    tokenInAddr: string,
    requested: bigint,
    maxBps: number,
  ): Promise<bigint>;
}
```

The `_slippageCap` helper uses off-chain AMM math to find the largest trade that stays within `maxBps` price impact. Always use it to avoid bots crashing the pool.

**SeededPRNG API**

```typescript
prng.next()             // float in [0, 1)
prng.range(min, max)    // float in [min, max)
prng.chance(p)          // boolean — true with probability p
prng.int(min, max)      // integer in [min, max] inclusive
```
