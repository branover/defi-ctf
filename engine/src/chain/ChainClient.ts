import { ethers } from "ethers";
import { config } from "../config.js";

export class ChainClient {
  public provider: ethers.JsonRpcProvider;
  private _signers: Map<number, ethers.Wallet> = new Map();

  constructor() {
    this.provider = new ethers.JsonRpcProvider(
      `http://127.0.0.1:${config.anvilPort}`,
      { chainId: config.chainId, name: "local" },
      { staticNetwork: true },
    );
  }

  getSigner(accountIndex: number): ethers.Wallet {
    let signer = this._signers.get(accountIndex);
    if (!signer) {
      const node = ethers.HDNodeWallet.fromPhrase(
        config.mnemonic,
        undefined,
        `m/44'/60'/0'/0/${accountIndex}`,
      );
      signer = new ethers.Wallet(node.privateKey, this.provider);
      this._signers.set(accountIndex, signer);
    }
    return signer;
  }

  /** Convenience: player signer is always account 0 */
  getPlayerSigner(): ethers.Wallet {
    return this.getSigner(0);
  }

  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async getBalance(address: string): Promise<bigint> {
    return this.provider.getBalance(address);
  }

  /** Raw JSON-RPC call */
  async rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    return this.provider.send(method, params) as Promise<T>;
  }
}
