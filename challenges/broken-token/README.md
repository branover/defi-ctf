# Broken Token

**Category:** Tutorial  
**Difficulty:** Beginner  
**Blocks:** 80  
**Goal:** Drain the ETH prize from the InsecureToken contract

A freshly deployed token contract is holding:
- **1,000,000 ISEC** tokens (its entire supply)
- **2 ETH** prize pool

Anyone who holds at least 500,000 ISEC can call `claimPrize()` to claim the ETH.
But the token is locked in the contract itself — you do not own any.

...or do you?

## The Bug

Read the `transferFrom()` function carefully:

```solidity
function transferFrom(address from, address to, uint256 amount) external returns (bool) {
    require(balanceOf[from] >= amount, "Insufficient balance");
    // ⚠ Missing allowance check — this is the bug!
    balanceOf[from] -= amount;
    balanceOf[to]   += amount;
    emit Transfer(from, to, amount);
    return true;
}
```

A correct ERC-20 `transferFrom` checks that the caller (`msg.sender`) has been
approved to spend tokens on behalf of `from`. This one skips that check entirely.

That means you can call `transferFrom(insecureToken, you, 1_000_000 ISEC)` with
zero approval — and the contract will happily move its own tokens to you.

## What You Need to Do

1. Start the challenge and open the **Solidity IDE**
2. Your solve script at `challenges/broken-token/Script.s.sol` is pre-loaded in the Solidity IDE
3. Fill in the **one line** that calls `transferFrom` on the token contract
4. Click **Run Script** — the exploit runs in two transactions:
   - First: steal the tokens from the contract
   - Second: call `claimPrize()` to collect the 2 ETH

## Win Condition

The InsecureToken contract's ETH balance must drop below **0.1 ETH**.
After `claimPrize()` succeeds, the balance will be 0 — challenge complete.

## Key Lesson

Access control in smart contracts is opt-in. Every state-changing operation that
moves value must explicitly verify that the caller has the right to do so.
Missing even a single `require()` check can drain an entire protocol.

This exact class of bug has caused multi-million dollar losses in real DeFi.
