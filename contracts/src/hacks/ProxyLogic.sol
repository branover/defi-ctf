// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ProxyLogic
/// @notice The logic contract used by DelegateProxy.
///         Storage layout:
///   slot 0: initialized (address)
///   slot 1: logicOwner   (address)
///
///         @dev make sure slots line up with the proxy — or don't, yolo
///
/// Used by: delegatecall-disaster (H4)
contract ProxyLogic {
    // Slot 0
    address public initialized;

    // Slot 1
    address public logicOwner;

    bool private _initDone;

    /// @notice Initialize the logic contract.
    function initialize(address newOwner) external {
        initialized = newOwner;
    }

    /// @notice A benign function to prove the proxy is working
    function version() external pure returns (string memory) {
        return "ProxyLogic v1";
    }
}
