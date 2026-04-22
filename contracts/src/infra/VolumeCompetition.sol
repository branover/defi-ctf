// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAMM {
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
}

/// @title VolumeCompetition
/// @notice Tracks per-address trading volume (self-reported via recordSwap).
///         Distributes a prize pool to the address with highest volume when claimPrize() is called.
///
/// Used by: the-wash
contract VolumeCompetition {
    address public immutable admin;
    uint256 public immutable endBlock;  // competition runs until this block
    uint256 public prize;               // ETH prize loaded at setup

    mapping(address => uint256) public volume;  // raw token units traded
    address public leader;
    uint256 public leadVolume;

    bool public claimed;

    event VolumeRecorded(address indexed trader, uint256 amount, uint256 totalVolume);
    event PrizeClaimed(address indexed winner, uint256 amount);

    constructor(uint256 blockDuration) {
        admin    = msg.sender;
        endBlock = block.number + blockDuration;
    }

    /// @notice Seed the prize pool with ETH
    receive() external payable {
        prize += msg.value;
    }

    /// @notice Record a trading volume contribution.
    ///         Called by the player in each block after executing swaps.
    ///         `amount` should be the USDC (or token1) amount swapped in that transaction.
    ///         The contract does not verify this on-chain — kept simple for v1.
    ///
    ///         In a real scenario this would be done via a hook or event listener.
    function recordVolume(uint256 amount) external {
        require(block.number <= endBlock, "Competition ended");
        volume[msg.sender] += amount;
        if (volume[msg.sender] > leadVolume) {
            leadVolume = volume[msg.sender];
            leader     = msg.sender;
        }
        emit VolumeRecorded(msg.sender, amount, volume[msg.sender]);
    }

    /// @notice Claim the prize. Must be called after endBlock by the leader.
    function claimPrize() external {
        require(block.number > endBlock, "Competition not ended");
        require(!claimed,                "Prize already claimed");
        require(msg.sender == leader,    "Not the leader");
        claimed = true;
        uint256 payout = address(this).balance;
        emit PrizeClaimed(msg.sender, payout);
        (bool ok,) = msg.sender.call{value: payout}("");
        require(ok, "Prize transfer failed");
    }

    /// @notice View: how much prize ETH is loaded
    function prizeAmount() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice View: blocks remaining in the competition
    function blocksRemaining() external view returns (uint256) {
        if (block.number >= endBlock) return 0;
        return endBlock - block.number;
    }
}
