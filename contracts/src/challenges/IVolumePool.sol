// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Interface that pool contracts must implement to report volume to a TradingCompetition.
interface IVolumePool {
    /// @notice Returns the pool type identifier.
    ///         Must equal bytes4(keccak256("DEFI_CTF_VOLUME_POOL_V1")).
    function POOL_TYPE() external view returns (bytes4);

    /// @notice The first token in this pool.
    function token0() external view returns (address);

    /// @notice The second token in this pool.
    function token1() external view returns (address);
}
