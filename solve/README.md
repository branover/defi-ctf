# solve/ — Foundry Workspace

A pre-configured Foundry project for writing attacker contracts and solve scripts.
Use it from the terminal or from the in-browser Solidity IDE.

---

## Quick start

```bash
# 1. Start a challenge in the browser
# 2. Write your .env
cd solve/
./env.sh
source .env

# 3. Read env vars, run a solve script
forge script script/Solve.s.sol \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

---

## env.sh — environment setup

`env.sh` calls `/api/connection_info` and writes a `.env` file with all addresses for the
currently-running challenge. Re-run it after restarting a challenge (addresses change each run).

```bash
./env.sh           # writes .env in solve/
source .env        # export vars for this shell session
```

The `.env` file is gitignored — it contains your private key. It exports:

| Variable | Description |
|---|---|
| `RPC_URL` | Anvil JSON-RPC endpoint (`http://127.0.0.1:8545`) |
| `CHAIN_ID` | Chain ID (`31337`) |
| `PRIVATE_KEY` | Player wallet private key |
| `PLAYER_ADDRESS` | Player wallet address |
| `ADDR_<ID>` | Address of each challenge contract (uppercased, hyphens → underscores) |
| `TOKEN_<SYMBOL>` | Address of each ERC-20 token |
| `POOL_<ID>` | Pool contract address |
| `POOL_<ID>_EXCHANGE` | Exchange slug, e.g. `uniswap`, `sushiswap` |
| `POOL_<ID>_DISPLAY` | Human-readable exchange name, e.g. `Uniswap` |
| `POOL_<ID>_TOKEN_A` | Token A symbol for the pool |
| `POOL_<ID>_TOKEN_B` | Token B symbol for the pool |

Pool IDs are uppercased with hyphens replaced by underscores: `weth-usdc-uniswap` → `POOL_WETH_USDC_UNISWAP`.

---

## Directory layout

```
solve/
├── foundry.toml          # Foundry config — remappings, profile settings
├── env.sh                # writes .env from /api/connection_info
├── lib/ -> ../contracts/lib   # symlink to forge-std (no extra install needed)
├── script/
│   └── Solve.s.sol       # shared template solve script
├── src/
│   └── Attacker.sol      # shared template attacker contract
└── challenges/
    └── <challenge-id>/   # per-challenge workspace (seeded from shared template on first IDE access)
        ├── script/
        │   └── Solve.s.sol
        └── src/
            └── Attacker.sol
```

Per-challenge directories under `solve/challenges/<id>/` are created automatically the first
time you open a challenge in the in-browser Solidity IDE. Each one is seeded from the shared
`script/` and `src/` templates. Edit freely — your changes persist across challenge restarts.

The shared `script/` and `src/` at the repo root are the fallback if a per-challenge directory
does not yet exist. They also serve as the workspace for CLI forge invocations from `solve/`.

---

## Template files

### `script/Solve.s.sol`

A minimal forge script template. Edit the `run()` function to add your exploit steps.

```solidity
import "forge-std/Script.sol";

contract Solve is Script {
    function run() external {
        uint256 playerKey  = vm.envUint("PRIVATE_KEY");
        address vault      = vm.envAddress("ADDR_VAULT");

        vm.startBroadcast(playerKey);
        // ... your exploit ...
        vm.stopBroadcast();
    }
}
```

### `src/Attacker.sol`

A minimal attacker contract template. Add functions for your exploit, then deploy from `Solve.s.sol`.

---

## In-browser Solidity IDE

The frontend has a **Solidity IDE** tab that exposes this workspace directly in the browser:

- **Edit** — browse and edit files in `solve/` from the IDE panel
- **Run Script** — triggers `forge script script/Solve.s.sol --broadcast` with your credentials
- **Deploy** — compiles and deploys a contract from `solve/src/`, showing the deployed address

Output streams in real time via `forge_log` WebSocket messages. The final `forge_done` message
indicates success or failure and (on deploy) the deployed contract address.

---

## cast — quick one-off calls

```bash
# Read a view function
cast call $ADDR_VAULT "owner()" --rpc-url $RPC_URL

# Send a transaction
cast send $ADDR_VAULT "drain()" --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# Decode calldata
cast decode-calldata "initialize(string,uint8)" <0x...calldata>
```

---

## Finding initialization calldata (upgradeable proxy challenges)

Challenge setup transactions land in block 1. The `initialize()` call for a proxy is in there —
reading its calldata reveals constructor arguments like admin passwords.

```bash
# List block-1 transactions
cast block 1 --rpc-url $RPC_URL --json | jq '.transactions[].input'

# Decode a specific calldata
cast decode-calldata "initialize(string,string,uint8,uint256,address)" <0x...calldata>
```

Or from a player script using the SDK:

```js
const txs = await getBlockTransactions(1);
for (const tx of txs) {
  if (tx.to?.toLowerCase() === getContractAddress("vault").toLowerCase()) {
    // Strip 4-byte selector, then decode
    const data = "0x" + tx.data.slice(10);
    const [password] = decodeCalldata(["string"], data);
    log("Password: " + password);
  }
}
```

---

## Tips

- **Re-run `env.sh` after every challenge restart** — contract addresses change on each start.
- **Dry-run before broadcasting** — omit `--broadcast` to simulate without sending transactions.
- **Verbose traces** — add `-vvvv` to `forge script` to see every call and revert reason.
- **Mining** — the engine mines blocks on a timer (~500 ms default). Your transactions land on the next block; fast-forward from the UI if you need to advance quickly.
- **Contract ABIs** — compiled artifacts are at `../contracts/out/<Name>.sol/<Name>.json`.
