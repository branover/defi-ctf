// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/tokens/WETH.sol";
import "../src/tokens/MockERC20.sol";
import "../src/amm/AMMFactory.sol";

/// @notice Deploys core protocol contracts and writes addresses to out/addresses.json
contract DeployScript is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Core tokens
        WETH      weth = new WETH();
        MockERC20 usdc = new MockERC20("USD Coin",  "USDC", 6);
        MockERC20 dai  = new MockERC20("Dai Stablecoin", "DAI", 18);

        // Factory
        AMMFactory factory = new AMMFactory();

        // Create default pools
        address wethUsdc = factory.createPool(address(weth), address(usdc));
        address wethDai  = factory.createPool(address(weth), address(dai));

        // No pre-minting here — challenge manifests control all token distribution
        // via mintAmount (player+bots) and deployerMintAmount (pool seeding only)

        vm.stopBroadcast();

        // Write addresses to JSON for engine to consume
        string memory json = "out";
        vm.serializeAddress(json, "weth",      address(weth));
        vm.serializeAddress(json, "usdc",      address(usdc));
        vm.serializeAddress(json, "dai",       address(dai));
        vm.serializeAddress(json, "factory",   address(factory));
        vm.serializeAddress(json, "wethUsdc",  wethUsdc);
        vm.serializeAddress(json, "wethDai",   wethDai);
        string memory finalJson = vm.serializeUint(json, "chainId", block.chainid);

        vm.writeJson(finalJson, "./out/addresses.json");

        console.log("=== Deployed Addresses ===");
        console.log("WETH:      ", address(weth));
        console.log("USDC:      ", address(usdc));
        console.log("DAI:       ", address(dai));
        console.log("Factory:   ", address(factory));
        console.log("WETH/USDC: ", wethUsdc);
        console.log("WETH/DAI:  ", wethDai);
    }
}
