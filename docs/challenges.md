# Creating Challenges

A challenge is a single directory under `challenges/` containing a `manifest.json`. The engine loads all manifests once at startup. To pick up manifest changes, restart the engine — no rebuild step is needed since manifests are plain JSON.

> **Restart required after any manifest change.**
> The engine reads every `manifest.json` exactly once on startup. Editing a manifest while the
> engine is running has no effect on `GET /api/challenges` or any other HTTP/WS payload until you
> restart:
>
> ```bash
> ./stop.sh && ./start.sh
> # or, inside Docker:
> docker compose -f docker/docker-compose.yml restart
> ```
>
> This applies to all manifest fields — id, name, bots, win conditions, contracts, tokens, and
> pools. No rebuild is required; a restart alone is sufficient.

---

## Directory layout

```
challenges/
  my-challenge/
    manifest.json
```

The directory name is purely organizational — the canonical ID comes from `manifest.json`.

---

## Full manifest schema

```jsonc
{
  // ── Identity ──────────────────────────────────────────────────────────────
  "id":          "my-challenge",      // unique slug — used in all API calls
  "name":        "Display Name",      // shown in the frontend challenge picker
  "description": "Flavour text shown to the player.",
  "version":     "1.0.0",            // optional, for your tracking
  "category":    "trading-strategy", // "tutorial" | "trading-strategy" | "market-manipulation" | "defi-exploit" (optional)
  "difficulty":  "medium",           // "beginner" | "easy" | "medium" | "hard" | "expert" (optional)
  "tags":        ["arbitrage"],      // searchable tags (optional)
  "order":       1,                  // sort order within category (optional)

  // ── Chain timing ─────────────────────────────────────────────────────────
  "chain": {
    "blockCount":      300,           // total blocks before the challenge ends
    "blockIntervalMs": 500,           // real-time ms between blocks at 1× speed
    "botSeed":         42,            // integer seed for all bot PRNGs
    "blocksPerCandle": 10             // blocks aggregated into each OHLCV candle
  },

  // ── Tokens ───────────────────────────────────────────────────────────────
  "tokens": [
    {
      "symbol":   "WETH",
      "decimals": 18,
      "type":     "weth"             // "weth" | "erc20" | "usd"
      // no mintAmount for WETH — players use wrapEth()
    },
    {
      "symbol":             "USDC",
      "decimals":           6,
      "type":               "erc20",
      "deployerMintAmount": "6200000",  // minted to deployer only (pool seeding)
      "mintAmount":         "150000"    // minted to player (account 0) AND each bot
    }
  ],

  // ── Pools ────────────────────────────────────────────────────────────────
  "pools": [
    {
      "id":             "weth-usdc-uniswap",    // pool ID used in all SDK calls
      "tokenA":         "WETH",
      "tokenB":         "USDC",
      "initialReserveA": "2000",        // initial tokenA reserve (human units)
      "initialReserveB": "6000000",     // initial tokenB reserve (human units)
      "exchange":       "uniswap",   // exchange/platform slug — default "uniswap" if omitted
      "displayName":    "Uniswap"    // shown in the frontend chart tab (optional)
    }
  ],

  // ── Bots ─────────────────────────────────────────────────────────────────
  "bots": [
    {
      "id":          "chaos-charlie",
      "personality": "volatile",        // volatile | meanReversion | arbitrageur | marketmaker | accumulator | periodic | momentum | sniper | nft-buyer | nft-panic-seller | nft-collector | volume-tracker
      "account":     1,                 // HD wallet index (0 = player, 1+ = bots)
      "params": {
        "poolId":            "weth-usdc-uniswap",
        "swapSizeMinEth":    5.0,
        "swapSizeMaxEth":    20.0,
        "tradeFrequency":    0.35
      }
    }
  ],

  // ── Contracts (optional) ──────────────────────────────────────────────────
  "contracts": [
    {
      "id":               "vault",
      "type":             "VulnerableVault",    // Forge artifact name (see Contract Types below)
      "params":           [],                    // constructor arguments; "{{id}}" resolves to a deployed address
      "fund":             [{ "tokenSymbol": "ETH", "amount": "1000" }],  // seed after deploy
      "constructorValue": "10",         // ETH (ether) to pass as msg.value to a payable constructor
      "collectionId":     "collection", // (nft-marketplace) reference a CTFCollection contractId
      "tokenSymbol":      "RARE",       // (upgradeable-erc20) register proxy address as this token symbol
      "botVolumes": [                   // (VolumeCompetition) pre-seed bot volume records
        { "signerIndex": 1, "volume": "1000000" }
      ]
    }
  ],

  // ── Bot positions (optional) ─────────────────────────────────────────────
  // Pre-seed leveraged positions on behalf of bot accounts at challenge start.
  "botPositions": [
    {
      "botAccount":     1,            // bot wallet index
      "wethCollateral": "30",         // WETH to deposit as collateral (human units)
      "usdcToBorrow":   "40000",      // USDC to borrow
      "contractId":     "margin"      // margin-protocol contract id from contracts array
    }
  ],

  // ── NFT mints (optional) ────────────────────────────────────────────────
  "nftMints": [
    {
      "contractId":    "collection",     // which nft-collection contract to mint from
      "tokenId":       1,                // informational; actual tokenId is sequential
      "recipient":     "marketplace",    // "player" | "marketplace" | "bot0"–"bot5"
      "rarityScore":   85,               // 1–100
      "listed":        true,             // auto-list in marketplace after minting
      "listingPrice":  "0.5",            // WETH listing price (human units)
      "marketplaceId": "marketplace"     // which marketplace contractId to list on
    }
  ],

  // ── NFT reveal (optional) ────────────────────────────────────────────────
  // Trigger reveal() on an nft-collection contract at a specific block.
  "nftReveal": {
    "contractId": "collection",
    "atBlock":    50
  },

  // ── Player overrides (optional) ───────────────────────────────────────────
  // Override default player starting balances. Defaults: 10 ETH native.
  "player": {
    "startingEth":    "5",             // override native ETH balance (via anvil_setBalance)
    "startingTokens": [{ "symbol": "USDC", "amount": "50000" }]
  },

  // ── Win condition ─────────────────────────────────────────────────────────
  "win": {
    "playerAccount": 0,
    "metric":        "ethBalance",      // ethBalance | tokenBalance | portfolioValueInEth | usdBalance | nftSalesProfit | drainContract
    "startingValue": "10",              // ETH equivalent at challenge start
    "target":        "15"              // ETH equivalent to reach
  }
}
```

---

## Chain settings

| Field | Type | Description |
|---|---|---|
| `blockCount` | int | How many blocks to mine before the challenge ends. Shorter = more intense. |
| `blockIntervalMs` | int | Milliseconds between blocks at 1× speed. 400ms ≈ fast, 1000ms ≈ relaxed. |
| `botSeed` | int | Seed for all bot PRNGs. Different seeds → different bot behaviour with the same params. |
| `blocksPerCandle` | int | Blocks per OHLCV candle. Lower = more granular charts. Default 10. |

---

## Tokens

### `type: "weth"`

Deploys as the WETH contract (wrappable ETH). Players use `wrapEth()` / `unwrapEth()` to convert. No minting needed — the player's ETH comes from the test account (10 000 ETH by default).

```json
{ "symbol": "WETH", "decimals": 18, "type": "weth" }
```

### `type: "usd"`

Deploys as `MockERC20`, functionally identical to `erc20`, but also signals to the win checker that this token is "the USD token." Required when using `metric: "usdBalance"`.

```json
{ "symbol": "USDC", "decimals": 6, "type": "usd", "deployerMintAmount": "6200000", "mintAmount": "150000" }
```

### `type: "erc20"`

Deploys as `MockERC20`. Two minting passes happen at challenge start:

| Field | Who receives it | Purpose |
|---|---|---|
| `deployerMintAmount` | Deployer account | Pool seeding — this is the liquidity locked in pools |
| `mintAmount` | Player + every bot | Trading budget |
| `botMintAmount` | Every bot only (not player) | Extra bot-only budget (optional) |

**Sizing rules:**

1. `deployerMintAmount` must be ≥ sum of all `initialReserveB` across all pools using this token.
2. `mintAmount` should give players and bots a meaningful amount to trade with — roughly 5–20% of the pool depth keeps individual trades from exhausting liquidity.
3. If you omit `mintAmount`, players start with zero of that token (valid for USDC-only challenges where they must earn it).

**Example for a 2000 WETH / 6M USDC pool:**

```json
{
  "symbol":             "USDC",
  "decimals":           6,
  "type":               "erc20",
  "deployerMintAmount": "6200000",
  "mintAmount":         "150000"
}
```

6.2M covers 6M for the pool plus 200k buffer. Each player/bot gets 150k USDC (~2.5% of pool depth).

---

## Pools

Pools are created via the `AMMFactory` contract. The factory deterministically sorts token addresses (`token0 < token1`) regardless of the order you specify in the manifest.

**Initial price** is implied by the reserve ratio:

```
price = initialReserveB / initialReserveA
        (in human units)
```

For a 2000 WETH / 6,000,000 USDC pool: price = 6,000,000 / 2,000 = $3,000/WETH.

**Liquidity depth:** larger reserves mean less slippage. A 2000 WETH pool at $3000 has ~$12M TVL. A 500 WETH pool at $3000 has ~$3M — much easier for players (and bots) to move the price.

**Multiple pools:** use unique IDs and different exchange labels to create cross-pool arb scenarios.

```json
"pools": [
  {
    "id": "weth-usdc-uniswap", "tokenA": "WETH", "tokenB": "USDC",
    "initialReserveA": "2000", "initialReserveB": "6000000",
    "exchange": "uniswap", "displayName": "Uniswap"
  },
  {
    "id": "weth-usdc-sushiswap", "tokenA": "WETH", "tokenB": "USDC",
    "initialReserveA": "2000", "initialReserveB": "5400000",
    "exchange": "sushiswap", "displayName": "SushiSwap"
  }
]
```

---

## Win conditions

```json
"win": {
  "playerAccount": 0,
  "metric":        "ethBalance",
  "startingValue": "10",
  "target":        "15"
}
```

The player wins when their balance reaches `startingValue + (target − startingValue)` in *profit* terms. The UI shows profit growing from 0 toward `(target − startingValue)`.

Since test accounts start with 10,000 ETH, the win checker records the balance after setup and adds the required profit delta — so `startingValue` is the notional starting stake, not the literal account balance.

### `metric: "ethBalance"`

Measures native ETH balance. Player earns ETH by unwrapping WETH profits.

```json
"metric": "ethBalance",
"startingValue": "10",
"target": "15"
```

Required profit: 5 ETH.

### `metric: "tokenBalance"`

Measures a specific ERC-20 token balance. Requires `tokenSymbol`.

```json
"metric":      "tokenBalance",
"tokenSymbol": "USDC",
"startingValue": "200000",
"target":      "250000"
```

Required profit: 50,000 USDC.

### `metric: "portfolioValueInEth"`

Sum of ETH + all token holdings converted to ETH at current pool prices. Rewards overall portfolio growth.

```json
"metric":        "portfolioValueInEth",
"startingValue": "10",
"target":        "13"
```

Required profit: 3 ETH in portfolio value.

### `metric: "usdBalance"`

Measures the player's balance of the token with `type: "usd"` in the manifest. Useful for stablecoin challenges where the goal is to accumulate a USD-denominated token.

```json
"metric":        "usdBalance",
"startingValue": "100000",
"target":        "150000"
```

Requires a token with `"type": "usd"` in the `tokens` array.

### `metric: "nftSalesProfit"`

Measures total portfolio value in ETH (same math as `portfolioValueInEth`). Use this when the challenge involves NFT trading or market manipulation — it conveys to players that NFT profits contribute to the win.

```json
"metric":        "nftSalesProfit",
"startingValue": "10",
"target":        "15"
```

### `metric: "drainContract"`

Wins when a deployed contract's balance drops below a threshold. Use for challenges that require exploiting a vulnerability to drain a vault.

```json
"win": {
  "metric":     "drainContract",
  "contractId": "vault",
  "threshold":  "10000000000000000000",
  "tokenSymbol": "ETH"
}
```

Win when the contract's ETH balance (or ERC-20 balance if `tokenSymbol` is set to a token symbol) drops below `threshold` (raw wei string). Omit `tokenSymbol` to check native ETH.

---

## Challenge-specific contracts

The `contracts` array deploys Solidity contracts at challenge start. Each entry requires a Forge artifact at `contracts/out/{type}.sol/{type}.json`.

```json
"contracts": [
  {
    "id":     "vault",
    "type":   "VulnerableVault",
    "params": [],
    "fund":   [{ "tokenSymbol": "ETH", "amount": "1000" }]
  },
  {
    "id":     "attacker",
    "type":   "ReentrancyAttacker",
    "params": ["{{vault}}"]
  }
]
```

- `id` — referenced in player scripts (`getContractAddress("vault")`) and win conditions
- `type` — Forge artifact name
- `params` — constructor arguments; `"{{contractId}}"` placeholders resolve to that contract's deployed address
- `fund` — seed the contract with ETH or ERC-20 tokens after deployment
- `collectionId` — (NFT marketplace only) reference the collection contract id
- `tokenSymbol` — (upgradeable-erc20 only) register the proxy address as a token symbol in the pool registry

### Available contract types

| Type | Category | Description |
|---|---|---|
| `VulnerableVault` | hacks | Reentrancy-buggy ETH vault (CEI violated) |
| `ReentrancyAttacker` | hacks | Pre-built reentrancy attacker — constructor takes vault address |
| `VulnerableStaking` | hacks | Arithmetic overflow in reward calculation |
| `UnprotectedOwnership` | hacks | Missing `onlyOwner` on `transferOwnership()` |
| `DelegateProxy` | hacks | Delegatecall storage collision proxy — constructor takes logic address |
| `ProxyLogic` | hacks | Logic contract with misaligned storage layout |
| `FlashLoanProvider` | infra | ERC-3156-style flash loans, 0.05% fee — constructor takes token address |
| `LendingProtocol` | infra | Spot-oracle lending (exploitable) — constructor takes pool, collateral token, borrow token |
| `VolumeCompetition` | infra | Volume-based prize distribution — constructor takes AMM pool address |
| `MarginProtocol` | leverage | Leveraged positions with liquidation — use with `botPositions` |
| `CTFCollection` | nft | ERC-721 NFT collection with rarity scores and reveal mechanic |
| `NFTMarketplace` | nft | NFT marketplace for buying/listing — use with `nftMints` |
| `StablecoinIssuer` | stablecoin | Collateral-backed stablecoin issuer |
| `AlgorithmicStablecoin` | stablecoin | Algorithmic stablecoin (exploitable oracle) |
| `USDFiat` | stablecoin | Simple USD-pegged fiat token |
| `UpgradeableERC20` | upgradeable | Upgradeable ERC-20 proxy (UUPS-style) |
| `ERC20Implementation` | upgradeable | ERC-20 logic contract for upgradeable proxy |
| `VaultImplementation` | upgradeable | Vault logic contract (uninitialized proxy exploit target) |
| `UninitializedProxy` | upgradeable | Proxy deployed without calling its initializer |
| `UpgradeableAMM` | upgradeable | Upgradeable AMM proxy — used with `nft-collector` bot |
| `ConstantProductAMMImpl` | upgradeable | Logic contract for the upgradeable AMM |

---

## Bot account assignment

Each bot needs a unique `account` index (1–9 or higher). The player is always account 0.

```json
"bots": [
  { "id": "bot-a", "account": 1, ... },
  { "id": "bot-b", "account": 2, ... },
  { "id": "bot-c", "account": 3, ... }
]
```

All accounts share the mnemonic `test test test test test test test test test test test junk`. Accounts are derived at `m/44'/60'/0'/0/{index}`.

| Index | Address |
|---|---|
| 0 (player) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |
| 1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` |
| 2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` |
| 3 | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` |
| 4 | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` |
| 5 | `0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc` |
| 6 | `0x976EA74026E726554dB657fA54763abd0C3a0aa9` |
| 7 | `0x14dC79964da2C08b23698B3D3cc7Ca32193d9955` |
| 8 | `0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f` |
| 9 | `0xa0Ee7A142d267C1f36714E4a8F75612F20a79720` |

---

## Worked example: creating a new challenge

### 1. Design the scenario

**Concept:** Flash crash — price drops 20% in the first 10 blocks due to a panic seller bot, then slowly recovers. Players must buy the dip and sell the recovery.

### 2. Set chain parameters

- 400 blocks total (about 3 minutes at 1×, 1× = 500ms intervals)
- Fast enough to feel urgent, slow enough to react

### 3. Size the pool

$3000/WETH, 500 WETH / 1,500,000 USDC — small pool so bots move price aggressively.

### 4. Design bots

- **panic-pete** (`volatile`): very high frequency, large trades, first 50 blocks only
  - Can't do "first 50 blocks only" in bot params — instead, use a large `volatile` bot that naturally calms down as reserves shift
- **recovery-rachel** (`meanReversion`): slow recovery back to $3000
- **noise-norm** (`volatile`): small noise to make the chart look realistic

### 5. Write the manifest

```json
{
  "id":          "flash-crash",
  "name":        "Flash Crash",
  "description": "The market just tanked 20%. Panic or profit? Buy the dip before recovery-bots close the gap.",
  "version":     "1.0.0",
  "chain": {
    "blockCount":      400,
    "blockIntervalMs": 500,
    "botSeed":         1337,
    "blocksPerCandle": 8
  },
  "tokens": [
    { "symbol": "WETH", "decimals": 18, "type": "weth" },
    {
      "symbol":             "USDC",
      "decimals":           6,
      "type":               "erc20",
      "deployerMintAmount": "1600000",
      "mintAmount":         "100000"
    }
  ],
  "pools": [
    {
      "id":              "weth-usdc-uniswap",
      "tokenA":          "WETH",
      "tokenB":          "USDC",
      "initialReserveA": "500",
      "initialReserveB": "1500000",
      "exchange":        "uniswap",
      "displayName":     "Uniswap"
    }
  ],
  "bots": [
    {
      "id":          "panic-pete",
      "personality": "volatile",
      "account":     1,
      "params": {
        "poolId":         "weth-usdc-uniswap",
        "swapSizeMinEth": 20,
        "swapSizeMaxEth": 60,
        "tradeFrequency": 0.7,
        "maxSlippageBps": 500
      }
    },
    {
      "id":          "recovery-rachel",
      "personality": "meanReversion",
      "account":     2,
      "params": {
        "poolId":            "weth-usdc-uniswap",
        "targetPrice":       3000,
        "swapSizeMinEth":    2.0,
        "swapSizeMaxEth":    8.0,
        "tradeFrequency":    0.4,
        "revertThreshold":   0.03,
        "twapWindow":        30
      }
    },
    {
      "id":          "noise-norm",
      "personality": "volatile",
      "account":     3,
      "params": {
        "poolId":         "weth-usdc-uniswap",
        "swapSizeMinEth": 0.2,
        "swapSizeMaxEth": 1.5,
        "tradeFrequency": 0.5
      }
    }
  ],
  "win": {
    "playerAccount": 0,
    "metric":        "ethBalance",
    "startingValue": "10",
    "target":        "14"
  }
}
```

### 6. Test

1. Place the file in `challenges/flash-crash/manifest.json`
2. Restart the engine — manifests are read once at startup, so a restart is required to pick up
   the new file (`./stop.sh && ./start.sh`)
3. Watch the chart in the frontend
4. Tune `swapSizeMaxEth` and `tradeFrequency` until the price action looks right
5. After every manifest edit, restart again to reload the changes

---

## Tuning guide

| Goal | Lever |
|---|---|
| Bigger price swings | Increase `swapSizeMaxEth`, reduce pool reserves |
| More frequent moves | Increase `tradeFrequency` |
| Slower recovery | Decrease meanReversion `tradeFrequency` or increase `revertThreshold` |
| Harder to arb | Increase `minProfitBps` on arbitrageur, or tighten noise bot sizing |
| Longer challenge | Increase `blockCount` |
| More pressure | Multiple bots on the same pool |
| Realistic fees | Default 0.3% — already baked into the AMM; no config needed |

See [bots.md](bots.md) for a complete reference on all bot params.
