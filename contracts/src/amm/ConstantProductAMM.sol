// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @title Constant Product AMM
/// @notice x*y=k pool with 0.3% swap fee, Uniswap v2 compatible math
contract ConstantProductAMM {
    address public factory;
    address public token0;
    address public token1;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32  private blockTimestampLast;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    uint256 private constant MINIMUM_LIQUIDITY = 1000;
    bool    private locked;

    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Sync(uint112 reserve0, uint112 reserve1);
    event Transfer(address indexed from, address indexed to, uint256 value);

    modifier lock() {
        require(!locked, "AMM: reentrancy");
        locked = true;
        _;
        locked = false;
    }

    constructor(address _token0, address _token1) {
        factory = msg.sender;
        // Sort tokens deterministically
        (token0, token1) = _token0 < _token1
            ? (_token0, _token1)
            : (_token1, _token0);
    }

    // ── View ──────────────────────────────────────────────────────────────

    function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) {
        _reserve0          = reserve0;
        _reserve1          = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    /// @notice Quote how much tokenOut you get for amountIn (includes 0.3% fee)
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public pure returns (uint256 amountOut)
    {
        require(amountIn > 0,   "AMM: insufficient input");
        require(reserveIn > 0 && reserveOut > 0, "AMM: insufficient liquidity");
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator       = amountInWithFee * reserveOut;
        uint256 denominator     = reserveIn * 1000 + amountInWithFee;
        amountOut = numerator / denominator;
    }

    /// @notice Quote how much tokenIn is needed to get exactly amountOut
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        public pure returns (uint256 amountIn)
    {
        require(amountOut > 0, "AMM: insufficient output");
        require(reserveIn > 0 && reserveOut > 0, "AMM: insufficient liquidity");
        uint256 numerator   = reserveIn * amountOut * 1000;
        uint256 denominator = (reserveOut - amountOut) * 997;
        amountIn = numerator / denominator + 1;
    }

    // ── Mutating ─────────────────────────────────────────────────────────

    /// @notice Swap exact tokenIn for at least minAmountOut of the other token
    function swapExactIn(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address to
    ) external lock returns (uint256 amountOut) {
        require(tokenIn == token0 || tokenIn == token1, "AMM: invalid token");
        bool zeroForOne = tokenIn == token0;
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();

        (uint256 reserveIn, uint256 reserveOut) = zeroForOne
            ? (uint256(_reserve0), uint256(_reserve1))
            : (uint256(_reserve1), uint256(_reserve0));

        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);
        require(amountOut >= minAmountOut, "AMM: slippage");

        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        address tokenOut = zeroForOne ? token1 : token0;
        IERC20(tokenOut).transfer(to, amountOut);

        _update(
            IERC20(token0).balanceOf(address(this)),
            IERC20(token1).balanceOf(address(this))
        );

        emit Swap(
            msg.sender,
            zeroForOne ? amountIn  : 0,
            zeroForOne ? 0         : amountIn,
            zeroForOne ? 0         : amountOut,
            zeroForOne ? amountOut : 0,
            to
        );
    }

    /// @notice Add liquidity; mints LP shares to `to`
    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to
    ) external lock returns (uint256 amount0, uint256 amount1, uint256 shares) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();

        if (_reserve0 == 0 && _reserve1 == 0) {
            (amount0, amount1) = (amount0Desired, amount1Desired);
        } else {
            uint256 amount1Optimal = amount0Desired * uint256(_reserve1) / uint256(_reserve0);
            if (amount1Optimal <= amount1Desired) {
                require(amount1Optimal >= amount1Min, "AMM: insufficient token1");
                (amount0, amount1) = (amount0Desired, amount1Optimal);
            } else {
                uint256 amount0Optimal = amount1Desired * uint256(_reserve0) / uint256(_reserve1);
                require(amount0Optimal <= amount0Desired);
                require(amount0Optimal >= amount0Min, "AMM: insufficient token0");
                (amount0, amount1) = (amount0Optimal, amount1Desired);
            }
        }

        IERC20(token0).transferFrom(msg.sender, address(this), amount0);
        IERC20(token1).transferFrom(msg.sender, address(this), amount1);

        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0) {
            shares = _sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0), MINIMUM_LIQUIDITY); // lock minimum liquidity forever
        } else {
            shares = _min(
                amount0 * _totalSupply / uint256(_reserve0),
                amount1 * _totalSupply / uint256(_reserve1)
            );
        }
        require(shares > 0, "AMM: insufficient shares");
        _mint(to, shares);

        _update(
            IERC20(token0).balanceOf(address(this)),
            IERC20(token1).balanceOf(address(this))
        );

        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Burn LP shares, returns underlying tokens to `to`
    function removeLiquidity(
        uint256 shares,
        uint256 amount0Min,
        uint256 amount1Min,
        address to
    ) external lock returns (uint256 amount0, uint256 amount1) {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 _totalSupply = totalSupply;

        amount0 = shares * balance0 / _totalSupply;
        amount1 = shares * balance1 / _totalSupply;
        require(amount0 >= amount0Min && amount1 >= amount1Min, "AMM: insufficient output");

        _burn(msg.sender, shares);
        IERC20(token0).transfer(to, amount0);
        IERC20(token1).transfer(to, amount1);

        _update(
            IERC20(token0).balanceOf(address(this)),
            IERC20(token1).balanceOf(address(this))
        );

        emit Burn(msg.sender, amount0, amount1, to);
    }

    // ── Internal ──────────────────────────────────────────────────────────

    function _update(uint256 balance0, uint256 balance1) private {
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "AMM: overflow");
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = uint32(block.timestamp);
        emit Sync(reserve0, reserve1);
    }

    function _mint(address to, uint256 value) private {
        totalSupply      += value;
        balanceOf[to]    += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) private {
        require(balanceOf[from] >= value, "AMM: insufficient shares");
        balanceOf[from] -= value;
        totalSupply     -= value;
        emit Transfer(from, address(0), value);
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) { z = x; x = (y / x + x) / 2; }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
