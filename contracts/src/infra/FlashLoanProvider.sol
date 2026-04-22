// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IFlashLoanReceiver {
    /// @notice Called by FlashLoanProvider after transferring `amount` tokens.
    /// @param token     The token being borrowed
    /// @param amount    Amount borrowed (pre-fee)
    /// @param fee       Fee that must be repaid on top of `amount`
    /// @param initiator Who called flashLoan()
    /// @param data      Arbitrary data passed through from the initiator
    function onFlashLoan(
        address token,
        uint256 amount,
        uint256 fee,
        address initiator,
        bytes calldata data
    ) external returns (bytes32);
}

/// @title FlashLoanProvider
/// @notice General-purpose flash loan provider.
///         Charges a 0.05% fee (5 bps). Token balance seeded via mint/transfer at challenge setup.
///         Any ERC20 token can be flash-loaned as long as the provider holds enough balance.
///         Repayment is enforced atomically within the same transaction via the onFlashLoan callback.
///
/// Used by: flash-point, spot-the-oracle, governance-storm
contract FlashLoanProvider {
    /// @dev Callback must return this magic value: keccak256("FlashLoanProvider.onFlashLoan")
    bytes32 public constant CALLBACK_SUCCESS = keccak256("FlashLoanProvider.onFlashLoan");

    uint256 public constant FEE_BPS = 5; // 0.05%

    event FlashLoan(address indexed receiver, address indexed token, uint256 amount, uint256 fee);

    /// @notice Borrow `amount` of `token`. Repay `amount + fee` in the callback.
    function flashLoan(
        address receiver,
        address token,
        uint256 amount,
        bytes calldata data
    ) external returns (bool) {
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        require(balBefore >= amount, "FlashLoan: insufficient liquidity");

        uint256 fee = (amount * FEE_BPS + 9999) / 10000; // ceil

        // Transfer tokens to receiver
        require(IERC20(token).transfer(receiver, amount), "FlashLoan: transfer failed");

        // Call receiver
        bytes32 result = IFlashLoanReceiver(receiver).onFlashLoan(
            token, amount, fee, msg.sender, data
        );
        require(result == CALLBACK_SUCCESS, "FlashLoan: invalid callback return");

        // Verify repayment
        uint256 balAfter = IERC20(token).balanceOf(address(this));
        require(balAfter >= balBefore + fee, "FlashLoan: repayment insufficient");

        emit FlashLoan(receiver, token, amount, fee);
        return true;
    }

    /// @notice How much of `token` is available to borrow.
    function maxFlashLoan(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Fee for borrowing `amount` of `token`.
    function flashFee(address, uint256 amount) external pure returns (uint256) {
        return (amount * FEE_BPS + 9999) / 10000;
    }
}
