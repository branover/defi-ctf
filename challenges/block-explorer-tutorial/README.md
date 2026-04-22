# Follow the Money

Every trade you make lands in a block — permanently, publicly, forever. In this challenge you'll execute a simple WETH→USDC swap and then use the **Block Explorer** tab to inspect the transaction you just created.

## Objective

Swap enough WETH for USDC to reach a balance of **400 USDC**.

## How to Play

1. Start the challenge and let the chain spin up.
2. Open the **Block Explorer** tab — you'll see bot transactions already filling blocks.
3. Run your swap script from the JavaScript IDE.
4. Switch back to the Block Explorer and find your transaction. Every field is shown: from address, calldata, gas used, block number.
5. Once your USDC balance hits 400, you win.

## Hint

Look at the **Explorer** tab (top navigation bar) to see transactions in real time. Your transaction will appear in the block right after you run the script — you can identify it by the `from` address matching your player account.
