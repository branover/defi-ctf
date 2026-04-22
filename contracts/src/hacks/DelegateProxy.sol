// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DelegateProxy
/// @notice A minimal proxy that delegates calls to a logic contract.
///         Storage layout:
///   slot 0: owner   (address)
///   slot 1: balance (uint256)
///
///         @dev storage layout alignment with the logic contract — worth double-checking
///              (left as an exercise, definitely fine though, probably)
///
/// Used by: delegatecall-disaster (H4)
contract DelegateProxy {
    // slot 0
    address public owner;
    // slot 1
    uint256 public balance;

    address public immutable logic;

    event OwnershipTaken(address indexed newOwner);
    event Drained(address indexed by, uint256 amount);

    constructor(address _logic) payable {
        owner   = msg.sender;
        logic   = _logic;
        balance = msg.value;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "DelegateProxy: not owner");
        _;
    }

    /// @notice Drain all ETH — only callable by owner
    function drain() external onlyOwner {
        uint256 bal = address(this).balance;
        require(bal > 0, "Nothing to drain");
        emit Drained(msg.sender, bal);
        (bool ok,) = msg.sender.call{value: bal}("");
        require(ok, "drain failed");
    }

    /// @notice Deposit ETH (used in challenge setup)
    function deposit() external payable {
        balance += msg.value;
    }

    /// @notice Fallback: delegate all unknown calls to the logic contract
    fallback() external payable {
        address _logic = logic;
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), _logic, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {
        balance += msg.value;
    }
}
