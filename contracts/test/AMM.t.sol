// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/tokens/WETH.sol";
import "../src/tokens/MockERC20.sol";
import "../src/amm/ConstantProductAMM.sol";
import "../src/amm/AMMFactory.sol";

contract AMMTest is Test {
    WETH       public weth;
    MockERC20  public usdc;
    AMMFactory public factory;
    ConstantProductAMM public pool;

    address alice = makeAddr("alice");
    address bob   = makeAddr("bob");

    // Pool-ordered amounts: token0 and token1 depend on address sort
    uint256 WETH_LIQUIDITY = 100 ether;
    uint256 USDC_LIQUIDITY = 300_000e6;

    /// @dev Returns (amount0, amount1) in pool token order
    function _ordered(uint256 wethAmt, uint256 usdcAmt) internal view returns (uint256 a0, uint256 a1) {
        (a0, a1) = pool.token0() == address(weth)
            ? (wethAmt, usdcAmt)
            : (usdcAmt, wethAmt);
    }

    function setUp() public {
        weth    = new WETH();
        usdc    = new MockERC20("USD Coin", "USDC", 6);
        factory = new AMMFactory();

        pool = ConstantProductAMM(factory.createPool(address(weth), address(usdc)));

        // Seed alice with 100 WETH + 300000 USDC
        vm.deal(alice, 200 ether);
        vm.prank(alice);
        weth.deposit{value: 100 ether}();

        usdc.mint(alice, 300_000e6);

        // Approve pool
        vm.startPrank(alice);
        weth.approve(address(pool), type(uint256).max);
        usdc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _seedPool() internal {
        (uint256 a0, uint256 a1) = _ordered(WETH_LIQUIDITY, USDC_LIQUIDITY);
        vm.prank(alice);
        pool.addLiquidity(a0, a1, 0, 0, alice);
    }

    function test_addLiquidity_initial() public {
        (uint256 a0, uint256 a1) = _ordered(WETH_LIQUIDITY, USDC_LIQUIDITY);
        vm.prank(alice);
        (uint256 ra0, uint256 ra1, uint256 shares) = pool.addLiquidity(a0, a1, 0, 0, alice);

        assertGt(shares, 0);
        assertEq(ra0, a0);
        assertEq(ra1, a1);

        (uint112 r0, uint112 r1,) = pool.getReserves();
        assertEq(uint256(r0), a0);
        assertEq(uint256(r1), a1);
    }

    function test_swapExactIn_wethForUsdc() public {
        _seedPool();

        // Bob gets 1 WETH and swaps it
        vm.deal(bob, 2 ether);
        vm.startPrank(bob);
        weth.deposit{value: 1 ether}();
        weth.approve(address(pool), type(uint256).max);

        uint256 usdcBefore = usdc.balanceOf(bob);
        uint256 amountOut = pool.swapExactIn(address(weth), 1 ether, 0, bob);
        uint256 usdcAfter = usdc.balanceOf(bob);
        vm.stopPrank();

        // At 100 WETH : 300000 USDC, 1 WETH ≈ 2970 USDC (after 0.3% fee)
        assertGt(amountOut, 2900e6);
        assertLt(amountOut, 3010e6);
        assertEq(usdcAfter - usdcBefore, amountOut);
    }

    function test_swapExactIn_usdcForWeth() public {
        _seedPool();

        usdc.mint(bob, 3000e6);
        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);

        uint256 wethBefore = weth.balanceOf(bob);
        uint256 amountOut = pool.swapExactIn(address(usdc), 3000e6, 0, bob);
        uint256 wethAfter = weth.balanceOf(bob);
        vm.stopPrank();

        // At 100 WETH : 300000 USDC, 3000 USDC ≈ 0.987 WETH after fee
        assertGt(amountOut, 0.98 ether);
        assertLt(amountOut, 1.00 ether);
        assertEq(wethAfter - wethBefore, amountOut);
    }

    function test_swapSlippage_reverts() public {
        _seedPool();

        vm.deal(bob, 1 ether);
        vm.startPrank(bob);
        weth.deposit{value: 1 ether}();
        weth.approve(address(pool), type(uint256).max);

        vm.expectRevert("AMM: slippage");
        pool.swapExactIn(address(weth), 1 ether, 99999e6, bob); // absurd min
        vm.stopPrank();
    }

    function test_removeLiquidity() public {
        (uint256 a0, uint256 a1) = _ordered(WETH_LIQUIDITY, USDC_LIQUIDITY);
        vm.prank(alice);
        (,, uint256 shares) = pool.addLiquidity(a0, a1, 0, 0, alice);

        uint256 wethBefore = weth.balanceOf(alice);
        uint256 usdcBefore = usdc.balanceOf(alice);

        vm.startPrank(alice);
        pool.removeLiquidity(shares, 0, 0, alice);
        vm.stopPrank();

        // Alice gets back close to what she put in (minus locked minimum)
        assertGt(weth.balanceOf(alice) - wethBefore, 99.9 ether);
        assertGt(usdc.balanceOf(alice) - usdcBefore, 299_900e6);
    }

    function test_getAmountOut_formula() public view {
        // At reserves 100 WETH : 300000 USDC, swap 1 WETH
        // amountOut = (1e18 * 997 * 300000e6) / (100e18 * 1000 + 1e18 * 997)
        uint256 out = pool.getAmountOut(1 ether, 100 ether, 300_000e6);
        // Should be ~2970 USDC
        assertGt(out, 2960e6);
        assertLt(out, 2980e6);
    }

    function test_kInvariant_maintained() public {
        _seedPool();

        (uint112 r0before, uint112 r1before,) = pool.getReserves();
        uint256 kBefore = uint256(r0before) * uint256(r1before);

        vm.deal(bob, 10 ether);
        vm.startPrank(bob);
        weth.deposit{value: 5 ether}();
        weth.approve(address(pool), type(uint256).max);
        pool.swapExactIn(address(weth), 5 ether, 0, bob);
        vm.stopPrank();

        (uint112 r0after, uint112 r1after,) = pool.getReserves();
        uint256 kAfter = uint256(r0after) * uint256(r1after);

        // k should be >= before (fee goes to LPs → k increases slightly)
        assertGe(kAfter, kBefore);
    }

    function test_factory_createPool() public {
        assertEq(factory.allPoolsLength(), 1);
        assertEq(factory.getPool(address(weth), address(usdc)), address(pool));
        assertEq(factory.getPool(address(usdc), address(weth)), address(pool));
    }

    function test_factory_duplicatePool_reverts() public {
        vm.expectRevert("AMMFactory: pool exists");
        factory.createPool(address(weth), address(usdc));
    }
}
