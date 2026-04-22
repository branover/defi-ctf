import { ethers } from "ethers";

const SOLD_ABI = [
  "event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price)",
];

export interface NftMarketplaceSaleApi {
  tokenId:       string;
  price:         string;
  seller:        string;
  buyer:         string;
  sellerLabel:   string;
  buyerLabel:    string;
  txHash:        string;
  blockNumber:   number;
  timestamp:     number;
}

function labelForAddress(book: Record<string, string> | undefined, addr: string): string {
  const n = book?.[addr.toLowerCase()];
  if (n) return n;
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * All `Sold` events from a marketplace contract (player, bots, and any other buyer).
 */
export async function fetchNftMarketplaceSalesWithLabels(
  provider: ethers.Provider,
  marketplaceAddress: string,
  fromBlock: number,
  toBlock: number,
  addressBook: Record<string, string> | undefined,
): Promise<NftMarketplaceSaleApi[]> {
  if (fromBlock > toBlock) return [];

  const iface = new ethers.Interface(SOLD_ABI);
  const c       = new ethers.Contract(marketplaceAddress, iface, provider);
  const logs    = await c.queryFilter(c.filters.Sold(), fromBlock, toBlock);
  const blockTs = new Map<number, number>();
  const out: NftMarketplaceSaleApi[] = [];

  for (const log of logs) {
    let parsed: ethers.LogDescription | null = null;
    try {
      parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
    } catch { continue; }
    if (!parsed || parsed.name !== "Sold") continue;
    const tokenId = parsed.args.tokenId as bigint;
    const seller  = parsed.args.seller as string;
    const buyer   = parsed.args.buyer as string;
    const price   = parsed.args.price as bigint;
    const bn = Number(log.blockNumber ?? 0);
    let ts = blockTs.get(bn);
    if (ts === undefined) {
      const blk = await provider.getBlock(bn);
      ts = blk ? Number(blk.timestamp) * 1000 : Date.now();
      blockTs.set(bn, ts);
    }
    out.push({
      tokenId:     tokenId.toString(),
      price:       ethers.formatEther(price),
      seller,
      buyer,
      sellerLabel: labelForAddress(addressBook, seller),
      buyerLabel:  labelForAddress(addressBook, buyer),
      txHash:      log.transactionHash,
      blockNumber: bn,
      timestamp:   ts,
    });
  }

  out.sort((a, b) => {
    if (b.blockNumber !== a.blockNumber) return b.blockNumber - a.blockNumber;
    return b.txHash.localeCompare(a.txHash);
  });
  return out;
}
