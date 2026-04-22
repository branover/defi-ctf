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

/// @title LendingProtocol
/// @notice Simple collateral lending with a spot price oracle from an AMM pool.
///         LTV: 75% (borrow up to 75% of collateral value in borrow token)
///         @dev oracle integration — TWAP upgrade deferred to v2, should be fine for now
///
/// Used by: spot-the-oracle, tape-painter
contract LendingProtocol {
    IAMM    public immutable oracle;      // AMM pool used as price oracle
    IERC20  public immutable collateral;  // token deposited as collateral (WETH)
    IERC20  public immutable borrowToken; // token borrowed (USDC)

    uint256 public constant LTV_BPS = 7500; // 75%

    mapping(address => uint256) public collateralBalance;
    mapping(address => uint256) public borrowBalance;

    // Total tokens available to lend (seeded by challenge setup)
    uint256 public totalLiquidity;

    event Deposit(address indexed user, uint256 amount);
    event Borrow(address indexed user, uint256 amount);
    event Repay(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);

    constructor(address _oracle, address _collateral, address _borrowToken) {
        oracle      = IAMM(_oracle);
        collateral  = IERC20(_collateral);
        borrowToken = IERC20(_borrowToken);
    }

    /// @notice Seed the protocol with borrowable liquidity (called by setup / deployer)
    function seed(uint256 amount) external {
        require(borrowToken.transferFrom(msg.sender, address(this), amount), "seed failed");
        totalLiquidity += amount;
    }

    /// @notice Deposit collateral (WETH)
    function deposit(uint256 amount) external {
        require(collateral.transferFrom(msg.sender, address(this), amount), "deposit failed");
        collateralBalance[msg.sender] += amount;
        emit Deposit(msg.sender, amount);
    }

    /// @notice Borrow up to 75% of deposited collateral value (in borrow token)
    function borrow(uint256 amount) external {
        uint256 maxBorrow = _maxBorrow(msg.sender);
        require(borrowBalance[msg.sender] + amount <= maxBorrow, "LendingProtocol: exceeds LTV");
        require(amount <= borrowToken.balanceOf(address(this)), "LendingProtocol: insufficient liquidity");
        borrowBalance[msg.sender] += amount;
        require(borrowToken.transfer(msg.sender, amount), "borrow transfer failed");
        emit Borrow(msg.sender, amount);
    }

    /// @notice Repay outstanding borrow
    function repay(uint256 amount) external {
        uint256 owed = borrowBalance[msg.sender];
        uint256 paying = amount > owed ? owed : amount;
        require(borrowToken.transferFrom(msg.sender, address(this), paying), "repay failed");
        borrowBalance[msg.sender] -= paying;
        emit Repay(msg.sender, paying);
    }

    /// @notice Withdraw collateral (only if no outstanding borrow)
    function withdraw(uint256 amount) external {
        require(borrowBalance[msg.sender] == 0, "LendingProtocol: repay first");
        require(collateralBalance[msg.sender] >= amount, "LendingProtocol: insufficient collateral");
        collateralBalance[msg.sender] -= amount;
        require(collateral.transfer(msg.sender, amount), "withdraw failed");
        emit Withdraw(msg.sender, amount);
    }

    // ── View ──────────────────────────────────────────────────────────────────

    /// @notice Max additional borrow for a user given current oracle price
    function maxBorrow(address user) external view returns (uint256) {
        return _maxBorrow(user) - borrowBalance[user];
    }

    /// @notice Current oracle price: how many borrow tokens per collateral token (18-decimal result)
    function oraclePrice() external view returns (uint256) {
        return _getPrice();
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _maxBorrow(address user) internal view returns (uint256) {
        uint256 colAmt = collateralBalance[user];
        if (colAmt == 0) return 0;
        uint256 price = _getPrice(); // borrow-token units per collateral unit (18 dec)
        uint8   colDec = collateral.decimals();
        uint8   borDec = borrowToken.decimals();
        // colValue in borrow token units (adjust for decimals)
        uint256 colValue = colAmt * price / (10 ** 18);
        // Scale for decimal mismatch between collateral and borrow token
        if (borDec > colDec) {
            colValue = colValue * (10 ** (borDec - colDec));
        } else if (colDec > borDec) {
            colValue = colValue / (10 ** (colDec - borDec));
        }
        return colValue * LTV_BPS / 10000;
    }

    /// @notice Spot price from AMM reserves: amount of borrowToken per collateralToken, 18-dec precision.
    function _getPrice() internal view returns (uint256) {
        (uint112 r0, uint112 r1,) = oracle.getReserves();
        address t0 = oracle.token0();
        uint8 dec0 = IERC20(oracle.token0()).decimals();
        uint8 dec1 = IERC20(oracle.token1()).decimals();

        bool colIsT0 = (t0 == address(collateral));
        uint256 rCol = colIsT0 ? uint256(r0) : uint256(r1);
        uint256 rBor = colIsT0 ? uint256(r1) : uint256(r0);
        uint8   dCol = colIsT0 ? dec0 : dec1;
        uint8   dBor = colIsT0 ? dec1 : dec0;

        if (rCol == 0) return 0;
        // price = (rBor / 10^dBor) / (rCol / 10^dCol)  →  rBor * 10^dCol * 10^18 / (rCol * 10^dBor)
        return rBor * (10 ** dCol) * (10 ** 18) / (rCol * (10 ** dBor));
    }
}
