// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IVolumePool.sol";

/// @notice A trading volume competition. Whoever accumulates the most recorded
/// WETH trading volume by competitionEnd claims the prize.
///
/// Volume is reported by pool contracts via recordTrade(). The contract verifies
/// that msg.sender implements IVolumePool.
/// @dev pool registry — keeping it lean for v1, can tighten later
contract TradingCompetition {
    bytes4 public constant REQUIRED_POOL_TYPE =
        bytes4(keccak256("DEFI_CTF_VOLUME_POOL_V1"));

    address public owner;
    uint256 public competitionEnd;
    uint256 public prizePool;
    bool    public prizeClaimed;

    mapping(address => uint256) public recordedVolume;
    address[] public participants;
    mapping(address => bool) public isParticipant;

    event TradeRecorded(address indexed pool, address indexed trader, uint256 amount);
    event PrizeClaimed(address indexed winner, uint256 amount);

    constructor(uint256 durationBlocks) payable {
        owner = msg.sender;
        competitionEnd = block.number + durationBlocks;
        prizePool = msg.value;
    }

    /// @notice Record trading volume for a participant.
    /// @dev msg.sender must implement IVolumePool and return REQUIRED_POOL_TYPE.
    /// @param trader  The address whose volume to credit.
    /// @param amount  The WETH-equivalent volume to record.
    function recordTrade(address trader, uint256 amount) external {
        require(block.number <= competitionEnd, "Competition has ended");
        require(amount > 0, "Amount must be positive");

        // verify caller is a pool — belt and suspenders
        bytes4 poolType;
        try IVolumePool(msg.sender).POOL_TYPE() returns (bytes4 t) {
            poolType = t;
        } catch {
            revert("Caller does not implement IVolumePool");
        }
        require(poolType == REQUIRED_POOL_TYPE, "Unrecognized pool type");

        if (!isParticipant[trader]) {
            isParticipant[trader] = true;
            participants.push(trader);
        }
        recordedVolume[trader] += amount;
        emit TradeRecorded(msg.sender, trader, amount);
    }

    /// @notice Owner-only: seed initial volumes (simulates pre-competition trading history).
    function seedVolume(address[] calldata traders, uint256[] calldata amounts) external {
        require(msg.sender == owner, "Not owner");
        require(traders.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < traders.length; i++) {
            if (!isParticipant[traders[i]]) {
                isParticipant[traders[i]] = true;
                participants.push(traders[i]);
            }
            recordedVolume[traders[i]] += amounts[i];
        }
    }

    /// @notice Claim the prize if you are the current leader after competition ends.
    function claimPrize() external {
        require(block.number > competitionEnd, "Competition not ended yet");
        require(!prizeClaimed, "Prize already claimed");

        address winner;
        uint256 highest;
        for (uint256 i = 0; i < participants.length; i++) {
            if (recordedVolume[participants[i]] > highest) {
                highest = recordedVolume[participants[i]];
                winner = participants[i];
            }
        }
        require(winner != address(0), "No participants");
        require(msg.sender == winner, "Not the winner");

        prizeClaimed = true;
        emit PrizeClaimed(winner, prizePool);
        (bool ok,) = payable(winner).call{value: prizePool}("");
        require(ok, "Transfer failed");
    }

    function getLeader() external view returns (address leader, uint256 volume) {
        for (uint256 i = 0; i < participants.length; i++) {
            if (recordedVolume[participants[i]] > volume) {
                volume = recordedVolume[participants[i]];
                leader = participants[i];
            }
        }
    }

    function timeRemaining() external view returns (uint256 blocks) {
        if (block.number >= competitionEnd) return 0;
        return competitionEnd - block.number;
    }

    receive() external payable {}
}
