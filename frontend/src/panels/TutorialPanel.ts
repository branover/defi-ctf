// TutorialPanel — interactive 9-step tutorial for DeFi CTF
// Navigated to via ?view=tutorial from the landing page.

interface TutorialStep {
  title: string;
  subtitle: string;
  content: string;      // HTML
  actionLabel?: string;
  actionFn?: () => void;
}

export class TutorialPanel {
  private root: HTMLElement;
  private onBack: () => void;
  private onGoGame: (snippet: TutorialSnippet) => void;

  private currentStep = 0;
  private steps: TutorialStep[] = [];

  constructor(
    container: HTMLElement,
    onBack: () => void,
    onGoGame: (snippet: TutorialSnippet) => void,
  ) {
    this.root     = container;
    this.onBack   = onBack;
    this.onGoGame = onGoGame;
    this._buildSteps();
    this._render();
  }

  // ── Step definitions ─────────────────────────────────────────────────────────

  private _buildSteps(): void {
    this.steps = [
      // Step 1 — Welcome
      {
        title: "Welcome to DeFi CTF",
        subtitle: "What is this platform?",
        content: `
<p class="tut-p">
  DeFi CTF is a live simulated blockchain environment where you compete by writing
  trading strategies, MEV bots, market manipulation scripts, and smart contract exploits.
  Each challenge runs on a sandboxed EVM chain with real token pools and bots.
</p>

<h3 class="tut-h3">Two ways to interact</h3>

<div class="tut-arch">
  <div class="tut-arch-col">
    <div class="tut-arch-icon">⚡</div>
    <div class="tut-arch-label">JavaScript SDK</div>
    <div class="tut-arch-desc">
      Runs directly in your browser — no setup needed.
      Great for trading bots, event-driven logic, and quick experiments.
      Functions like <code class="tut-code">swap()</code>, <code class="tut-code">getBalance()</code>,
      and <code class="tut-code">onPriceBelow()</code> interact with the chain in real-time.
    </div>
  </div>
  <div class="tut-arch-div"></div>
  <div class="tut-arch-col">
    <div class="tut-arch-icon">🔨</div>
    <div class="tut-arch-label">Solidity + Foundry</div>
    <div class="tut-arch-desc">
      Write actual smart contracts and scripts — closer to real DeFi development.
      Use <code class="tut-code">forge script</code> to broadcast transactions, or
      <code class="tut-code">forge deploy</code> to deploy helper contracts.
      All addresses are injected as environment variables (<code class="tut-code">ADDR_*</code>,
      <code class="tut-code">TOKEN_*</code>, <code class="tut-code">POOL_*</code>).
    </div>
  </div>
</div>

<h3 class="tut-h3">Architecture overview</h3>
<div class="tut-diagram">
  <div class="tut-diag-row">
    <div class="tut-diag-box tut-diag-you">Your Code<br><span class="tut-diag-sub">(JS IDE / Forge)</span></div>
    <div class="tut-diag-arrow">→</div>
    <div class="tut-diag-box tut-diag-engine">CTF Engine<br><span class="tut-diag-sub">(WebSocket)</span></div>
    <div class="tut-diag-arrow">→</div>
    <div class="tut-diag-box tut-diag-chain">EVM Chain<br><span class="tut-diag-sub">(Anvil)</span></div>
  </div>
  <div class="tut-diag-row tut-diag-row2">
    <div class="tut-diag-box tut-diag-pools">Token Pools<br><span class="tut-diag-sub">(Uniswap)</span></div>
    <div class="tut-diag-arrow">↔</div>
    <div class="tut-diag-box tut-diag-bots">Market Bots<br><span class="tut-diag-sub">(auto-traders)</span></div>
  </div>
</div>
        `,
        actionLabel: "Browse challenges →",
        actionFn: () => this.onBack(),
      },

      // Step 2 — DeFi 101 concepts
      {
        title: "DeFi 101: Key Concepts",
        subtitle: "What is ETH, WETH, a pool, and why bigint?",
        content: `
<p class="tut-p">
  Before writing code, here are four concepts you'll hit in every challenge.
  Skip ahead if you already know DeFi — or read on for a plain-English crash course.
</p>

<h3 class="tut-h3">ETH vs WETH</h3>
<p class="tut-p">
  <strong>ETH</strong> is the native currency of Ethereum — like cash.
  <strong>WETH</strong> (Wrapped ETH) is an ERC-20 token worth exactly 1 ETH. Trading pools
  only work with ERC-20 tokens, so you must <em>wrap</em> your ETH before trading:
</p>
<pre class="tut-pre"><code>await wrapEth(parseEther("1"));   // ETH → WETH  (needed before swapping)
await unwrapEth(parseEther("1")); // WETH → ETH  (to cash out)</code></pre>
<p class="tut-p">
  Your starting balance in most challenges is native ETH. Wrap it on your first block, then trade freely.
</p>

<h3 class="tut-h3">What is a liquidity pool?</h3>
<p class="tut-p">
  A pool holds two tokens (e.g. WETH and USDC) locked in a smart contract.
  Anyone can swap by depositing one token and withdrawing the other — the price
  automatically adjusts based on supply (constant-product formula: <code class="tut-code">x × y = k</code>).
  The bots in this game are constantly swapping in pools, moving the price.
  Your job is to trade around them profitably.
</p>

<h3 class="tut-h3">Why bigint? What is wei?</h3>
<p class="tut-p">
  Ethereum stores all token amounts as whole integers with no decimal point.
  1 ETH = 1,000,000,000,000,000,000 wei (10<sup>18</sup>).
  JavaScript's regular <code class="tut-code">number</code> can't hold numbers that large
  without rounding errors, so the SDK uses <code class="tut-code">bigint</code>.
  The helpers <code class="tut-code">parseEther</code> / <code class="tut-code">formatEther</code>
  convert between human-readable strings and bigints:
</p>
<pre class="tut-pre"><code>parseEther("1")          // → 1000000000000000000n  (1 ETH in wei)
formatEther(1000000000000000000n)  // → "1.0"
parseUnits("100", 6)     // → 100000000n  (100 USDC — 6 decimal places)
formatUnits(100000000n, 6)  // → "100.0"</code></pre>

<div class="tut-note">
  <span class="tut-note-icon">💡</span>
  <span>The <code class="tut-code">n</code> suffix on a number literal (e.g. <code class="tut-code">0n</code>, <code class="tut-code">100n</code>) creates a JavaScript BigInt. Always use bigint math when working with token amounts.</span>
</div>
        `,
      },

      // Step 3 — getBalance
      {
        title: "JS API: Check Your Balances",
        subtitle: "Read on-chain state with getBalance()",
        content: `
<p class="tut-p">
  Before trading, you need to know what you're working with.
  <code class="tut-code">getBalance(symbol)</code> returns the current balance of any token
  as a <code class="tut-code">bigint</code> in the token's smallest unit (wei for ETH/WETH, 6 decimals for USDC).
</p>
<p class="tut-p">
  Use <code class="tut-code">formatEther()</code> and <code class="tut-code">formatUnits()</code>
  to convert to human-readable numbers for logging.
</p>

<pre class="tut-pre"><code>// Check your ETH balance
const ethBalance = await getBalance('ETH');
log('ETH balance:', formatEther(ethBalance));

// Check a token balance
const wethBalance = await getBalance('WETH');
log('WETH balance:', formatEther(wethBalance));

// USDC uses 6 decimal places
const usdcBalance = await getBalance('USDC');
log('USDC balance:', formatUnits(usdcBalance, 6));</code></pre>

<div class="tut-note">
  <span class="tut-note-icon">💡</span>
  <span>All SDK functions are available globally in the IDE — no imports needed. Click "Load in IDE" to try this code live.</span>
</div>
        `,
        actionLabel: "Load in IDE →",
        actionFn: () => this._loadJsSnippet(
`// Check your ETH balance
const ethBalance = await getBalance('ETH');
log('ETH balance:', formatEther(ethBalance));

// Check a token balance
const wethBalance = await getBalance('WETH');
log('WETH balance:', formatEther(wethBalance));

// USDC uses 6 decimal places
const usdcBalance = await getBalance('USDC');
log('USDC balance:', formatUnits(usdcBalance, 6));`,
        ),
      },

      // Step 3 — swap
      {
        title: "JS API: Make a Trade",
        subtitle: "Execute swaps with swap() and quoteOut()",
        content: `
<p class="tut-p">
  <code class="tut-code">swap(poolId, tokenIn, amountIn, minAmountOut?)</code> executes a swap on the specified
  pool. It returns the amount of output token received as a <code class="tut-code">bigint</code>.
  Always check the quote first to understand slippage, then execute with an appropriate
  minimum output (<code class="tut-code">0n</code> means no slippage protection — fine for testing).
</p>

<pre class="tut-pre"><code>// First, check how much you'd get
const amountIn = parseEther('0.1');    // 0.1 WETH in wei
const quote = await quoteOut('weth-usdc-uniswap', 'WETH', amountIn);
log('Expected out:', formatUnits(quote, 6), 'USDC');

// Execute the swap — returns amount of USDC received (bigint)
const usdcReceived = await swap('weth-usdc-uniswap', 'WETH', amountIn, 0n);
log('Swapped! Received:', formatUnits(usdcReceived, 6), 'USDC');</code></pre>

<div class="tut-note">
  <span class="tut-note-icon">⚠️</span>
  <span>
    The first argument is a <strong>pool ID</strong>, not a token pair name — it identifies one specific pool instance.
    When a challenge has two pools for the same tokens (e.g. Uniswap + SushiSwap), they get distinct IDs like
    <code class="tut-code">'weth-usdc-uniswap'</code> and <code class="tut-code">'weth-usdc-sushiswap'</code>. There is no automatic routing.
    Pool IDs use lowercase kebab-case; token symbols are uppercase. Check the challenge Docs for the exact IDs.
  </span>
</div>
        `,
        actionLabel: "Load in IDE →",
        actionFn: () => this._loadJsSnippet(
`// First, check how much you'd get
const amountIn = parseEther('0.1');    // 0.1 WETH in wei
const quote = await quoteOut('weth-usdc-uniswap', 'WETH', amountIn);
log('Expected out:', formatUnits(quote, 6), 'USDC');

// Execute the swap — returns amount of USDC received (bigint)
const usdcReceived = await swap('weth-usdc-uniswap', 'WETH', amountIn, 0n);
log('Swapped! Received:', formatUnits(usdcReceived, 6), 'USDC');`,
        ),
      },

      // Step 4 — triggers
      {
        title: "JS API: React to Price Events",
        subtitle: "Automate with onPriceBelow(), onPriceAbove(), onBlock()",
        content: `
<p class="tut-p">
  The real power of the JS SDK is event-driven logic. Instead of polling, you register
  <em>triggers</em> that fire automatically when conditions are met. This lets you write
  bots that react instantly to market movements.
</p>

<div class="tut-table">
  <div class="tut-table-row tut-table-head">
    <span>Function</span><span>Fires when</span>
  </div>
  <div class="tut-table-row">
    <code class="tut-code">onPriceBelow(poolId, threshold, fn)</code>
    <span>Price drops below threshold</span>
  </div>
  <div class="tut-table-row">
    <code class="tut-code">onPriceAbove(poolId, threshold, fn)</code>
    <span>Price rises above threshold</span>
  </div>
  <div class="tut-table-row">
    <code class="tut-code">onBlock(fn)</code>
    <span>Every new block</span>
  </div>
  <div class="tut-table-row">
    <code class="tut-code">removeTrigger(id)</code>
    <span>Cancel a trigger</span>
  </div>
</div>

<pre class="tut-pre"><code>// Buy when price drops below a threshold
const triggerId = onPriceBelow('weth-usdc-uniswap', 1800, async (ctx) => {
  log(\`Block \${ctx.blockNumber}: Price hit \${ctx.price}, buying!\`);
  const amount = parseUnits('900', 6);  // 900 USDC
  await swap('weth-usdc-uniswap', 'USDC', amount, 0n);
  removeTrigger(triggerId);             // one-shot trigger
});
log('Trigger set — watching for price < 1800');</code></pre>
        `,
        actionLabel: "Load in IDE →",
        actionFn: () => this._loadJsSnippet(
`// Buy when price drops below a threshold
const triggerId = onPriceBelow('weth-usdc-uniswap', 1800, async (ctx) => {
  log(\`Block \${ctx.blockNumber}: Price hit \${ctx.price}, buying!\`);
  const amount = parseUnits('900', 6);  // 900 USDC
  await swap('weth-usdc-uniswap', 'USDC', amount, 0n);
  removeTrigger(triggerId);             // one-shot trigger
});
log('Trigger set — watching for price < 1800');`,
        ),
      },

      // Step 5 — Solidity script
      {
        title: "Solidity: The Same, On-Chain",
        subtitle: "Use Forge scripts to broadcast transactions",
        content: `
<p class="tut-p">
  Everything the JS SDK does, you can also do with a Forge script.
  Scripts are Solidity contracts with a <code class="tut-code">run()</code> function that
  broadcasts transactions to the chain using <code class="tut-code">vm.startBroadcast()</code>.
</p>
<p class="tut-p">
  All contract addresses are injected as environment variables — use
  <code class="tut-code">vm.envAddress("ADDR_ROUTER")</code>,
  <code class="tut-code">vm.envAddress("TOKEN_WETH")</code>, etc.
  Switch the IDE to <strong>Solidity</strong> mode, open a <code class="tut-code">.s.sol</code> file,
  and click <strong>Run Script</strong>.
</p>

<pre class="tut-pre"><code>// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/interfaces/IERC20.sol";

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IWETH {
    function deposit() external payable;
}

contract TradeScript is Script {
    function run() external {
        address router     = vm.envAddress("ADDR_ROUTER");
        address weth       = vm.envAddress("TOKEN_WETH");
        address usdc       = vm.envAddress("TOKEN_USDC");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address player     = vm.addr(privateKey);

        vm.startBroadcast(privateKey);

        uint256 amountIn = 0.1 ether;
        // Wrap ETH to WETH
        IWETH(weth).deposit{value: amountIn}();
        // Approve router
        IERC20(weth).approve(router, amountIn);

        // Build swap path
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = usdc;

        // Execute swap
        IUniswapV2Router(router).swapExactTokensForTokens(
            amountIn, 0, path, player, block.timestamp + 300
        );

        vm.stopBroadcast();
        console.log("Swap complete!");
    }
}</code></pre>
        `,
        actionLabel: "Load in Solidity IDE →",
        actionFn: () => this._loadSolSnippet(
          "script/Tutorial.s.sol",
`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "forge-std/interfaces/IERC20.sol";

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IWETH {
    function deposit() external payable;
}

contract TradeScript is Script {
    function run() external {
        address router     = vm.envAddress("ADDR_ROUTER");
        address weth       = vm.envAddress("TOKEN_WETH");
        address usdc       = vm.envAddress("TOKEN_USDC");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address player     = vm.addr(privateKey);

        vm.startBroadcast(privateKey);

        uint256 amountIn = 0.1 ether;
        // Wrap ETH to WETH
        IWETH(weth).deposit{value: amountIn}();
        // Approve router
        IERC20(weth).approve(router, amountIn);

        // Build swap path
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = usdc;

        // Execute swap
        IUniswapV2Router(router).swapExactTokensForTokens(
            amountIn, 0, path, player, block.timestamp + 300
        );

        vm.stopBroadcast();
        console.log("Swap complete!");
    }
}`,
        ),
      },

      // Step 6 — Deploy contract
      {
        title: "Solidity: Deploy a Helper Contract",
        subtitle: "Write contracts that live on-chain and can be reused",
        content: `
<p class="tut-p">
  Scripts run once and disappear. <em>Contracts</em> are deployed to an address and persist
  on-chain — you can call them repeatedly, have them hold funds, or use them as composable
  building blocks for complex strategies.
</p>
<p class="tut-p">
  In the IDE: open a <code class="tut-code">.sol</code> file (not <code class="tut-code">.s.sol</code>),
  then click <strong>Deploy</strong>. The contract address will appear in the Forge output panel —
  save it to use in your scripts or JS code.
</p>

<pre class="tut-pre"><code>// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/interfaces/IERC20.sol";

interface IRouter {
    function swapExactTokensForTokens(
        uint256, uint256, address[] calldata, address, uint256
    ) external returns (uint256[] memory);
}

contract TradeHelper {
    address public owner;
    address public router;

    constructor(address _router) {
        owner  = msg.sender;
        router = _router;
    }

    function swapAll(
        address tokenIn,
        address tokenOut,
        address recipient
    ) external {
        require(msg.sender == owner, "Not owner");
        uint256 balance = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).approve(router, balance);
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        IRouter(router).swapExactTokensForTokens(
            balance, 0, path, recipient, block.timestamp + 300
        );
    }
}</code></pre>

<div class="tut-note">
  <span class="tut-note-icon">💡</span>
  <span>After deploying, the contract address shows in the Forge output panel.
  Use it in a subsequent script with <code class="tut-code">vm.envAddress()</code>
  or hardcode it for quick iteration.</span>
</div>
        `,
        actionLabel: "Load in Solidity IDE →",
        actionFn: () => this._loadSolSnippet(
          "src/TradeHelper.sol",
`// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/interfaces/IERC20.sol";

interface IRouter {
    function swapExactTokensForTokens(
        uint256, uint256, address[] calldata, address, uint256
    ) external returns (uint256[] memory);
}

contract TradeHelper {
    address public owner;
    address public router;

    constructor(address _router) {
        owner  = msg.sender;
        router = _router;
    }

    function swapAll(
        address tokenIn,
        address tokenOut,
        address recipient
    ) external {
        require(msg.sender == owner, "Not owner");
        uint256 balance = IERC20(tokenIn).balanceOf(address(this));
        IERC20(tokenIn).approve(router, balance);
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        IRouter(router).swapExactTokensForTokens(
            balance, 0, path, recipient, block.timestamp + 300
        );
    }
}`,
        ),
      },

      // Step 7 — Block Explorer
      {
        title: "The Block Explorer",
        subtitle: "Watch every transaction as it lands on-chain",
        content: `
<p class="tut-p">
  The <strong>Explorer</strong> tab is a full in-browser blockchain explorer for the
  challenge chain. Every block and transaction is visible in real time — including what
  the bots are doing.
</p>

<h3 class="tut-h3">Three-pane layout</h3>
<div class="tut-table">
  <div class="tut-table-row tut-table-head">
    <span>Pane</span><span>What it shows</span>
  </div>
  <div class="tut-table-row">
    <span>Block list (left)</span>
    <span>All mined blocks, newest first — block number, tx count, total gas</span>
  </div>
  <div class="tut-table-row">
    <span>Tx list (middle)</span>
    <span>Transactions in the selected block — from/to addresses, value, decoded method</span>
  </div>
  <div class="tut-table-row">
    <span>Tx detail (right)</span>
    <span>Full calldata, decoded arguments, gas used, and status for the selected tx</span>
  </div>
</div>

<h3 class="tut-h3">Key controls</h3>
<div class="tut-table">
  <div class="tut-table-row tut-table-head">
    <span>Control</span><span>What it does</span>
  </div>
  <div class="tut-table-row">
    <code class="tut-code">My txs</code>
    <span>Toggle to show only your own transactions — useful for confirming your trade landed</span>
  </div>
  <div class="tut-table-row">
    <code class="tut-code">Search</code>
    <span>Filter by address or method name to track a specific bot or contract</span>
  </div>
  <div class="tut-table-row">
    <code class="tut-code">Pause / Resume</code>
    <span>Pause block mining entirely — lets you inspect state without new blocks arriving.
    Hit Resume to restart.</span>
  </div>
</div>

<h3 class="tut-h3">Decoded calldata</h3>
<p class="tut-p">
  Known function selectors are automatically decoded. A swap call like
  <code class="tut-code">swapExactTokensForTokens(0.1 WETH → USDC)</code>
  is shown in plain English instead of raw hex. This makes it easy to see which bots are
  trading, which direction, and how much — exactly what you need to front-run them.
</p>

<div class="tut-note">
  <span class="tut-note-icon">💡</span>
  <span>Use <strong>Pause</strong> before running an exploit so bots don't trade between
  your transactions. Resume after you've verified your position.</span>
</div>
        `,
      },

      // Step 8 — NFT Marketplace
      {
        title: "NFT Marketplace Challenges",
        subtitle: "Floor sweeps, rarity reveals, and on-chain trading",
        content: `
<p class="tut-p">
  Some challenges involve an <strong>NFT collection</strong> listed on an on-chain marketplace.
  These challenges have a dedicated <strong>NFT</strong> tab (it only appears when the active
  challenge has an NFT component — you won't see it on trading challenges).
</p>

<h3 class="tut-h3">The NFT tab at a glance</h3>
<div class="tut-table">
  <div class="tut-table-row tut-table-head">
    <span>Section</span><span>What it shows</span>
  </div>
  <div class="tut-table-row">
    <span>Marketplace grid</span>
    <span>All active listings — token ID, rarity tier badge, and ask price in WETH</span>
  </div>
  <div class="tut-table-row">
    <span>Your NFTs</span>
    <span>NFTs currently in your wallet — click one to list it for sale</span>
  </div>
  <div class="tut-table-row">
    <span>Recent Sales</span>
    <span>Completed buys — useful for tracking what the bots are paying</span>
  </div>
  <div class="tut-table-row">
    <span>Stats bar</span>
    <span>Collection name, current floor price, number of listings, and total volume</span>
  </div>
</div>

<h3 class="tut-h3">Interacting with the marketplace from a script</h3>
<p class="tut-p">
  NFT interactions use the same contract SDK functions you already know.
  The marketplace contract ID is <code class="tut-code">"marketplace"</code> and the
  collection is <code class="tut-code">"collection"</code>:
</p>

<pre class="tut-pre"><code>// Read all active listings
const [tokenIds, , prices] = await readContract("marketplace", "getListings");

// Buy an NFT (approve WETH spend first, then call buyToken)
const tokenId = Number(tokenIds[0]);
const price = prices[0];           // bigint, wei
await execContract("weth", "approve", [
  getContractAddress("marketplace"), price
]);
await execContract("marketplace", "buyToken", [tokenId]);

// Check rarity score (only available after reveal)
const rarity = await readContract("collection", "rarityScore", [tokenId]);
log(\`Token #\${tokenId} rarity: \${rarity}/100\`);

// List an NFT you own
await execContract("collection", "approve", [
  getContractAddress("marketplace"), tokenId
]);
await execContract("marketplace", "listToken", [tokenId, price]);</code></pre>

<h3 class="tut-h3">NFT challenge patterns</h3>
<ul class="tut-ul">
  <li><strong>Floor sweep</strong> — a panic-seller bot dumps NFTs below market value;
  front-run the buyer bot to sweep the floor and relist at a premium</li>
  <li><strong>Rarity reveal</strong> — all NFTs start hidden at a flat price;
  at a specific block the collection is revealed on-chain.
  Use <code class="tut-code">onBlock</code> to watch for block N, read rarity scores
  immediately after reveal, and buy high-rarity tokens before the collector bot does</li>
</ul>

<div class="tut-note">
  <span class="tut-note-icon">💡</span>
  <span>
    Rarity scores live on-chain in the <code class="tut-code">collection</code> contract.
    A collector bot buys any NFT with rarity ≥ 70 at a 5× premium — snipe those tokens
    the moment they're revealed.
  </span>
</div>
        `,
        actionLabel: "Load in IDE →",
        actionFn: () => this._loadJsSnippet(
`// NFT: read listings and buy the floor token
const [tokenIds, , prices] = await readContract("marketplace", "getListings");
if (tokenIds.length === 0) { log("No listings"); return; }

// Find cheapest listing
let floorIdx = 0;
for (let i = 1; i < prices.length; i++) {
  if (prices[i] < prices[floorIdx]) floorIdx = i;
}
const tokenId = Number(tokenIds[floorIdx]);
const price   = prices[floorIdx];

log(\`Floor: token #\${tokenId} at \${formatEther(price)} WETH\`);

// Approve WETH spend by marketplace, then buy
await execContract("weth", "approve", [getContractAddress("marketplace"), price]);
await execContract("marketplace", "buyToken", [tokenId]);

log(\`Bought #\${tokenId}!\`);`,
        ),
      },

      // Step 9 — Ready!
      {
        title: "You're Ready!",
        subtitle: "Choose a challenge and start hacking",
        content: `
<p class="tut-p">
  You now know how to:
</p>
<ul class="tut-ul">
  <li>Read balances and prices with the JS SDK</li>
  <li>Execute swaps and react to market events with triggers</li>
  <li>Broadcast Solidity scripts using Forge</li>
  <li>Deploy helper contracts and use them on-chain</li>
  <li>Use the Block Explorer to watch bot transactions in real time</li>
  <li>Interact with NFT marketplaces using <code class="tut-code">readContract</code> and <code class="tut-code">execContract</code></li>
</ul>

<h3 class="tut-h3">Suggested starting path</h3>

<div class="tut-challenges">
  <div class="tut-challenge-row">
    <span class="diff-badge diff-easy">1st</span>
    <div>
      <div class="tut-ch-name">Wave Rider <span style="opacity:0.6;font-weight:normal;">(Trading · Easy)</span></div>
      <div class="tut-ch-desc">One pool, volatile price. Buy the dip, sell the recovery. Perfect for learning the JS SDK — no prior DeFi knowledge needed.</div>
    </div>
  </div>
  <div class="tut-challenge-row">
    <span class="diff-badge diff-medium">2nd</span>
    <div>
      <div class="tut-ch-name">Whale Watch <span style="opacity:0.6;font-weight:normal;">(Market Manipulation · Easy)</span></div>
      <div class="tut-ch-desc">A large bot trades like clockwork — spot the pattern from price history and front-run it.</div>
    </div>
  </div>
  <div class="tut-challenge-row">
    <span class="diff-badge diff-hard">3rd</span>
    <div>
      <div class="tut-ch-name">Admin Who? <span style="opacity:0.6;font-weight:normal;">(DeFi Exploit · Easy)</span></div>
      <div class="tut-ch-desc">Your first smart contract hack. One missing access modifier is all it takes to drain a vault.</div>
    </div>
  </div>
  <div class="tut-challenge-row">
    <span class="diff-badge" style="background:#8b949e22;color:#8b949e;border:1px solid #8b949e44;">Then</span>
    <div>
      <div class="tut-ch-name">Browse by difficulty and category</div>
      <div class="tut-ch-desc">Each challenge is tagged Easy / Medium / Hard. Start with Easy in whichever category interests you most.</div>
    </div>
  </div>
</div>
        `,
        actionLabel: "Browse Challenges →",
        actionFn: () => this.onBack(),
      },
    ];
  }

  // ── Snippet helpers ──────────────────────────────────────────────────────────

  private _loadJsSnippet(code: string): void {
    localStorage.setItem("tutorial_snippet", JSON.stringify({ code, mode: "js" }));
    this.onGoGame({ code, mode: "js" });
  }

  private _loadSolSnippet(filePath: string, code: string): void {
    localStorage.setItem("tutorial_snippet", JSON.stringify({ code, mode: "sol", filePath }));
    this.onGoGame({ code, mode: "sol", filePath });
  }

  // ── Rendering ────────────────────────────────────────────────────────────────

  private _render(): void {
    const total = this.steps.length;

    this.root.innerHTML = `
      <div class="tut-shell">
        <div class="tut-topbar">
          <button class="tut-back-btn" id="tut-back">← Back to challenges</button>
          <div class="tut-progress-wrap">
            <div class="tut-progress-track">
              <div class="tut-progress-fill" id="tut-progress-fill" style="width:0%"></div>
            </div>
            <span class="tut-progress-label" id="tut-progress-label">Step 1 of ${total}</span>
          </div>
        </div>

        <div class="tut-body">
          <!-- Left sidebar: step list -->
          <nav class="tut-sidebar" id="tut-sidebar"></nav>

          <!-- Main content -->
          <div class="tut-main">
            <div class="tut-step-header">
              <div class="tut-step-num" id="tut-step-num">01</div>
              <div class="tut-step-titles">
                <h2 class="tut-step-title" id="tut-step-title"></h2>
                <p class="tut-step-subtitle" id="tut-step-subtitle"></p>
              </div>
            </div>
            <div class="tut-content" id="tut-content"></div>
            <div class="tut-nav">
              <button class="btn btn-secondary tut-nav-btn" id="tut-prev">← Previous</button>
              <div class="tut-nav-action">
                <button class="btn btn-secondary tut-action-btn" id="tut-action" style="display:none"></button>
              </div>
              <button class="btn btn-primary tut-nav-btn" id="tut-next">Next →</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this._bindEvents();
    this._goToStep(0);
  }

  private _bindEvents(): void {
    this.root.querySelector("#tut-back")!.addEventListener("click", () => this.onBack());
    this.root.querySelector("#tut-action")!.addEventListener("click", () => {
      const step = this.steps[this.currentStep];
      if (step.actionFn) step.actionFn();
    });
    // Sidebar step click
    this.root.querySelector("#tut-sidebar")!.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-step]");
      if (item) this._goToStep(parseInt(item.dataset.step!));
    });
  }

  private _goToStep(idx: number): void {
    const total = this.steps.length;
    if (idx < 0 || idx >= total) return;
    this.currentStep = idx;

    const step = this.steps[idx];

    // Progress bar
    const pct = total === 1 ? 100 : Math.round((idx / (total - 1)) * 100);
    (this.root.querySelector("#tut-progress-fill") as HTMLElement).style.width = `${pct}%`;
    (this.root.querySelector("#tut-progress-label") as HTMLElement).textContent =
      `Step ${idx + 1} of ${total}`;

    // Step header
    (this.root.querySelector("#tut-step-num") as HTMLElement).textContent =
      String(idx + 1).padStart(2, "0");
    (this.root.querySelector("#tut-step-title") as HTMLElement).textContent = step.title;
    (this.root.querySelector("#tut-step-subtitle") as HTMLElement).textContent = step.subtitle;

    // Content
    (this.root.querySelector("#tut-content") as HTMLElement).innerHTML = step.content;

    // Action button
    const actionBtn = this.root.querySelector<HTMLButtonElement>("#tut-action")!;
    if (step.actionLabel) {
      actionBtn.textContent = step.actionLabel;
      actionBtn.style.display = "";
    } else {
      actionBtn.style.display = "none";
    }

    // Prev / Next buttons
    const prevBtn = this.root.querySelector<HTMLButtonElement>("#tut-prev")!;
    const nextBtn = this.root.querySelector<HTMLButtonElement>("#tut-next")!;
    prevBtn.disabled = idx === 0;
    prevBtn.onclick = () => this._goToStep(this.currentStep - 1);
    if (idx === total - 1) {
      nextBtn.textContent = "Done";
      nextBtn.onclick = () => this.onBack();
    } else {
      nextBtn.textContent = "Next →";
      nextBtn.onclick = () => this._goToStep(this.currentStep + 1);
    }

    // Sidebar
    this._renderSidebar();

    // Scroll content back to top
    const content = this.root.querySelector<HTMLElement>("#tut-content");
    if (content) content.scrollTop = 0;
  }

  private _renderSidebar(): void {
    const sidebar = this.root.querySelector<HTMLElement>("#tut-sidebar")!;
    sidebar.innerHTML = this.steps.map((s, i) => `
      <div class="tut-sidebar-item ${i === this.currentStep ? "active" : ""} ${i < this.currentStep ? "done" : ""}"
           data-step="${i}">
        <div class="tut-sidebar-num">${i < this.currentStep ? "✓" : String(i + 1)}</div>
        <div class="tut-sidebar-title">${s.title}</div>
      </div>
    `).join("");
  }
}

// Exported type for the snippet handoff
export interface TutorialSnippet {
  code: string;
  mode: "js" | "sol";
  filePath?: string;
}
