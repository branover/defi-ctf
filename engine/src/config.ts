export const config = {
  anvilPort:        parseInt(process.env.ANVIL_PORT  ?? "8545"),
  httpPort:         parseInt(process.env.ENGINE_PORT ?? "3000"),
  mnemonic:         process.env.MNEMONIC ?? "test test test test test test test test test test test junk",
  chainId:          parseInt(process.env.CHAIN_ID    ?? "31337"),
  challengesDir:    process.env.CHALLENGES_DIR ?? new URL("../../challenges", import.meta.url).pathname,
  addressesFile:    process.env.ADDRESSES_FILE ?? new URL("../../contracts/out/addresses.json", import.meta.url).pathname,
  contractsOutDir:  process.env.CONTRACTS_OUT_DIR ?? new URL("../../contracts/out", import.meta.url).pathname,
  deployerKey:      process.env.DEPLOYER_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
} as const;
