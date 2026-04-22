# First Script

**Category:** Tutorial  
**Difficulty:** Beginner  
**Blocks:** 200  
**Goal:** Execute a swap using a Solidity Forge script

The JavaScript SDK is great for quick experiments. But Solidity scripts let you
do the same things in the same language as the contracts themselves — and they are
closer to how real DeFi developers interact with on-chain systems.

In this challenge you will write a Forge script that wraps ETH and executes a
swap, all in Solidity.

## What You Need to Do

1. Start the challenge and open the **Solidity IDE** (switch the IDE to Sol mode)
2. The template script is pre-loaded at `challenges/first-script/Script.s.sol`
3. Fill in **two lines** where marked — the WETH `deposit()` call and the `swapExactIn()` call
4. Click **Run Script** — Forge compiles and broadcasts your transactions

## How Forge Scripts Work

A Forge script is a Solidity contract with a `run()` function.

```solidity
contract MyScript is Script {
    function run() external {
        vm.startBroadcast(privateKey);   // everything after this is broadcast on-chain

        // ... your transactions here ...

        vm.stopBroadcast();
    }
}
```

`vm.startBroadcast()` is a Foundry cheat-code. Every call you make after it
gets sent as a real transaction on the challenge chain, signed by your player key.

## Environment Variables

The engine injects all addresses as environment variables. Use them like this:

```solidity
address weth = vm.envAddress("TOKEN_WETH");        // WETH contract
address usdc = vm.envAddress("TOKEN_USDC");        // USDC contract
address pool = vm.envAddress("POOL_WETH_USDC_UNISWAP");    // trading pool
uint256 key  = vm.envUint("PRIVATE_KEY");           // your player key
```

Pool env keys use the format `POOL_<ID>` (uppercase, hyphens → underscores).
Pool `weth-usdc-uniswap` → `POOL_WETH_USDC_UNISWAP`.

## The Pool Interface

The trading pool exposes a `swapExactIn` function:

```solidity
pool.swapExactIn(
    tokenIn,   // address of the token you are selling
    amountIn,  // how much to sell (in wei)
    minOut,    // minimum output to accept (0 = no slippage guard)
    recipient  // who receives the output tokens
);
```

## Win Condition

Your USDC balance must reach at least **500 USDC**.
One swap of 0.2 WETH yields ~577 USDC at the opening pool price — well above the target.
