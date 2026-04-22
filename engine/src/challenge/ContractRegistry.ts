import { ethers } from "ethers";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ChainClient } from "../chain/ChainClient.js";
import { config } from "../config.js";

export interface ContractDeploySpec {
  id:               string;
  type:             string;
  params:           (string | number | boolean)[];
  fund?:            { tokenSymbol: string; amount: string }[];
  constructorValue?: string;  // ETH (in ether) to send as msg.value with the constructor
  botVolumes?:      { signerIndex: number; volume: string }[];  // for trading-competition seeding
  tokenSymbol?:     string;  // for upgradeable-erc20: register proxy as this token in the pool registry
}

interface DeployedContract {
  id:      string;
  type:    string;
  address: string;
  abi:     ethers.InterfaceAbi;
}

const ERC20_MINT_ABI = ["function mint(address to, uint256 amount)"];

export class ContractRegistry {
  private contracts = new Map<string, DeployedContract>();

  constructor(private client: ChainClient) {}

  /**
   * Deploy all contracts listed in the manifest's `contracts` array.
   *
   * Placeholder syntax in params:
   *   `{{token:SYMBOL}}`  → resolves to token address (case-insensitive)
   *   `{{pool:poolId}}`   → resolves to AMM pool address
   *   `{{contractId}}`    → resolves to a previously-deployed contract in this registry
   *
   * `fund` entries seed the contract with ETH or minted ERC20 after deployment.
   */
  async deploy(
    specs:           ContractDeploySpec[],
    deployer:        ethers.NonceManager,
    tokenAddresses:  Map<string, string>,
    poolAddresses?:  Map<string, string>,
  ): Promise<void> {
    for (const spec of specs) {
      const artifactPath = join(config.contractsOutDir, `${spec.type}.sol`, `${spec.type}.json`);
      if (!existsSync(artifactPath)) {
        throw new Error(
          `[ContractRegistry] artifact not found: ${artifactPath}\n` +
          `  → Run \`forge build\` inside the contracts/ directory.`,
        );
      }

      const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
      const abi      = artifact.abi as ethers.InterfaceAbi;
      const bytecode = artifact.bytecode?.object as string | undefined;
      if (!bytecode || bytecode === "0x") {
        throw new Error(`[ContractRegistry] no bytecode in artifact: ${spec.type}`);
      }

      // Resolve placeholders in constructor params
      const resolvedParams = (spec.params ?? []).map(p => {
        if (typeof p === "string" && p.startsWith("{{") && p.endsWith("}}")) {
          const ref = p.slice(2, -2);

          if (ref.startsWith("token:")) {
            const sym  = ref.slice(6).toUpperCase();
            const addr = tokenAddresses.get(sym);
            if (!addr) throw new Error(`[ContractRegistry] placeholder ${p}: token "${sym}" not found`);
            return addr;
          }

          if (ref.startsWith("pool:")) {
            const poolId = ref.slice(5);
            const addr   = poolAddresses?.get(poolId);
            if (!addr) throw new Error(`[ContractRegistry] placeholder ${p}: pool "${poolId}" not found`);
            return addr;
          }

          // Default: previously-deployed contract id
          if (!this.contracts.has(ref)) {
            throw new Error(
              `[ContractRegistry] unresolved placeholder "{{${ref}}}" in ${spec.id} params. ` +
              `Deploy "${ref}" before "${spec.id}" in the contracts array.`,
            );
          }
          return this.contracts.get(ref)!.address;
        }
        return p;
      });

      const factory = new ethers.ContractFactory(abi, bytecode, deployer);
      // If the manifest specifies a constructorValue, pass it as msg.value.
      // This supports payable constructors (e.g. TradingCompetition which sets
      // prizePool = msg.value at deployment time).
      const deployOptions = spec.constructorValue
        ? { value: ethers.parseEther(spec.constructorValue) }
        : {};
      const contract = await factory.deploy(...resolvedParams, deployOptions);
      await contract.waitForDeployment();
      const address  = await contract.getAddress();

      this.contracts.set(spec.id, { id: spec.id, type: spec.type, address, abi });
      const valueNote = spec.constructorValue ? ` (with ${spec.constructorValue} ETH)` : "";
      console.log(`[ContractRegistry] deployed ${spec.type} as "${spec.id}" @ ${address}${valueNote}`);

      // Post-deploy: for contracts that need to own ERC20 tokens (mint/burn rights),
      // the deployer must transfer ownership of those tokens to the newly deployed contract.
      // These contracts removed transferOwnership() from their constructors to avoid a
      // msg.sender mismatch (constructor call sets msg.sender to the new contract, not the deployer).
      const TRANSFER_OWNERSHIP_ABI = ["function transferOwnership(address newOwner) external"];
      if (spec.type === "StablecoinIssuer") {
        // params[1] is {{token:USDS}} → the USDS token address
        const usdsAddr = resolvedParams[1] as string;
        const tok = new ethers.Contract(usdsAddr, TRANSFER_OWNERSHIP_ABI, deployer);
        await (await tok.transferOwnership(address)).wait(1);
        console.log(`[ContractRegistry] transferred USDS ownership to ${spec.id} @ ${address}`);
      } else if (spec.type === "AlgorithmicStablecoin") {
        // params[1] is {{token:ALGOS}} → the ALGOS token address
        const algosAddr = resolvedParams[1] as string;
        const tok = new ethers.Contract(algosAddr, TRANSFER_OWNERSHIP_ABI, deployer);
        await (await tok.transferOwnership(address)).wait(1);
        console.log(`[ContractRegistry] transferred ALGOS ownership to ${spec.id} @ ${address}`);
      } else if (spec.type === "MarginProtocol") {
        // MarginProtocol needs to seed USDC — handled via fund[] already.
        // No token ownership needed.
      }

      // Fund contract after deployment
      if (spec.fund) {
        for (const f of spec.fund) {
          if (f.tokenSymbol.toUpperCase() === "ETH") {
            const amount = ethers.parseEther(f.amount);
            const tx = await deployer.sendTransaction({ to: address, value: amount });
            await tx.wait(1);
            console.log(`[ContractRegistry] funded "${spec.id}" with ${f.amount} ETH`);
          } else {
            const tokenAddr = tokenAddresses.get(f.tokenSymbol.toUpperCase());
            if (!tokenAddr) {
              console.warn(`[ContractRegistry] fund: token not found: ${f.tokenSymbol}`);
              continue;
            }
            // Find decimals from token contract
            const tokenContract = new ethers.Contract(
              tokenAddr,
              ["function decimals() view returns (uint8)", ...ERC20_MINT_ABI],
              deployer,
            );
            const decimals = Number(await tokenContract.decimals());
            const amount   = ethers.parseUnits(f.amount, decimals);
            const tx = await tokenContract.mint(address, amount);
            await tx.wait(1);
            console.log(`[ContractRegistry] funded "${spec.id}" with ${f.amount} ${f.tokenSymbol}`);
          }
        }
      }

      // Seed bot volumes for trading-competition contracts.
      // Uses seedVolume() (owner-only) so the deployer can credit initial volumes
      // without needing each bot signer to be a pool contract implementing IVolumePool.
      if (spec.botVolumes && spec.botVolumes.length > 0) {
        const SEED_VOLUME_ABI = [
          "function seedVolume(address[] calldata traders, uint256[] calldata amounts) external",
        ];
        const traders: string[] = [];
        const amounts: bigint[] = [];
        for (const bv of spec.botVolumes) {
          traders.push(await this.client.getSigner(bv.signerIndex).getAddress());
          amounts.push(BigInt(bv.volume));
        }
        const competition = new ethers.Contract(address, SEED_VOLUME_ABI, deployer);
        const tx = await competition.seedVolume(traders, amounts);
        await tx.wait(1);
        console.log(
          `[ContractRegistry] seeded ${traders.length} bot volumes on "${spec.id}" via seedVolume()`,
        );
      }
    }
  }

  /**
   * Register an already-deployed contract (e.g. an upgradeable proxy orchestrated
   * by ChallengeRunner) so it can be retrieved by id like any other contract.
   */
  register(id: string, address: string, abi: ethers.InterfaceAbi, type = "external"): void {
    this.contracts.set(id, { id, type, address, abi });
    console.log(`[ContractRegistry] registered "${id}" (${type}) @ ${address}`);
  }

  /** Returns deployed address. Throws if not found. */
  getAddress(id: string): string {
    const c = this.contracts.get(id);
    if (!c) throw new Error(`[ContractRegistry] no contract deployed with id "${id}"`);
    return c.address;
  }

  /** Returns ABI. Throws if not found. */
  getAbi(id: string): ethers.InterfaceAbi {
    const c = this.contracts.get(id);
    if (!c) throw new Error(`[ContractRegistry] no contract deployed with id "${id}"`);
    return c.abi;
  }

  /** Read-only contract instance (provider-connected). */
  getContract(id: string): ethers.Contract {
    const { address, abi } = this.getContractMeta(id);
    return new ethers.Contract(address, abi, this.client.provider);
  }

  /** Signer-connected contract instance for state-changing calls. */
  getContractWithSigner(id: string, signer: ethers.Signer): ethers.Contract {
    const { address, abi } = this.getContractMeta(id);
    return new ethers.Contract(address, abi, signer);
  }

  /** True when any contracts are deployed (for WinConditionChecker guard). */
  has(id: string): boolean {
    return this.contracts.has(id);
  }

  /** List all deployed contract ids (for debugging). */
  list(): string[] {
    return [...this.contracts.keys()];
  }

  /**
   * Build a map from 4-byte selector (hex, e.g. "0xa9059cbb") to the full
   * human-readable ABI string for every function in every deployed contract.
   *
   * The result can be merged with a set of well-known selectors so the block
   * explorer can decode calldata for challenge-specific contracts as well as
   * common ERC-20/DEX functions.
   */
  buildSelectorMap(): Map<string, string> {
    const map = new Map<string, string>();
    for (const c of this.contracts.values()) {
      try {
        const iface = new ethers.Interface(c.abi);
        for (const fragment of iface.fragments) {
          if (fragment.type !== "function") continue;
          const fn = fragment as ethers.FunctionFragment;
          // Use fn.selector directly to avoid ethers throwing "multiple matches
          // found" when the ABI contains overloaded functions (same name,
          // different parameter types — e.g. safeTransferFrom on ERC-721).
          const selector = fn.selector;
          if (selector) {
            // Store the full ABI string so the decoder can reconstruct an
            // Interface for argument decoding.
            map.set(selector.toLowerCase(), fn.format("full"));
          }
        }
      } catch {
        // Malformed ABI — skip this contract
      }
    }
    return map;
  }

  clear(): void {
    this.contracts.clear();
  }

  private getContractMeta(id: string): DeployedContract {
    const c = this.contracts.get(id);
    if (!c) throw new Error(`[ContractRegistry] no contract deployed with id "${id}"`);
    return c;
  }
}
