// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title VaultImplementation
/// @notice Manages WETH deposits and withdrawals behind a UninitializedProxy.
///         Uses ERC-7201 namespaced storage to avoid slot collisions with the proxy.
contract VaultImplementation {
    // ERC-7201 storage slot: keccak256("vault.main") - 1
    bytes32 private constant VAULT_STORAGE_LOCATION =
        0x7b7b59a1a8f5b4d5e0c0e5a3b8f5d4a3e2c1b0a9f8e7d6c5b4a3029181716150;

    struct VaultStorage {
        bool initialized;
        address weth;
        uint256 totalDeposits;
    }

    function _getStorage() internal pure returns (VaultStorage storage $) {
        assembly { $.slot := VAULT_STORAGE_LOCATION }
    }

    /// @notice Initialize the vault with the WETH token address.
    ///         This is only called directly on the implementation — the proxy
    ///         never calls this (the proxy deliberately leaves owner unset).
    function initialize(address _weth) external {
        VaultStorage storage $ = _getStorage();
        require(!$.initialized, "Already initialized");
        $.initialized = true;
        $.weth        = _weth;
    }

    function deposit(uint256 amount) external {
        VaultStorage storage $ = _getStorage();
        require($.weth != address(0), "Not initialized");
        IERC20($.weth).transfer(address(this), amount);
        $.totalDeposits += amount;
    }

    function withdraw(uint256 amount) external {
        VaultStorage storage $ = _getStorage();
        require($.weth != address(0), "Not initialized");
        IERC20($.weth).transfer(msg.sender, amount);
        $.totalDeposits -= amount;
    }

    function drain(address to) external {
        VaultStorage storage $ = _getStorage();
        require($.weth != address(0), "Not initialized");
        uint256 bal = IERC20($.weth).balanceOf(address(this));
        IERC20($.weth).transfer(to, bal);
    }

    function balance() external view returns (uint256) {
        VaultStorage storage $ = _getStorage();
        if ($.weth == address(0)) return 0;
        return IERC20($.weth).balanceOf(address(this));
    }

    function weth() external view returns (address) {
        return _getStorage().weth;
    }
}
