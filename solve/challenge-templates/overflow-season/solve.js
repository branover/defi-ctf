// Overflow Season
//
// Goal: drain the `staking` contract below 0.1 ETH.
//
// The contract uses a two-step flow:
//   1. deposit() — send ETH into the contract to fund your stake balance
//   2. stake(amount) — lock `amount` wei from your deposit into an active stake
//   3. claimRewards() — collect block rewards proportional to your staked amount
//   4. unstake() — recover your principal
//
// Read the contract source in the Solidity IDE (lib/VulnerableStaking.sol).
// Something about the stake() function looks off.

const id = onBlock(async (ctx) => {
  removeTrigger(id);

  const player = getPlayerAddress();
  const ethBal = await getBalance("ETH");
  ctx.log("ETH balance:", formatEther(ethBal));

  // Step 1: deposit some ETH
  const depositAmt = parseEther("1");
  ctx.log("Depositing", formatEther(depositAmt), "ETH...");
  await execContract("staking", "deposit", [], depositAmt);

  // Step 2: stake from deposit
  // Hint: what happens if `amount` is larger than 2^128?
  const stakeAmt = depositAmt; // ← is this the right value?
  ctx.log("Staking", stakeAmt.toString(), "wei...");
  await execContract("staking", "stake", [stakeAmt]);

  ctx.log("Staked. Waiting for rewards to accrue...");
});

onBlock(async (ctx) => {
  if (ctx.blockNumber < 5) return; // wait a few blocks

  const player = getPlayerAddress();
  const preview = await readContract("staking", "previewReward", [player, ctx.blockNumber]);
  ctx.log(`[${ctx.blockNumber}] Preview reward:`, formatEther(preview), "ETH");

  if (preview > 0n) {
    ctx.log("Claiming rewards...");
    await execContract("staking", "claimRewards", []);

    const ethBal = await getBalance("ETH");
    ctx.log("ETH balance after claim:", formatEther(ethBal));
  }
});

log("Script loaded.");
