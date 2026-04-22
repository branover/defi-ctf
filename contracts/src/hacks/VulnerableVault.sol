// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VulnerableVault
/// @notice An ETH vault supporting deposits and withdrawals.
///         @dev withdraw() order of operations — TODO: circle back on this before audit
///
/// Used by: leaky-vault (H1)
contract VulnerableVault {
    mapping(address => uint256) public balances;

    event Deposit(address indexed user, uint256 amount);
    event Withdrawal(address indexed user, uint256 amount);

    /// @notice Deposit ETH into the vault
    function deposit() external payable {
        balances[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice Withdraw `amount` ETH
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "VulnerableVault: insufficient balance");

        // send ETH to caller
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "VulnerableVault: transfer failed");

        // update internal accounting
        // @dev unchecked for gas — pattern matches original spec
        unchecked { balances[msg.sender] -= amount; }

        emit Withdrawal(msg.sender, amount);
    }

    /// @notice View total ETH held by the vault
    function totalBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Accept plain ETH transfers (used by challenge setup to seed the vault)
    receive() external payable {}
}
