// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Solve.s.sol — Master solve script template
//
// Quick start:
//   1. Start a challenge in the UI (or via API)
//   2. Run:  cd solve && ./env.sh && source .env
//   3. forge script script/Solve.s.sol \
//        --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
//
// Rename / duplicate this file per challenge. Each challenge is independent.
// The in-browser IDE has a Run Script button that does all of the above for you.
// ─────────────────────────────────────────────────────────────────────────────

// ── Minimal interfaces ────────────────────────────────────────────────────────

/// @dev The custom AMM used by every pool in this CTF.
///      Use swapExactIn, NOT a Uniswap router — there is none.
interface IPool {
    /// @notice Swap an exact amount of tokenIn for as many tokenOut as possible.
    /// @param tokenIn   Address of the token you are selling
    /// @param amountIn  Amount to sell (in tokenIn's smallest unit)
    /// @param minOut    Revert if output < minOut (slippage protection, pass 0 to disable)
    /// @return amountOut Actual amount of tokenOut received
    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, address to) external returns (uint256 amountOut);

    function getReserves() external view returns (uint256 reserve0, uint256 reserve1);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

// ── Example attacker contract (uncomment and adapt as needed) ─────────────────

// contract MyAttacker {
//     address public owner;
//     IPool   public pool;
//     IERC20  public token;
//
//     constructor(address _pool, address _token) {
//         owner = msg.sender;
//         pool  = IPool(_pool);
//         token = IERC20(_token);
//     }
//
//     function attack() external payable {
//         // ... your exploit logic here
//     }
//
//     // Receive ETH from drains / withdraws
//     receive() external payable {}
// }

// ─────────────────────────────────────────────────────────────────────────────

contract Solve is Script {
    function run() external {
        // ── Load connection info written by env.sh ─────────────────────────
        uint256 playerKey  = vm.envUint("PRIVATE_KEY");
        address playerAddr = vm.envAddress("PLAYER_ADDRESS");

        // ── Token addresses ────────────────────────────────────────────────
        // Uncomment the ones your challenge uses.
        //
        // address weth = vm.envAddress("TOKEN_WETH");
        // address usdc = vm.envAddress("TOKEN_USDC");
        // address dai  = vm.envAddress("TOKEN_DAI");

        // ── Pool addresses ─────────────────────────────────────────────────
        // Each pool's env key is derived from its ID: "weth-usdc-uniswap" → POOL_WETH_USDC_UNISWAP
        // The engine also exports metadata vars (exchange slug, display name, token symbols).
        //
        // address pool = vm.envAddress("POOL_WETH_USDC_UNISWAP");
        // string memory exchange  = vm.envString("POOL_WETH_USDC_UNISWAP_EXCHANGE");  // e.g. "uniswap"
        // string memory dispName  = vm.envString("POOL_WETH_USDC_UNISWAP_DISPLAY");   // e.g. "Uniswap"
        // string memory tokenA    = vm.envString("POOL_WETH_USDC_UNISWAP_TOKEN_A");   // e.g. "WETH"
        // string memory tokenB    = vm.envString("POOL_WETH_USDC_UNISWAP_TOKEN_B");   // e.g. "USDC"

        // ── Challenge contract addresses ───────────────────────────────────
        // Key format: ADDR_<ID_UPPERCASED_HYPHEN_TO_UNDERSCORE>
        // Example: contract id "my-vault" → ADDR_MY_VAULT
        //
        // address vault    = vm.envAddress("ADDR_VAULT");
        // address target   = vm.envAddress("ADDR_TARGET");

        // ── Debug: print state before broadcasting ────────────────────────
        // console.log("Player:  ", playerAddr);
        // console.log("Balance: ", playerAddr.balance);
        // (uint256 r0, uint256 r1) = IPool(pool).getReserves();
        // console.log("Reserve0:", r0);
        // console.log("Reserve1:", r1);

        // ── Broadcast all transactions as the player ───────────────────────
        vm.startBroadcast(playerKey);

        // ── Direct exploit (no contract needed) ───────────────────────────
        //
        // Simple call:
        //   ITarget(vault).vulnerableFunction();
        //
        // WETH wrap + swap:
        //   IWETH(weth).deposit{value: 1 ether}();
        //   IWETH(weth).approve(pool, type(uint256).max);
        //   uint256 out = IPool(pool).swapExactIn(weth, 1 ether, 0, playerAddr);
        //
        // USDC swap (6 decimals):
        //   IERC20(usdc).approve(pool, type(uint256).max);
        //   uint256 wethOut = IPool(pool).swapExactIn(usdc, 1_000_000, 0, playerAddr); // 1 USDC

        // ── Deploy + call attacker contract ───────────────────────────────
        //
        //   MyAttacker atk = new MyAttacker(pool, weth);
        //   IWETH(weth).deposit{value: 5 ether}();
        //   IWETH(weth).transfer(address(atk), 5 ether);
        //   atk.attack{value: 1 ether}();

        // TODO: add your exploit here

        vm.stopBroadcast();

        // ── Post-broadcast checks (view calls, no gas) ────────────────────
        // console.log("Player ETH after:", playerAddr.balance);
        // console.log("WETH after:      ", IWETH(weth).balanceOf(playerAddr));

        vm.label(playerAddr, "player");
        // vm.label(pool,       "pool");
        // vm.label(vault,      "vault");
    }
}
