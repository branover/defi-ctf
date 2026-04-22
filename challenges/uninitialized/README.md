# Uninitialized

A WETH vault was deployed using an upgradeable proxy — but the proxy was deployed in a hurry. Some setup steps were left for later — and later never came.

## Win condition

Drain the vault WETH balance below 1 WETH.

::: spoiler Hints

- Check the deployment carefully. The chain's history is public.
- An ERC-7201 upgradeable proxy that skips its initializer call leaves ownership up for grabs — anyone who calls `initialize()` first becomes the owner.
- Once you own the proxy, you can point it at any implementation you like. A replacement vault logic contract only needs one useful function: move the WETH out.

:::

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `VaultImplementation` | `lib/VaultImplementation.sol` | Vault logic contract using ERC-7201 namespaced storage — deployed as the implementation behind the proxy |
| `UninitializedProxy` | `lib/UninitializedProxy.sol` | ERC-1967 proxy contract |
