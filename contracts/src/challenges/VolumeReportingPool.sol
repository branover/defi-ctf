// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IVolumePool.sol";
import "./TradingCompetition.sol";

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice A swap wrapper that reports WETH-equivalent volume to TradingCompetition.
/// Implements IVolumePool so the competition accepts its reports.
contract VolumeReportingPool is IVolumePool {
    bytes4 public constant override POOL_TYPE =
        bytes4(keccak256("DEFI_CTF_VOLUME_POOL_V1"));

    address public override token0;  // WETH
    address public override token1;  // other token
    address public immutable router;
    TradingCompetition public immutable competition;

    constructor(address _token0, address _token1, address _router, address _competition) {
        token0 = _token0;
        token1 = _token1;
        router = _router;
        competition = TradingCompetition(payable(_competition));
    }

    /// @notice Swap tokenIn for tokenOut and record volume in the competition.
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 amountOutMin,
        address to
    ) external returns (uint256 amountOut) {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).approve(router, amountIn);

        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenIn == token0 ? token1 : token0;

        uint256[] memory amounts = IUniswapV2Router(router).swapExactTokensForTokens(
            amountIn, amountOutMin, path, to, block.timestamp + 300
        );
        amountOut = amounts[amounts.length - 1];

        // Record the WETH-equivalent volume
        uint256 wethAmount = tokenIn == token0 ? amountIn : amounts[0];
        competition.recordTrade(msg.sender, wethAmount);
    }
}
