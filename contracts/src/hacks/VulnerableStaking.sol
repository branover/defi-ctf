// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VulnerableStaking
/// @notice Deposit ETH, then stake it to earn block-based rewards.
///         @dev uint128 chosen for deposit accounting to save gas on the hot path.
///              Should be fine — no one deposits more than 2^128 wei in one go. ¯\_(ツ)_/¯
///
/// Used by: overflow-season
contract VulnerableStaking {
    struct Stake {
        uint256 amount;
        uint256 startBlock;
        bool    active;
    }

    // Pending ETH deposited but not yet staked
    mapping(address => uint256) public deposits;

    // Active stakes
    mapping(address => Stake) public stakes;

    // Conservative reward rate: ~0.01% per block per ETH — audited, safe, boring
    uint256 public constant RATE_PER_BLOCK = 1e14;

    event Deposited(address indexed user, uint256 amount);
    event Staked(address indexed user, uint256 amount, uint256 startBlock);
    event Claimed(address indexed user, uint256 reward);
    event Unstaked(address indexed user, uint256 amount);

    /// @notice Deposit ETH to fund your stake
    function deposit() external payable {
        require(msg.value > 0, "deposit: zero amount");
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Stake `amount` wei from your deposit balance to begin earning rewards
    function stake(uint256 amount) external {
        require(amount > 0, "stake: zero amount");
        require(!stakes[msg.sender].active, "stake: already staked");

        unchecked {
            // Gas-optimized balance check — uint128 handles any realistic deposit amount
            require(
                uint128(deposits[msg.sender]) >= uint128(amount),
                "stake: insufficient deposit"
            );
            // Deduct from deposit balance
            deposits[msg.sender] -= uint128(amount);
        }

        stakes[msg.sender] = Stake(amount, block.number, true);
        emit Staked(msg.sender, amount, block.number);
    }

    /// @notice Claim accumulated staking rewards
    function claimRewards() external {
        Stake storage s = stakes[msg.sender];
        require(s.active, "claimRewards: not staked");

        uint256 elapsed = block.number - s.startBlock;
        uint256 reward  = elapsed * RATE_PER_BLOCK * s.amount / 1e18;
        uint256 payout  = reward > address(this).balance ? address(this).balance : reward;

        s.startBlock = block.number;

        if (payout > 0) {
            (bool ok,) = msg.sender.call{value: payout}("");
            require(ok, "claimRewards: transfer failed");
            emit Claimed(msg.sender, payout);
        }
    }

    /// @notice Unstake and recover principal (capped at available balance)
    function unstake() external {
        Stake storage s = stakes[msg.sender];
        require(s.active, "unstake: not staked");

        uint256 amount = s.amount > address(this).balance
            ? address(this).balance
            : s.amount;

        s.active = false;
        s.amount = 0;

        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "unstake: transfer failed");
        emit Unstaked(msg.sender, amount);
    }

    /// @notice Preview the reward that would be claimable at a given block
    function previewReward(address user, uint256 atBlock) external view returns (uint256) {
        Stake storage s = stakes[user];
        if (!s.active || atBlock <= s.startBlock) return 0;
        uint256 elapsed = atBlock - s.startBlock;
        return elapsed * RATE_PER_BLOCK * s.amount / 1e18;
    }

    receive() external payable {}
}
