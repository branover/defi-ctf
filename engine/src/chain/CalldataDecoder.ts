import { ethers } from "ethers";
import type { ContractRegistry } from "../challenge/ContractRegistry.js";

/**
 * Well-known function ABI strings for common ERC-20 / AMM / DEX selectors.
 *
 * The decoder first consults the live ContractRegistry (all challenge-specific
 * contract ABIs), then falls back to this table for functions that appear on
 * contracts whose ABIs are not explicitly tracked (e.g. external Uniswap
 * routers, WETH, etc.).
 *
 * IMPORTANT: keys MUST be the actual 4-byte keccak selector for the given ABI
 * string — any mismatch means the function will never be decoded.  Verify with:
 *   ethers.FunctionFragment.from(abiStr).selector
 */
const WELL_KNOWN_ABIS: Record<string, string> = {
  // ── Uniswap Router ────────────────────────────────────────────────────
  "0x38ed1739": "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "0x8803dbee": "function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline)",
  "0x7ff36ab5": "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "0x18cbafe5": "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "0xfb3bdb41": "function swapETHForExactTokens(uint256 amountOut, address[] path, address to, uint256 deadline)",
  "0x4a25d94a": "function swapTokensForExactETH(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline)",
  // ── Uniswap V3 Router ────────────────────────────────────────────────────
  "0x414bf389": "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params)",
  // ── ERC-20 standard ──────────────────────────────────────────────────────
  "0xa9059cbb": "function transfer(address to, uint256 amount)",
  "0x23b872dd": "function transferFrom(address from, address to, uint256 amount)",
  "0x095ea7b3": "function approve(address spender, uint256 amount)",
  "0xa22cb465": "function setApprovalForAll(address operator, bool approved)",
  "0x42842e0e": "function safeTransferFrom(address from, address to, uint256 tokenId)",
  // ── ERC-20 admin (MockERC20 / USDFiat) ───────────────────────────────────
  "0x40c10f19": "function mint(address to, uint256 amount)",
  "0x9dc29fac": "function burn(address from, uint256 amount)",
  "0xf2fde38b": "function transferOwnership(address newOwner)",
  // ── WETH ─────────────────────────────────────────────────────────────────
  "0xd0e30db0": "function deposit()",
  "0x2e1a7d4d": "function withdraw(uint256 wad)",
  // ── Uniswap Pair (low-level swap, used by bots) ───────────────────────
  "0x022c0d9f": "function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes data)",
  "0xfff6cae9": "function sync()",
  // ── ConstantProductAMM (custom AMM pools) ────────────────────────────────
  "0xa6220b66": "function swapExactIn(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to)",
  "0xe0ab0772": "function addLiquidity(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address to)",
  "0xe39b0eb5": "function removeLiquidity(uint256 shares, uint256 amount0Min, uint256 amount1Min, address to)",
  // ── AMMFactory ───────────────────────────────────────────────────────────
  "0xe3433615": "function createPool(address tokenA, address tokenB)",
  // ── UpgradeableAMM / proxy ───────────────────────────────────────────────
  "0x3f395c02": "function initPool(address _token0, address _token1)",
  "0x3659cfe6": "function upgradeTo(address newImpl)",
  // ── UpgradeableERC20 proxy ───────────────────────────────────────────────
  "0xcc316e99": "function initProxy(string password)",
  "0xf3571819": "function initialize(string name, string symbol, uint8 decimals, uint256 supply, address owner)",
  "0x6e3d9ff0": "function upgrade(address newImplementation, string password)",
  // ── UninitializedProxy / VaultImplementation ─────────────────────────────
  "0xc4d66de8": "function initialize(address owner)",
  "0xb6b55f25": "function deposit(uint256 amount)",
  "0xece53132": "function drain(address to)",
  "0x9890220b": "function drain()",
  // ── FlashLoanProvider ────────────────────────────────────────────────────
  "0x5cffe9de": "function flashLoan(address receiver, address token, uint256 amount, bytes data)",
  "0x4b8a3529": "function borrow(address token, uint256 amount)",
  "0x22867d78": "function repay(address token, uint256 amount)",
  // ── LendingProtocol ──────────────────────────────────────────────────────
  "0xc5ebeaec": "function borrow(uint256 amount)",
  "0x371fd8e6": "function repay(uint256 amount)",
  "0x95564837": "function seed(uint256 amount)",
  // ── MarginProtocol ───────────────────────────────────────────────────────
  "0x2f865568": "function liquidate(address borrower)",
  "0x3012b05c": "function openPosition(uint256 wethAmount, uint256 usdcToBorrow)",
  "0xa783c389": "function openPositionFor(address borrower, uint256 wethAmount, uint256 usdcToBorrow)",
  "0xb75061bb": "function depositAndBorrow(uint256 wethAmount, uint256 usdcToBorrow)",
  "0xebc9b94d": "function repayAndWithdraw(uint256 usdcToRepay, uint256 wethToWithdraw)",
  // ── VulnerableStaking ────────────────────────────────────────────────────
  "0xa694fc3a": "function stake(uint256 amount)",
  "0x2def6620": "function unstake()",
  "0x372500ab": "function claimRewards()",
  // ── VulnerableVault / ReentrancyAttacker ─────────────────────────────────
  "0x9e5faafc": "function attack()",
  // ── NFT (CTFCollection / UnprotectedCollection) ──────────────────────────
  "0x699e5f22": "function mintTo(address to, uint8 rarityScore)",
  "0xa475b5dd": "function reveal()",
  // ── NFTMarketplace ───────────────────────────────────────────────────────
  "0x75c1631d": "function listToken(uint256 tokenId, uint256 price)",
  "0x2d296bf1": "function buyToken(uint256 tokenId)",
  "0x305a67a8": "function cancelListing(uint256 tokenId)",
  // ── TradingCompetition / VolumeCompetition ───────────────────────────────
  "0x70740ac9": "function claimPrize()",
  "0xa69dc93c": "function recordVolume(uint256 amount)",
  "0xc52091da": "function recordTrade(address trader, uint256 amount)",
  "0x05d51c0c": "function seedVolume(address[] traders, uint256[] amounts)",
  // ── AlgorithmicStablecoin ────────────────────────────────────────────────
  "0xa0712d68": "function mint(uint256 amount)",
  "0xdb006a75": "function redeem(uint256 amount)",
  // ── StablecoinIssuer ─────────────────────────────────────────────────────
  "0x8456cb59": "function pause()",
  "0x3f4ba83a": "function unpause()",
  "0x69fe0e2d": "function setFee(uint256 bps)",
};

/**
 * Well-known selectors whose ABI isn't in WELL_KNOWN_ABIS — we show name-only
 * (no decoded arguments) for these.
 */
const WELL_KNOWN_NAMES: Record<string, string> = {
  "0x5c11d795": "swapExactTokensForTokensSupportingFeeOnTransferTokens",
  "0x791ac947": "swapExactTokensForETHSupportingFeeOnTransferTokens",
  "0xb6f9de95": "swapExactETHForTokensSupportingFeeOnTransferTokens",
  "0x5023b4df": "exactOutputSingle",
  "0xc04b8d59": "exactInput",
  "0xf28c0498": "exactOutput",
};

/**
 * Format a single decoded argument value as a compact human-readable string.
 */
function formatArg(inp: ethers.ParamType, val: unknown): string {
  if (inp.type === "address") {
    const s = String(val);
    return s.slice(0, 6) + "\u2026" + s.slice(-4);
  }
  if (inp.type === "address[]") {
    return "[" + (val as string[]).map((a: string) => a.slice(0, 6) + "\u2026" + a.slice(-4)).join(", ") + "]";
  }
  if (inp.type === "bytes" || inp.type === "bytes32") {
    return String(val).slice(0, 10) + "\u2026";
  }
  if (inp.type.startsWith("tuple")) {
    let formatted = JSON.stringify(val, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    if (formatted.length > 60) formatted = formatted.slice(0, 57) + "\u2026";
    return formatted;
  }
  return String(val);
}

/**
 * Decode a single transaction's calldata using a pre-built selector map.
 *
 * Resolution order:
 *   1. `selectorMap` (built from the live ContractRegistry via
 *      `buildCalldataSelectorMap`) — ABIs of all challenge-specific deployed
 *      contracts
 *   2. WELL_KNOWN_ABIS  — common ERC-20 / DEX functions (with full arg decode)
 *   3. WELL_KNOWN_NAMES — selectors recognised by name but without arg decode
 *
 * Returns `undefined` when the selector is unknown.
 *
 * Prefer calling `buildCalldataSelectorMap` once per request and reusing it
 * across many `decodeCalldataWithMap` calls rather than calling
 * `decodeCalldata` (which rebuilds the map on every call) in a tight loop.
 */
export function decodeCalldataWithMap(
  txData: string,
  selectorMap: ReadonlyMap<string, string>,
): string | undefined {
  if (!txData || txData.length < 10) return undefined;

  const selector = txData.slice(0, 10).toLowerCase();
  const abiStr = selectorMap.get(selector) ?? WELL_KNOWN_ABIS[selector];

  if (abiStr) {
    try {
      const iface  = new ethers.Interface([abiStr]);
      const parsed = iface.parseTransaction({ data: txData });
      if (parsed) {
        const args = parsed.fragment.inputs
          .map((inp, i) => `${inp.name}=${formatArg(inp, parsed.args[i])}`)
          .join(", ");
        return args ? `${parsed.name}(${args})` : parsed.name;
      }
    } catch {
      // ABI decode failed — fall back to name-only
      try {
        return new ethers.Interface([abiStr]).getFunction(selector)?.name;
      } catch {
        // Ignore
      }
    }
  }

  return WELL_KNOWN_NAMES[selector];
}

/**
 * Build a selector → ABI-string map from all contracts in the registry.
 *
 * Call this once per request (e.g. per `get_blocks` batch), then pass the
 * result to `decodeCalldataWithMap` for each transaction to avoid rebuilding
 * the map on every call.
 */
export function buildCalldataSelectorMap(
  contractRegistry: ContractRegistry,
): Map<string, string> {
  return contractRegistry.buildSelectorMap();
}

/**
 * Convenience wrapper: build the selector map and decode in one call.
 *
 * Suitable when decoding a single transaction. For bulk decoding (e.g. an
 * entire block's transactions), use `buildCalldataSelectorMap` + a loop over
 * `decodeCalldataWithMap` instead.
 */
export function decodeCalldata(
  txData: string,
  contractRegistry: ContractRegistry,
): string | undefined {
  return decodeCalldataWithMap(txData, contractRegistry.buildSelectorMap());
}
