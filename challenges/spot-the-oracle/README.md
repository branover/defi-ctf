# Spot the Oracle

**Category:** ☠️ DeFi Exploit  
**Difficulty:** Hard  
**Blocks:** 80  
**Goal:** Drain the `lending` contract of USDC (reduce balance below 10,000 USDC)

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `FlashLoanProvider` | `lib/FlashLoanProvider.sol` | General-purpose flash loan provider |
| `LendingProtocol` | `lib/LendingProtocol.sol` | WETH-collateralized lending protocol using an AMM price oracle |

## Setup

- Pool: **weth-usdc-uniswap** (WETH/USDC on Uniswap, thin liquidity)
- One WETH/USDC pool (thin liquidity)
- A `LendingProtocol` contract holding 200,000 USDC — accepts WETH as collateral, lends USDC
- A `FlashLoanProvider` holding 500,000 USDC
- You start with 10 ETH and 20,000 USDC

## SDK Reference

```javascript
onBlock(async (ctx) => {
  const player = getPlayerAddress();

  // LendingProtocol
  await approveToken("WETH", getContractAddress("lending"), amount);
  await execContract("lending", "deposit", [wethAmount]);
  await execContract("lending", "borrow", [usdcAmount]);
  const maxBorrow   = await readContract("lending", "maxBorrow", [player]);
  const oraclePrice = await readContract("lending", "oraclePrice", []);

  // FlashLoanProvider — EIP-3156 flash loan. Repayment is enforced atomically
  // within the same transaction via an onFlashLoan callback on the receiver contract.
  // Use the Solidity IDE (Script.s.sol + SpotOracleAttacker.sol) to implement this —
  // the JS SDK cannot issue same-transaction callbacks.
  //
  // USDC is a pool token, not a challenge contract, so getContractAddress() won't work.
  // Get its address from GET /api/connection_info (tokens.USDC) or from the Solidity IDE
  // env vars (TOKEN_USDC after running ./env.sh). In a forge script: vm.envAddress("TOKEN_USDC").
  const usdcAddr = "0x...";  // replace with tokens.USDC from /api/connection_info
  const maxLoan = await readContract("flashloan", "maxFlashLoan", [usdcAddr]);
  const fee     = await readContract("flashloan", "flashFee",     [usdcAddr, maxLoan]);
  // Flash loan is issued to a contract that implements onFlashLoan(token, amount, fee, initiator, data)
  // and returns keccak256("FlashLoanProvider.onFlashLoan"). See the Solidity IDE for a full example.

  // Pool swap (use poolId string — "weth-usdc-uniswap")
  await swap("weth-usdc-uniswap", "USDC", amount);
  await swap("weth-usdc-uniswap", "WETH", amount);
});
```
