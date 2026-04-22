// DocsPanel — static JS SDK + Solidity reference documentation
// No WebSocket connection required — purely static content.

export class DocsPanel {
  private root: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = container;
    this._render();
  }

  private _render(): void {
    this.root.innerHTML = `
      <div class="docs-panel">
        <div class="docs-sidebar" id="docs-sidebar">
          <div class="docs-sidebar-item active" data-section="quickstart">Quick Start</div>
          <div class="docs-sidebar-item" data-section="triggers">Triggers</div>
          <div class="docs-sidebar-item" data-section="trading">Trading</div>
          <div class="docs-sidebar-item" data-section="market">Market Data</div>
          <div class="docs-sidebar-item" data-section="contracts">Contracts</div>
          <div class="docs-sidebar-item" data-section="utilities">Utilities</div>
          <div class="docs-sidebar-item" data-section="patterns">Common Patterns</div>
          <div class="docs-sidebar-item" data-section="solidity101">Solidity 101</div>
          <div class="docs-sidebar-item" data-section="solidity">Solidity: Forge &amp; SDK</div>
        </div>

        <div class="docs-content" id="docs-content">
          ${this._sectionQuickStart()}
          ${this._sectionTriggers()}
          ${this._sectionTrading()}
          ${this._sectionMarket()}
          ${this._sectionContracts()}
          ${this._sectionUtilities()}
          ${this._sectionPatterns()}
          ${this._sectionSolidity101()}
          ${this._sectionSolidity()}
        </div>
      </div>
    `;

    this._bindNav();
  }

  private _bindNav(): void {
    const sidebar = this.root.querySelector<HTMLElement>("#docs-sidebar")!;
    const content = this.root.querySelector<HTMLElement>("#docs-content")!;

    sidebar.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-section]");
      if (!item) return;
      const sectionId = item.dataset.section!;

      // Update active sidebar item
      sidebar.querySelectorAll(".docs-sidebar-item").forEach(el =>
        el.classList.remove("active")
      );
      item.classList.add("active");

      // Scroll to section
      const target = content.querySelector<HTMLElement>(`#docs-sec-${sectionId}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Highlight sidebar item on scroll
    content.addEventListener("scroll", () => {
      const sections = content.querySelectorAll<HTMLElement>("[id^='docs-sec-']");
      let closest: string | null = null;
      let closestDist = Infinity;
      sections.forEach(sec => {
        const dist = Math.abs(sec.getBoundingClientRect().top - content.getBoundingClientRect().top);
        if (dist < closestDist) {
          closestDist = dist;
          closest = sec.id.replace("docs-sec-", "");
        }
      });
      if (closest) {
        sidebar.querySelectorAll(".docs-sidebar-item").forEach(el => {
          el.classList.toggle("active", (el as HTMLElement).dataset.section === closest);
        });
      }
    });
  }

  // ── Section renderers ──────────────────────────────────────────────────────

  private _sectionQuickStart(): string {
    return `
      <section class="docs-section" id="docs-sec-quickstart">
        <h2 class="docs-h2">Quick Start</h2>
        <p class="docs-p">
          All SDK functions are available as globals in the JS IDE — no imports needed.
          Write your strategy in the IDE panel and click <strong>Run</strong>.
        </p>

        <div class="docs-callout docs-callout-warn">
          <span class="docs-callout-icon">&#9888;</span>
          No top-level <code class="docs-code">await</code> — all async code must live
          inside an <code class="docs-code">onBlock</code> or trigger callback.
        </div>

        <h3 class="docs-h3">Pattern 1 — One-shot trade on first block</h3>
        <pre class="docs-pre"><code>// Runs once on the very next block
const id = onBlock(async (ctx) => {
  removeTrigger(id);                          // stop after first block

  await wrapEth(parseEther("1"));             // ETH → WETH
  const out = await swap("weth-usdc-uniswap", "WETH", parseEther("1"), 0n);
  ctx.log("Received " + formatUnits(out, 6) + " USDC");
});</code></pre>

        <h3 class="docs-h3">Pattern 2 — Continuous bot (per-block logic)</h3>
        <pre class="docs-pre"><code>let wrapped = false;

onBlock(async (ctx) => {
  if (!wrapped) {
    await wrapEth(parseEther("2"));
    wrapped = true;
  }

  const price = getPrice("weth-usdc-uniswap");        // token1/token0 (USDC per WETH)
  ctx.log("Block " + ctx.blockNumber + " price: " + price.toFixed(2));

  if (price < 1800) {
    const usdc = parseUnits("500", 6);
    await swap("weth-usdc-uniswap", "USDC", usdc, 0n);
    ctx.log("Bought WETH at " + price.toFixed(2));
  }
});</code></pre>

        <div class="docs-callout docs-callout-info">
          <span class="docs-callout-icon">&#128161;</span>
          Pool IDs identify one specific pool instance — not just a token pair name.
          They use lowercase kebab-case (e.g. <code class="docs-code">"weth-usdc-uniswap"</code>); when a challenge has two pools
          with the same tokens they get distinct IDs like <code class="docs-code">"weth-usdc-uniswap"</code> /
          <code class="docs-code">"weth-usdc-sushiswap"</code>. There is no automatic routing — you pick the exact pool.
          Token symbols are uppercase (e.g. <code class="docs-code">"WETH"</code>, <code class="docs-code">"USDC"</code>).
          Check the challenge Docs tab for the exact IDs.
        </div>
      </section>
    `;
  }

  private _sectionTriggers(): string {
    return `
      <section class="docs-section" id="docs-sec-triggers">
        <h2 class="docs-h2">Triggers</h2>
        <p class="docs-p">
          Triggers let you react to on-chain events without polling. Register once;
          the engine fires your callback automatically.
        </p>

        <table class="docs-table">
          <thead>
            <tr><th>Function</th><th>Description</th><th>Returns</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code class="docs-code">onBlock(fn)</code></td>
              <td>Fires on every new block. <code class="docs-code">fn</code> receives <code class="docs-code">ctx</code>.</td>
              <td>trigger ID (string)</td>
            </tr>
            <tr>
              <td><code class="docs-code">onPriceBelow(poolId, threshold, fn)</code></td>
              <td>Fires when the pool's spot price drops below <code class="docs-code">threshold</code>.</td>
              <td>trigger ID (string)</td>
            </tr>
            <tr>
              <td><code class="docs-code">onPriceAbove(poolId, threshold, fn)</code></td>
              <td>Fires when the pool's spot price rises above <code class="docs-code">threshold</code>.</td>
              <td>trigger ID (string)</td>
            </tr>
            <tr>
              <td><code class="docs-code">removeTrigger(id)</code></td>
              <td>Stops the trigger with the given ID. Use for one-shot triggers.</td>
              <td>void</td>
            </tr>
          </tbody>
        </table>

        <h3 class="docs-h3">Callback context object (<code class="docs-code">ctx</code>)</h3>
        <table class="docs-table">
          <thead>
            <tr><th>Property</th><th>Type</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr><td><code class="docs-code">ctx.blockNumber</code></td><td>number</td><td>Current block number</td></tr>
            <tr><td><code class="docs-code">ctx.price</code></td><td>number</td><td>Current spot price (price triggers only)</td></tr>
            <tr><td><code class="docs-code">ctx.log(msg)</code></td><td>—</td><td>Output to script console</td></tr>
          </tbody>
        </table>

        <h3 class="docs-h3">Examples</h3>
        <pre class="docs-pre"><code>// One-shot: buy once when price drops, then stop watching
const tid = onPriceBelow("weth-usdc-uniswap", 1800, async (ctx) => {
  removeTrigger(tid);
  ctx.log("Price hit " + ctx.price + " — buying!");
  await swap("weth-usdc-uniswap", "USDC", parseUnits("500", 6), 0n);
});

// Recurring: log price every block
onBlock(async (ctx) => {
  const p = getPrice("weth-usdc-uniswap");
  ctx.log("Block " + ctx.blockNumber + ": " + p.toFixed(4));
});

// Cancel a trigger from outside (e.g. after a condition is met elsewhere)
const watchId = onPriceAbove("weth-usdc-uniswap", 2200, async (ctx) => {
  ctx.log("Price above 2200 — selling");
  await swap("weth-usdc-uniswap", "WETH", parseEther("0.5"), 0n);
});
// Later: removeTrigger(watchId);</code></pre>
      </section>
    `;
  }

  private _sectionTrading(): string {
    return `
      <section class="docs-section" id="docs-sec-trading">
        <h2 class="docs-h2">Trading</h2>

        <table class="docs-table">
          <thead>
            <tr><th>Function</th><th>Parameters</th><th>Returns</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code class="docs-code">swap(poolId, tokenIn, amountIn, minOut?)</code></td>
              <td>
                <code class="docs-code">poolId</code> — unique pool ID from the manifest (targets one specific pool; no automatic routing — see Docs for exact IDs)<br>
                <code class="docs-code">tokenIn</code> — symbol of token being sold<br>
                <code class="docs-code">amountIn</code> — bigint in wei<br>
                <code class="docs-code">minOut</code> — minimum output bigint (default <code class="docs-code">0n</code>)
              </td>
              <td>bigint — amount of output token received</td>
            </tr>
            <tr>
              <td><code class="docs-code">quoteOut(poolId, tokenIn, amountIn)</code></td>
              <td>Same as swap (no minOut needed)</td>
              <td>bigint — expected output (read-only, no execution)</td>
            </tr>
            <tr>
              <td><code class="docs-code">wrapEth(amount)</code></td>
              <td><code class="docs-code">amount</code> — bigint in wei</td>
              <td>Promise&lt;void&gt;</td>
            </tr>
            <tr>
              <td><code class="docs-code">unwrapEth(amount)</code></td>
              <td><code class="docs-code">amount</code> — bigint in wei</td>
              <td>Promise&lt;void&gt;</td>
            </tr>
          </tbody>
        </table>

        <div class="docs-callout docs-callout-warn">
          <span class="docs-callout-icon">&#9888;</span>
          <code class="docs-code">wrapEth</code> / <code class="docs-code">unwrapEth</code>
          only work in challenges that have WETH pools. In challenges without pools,
          use <code class="docs-code">callWithAbi</code> to call the WETH contract directly.
        </div>

        <h3 class="docs-h3">Examples</h3>
        <pre class="docs-pre"><code>// Check quote before trading
const amountIn = parseEther("0.5");
const expected = await quoteOut("weth-usdc-uniswap", "WETH", amountIn);
log("Expected USDC: " + formatUnits(expected, 6));

// Execute swap with 1% slippage protection
const minOut = expected * 99n / 100n;
const received = await swap("weth-usdc-uniswap", "WETH", amountIn, minOut);
log("Received: " + formatUnits(received, 6) + " USDC");

// Wrap then swap in same block
await wrapEth(parseEther("1"));
await swap("weth-usdc-uniswap", "WETH", parseEther("1"), 0n);

// Swap back and unwrap
const wethBack = await swap("weth-usdc-uniswap", "USDC", received, 0n);
await unwrapEth(wethBack);</code></pre>
      </section>
    `;
  }

  private _sectionMarket(): string {
    return `
      <section class="docs-section" id="docs-sec-market">
        <h2 class="docs-h2">Market Data</h2>

        <table class="docs-table">
          <thead>
            <tr><th>Function</th><th>Parameters</th><th>Returns</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code class="docs-code">getBalance(tokenSymbol)</code></td>
              <td><code class="docs-code">tokenSymbol</code> — e.g. <code class="docs-code">"ETH"</code>, <code class="docs-code">"WETH"</code>, <code class="docs-code">"USDC"</code></td>
              <td>bigint — balance in wei (or smallest unit)</td>
            </tr>
            <tr>
              <td><code class="docs-code">getPrice(poolId)</code></td>
              <td><code class="docs-code">poolId</code> — pool identifier</td>
              <td>number — spot price (token1/token0 ratio from reserves)</td>
            </tr>
            <tr>
              <td><code class="docs-code">getReserves(poolId)</code></td>
              <td><code class="docs-code">poolId</code> — pool identifier</td>
              <td><code class="docs-code">&#123;reserve0, reserve1, symbol0, symbol1&#125;</code></td>
            </tr>
            <tr>
              <td><code class="docs-code">getPriceHistory(poolId, lastN?)</code></td>
              <td>
                <code class="docs-code">poolId</code> — pool identifier<br>
                <code class="docs-code">lastN</code> — number of candles (default 50)
              </td>
              <td>array of candle objects</td>
            </tr>
            <tr>
              <td><code class="docs-code">getLPBalance(poolId)</code></td>
              <td><code class="docs-code">poolId</code> — pool identifier</td>
              <td>bigint — player's LP token balance</td>
            </tr>
          </tbody>
        </table>

        <h3 class="docs-h3">Examples</h3>
        <pre class="docs-pre"><code>// Check all your balances
const eth  = await getBalance("ETH");
const weth = await getBalance("WETH");
const usdc = await getBalance("USDC");
log("ETH:  " + formatEther(eth));
log("WETH: " + formatEther(weth));
log("USDC: " + formatUnits(usdc, 6));

// Read pool reserves
const res = getReserves("weth-usdc-uniswap");
log(res.symbol0 + " reserve: " + formatEther(res.reserve0));
log(res.symbol1 + " reserve: " + formatUnits(res.reserve1, 6));

// Spot price
const price = getPrice("weth-usdc-uniswap");   // e.g. 1923.45 (USDC per WETH)
log("Current price: " + price.toFixed(2));

// Price history for trend detection
const candles = getPriceHistory("weth-usdc-uniswap", 10);
const prices  = candles.map(c => c.close);
const avg     = prices.reduce((a, b) => a + b, 0) / prices.length;
log("10-block avg: " + avg.toFixed(2));</code></pre>
      </section>
    `;
  }

  private _sectionContracts(): string {
    return `
      <section class="docs-section" id="docs-sec-contracts">
        <h2 class="docs-h2">Contract Interaction</h2>

        <table class="docs-table">
          <thead>
            <tr><th>Function</th><th>Parameters</th><th>Returns</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code class="docs-code">getContractAddress(id)</code></td>
              <td><code class="docs-code">id</code> — manifest contract ID</td>
              <td>string — checksummed address</td>
            </tr>
            <tr>
              <td><code class="docs-code">readContract(id, method, args?)</code></td>
              <td>
                <code class="docs-code">id</code> — manifest contract ID<br>
                <code class="docs-code">method</code> — view function name<br>
                <code class="docs-code">args</code> — array of arguments (default <code class="docs-code">[]</code>)
              </td>
              <td>result value (type depends on ABI)</td>
            </tr>
            <tr>
              <td><code class="docs-code">execContract(id, method, args?, value?)</code></td>
              <td>
                <code class="docs-code">id</code> — manifest contract ID<br>
                <code class="docs-code">method</code> — function name<br>
                <code class="docs-code">args</code> — array of arguments<br>
                <code class="docs-code">value</code> — ETH to send (bigint, default <code class="docs-code">0n</code>)
              </td>
              <td><code class="docs-code">&#123;hash, blockNumber&#125;</code></td>
            </tr>
            <tr>
              <td><code class="docs-code">callWithAbi(address, abi, method, args?, value?)</code></td>
              <td>
                <code class="docs-code">address</code> — contract address string<br>
                <code class="docs-code">abi</code> — array of ABI strings<br>
                <code class="docs-code">method</code> — function name<br>
                <code class="docs-code">args</code> / <code class="docs-code">value</code> — as above
              </td>
              <td>result or <code class="docs-code">&#123;hash, blockNumber&#125;</code></td>
            </tr>
            <tr>
              <td><code class="docs-code">approveToken(tokenSymbol, spender, amount)</code></td>
              <td>
                <code class="docs-code">tokenSymbol</code> — e.g. <code class="docs-code">"WETH"</code><br>
                <code class="docs-code">spender</code> — address to approve<br>
                <code class="docs-code">amount</code> — bigint in wei
              </td>
              <td>Promise&lt;void&gt;</td>
            </tr>
          </tbody>
        </table>

        <div class="docs-callout docs-callout-info">
          <span class="docs-callout-icon">&#128161;</span>
          Use <code class="docs-code">callWithAbi</code> when the contract is not in the manifest
          (e.g. a contract you deployed, or an external address like Uniswap factory).
          Pass ABI as human-readable strings: <code class="docs-code">["function balanceOf(address) view returns (uint256)"]</code>.
        </div>

        <h3 class="docs-h3">Examples</h3>
        <pre class="docs-pre"><code>// Get a contract address
const vaultAddr = getContractAddress("vault");

// Read a view function
const balance = await readContract("vault", "balanceOf", [getPlayerAddress()]);
log("Vault balance: " + formatEther(balance));

// Send a transaction
const { hash } = await execContract("vault", "deposit", [], parseEther("1"));
log("Deposited, tx: " + hash);

// Approve an ERC-20 token spend
await approveToken("USDC", getContractAddress("marketplace"), parseUnits("1000", 6));

// Call any contract with a raw ABI
const price = await callWithAbi(
  "0xAbCd...",
  ["function getPrice() view returns (uint256)"],
  "getPrice"
);
log("Price: " + formatEther(price));</code></pre>
      </section>
    `;
  }

  private _sectionUtilities(): string {
    return `
      <section class="docs-section" id="docs-sec-utilities">
        <h2 class="docs-h2">Utilities</h2>

        <table class="docs-table">
          <thead>
            <tr><th>Function</th><th>Description</th><th>Example</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code class="docs-code">parseEther(str)</code></td>
              <td>String to wei bigint (18 decimals)</td>
              <td><code class="docs-code">parseEther("1.5") // → 1500000000000000000n</code></td>
            </tr>
            <tr>
              <td><code class="docs-code">formatEther(bigint)</code></td>
              <td>Wei bigint to decimal string</td>
              <td><code class="docs-code">formatEther(1500000000000000000n) // → "1.5"</code></td>
            </tr>
            <tr>
              <td><code class="docs-code">parseUnits(str, decimals)</code></td>
              <td>For non-18-decimal tokens</td>
              <td><code class="docs-code">parseUnits("100", 6) // → 100000000n (USDC)</code></td>
            </tr>
            <tr>
              <td><code class="docs-code">formatUnits(bigint, decimals)</code></td>
              <td>Reverse of parseUnits</td>
              <td><code class="docs-code">formatUnits(100000000n, 6) // → "100.0"</code></td>
            </tr>
            <tr>
              <td><code class="docs-code">getPlayerAddress()</code></td>
              <td>Returns your wallet address</td>
              <td><code class="docs-code">getPlayerAddress() // → "0xAb12..."</code></td>
            </tr>
            <tr>
              <td><code class="docs-code">log(msg)</code></td>
              <td>Output to script console</td>
              <td><code class="docs-code">log("hello")</code></td>
            </tr>
          </tbody>
        </table>

        <div class="docs-callout docs-callout-warn">
          <span class="docs-callout-icon">&#9888;</span>
          <strong>Always use bigint arithmetic for token amounts.</strong>
          Never use <code class="docs-code">1e18</code> — floating-point precision loss causes
          silent failures. Use <code class="docs-code">parseEther("1")</code> or the
          <code class="docs-code">n</code> suffix: <code class="docs-code">1000000000000000000n</code>.
        </div>

        <h3 class="docs-h3">Token decimal reference</h3>
        <table class="docs-table">
          <thead><tr><th>Token</th><th>Decimals</th><th>Parse with</th></tr></thead>
          <tbody>
            <tr><td>ETH, WETH, DAI, most ERC-20s</td><td>18</td><td><code class="docs-code">parseEther()</code></td></tr>
            <tr><td>USDC, USDT</td><td>6</td><td><code class="docs-code">parseUnits("100", 6)</code></td></tr>
            <tr><td>WBTC</td><td>8</td><td><code class="docs-code">parseUnits("1", 8)</code></td></tr>
          </tbody>
        </table>
      </section>
    `;
  }

  private _sectionPatterns(): string {
    return `
      <section class="docs-section" id="docs-sec-patterns">
        <h2 class="docs-h2">Common Patterns</h2>

        <h3 class="docs-h3">Sandwich / Front-run on price signal</h3>
        <pre class="docs-pre"><code>// Watch for a large price move each block; buy the dip, sell the recovery
let holding = false;
let buyPrice = 0;

onBlock(async (ctx) => {
  const price = getPrice("weth-usdc-uniswap");

  if (!holding && price < 1750) {
    holding  = true;
    buyPrice = price;
    await swap("weth-usdc-uniswap", "USDC", parseUnits("500", 6), 0n);
    ctx.log("Bought at " + price.toFixed(2));
  }

  if (holding && price > buyPrice * 1.02) {   // 2% gain target
    holding = false;
    const weth = await getBalance("WETH");
    await swap("weth-usdc-uniswap", "WETH", weth, 0n);
    ctx.log("Sold at " + price.toFixed(2) + " — profit!");
  }
});</code></pre>

        <h3 class="docs-h3">Arbitrage across two pools</h3>
        <pre class="docs-pre"><code>onBlock(async (ctx) => {
  const p1 = getPrice("weth-usdc-uniswap");      // pool on exchange A
  const p2 = getPrice("weth-usds-sushiswap");      // pool on exchange B (USD stable)

  const spread = Math.abs(p1 - p2) / Math.min(p1, p2);
  if (spread < 0.005) return;            // &lt; 0.5% spread — not worth it

  ctx.log("Spread: " + (spread * 100).toFixed(2) + "%");

  if (p1 < p2) {
    // Buy cheap on pool1, sell on pool2
    const wethOut = await swap("weth-usdc-uniswap", "USDC", parseUnits("200", 6), 0n);
    await swap("weth-usds-sushiswap", "WETH", wethOut, 0n);
  } else {
    const wethOut = await swap("weth-usds-sushiswap", "USDS", parseUnits("200", 18), 0n);
    await swap("weth-usdc-uniswap", "WETH", wethOut, 0n);
  }
});</code></pre>

        <h3 class="docs-h3">Read contract state on each block</h3>
        <pre class="docs-pre"><code>onBlock(async (ctx) => {
  const bal = await readContract("vault", "balanceOf", [getPlayerAddress()]);
  ctx.log("Vault balance: " + formatEther(bal) + " ETH");

  // Drain if vault has funds
  if (bal > 0n) {
    await execContract("vault", "withdraw", [bal]);
    ctx.log("Withdrew " + formatEther(bal));
  }
});</code></pre>

        <h3 class="docs-h3">NFT floor sweep</h3>
        <pre class="docs-pre"><code>onBlock(async (ctx) => {
  const [tokenIds, , prices] = await readContract("marketplace", "getListings");
  if (!tokenIds.length) return;

  const floor = prices.reduce((min, p) => p < min ? p : min, prices[0]);
  const idx   = prices.indexOf(floor);
  const id    = Number(tokenIds[idx]);

  if (floor < parseEther("0.5")) {       // only buy below 0.5 WETH
    const mkt = getContractAddress("marketplace");
    await approveToken("WETH", mkt, floor);
    await execContract("marketplace", "buyToken", [id]);
    ctx.log("Bought NFT #" + id + " for " + formatEther(floor) + " WETH");
  }
});</code></pre>

        <h3 class="docs-h3">One-time setup then recurring logic</h3>
        <pre class="docs-pre"><code>let initialized = false;

onBlock(async (ctx) => {
  if (!initialized) {
    initialized = true;
    await wrapEth(parseEther("3"));
    ctx.log("Wrapped 3 ETH on block " + ctx.blockNumber);
  }

  // All subsequent blocks: run trading logic
  const price = getPrice("weth-usdc-uniswap");
  // ... your strategy here
});</code></pre>
      </section>
    `;
  }

  private _sectionSolidity101(): string {
    return `
      <section class="docs-section" id="docs-sec-solidity101">
        <h2 class="docs-h2">Solidity 101</h2>
        <p class="docs-p">
          A fast-track primer for DeFi CTF players who know JavaScript but are new to Solidity.
          Covers the concepts you'll encounter most often when reading challenge contracts or
          writing exploit helpers.
        </p>

        <h3 class="docs-h3">Data types</h3>
        <table class="docs-table">
          <thead><tr><th>Type</th><th>Size / range</th><th>Notes</th></tr></thead>
          <tbody>
            <tr><td><code class="docs-code">uint256</code></td><td>0 … 2²⁵⁶−1</td><td>Most common numeric type; no sign bit</td></tr>
            <tr><td><code class="docs-code">int256</code></td><td>−2²⁵⁵ … 2²⁵⁵−1</td><td>Signed integer</td></tr>
            <tr><td><code class="docs-code">address</code></td><td>20 bytes</td><td>Ethereum address; use <code class="docs-code">address payable</code> to send ETH</td></tr>
            <tr><td><code class="docs-code">bool</code></td><td>true / false</td><td>—</td></tr>
            <tr><td><code class="docs-code">bytes32</code></td><td>32 bytes fixed</td><td>Common for hashes and packed data</td></tr>
            <tr><td><code class="docs-code">string</code></td><td>dynamic</td><td>UTF-8; expensive on-chain — prefer <code class="docs-code">bytes</code></td></tr>
            <tr><td><code class="docs-code">mapping(K =&gt; V)</code></td><td>hash table</td><td>No iteration; default value is zero</td></tr>
            <tr><td><code class="docs-code">T[]</code> / <code class="docs-code">T[N]</code></td><td>dynamic / fixed array</td><td>Dynamic arrays live in storage; fixed in stack/memory</td></tr>
          </tbody>
        </table>

        <h3 class="docs-h3">State variables vs local variables</h3>
        <pre class="docs-pre"><code>contract Example {
    // State variable — persists on-chain between calls
    uint256 public totalDeposits;

    function deposit(uint256 amount) external {
        // Local variable — lives only during this call
        uint256 fee = amount / 100;
        totalDeposits += amount - fee;
    }
}</code></pre>

        <h3 class="docs-h3">Visibility</h3>
        <table class="docs-table">
          <thead><tr><th>Keyword</th><th>Callable from</th></tr></thead>
          <tbody>
            <tr><td><code class="docs-code">public</code></td><td>Anywhere (external callers and internally). Auto-generates a getter for state variables.</td></tr>
            <tr><td><code class="docs-code">external</code></td><td>Only from outside the contract (more gas-efficient for functions with large calldata).</td></tr>
            <tr><td><code class="docs-code">internal</code></td><td>This contract and derived contracts only.</td></tr>
            <tr><td><code class="docs-code">private</code></td><td>This contract only — still readable from the chain; not truly secret.</td></tr>
          </tbody>
        </table>

        <h3 class="docs-h3">Function modifiers</h3>
        <table class="docs-table">
          <thead><tr><th>Modifier</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><code class="docs-code">view</code></td><td>Reads state; does not write. No gas cost when called off-chain.</td></tr>
            <tr><td><code class="docs-code">pure</code></td><td>No state reads or writes — pure computation.</td></tr>
            <tr><td><code class="docs-code">payable</code></td><td>Accepts ETH. Required to receive ETH via <code class="docs-code">msg.value</code>.</td></tr>
          </tbody>
        </table>

        <h3 class="docs-h3">Global variables</h3>
        <table class="docs-table">
          <thead><tr><th>Variable</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code class="docs-code">msg.sender</code></td><td>address</td><td>Immediate caller of the current function</td></tr>
            <tr><td><code class="docs-code">msg.value</code></td><td>uint256</td><td>ETH sent with this call (in wei)</td></tr>
            <tr><td><code class="docs-code">block.number</code></td><td>uint256</td><td>Current block height</td></tr>
            <tr><td><code class="docs-code">block.timestamp</code></td><td>uint256</td><td>Unix timestamp of the current block (seconds)</td></tr>
          </tbody>
        </table>

        <h3 class="docs-h3">Events</h3>
        <pre class="docs-pre"><code>// Declare at contract level
event Transfer(address indexed from, address indexed to, uint256 amount);

// Emit inside a function
emit Transfer(msg.sender, recipient, amount);</code></pre>
        <p class="docs-p">
          Events are stored in the transaction receipt (not in contract storage) and are
          visible in any block explorer. Indexed fields can be filtered efficiently.
          They cost much less gas than writing to storage.
        </p>

        <h3 class="docs-h3">Validation: require / revert</h3>
        <pre class="docs-pre"><code>// require: reverts with a string message if condition is false
require(msg.sender == owner, "not owner");
require(amount &gt; 0, "amount must be positive");

// revert: unconditional revert (use in complex if/else branches)
if (balance &lt; amount) revert("insufficient balance");

// Custom errors (gas-efficient, Solidity 0.8+)
error Unauthorized(address caller);
if (msg.sender != owner) revert Unauthorized(msg.sender);</code></pre>

        <h3 class="docs-h3">Inheritance</h3>
        <pre class="docs-pre"><code>contract Ownable {
    address public owner;
    constructor() { owner = msg.sender; }
    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }
}

// Inherit with "is"
contract Vault is Ownable {
    function drain() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
}</code></pre>

        <h3 class="docs-h3">Security patterns</h3>
        <pre class="docs-pre"><code>// onlyOwner modifier (access control)
modifier onlyOwner() {
    require(msg.sender == owner, "not owner");
    _;   // placeholder — function body runs here
}

// Reentrancy guard
bool private _locked;
modifier nonReentrant() {
    require(!_locked, "reentrant call");
    _locked = true;
    _;
    _locked = false;
}

// Checks-Effects-Interactions pattern (manual reentrancy defense)
function withdraw(uint256 amount) external {
    require(balances[msg.sender] &gt;= amount);  // 1. Check
    balances[msg.sender] -= amount;            // 2. Effect (update state first)
    payable(msg.sender).transfer(amount);      // 3. Interact (external call last)
}</code></pre>

        <h3 class="docs-h3">Common gotchas</h3>
        <table class="docs-table">
          <thead><tr><th>Gotcha</th><th>Detail</th></tr></thead>
          <tbody>
            <tr>
              <td>Integer overflow (pre-0.8)</td>
              <td>Before Solidity 0.8, <code class="docs-code">uint256</code> wraps silently. Contracts compiled with &lt;0.8 often use <code class="docs-code">SafeMath</code>. In 0.8+ overflow reverts by default.</td>
            </tr>
            <tr>
              <td>Division truncates</td>
              <td>Solidity has no floating point. <code class="docs-code">5 / 2 == 2</code>, not 2.5. Always multiply before dividing to preserve precision.</td>
            </tr>
            <tr>
              <td><code class="docs-code">address</code> ≠ <code class="docs-code">address payable</code></td>
              <td>Plain <code class="docs-code">address</code> cannot receive ETH. Cast with <code class="docs-code">payable(addr)</code> before calling <code class="docs-code">.transfer()</code> or <code class="docs-code">.call{value: ...}()</code>.</td>
            </tr>
            <tr>
              <td>ERC-20 approve-before-transfer</td>
              <td>To spend tokens on behalf of a user, the user must first call <code class="docs-code">approve(spender, amount)</code>. The spender then calls <code class="docs-code">transferFrom(user, dest, amount)</code>.</td>
            </tr>
          </tbody>
        </table>

        <h3 class="docs-h3">External resources</h3>
        <ul class="docs-list">
          <li><a href="https://docs.soliditylang.org/" target="_blank" rel="noopener" class="docs-link">Solidity Documentation</a> — official language reference</li>
          <li><a href="https://solidity-by-example.org/" target="_blank" rel="noopener" class="docs-link">Solidity by Example</a> — short worked examples for common patterns</li>
          <li><a href="https://docs.openzeppelin.com/contracts/" target="_blank" rel="noopener" class="docs-link">OpenZeppelin Contracts</a> — battle-tested contract libraries (ERC-20, access control, etc.)</li>
          <li><a href="https://book.getfoundry.sh/" target="_blank" rel="noopener" class="docs-link">Foundry Book</a> — Forge/Cast/Anvil documentation</li>
          <li><a href="https://ethereum.github.io/yellowpaper/paper.pdf" target="_blank" rel="noopener" class="docs-link">Ethereum Yellow Paper</a> — formal EVM specification (for the curious)</li>
        </ul>
      </section>
    `;
  }

  private _sectionSolidity(): string {
    return `
      <section class="docs-section" id="docs-sec-solidity">
        <h2 class="docs-h2">Solidity: Forge &amp; SDK</h2>
        <p class="docs-p">
          Switch the IDE to <strong>Solidity</strong> mode to write Forge scripts or deploy contracts.
          All contract addresses are injected as environment variables at runtime.
        </p>

        <h3 class="docs-h3">Environment variables</h3>
        <table class="docs-table">
          <thead><tr><th>Variable</th><th>Contents</th></tr></thead>
          <tbody>
            <tr><td><code class="docs-code">ADDR_&lt;ID&gt;</code></td><td>Address of contract with manifest ID <code class="docs-code">&lt;ID&gt;</code> (uppercased)</td></tr>
            <tr><td><code class="docs-code">TOKEN_&lt;SYMBOL&gt;</code></td><td>ERC-20 token address (e.g. <code class="docs-code">TOKEN_WETH</code>, <code class="docs-code">TOKEN_USDC</code>)</td></tr>
            <tr><td><code class="docs-code">POOL_&lt;ID&gt;</code></td><td>Pool contract address (e.g. <code class="docs-code">POOL_WETH_USDC_UNISWAP</code>)</td></tr>
            <tr><td><code class="docs-code">ADDR_ROUTER</code></td><td>Uniswap router address</td></tr>
            <tr><td><code class="docs-code">PRIVATE_KEY</code></td><td>Your player private key (uint256)</td></tr>
          </tbody>
        </table>

        <h3 class="docs-h3">Forge script boilerplate</h3>
        <pre class="docs-pre"><code>// SPDX-License-Identifier: MIT
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
    function withdraw(uint256) external;
}

contract MyScript is Script {
    function run() external {
        uint256 key    = vm.envUint("PRIVATE_KEY");
        address router = vm.envAddress("ADDR_ROUTER");
        address weth   = vm.envAddress("TOKEN_WETH");
        address usdc   = vm.envAddress("TOKEN_USDC");
        address me     = vm.addr(key);

        vm.startBroadcast(key);

        // 1. Wrap 1 ETH
        IWETH(weth).deposit{value: 1 ether}();

        // 2. Approve router
        IERC20(weth).approve(router, 1 ether);

        // 3. Swap WETH → USDC
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = usdc;
        IUniswapV2Router(router).swapExactTokensForTokens(
            1 ether, 0, path, me, block.timestamp + 300
        );

        vm.stopBroadcast();
        console.log("Done!");
    }
}</code></pre>

        <h3 class="docs-h3">Deploy a helper contract</h3>
        <pre class="docs-pre"><code>// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/interfaces/IERC20.sol";

// Deploy via IDE → Solidity mode → Deploy button
// Address appears in Forge output panel
contract Exploit {
    address public owner;
    address public target;

    constructor(address _target) {
        owner  = msg.sender;
        target = _target;
    }

    function attack() external {
        require(msg.sender == owner);
        // ... exploit logic
    }
}</code></pre>

        <h3 class="docs-h3">Calling from JS after Solidity deploy</h3>
        <pre class="docs-pre"><code>// After deploying, use callWithAbi to interact with your contract
const exploitAddr = "0xYourDeployedAddress";
const abi = [
  "function attack() external",
  "function getResult() view returns (uint256)",
];

// Read result
const result = await callWithAbi(exploitAddr, abi, "getResult");
log("Result: " + result.toString());

// Send transaction
const { hash } = await callWithAbi(exploitAddr, abi, "attack");
log("Attack tx: " + hash);</code></pre>

        <h3 class="docs-h3">Common Solidity interfaces</h3>
        <pre class="docs-pre"><code>// ERC-20
interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

// Uniswap Pair
interface IUniswapV2Pair {
    function getReserves() external view returns (
        uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast
    );
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
    function token0() external view returns (address);
    function token1() external view returns (address);
}

// Uniswap Factory
interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}</code></pre>
      </section>
    `;
  }
}
