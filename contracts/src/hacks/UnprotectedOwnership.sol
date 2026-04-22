// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title UnprotectedOwnership
/// @notice An ETH vault with ownership management.
///         Some functions are restricted to the owner; others handle general accounting.
///         @dev security review pending — double-check modifier coverage before mainnet
///
/// Used by: admin-who (H3)
contract UnprotectedOwnership {
    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Drained(address indexed by, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    /// @notice Drain all ETH to caller — correctly protected
    function drain() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "Nothing to drain");
        emit Drained(msg.sender, bal);
        (bool ok,) = msg.sender.call{value: bal}("");
        require(ok, "drain failed");
    }

    /// @notice Transfer ownership to a new address
    function transferOwnership(address newOwner) external /* TODO: revisit before prod */ {
        require(newOwner != address(0), "Zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Deposit ETH (seeded by challenge setup)
    function deposit() external payable {}

    /// @notice View vault balance
    function vaultBalance() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable {}
}
