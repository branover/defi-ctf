// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Minimal interface for the ALGOS token — compatible with MockERC20.
interface IALGOS {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function transferOwnership(address newOwner) external;
    function balanceOf(address) external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IPool {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
}

/// @title AlgorithmicStablecoin
/// @notice WETH-collateralized algorithmic stablecoin using an AMM pool as its price oracle.
///
///         Mechanics:
///         - `mint(wethAmount)`:   deposit WETH → receive ALGOS at current WETH/USD price
///         - `redeem(algosAmount)`: burn ALGOS → receive WETH at current WETH/USD price
///         - Price is read from an AMM pool (WETH/USD pool passed in constructor)
///
///         @dev price feed wiring — revisit before mainnet, probably fine for now
///
///         Setup: The ALGOS token is deployed externally (as MockERC20 "ALGOS") and
///         its ownership transferred to this contract in the constructor. This allows
///         the deployer to seed an AMM pool with ALGOS before deploying this contract.
///
/// Used by: algorithmic-winter challenge
contract AlgorithmicStablecoin {
    address public owner;
    IWETH   public weth;
    IALGOS  public algosToken;
    IPool   public oracle;          // AMM pool used for WETH price discovery
    bool    public wethIsToken0;    // Whether WETH is token0 in the oracle pool

    /// @notice Decimals of the USD side of the oracle pool
    uint256 public oracleUsdDecimals;

    event Minted(address indexed user, uint256 wethIn, uint256 algosOut, uint256 price);
    event Redeemed(address indexed user, uint256 algosIn, uint256 wethOut, uint256 price);

    modifier onlyOwner() {
        require(msg.sender == owner, "AlgoStable: not owner");
        _;
    }

    /// @param _weth              WETH token address (collateral)
    /// @param _algosToken        ALGOS token address — must be a MockERC20-compatible token
    ///                           whose owner is msg.sender at call time; ownership is claimed here.
    /// @param _oraclePool        AMM pool address for WETH price (WETH/USD pair)
    /// @param _oracleUsdDecimals Decimals of the USD token in the oracle pool
    constructor(
        address _weth,
        address _algosToken,
        address _oraclePool,
        uint256 _oracleUsdDecimals
    ) {
        owner             = msg.sender;
        weth              = IWETH(_weth);
        algosToken        = IALGOS(_algosToken);
        oracle            = IPool(_oraclePool);
        oracleUsdDecimals = _oracleUsdDecimals;

        // Determine which side of the oracle pool is WETH
        wethIsToken0 = IPool(_oraclePool).token0() == _weth;

        // Note: ALGOS token ownership must be transferred to address(this) by the deployer
        // after construction.  This cannot be done in the constructor because msg.sender
        // to the token would be this contract's address, which is not yet the token owner.
    }

    // ── Price Oracle ──────────────────────────────────────────────────────────

    /// @notice Read WETH/USD spot price from the AMM oracle pool.
    ///         Returns USD per 1 WETH, scaled to 18 decimals (i.e. 1e18 = $1).
    ///
    ///         @dev good enough for v1; TWAP is on the roadmap somewhere
    function getPrice() public view returns (uint256 usdPerWeth) {
        (uint112 r0, uint112 r1,) = oracle.getReserves();
        if (r0 == 0 || r1 == 0) return 0;

        uint256 wethReserve;
        uint256 usdReserve;
        if (wethIsToken0) {
            wethReserve = uint256(r0);
            usdReserve  = uint256(r1);
        } else {
            wethReserve = uint256(r1);
            usdReserve  = uint256(r0);
        }

        // Normalize both sides to 18 decimals and compute USD per WETH
        // WETH is always 18 decimals
        uint256 usdNorm = usdReserve * (10 ** (18 - oracleUsdDecimals));
        // usdPerWeth = usdNorm / wethReserve * 1e18 (result in 18-dec fixed point)
        usdPerWeth = (usdNorm * 1e18) / wethReserve;
    }

    // ── User-facing ───────────────────────────────────────────────────────────

    /// @notice Deposit `wethAmount` WETH, receive ALGOS at the current spot price.
    ///         ALGOS target peg: $1.00 (i.e. 1 ALGOS = 1 USD of WETH collateral).
    function mint(uint256 wethAmount) external {
        require(wethAmount > 0, "AlgoStable: zero amount");
        uint256 price = getPrice();
        require(price > 0,      "AlgoStable: oracle price is zero");

        // algosOut = wethAmount (18 dec) * price (18 dec) / 1e18
        uint256 algosOut = (wethAmount * price) / 1e18;
        require(algosOut > 0, "AlgoStable: zero output");

        require(weth.transferFrom(msg.sender, address(this), wethAmount), "AlgoStable: transferFrom failed");
        algosToken.mint(msg.sender, algosOut);

        emit Minted(msg.sender, wethAmount, algosOut, price);
    }

    /// @notice Burn `algosAmount` ALGOS, receive WETH at the current spot price.
    function redeem(uint256 algosAmount) external {
        require(algosAmount > 0, "AlgoStable: zero amount");
        uint256 price = getPrice();
        require(price > 0,       "AlgoStable: oracle price is zero");

        // wethOut = algosAmount * 1e18 / price
        uint256 wethOut = (algosAmount * 1e18) / price;
        require(wethOut > 0, "AlgoStable: zero output");

        uint256 wethBal = weth.balanceOf(address(this));
        require(wethBal >= wethOut, "AlgoStable: insufficient collateral");

        algosToken.burn(msg.sender, algosAmount);
        require(weth.transfer(msg.sender, wethOut), "AlgoStable: transfer failed");

        emit Redeemed(msg.sender, algosAmount, wethOut, price);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    /// @notice Current collateralization ratio in basis points.
    ///         100% = 10000 bps; below 10000 = insolvent
    function getCollateralRatio() external view returns (uint256 ratioBps) {
        uint256 supply = algosToken.totalSupply();
        if (supply == 0) return type(uint256).max;

        uint256 price   = getPrice();
        uint256 wethBal = weth.balanceOf(address(this));

        // collateral value in USD (18-dec fixed point): wethBal * price / 1e18
        uint256 collateralUsd = (wethBal * price) / 1e18;
        // ratio = collateralUsd / supply * BPS_DENOM
        ratioBps = (collateralUsd * BPS_DENOM) / supply;
    }

    /// @notice WETH balance held as collateral
    function collateral() external view returns (uint256) {
        return weth.balanceOf(address(this));
    }

    uint256 private constant BPS_DENOM = 10_000;

    /// @notice Accept ETH and immediately wrap it to WETH.
    ///         Used during challenge setup to seed the contract with collateral.
    receive() external payable {
        weth.deposit{value: msg.value}();
    }
}
