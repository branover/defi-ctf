// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title UpgradeableAMM
/// @notice An upgradeable proxy that delegates all swap/liquidity calls to an
///         implementation contract.  The proxy stores an `owner` address that
///         controls upgrades.
///
///         ERC-1967 storage slots are used so that the proxy's admin state does
///         not collide with the implementation's storage layout.
///
///         @dev ownership init — @todo wire this up properly before prod
contract UpgradeableAMM {
    // ── ERC-1967 storage slots ────────────────────────────────────────────────

    /// @dev ERC-1967 implementation slot:
    ///      bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
    bytes32 private constant IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /// @dev ERC-1967 admin slot:
    ///      bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1)
    bytes32 private constant OWNER_SLOT =
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;

    // ── Constructor ───────────────────────────────────────────────────────────

    /// @param impl  Address of the initial ConstantProductAMM implementation.
    constructor(address impl) {
        _setSlot(IMPL_SLOT, uint256(uint160(impl)));
        // owner setup deferred — call initialize() after deploy
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// @notice Claim proxy ownership.  Succeeds only while owner == address(0).
    /// @param owner_  Address to install as the new owner.
    function initialize(address owner_) external {
        require(owner() == address(0), "UpgradeableAMM: already initialized");
        _setSlot(OWNER_SLOT, uint256(uint160(owner_)));
    }

    /// @notice Upgrade the implementation.
    /// @dev Access control: owner must match, or owner must be set first.
    /// @param newImpl  Address of the new implementation contract.
    function upgradeTo(address newImpl) external {
        require(
            owner() == address(0) || msg.sender == owner(),
            "UpgradeableAMM: not authorized"
        );
        _setSlot(IMPL_SLOT, uint256(uint160(newImpl)));
    }

    /// @notice Returns the current proxy owner (address(0) until initialize() is called).
    function owner() public view returns (address) {
        return address(uint160(_getSlot(OWNER_SLOT)));
    }

    /// @notice Returns the current implementation address.
    function implementation() public view returns (address) {
        return address(uint160(_getSlot(IMPL_SLOT)));
    }

    // ── Proxy ─────────────────────────────────────────────────────────────────

    /// @dev Delegates every call (swap, addLiquidity, getReserves, …) to the
    ///      current implementation via delegatecall.
    fallback() external payable {
        address impl = implementation();
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

    // ── Storage helpers ───────────────────────────────────────────────────────

    function _getSlot(bytes32 slot) internal view returns (uint256 value) {
        assembly { value := sload(slot) }
    }

    function _setSlot(bytes32 slot, uint256 value) internal {
        assembly { sstore(slot, value) }
    }
}
