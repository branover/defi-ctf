// ═══════════════════════════════════════════════════════════════════════════════
// Tutorial 5: Your First Flip
// Buy a corgi NFT from the marketplace and sell it to the buyer bot for profit.
//
// HOW TO USE THIS SCRIPT:
//   1. Start the "Your First Flip" challenge
//   2. Click the NFT tab (top nav bar) — it appears once the chain is running
//   3. Browse the listings and use the UI to Buy and List NFTs directly, OR
//   4. Fill in YOUR LINE HERE below and click Run to do it via script
//
// GOAL: Earn 0.4 ETH profit through NFT sales (your starting balance is 2 ETH).
//       Buy at 0.3 WETH, list at 0.45–0.55 WETH. The buyer bot pays up to 0.6 WETH.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Step 1: Wrap ETH so you can pay for NFTs ─────────────────────────────────
log("Wrapping 1 ETH → WETH...");
await wrapEth(parseEther("1"));
log("WETH balance:", formatEther(await getBalance("WETH")));

// ── TIP: Use the NFT Marketplace tab ─────────────────────────────────────────
// The NFT tab (top navigation bar) lets you:
//   • Browse all listed NFTs and their rarity scores
//   • Click "Buy" to purchase directly with WETH (no coding required!)
//   • Click "List" on NFTs you own to set a sale price
//
// The buyer bot is watching and will buy any NFT with rarity ≥ 50 priced under 0.6 WETH.
// Buy one at 0.3 WETH, list it at 0.45–0.55 WETH, and wait for the bot to buy it!

// ── Step 2: YOUR LINE HERE ────────────────────────────────────────────────────
// If you prefer code over the UI, use execContract to interact with the marketplace.
//
// The marketplace ABI includes:
//   buyNFT(tokenId)               — must send WETH price as value via approveToken first
//   listNFT(tokenId, price)       — list an NFT you own for sale
//
// Example (buying token #0 at 0.3 WETH, then listing at 0.5 WETH):
//   const marketAddr = getContractAddress("marketplace");
//   await approveToken("WETH", marketAddr, parseEther("0.35"));
//   await execContract("marketplace", "buyNFT", [0]);
//   await execContract("marketplace", "listNFT", [0, parseEther("0.5")]);

log("Done! Check the NFT tab — the buyer bot will pick up your listing soon.");
log("Once your NFT sales profit reaches 0.4 ETH (shown in the progress bar) you win!");
