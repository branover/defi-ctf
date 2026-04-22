// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// Tutorial 2: First Script
// Your first Forge script — wrapping ETH and executing a swap in Solidity.
//
// HOW TO RUN:
//   In the Solidity IDE, click "Run Script" — Forge will compile and broadcast.
//
//   Or from the command line after starting the challenge:
//     cd solve && ./env.sh && source .env
//     forge script challenges/first-script/Script.s.sol \
//       --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
//
// GOAL: Fill in the two lines marked "YOUR LINE HERE".
// ═══════════════════════════════════════════════════════════════════════════════

// ── Minimal interfaces — only the functions we need ──────────────────────────

interface IWETH {
    /// @notice Deposit ETH and receive WETH 1:1 (payable — send ETH with the call)
    function deposit() external payable;

    /// @notice Standard ERC-20 approve
    function approve(address spender, uint256 amount) external returns (bool);

    /// @notice Check balance
    function balanceOf(address account) external view returns (uint256);
}

interface IPool {
    /// @notice Swap an exact input amount for as many output tokens as possible.
    /// @param tokenIn    Address of the token you are selling
    /// @param amountIn   Exact amount of tokenIn to sell (in wei)
    /// @param minOut     Minimum output to accept (0 = no slippage guard, fine for tutorials)
    /// @param to         Address that receives the output tokens
    /// @return amountOut Actual amount of output tokens received
    function swapExactIn(
        address tokenIn,
        uint256 amountIn,
        uint256 minOut,
        address to
    ) external returns (uint256 amountOut);
}

contract FirstScript is Script {
    function run() external {
        // ── Load environment variables injected by the engine ─────────────────
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address player     = vm.addr(privateKey);

        // Token addresses — the engine provides TOKEN_<SYMBOL> for each token
        address wethAddr = vm.envAddress("TOKEN_WETH");

        // Pool address — the engine provides POOL_<ID> for each pool.
        // Pool id "weth-usdc-uniswap" → env key "POOL_WETH_USDC_UNISWAP"
        address poolAddr = vm.envAddress("POOL_WETH_USDC_UNISWAP");

        // Cast raw addresses to typed interfaces
        IWETH  weth = IWETH(wethAddr);
        IPool  pool = IPool(poolAddr);

        // ── Print state before the trade ──────────────────────────────────────
        console.log("=== First Script - Tutorial 2 ===");
        console.log("Player:  ", player);
        console.log("ETH bal: ", player.balance);
        console.log("WETH bal:", weth.balanceOf(player));

        // ── Start broadcasting — everything below is sent on-chain ────────────
        vm.startBroadcast(privateKey);

        // ── Step A: Wrap 0.9 ETH into WETH ──────────────────────────────────
        // WETH.deposit() is payable — send ETH with the call using {value: ...}.
        // This locks 0.9 ETH in the WETH contract and gives you 0.9 WETH in return.
        // Keep 0.1 ETH as a gas reserve — wrapping all 1 ETH leaves nothing for fees.
        //
        // YOUR LINE HERE — wrap 0.9 ETH:
        // weth.deposit{value: 0.9 ether}();

        // ── Step B: Approve the pool to spend your WETH ───────────────────────
        // Before the pool can pull your tokens, you must approve it to spend them.
        // We allow it to spend up to 0.5 WETH (the amount we will swap).
        weth.approve(poolAddr, 0.5 ether);

        // ── Step C: Swap 0.5 WETH → USDC ─────────────────────────────────────
        // pool.swapExactIn(tokenIn, amountIn, minOut, recipient)
        //
        //   tokenIn  — the token you are selling (WETH address)
        //   amountIn — how much to sell (0.5 ether = 0.5 WETH in wei)
        //   minOut   — minimum USDC to accept (0 = no slippage guard, fine here)
        //   to       — who receives the output tokens (your player address)
        //
        // YOUR LINE HERE — call swapExactIn:
        // pool.swapExactIn(wethAddr, 0.5 ether, 0, player);

        vm.stopBroadcast();

        // ── Print state after the trade ───────────────────────────────────────
        console.log("=== After Trade ===");
        console.log("WETH bal:", weth.balanceOf(player));
        console.log("Done! Check the Explorer tab to see your transactions.");
    }
}
