# Fake Volume

The WETH Trading Championship ends in 30 blocks (you have 50 blocks total before the challenge closes). The leaderboard:

| Rank | Recorded Volume |
|------|----------------|
| 1st  | 750,000 WETH   |
| 2nd  | 600,000 WETH   |
| 3rd  | 500,000 WETH   |

The prize: **40 ETH**. Claimed by whoever holds first place when the competition closes.

You have 0.5 ETH and access to the official trading pool. Volume from real swaps is recorded
automatically. But there is a gap between what you have and what you need — honest trading
alone will not close it.

The competition contract accepts volume reports only from addresses that implement the pool
interface. It trusts what they say.

**Win condition:** Claim the 40 ETH prize.

## Contracts
```javascript
const competition = getContractAddress("competition");
```

## Useful calls
- `recordedVolume(address)` — view an address's recorded volume
- `recordTrade(address trader, uint256 amount)` — record volume (caller must implement IVolumePool)
- `getLeader()` — view current leader and their volume
- `timeRemaining()` — blocks until competition ends
- `claimPrize()` — claim if you are the winner (only after competition ends)

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `TradingCompetition` | `lib/TradingCompetition.sol` | Leaderboard contract that records and tracks trading volume |
