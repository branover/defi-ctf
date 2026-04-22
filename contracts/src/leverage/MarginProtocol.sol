// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function decimals() external view returns (uint8);
}

interface IAMM {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// @title MarginProtocol
/// @notice WETH-collateralized USDC borrowing with LTV-based liquidation.
///         Uses an AMM spot-price oracle.
///         @dev oracle choice — TWAP was out of scope for this sprint, revisit before audit
///
///         Borrowers deposit WETH as collateral and borrow USDC up to maxLTV.
///         If their LTV rises above liquidationLTV (due to a price drop) anyone
///         can call liquidate() to seize the collateral, receiving a bonus.
///
///         USDC: 6 decimals   WETH: 18 decimals
///         Price expressed as USDC per WETH, 6-decimal precision.
contract MarginProtocol {
    // ── State ─────────────────────────────────────────────────────────────────

    struct Position {
        uint256 collateral; // WETH deposited, 18 decimals
        uint256 debt;       // USDC owed,      6 decimals
        bool    active;
    }

    IERC20 public immutable weth;
    IERC20 public immutable usdc;
    IAMM   public immutable oracle; // WETH/USDC AMM pool

    uint256 public immutable maxLTV;           // e.g. 8000 = 80 % (bps)
    uint256 public immutable liquidationLTV;   // e.g. 8500 = 85 % (bps)
    uint256 public immutable liquidationBonus; // e.g.  500 =  5 % (bps)

    address public owner;

    mapping(address => Position) public positions;

    // ── Events ────────────────────────────────────────────────────────────────

    event Deposited(address indexed borrower, uint256 wethAmount, uint256 usdcBorrowed);
    event Repaid(address indexed borrower, uint256 usdcRepaid, uint256 wethWithdrawn);
    event Liquidated(
        address indexed borrower,
        address indexed liquidator,
        uint256 collateralSeized,
        uint256 debtCleared
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor(
        address _weth,
        address _usdc,
        address _oracle,
        uint256 _maxLTV,
        uint256 _liquidationLTV,
        uint256 _liquidationBonus
    ) {
        require(_maxLTV < _liquidationLTV, "MarginProtocol: maxLTV must be below liquidationLTV");
        require(_liquidationLTV < 10000,   "MarginProtocol: liquidationLTV must be < 100%");
        weth             = IERC20(_weth);
        usdc             = IERC20(_usdc);
        oracle           = IAMM(_oracle);
        maxLTV           = _maxLTV;
        liquidationLTV   = _liquidationLTV;
        liquidationBonus = _liquidationBonus;
        owner            = msg.sender;
    }

    // ── Owner helpers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "MarginProtocol: not owner");
        _;
    }

    /// @notice Seed USDC reserves so borrowers have liquidity to borrow against.
    ///         Called by ContractRegistry fund[] after deployment.
    function seed(uint256 amount) external onlyOwner {
        require(usdc.transferFrom(msg.sender, address(this), amount), "seed failed");
    }

    /// @notice Owner-only: open a position on behalf of an arbitrary address.
    ///         Used by ChallengeRunner to pre-seed bot positions without needing
    ///         individual bot approvals.
    function openPositionFor(
        address borrower,
        uint256 wethAmount,
        uint256 usdcToBorrow
    ) external onlyOwner {
        _openPosition(borrower, wethAmount, usdcToBorrow, true);
    }

    // ── Public interface ──────────────────────────────────────────────────────

    /// @notice Deposit WETH collateral and borrow USDC in one call.
    /// @param wethAmount   Amount of WETH to deposit (18 dec).
    /// @param usdcToBorrow Amount of USDC to borrow   (6  dec).
    function depositAndBorrow(uint256 wethAmount, uint256 usdcToBorrow) external {
        _openPosition(msg.sender, wethAmount, usdcToBorrow, false);
    }

    /// @notice Repay USDC debt and withdraw WETH collateral.
    /// @param usdcToRepay      USDC to return (6 dec). Use type(uint256).max to repay all.
    /// @param wethToWithdraw   WETH to reclaim (18 dec). Use type(uint256).max to take all.
    function repayAndWithdraw(uint256 usdcToRepay, uint256 wethToWithdraw) external {
        Position storage pos = positions[msg.sender];
        require(pos.active, "MarginProtocol: no active position");

        // Repay
        uint256 repaying = usdcToRepay == type(uint256).max ? pos.debt : usdcToRepay;
        if (repaying > pos.debt) repaying = pos.debt;
        if (repaying > 0) {
            require(usdc.transferFrom(msg.sender, address(this), repaying), "repay failed");
            pos.debt -= repaying;
        }

        // Withdraw
        uint256 withdrawing = wethToWithdraw == type(uint256).max ? pos.collateral : wethToWithdraw;
        if (withdrawing > pos.collateral) withdrawing = pos.collateral;
        if (withdrawing > 0) {
            // After withdrawal, check LTV still safe (if debt remains)
            if (pos.debt > 0) {
                uint256 newCollateral = pos.collateral - withdrawing;
                uint256 ltv = _computeLTV(newCollateral, pos.debt);
                require(ltv <= maxLTV, "MarginProtocol: withdrawal would breach maxLTV");
            }
            pos.collateral -= withdrawing;
            require(weth.transfer(msg.sender, withdrawing), "weth withdraw failed");
        }

        if (pos.collateral == 0 && pos.debt == 0) {
            pos.active = false;
        }

        emit Repaid(msg.sender, repaying, withdrawing);
    }

    /// @notice Liquidate an underwater position.
    ///         Caller must repay the position's full USDC debt.
    ///         Caller receives all the WETH collateral (debt repaid + liquidation bonus).
    /// @param borrower Address of the position to liquidate.
    function liquidate(address borrower) external {
        Position storage pos = positions[borrower];
        require(pos.active,      "MarginProtocol: no active position");
        require(pos.debt > 0,    "MarginProtocol: position has no debt");

        uint256 ltv = _computeLTV(pos.collateral, pos.debt);
        require(ltv > liquidationLTV, "MarginProtocol: position not liquidatable");

        uint256 debt       = pos.debt;
        uint256 collateral = pos.collateral;

        // Clear the position
        pos.debt       = 0;
        pos.collateral = 0;
        pos.active     = false;

        // Liquidator repays the debt
        require(usdc.transferFrom(msg.sender, address(this), debt), "liquidate: repay failed");

        // Liquidator receives entire collateral (implicitly includes bonus because
        // collateral > debt value; the bonus is realised as the spread).
        require(weth.transfer(msg.sender, collateral), "liquidate: weth transfer failed");

        emit Liquidated(borrower, msg.sender, collateral, debt);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    /// @notice Current LTV of a position in basis points (e.g. 8000 = 80%).
    ///         Returns 0 for positions with no debt or no collateral.
    function getLTV(address borrower) external view returns (uint256) {
        Position storage pos = positions[borrower];
        if (!pos.active || pos.collateral == 0 || pos.debt == 0) return 0;
        return _computeLTV(pos.collateral, pos.debt);
    }

    /// @notice Spot USDC price of 1 WETH from oracle reserves (6-decimal precision).
    ///         e.g. 2000_000000 means $2000/WETH.
    function getPrice() public view returns (uint256) {
        return _getPrice();
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _openPosition(
        address borrower,
        uint256 wethAmount,
        uint256 usdcToBorrow,
        bool ownerMode        // if true, pull WETH from owner not borrower
    ) internal {
        require(!positions[borrower].active, "MarginProtocol: position already open");
        require(wethAmount > 0, "MarginProtocol: zero collateral");

        // Pull WETH collateral
        address wethSource = ownerMode ? owner : borrower;
        require(weth.transferFrom(wethSource, address(this), wethAmount), "weth transfer failed");

        // Check LTV before borrow
        if (usdcToBorrow > 0) {
            uint256 ltv = _computeLTV(wethAmount, usdcToBorrow);
            require(ltv <= maxLTV, "MarginProtocol: exceeds maxLTV");
            require(usdcToBorrow <= usdc.balanceOf(address(this)), "MarginProtocol: insufficient USDC reserves");
            require(usdc.transfer(borrower, usdcToBorrow), "usdc transfer failed");
        }

        positions[borrower] = Position({
            collateral: wethAmount,
            debt:       usdcToBorrow,
            active:     true
        });

        emit Deposited(borrower, wethAmount, usdcToBorrow);
    }

    /// @notice LTV in bps: (debt_in_usdc / collateral_value_in_usdc) * 10000
    function _computeLTV(uint256 collateral, uint256 debt) internal view returns (uint256) {
        if (collateral == 0) return type(uint256).max;
        uint256 price = _getPrice(); // USDC per WETH, 6-decimal precision
        // collateralValue = collateral (18 dec) * price (6 dec) / 1e18  → 6 dec
        uint256 collateralValue = collateral * price / 1e18;
        if (collateralValue == 0) return type(uint256).max;
        return debt * 10000 / collateralValue;
    }

    /// @notice Read USDC-per-WETH spot price from oracle pool.
    ///         Result has 6 decimal places (same as USDC).
    function _getPrice() internal view returns (uint256) {
        (uint112 r0, uint112 r1,) = oracle.getReserves();
        address t0  = oracle.token0();
        uint8   d0  = IERC20(t0).decimals();
        address t1  = oracle.token1();
        uint8   d1  = IERC20(t1).decimals();

        bool wethIsT0 = (t0 == address(weth));
        uint256 rWeth = wethIsT0 ? uint256(r0) : uint256(r1);
        uint256 rUsdc = wethIsT0 ? uint256(r1) : uint256(r0);
        uint8   dWeth = wethIsT0 ? d0 : d1;
        uint8   dUsdc = wethIsT0 ? d1 : d0;

        if (rWeth == 0) return 0;
        // price = (rUsdc / 10^dUsdc) / (rWeth / 10^dWeth) expressed with 6 decimal places
        // = rUsdc * 10^dWeth * 10^6 / (rWeth * 10^dUsdc)
        return rUsdc * (10 ** dWeth) * (10 ** 6) / (rWeth * (10 ** dUsdc));
    }
}
