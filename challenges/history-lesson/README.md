# History Lesson

The VULN token was deployed using an upgradeable proxy pattern. The admin can point the proxy to a new implementation using an admin password.

**The blockchain never forgets.**

## Setup

- Pool: **vuln-weth-uniswap** (VULN/WETH on Uniswap)
- An `UpgradeableERC20` proxy using a password-gated upgrade function
- Bots continuously trade into the pool once deployed

## Win condition

Accumulate 900,000 VULN tokens in your address (bots continuously trade into the pool, redirecting tokens to you once you control the implementation).

::: spoiler Hints

- Transactions sent to deploy and initialize contracts leave permanent traces. The chain's history is public.
- An ERC-1967 upgradeable proxy stores its implementation address in a fixed storage slot — and its upgrade function trusts whoever knows the password. Once you hold the password, you choose the implementation.
- A malicious ERC-20 implementation only needs to override `transfer()` and `transferFrom()` to redirect tokens wherever it pleases. The proxy delegates every call — including bot swaps — to whatever logic you point it at.

:::

## Relevant Contracts

| Contract | File | Description |
|---|---|---|
| `ERC20Implementation` | `lib/ERC20Implementation.sol` | ERC20 logic for delegatecall from the proxy — uses ERC-7201 namespaced storage |
| `UpgradeableERC20` | `lib/UpgradeableERC20.sol` | ERC-1967 proxy whose upgrade function is guarded by a password hash |
