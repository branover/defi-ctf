// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ConstantProductAMM.sol";

/// @title AMM Factory
/// @notice Deploys and tracks ConstantProductAMM pools
contract AMMFactory {
    mapping(address => mapping(address => address)) public getPool;
    address[] public allPools;

    event PoolCreated(address indexed token0, address indexed token1, address pool, uint256 poolIndex);

    function createPool(address tokenA, address tokenB) external returns (address pool) {
        require(tokenA != tokenB, "AMMFactory: identical tokens");
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(t0 != address(0), "AMMFactory: zero address");
        require(getPool[t0][t1] == address(0), "AMMFactory: pool exists");

        pool = address(new ConstantProductAMM(t0, t1));
        getPool[t0][t1] = pool;
        getPool[t1][t0] = pool; // reverse mapping
        allPools.push(pool);

        emit PoolCreated(t0, t1, pool, allPools.length - 1);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
