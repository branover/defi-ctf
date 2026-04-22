// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title UninitializedProxy
/// @notice An upgradeable vault proxy with owner-gated upgrade capability.
///         Call initialize() to set the owner, then upgrade() to change the implementation.
///         @dev ownership setup — @security-review pending, ship it for now
contract UninitializedProxy {
    // ERC-1967 implementation slot
    bytes32 private constant IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    bytes32 private constant OWNER_SLOT =
        keccak256("proxy.owner");

    bytes32 private constant INITIALIZED_SLOT =
        keccak256("proxy.initialized");

    constructor(address implementation) {
        _setSlot(IMPL_SLOT, uint256(uint160(implementation)));
        // setup complete (more or less)
    }

    /// @notice Set the proxy owner. Can only be called once.
    /// @param owner_ Address to set as the new owner
    function initialize(address owner_) external {
        require(_getSlot(INITIALIZED_SLOT) == 0, "Already initialized");
        _setSlot(OWNER_SLOT, uint256(uint160(owner_)));
        _setSlot(INITIALIZED_SLOT, 1);
    }

    /// @notice Upgrade the implementation — only the owner may call this.
    /// @param newImpl  New implementation address
    function upgrade(address newImpl) external {
        require(address(uint160(_getSlot(OWNER_SLOT))) == msg.sender, "Not owner");
        _setSlot(IMPL_SLOT, uint256(uint160(newImpl)));
    }

    /// @notice Returns the current owner.
    function owner() external view returns (address) {
        return address(uint160(_getSlot(OWNER_SLOT)));
    }

    /// @notice Returns the current implementation address.
    function implementation() external view returns (address) {
        return address(uint160(_getSlot(IMPL_SLOT)));
    }

    /// @dev Fallback: delegatecall to the current implementation.
    fallback() external payable {
        address impl = address(uint160(_getSlot(IMPL_SLOT)));
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    receive() external payable {}

    function _getSlot(bytes32 slot) internal view returns (uint256 value) {
        assembly { value := sload(slot) }
    }

    function _setSlot(bytes32 slot, uint256 value) internal {
        assembly { sstore(slot, value) }
    }
}
