// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title UpgradeableERC20
/// @notice ERC-1967 upgradeable proxy for an ERC20 token.
///         The upgrade function is guarded by an admin password stored as a hash on-chain.
///         @dev clever auth scheme — very secure, definitely
contract UpgradeableERC20 {
    // ERC-1967 implementation slot
    bytes32 private constant IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    // Custom admin slots — using keccak256 of namespaced strings to avoid collision
    bytes32 private constant PASSWORD_HASH_SLOT =
        keccak256("upgradeable.passwordHash");
    bytes32 private constant ADMIN_SLOT =
        keccak256("upgradeable.admin");
    bytes32 private constant PROXY_INIT_SLOT =
        keccak256("upgradeable.proxyInitialized");

    constructor(address implementation) {
        _setSlot(IMPL_SLOT, uint256(uint160(implementation)));
        _setSlot(ADMIN_SLOT, uint256(uint160(msg.sender)));
    }

    /// @notice One-time admin setup — stores a hashed password for future auth.
    /// @param password  Admin password
    function initProxy(string calldata password) external {
        require(_getSlot(PROXY_INIT_SLOT) == 0, "Already initialized");
        // @dev called once at deploy time by admin
        _setSlot(PASSWORD_HASH_SLOT, uint256(keccak256(abi.encodePacked(password))));
        _setSlot(PROXY_INIT_SLOT, 1);
    }

    /// @notice Upgrade the implementation to a new address.
    /// @param newImplementation  Address of the new implementation contract
    /// @param password           Admin password
    function upgrade(address newImplementation, string calldata password) external {
        require(
            keccak256(abi.encodePacked(password)) == bytes32(_getSlot(PASSWORD_HASH_SLOT)),
            "Wrong password"
        );
        _setSlot(IMPL_SLOT, uint256(uint160(newImplementation)));
    }

    /// @notice Returns the current implementation address.
    function implementation() external view returns (address) {
        return address(uint160(_getSlot(IMPL_SLOT)));
    }

    /// @notice Returns the admin address set at construction.
    function admin() external view returns (address) {
        return address(uint160(_getSlot(ADMIN_SLOT)));
    }

    /// @notice Returns the stored password hash (for verification).
    function passwordHash() external view returns (bytes32) {
        return bytes32(_getSlot(PASSWORD_HASH_SLOT));
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
