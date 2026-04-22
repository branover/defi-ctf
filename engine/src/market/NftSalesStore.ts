/**
 * NftSalesStore — in-memory store for NFT sale events.
 *
 * Imported by WSServer (to record sales on nft_buy success) and
 * httpServer (to serve GET /api/nft/:contractId/sales).
 *
 * Keyed by contractId so different challenges don't mix their history.
 * Cleared on challenge stop.
 */

export interface NftSaleRecord {
  tokenId:   string;
  price:     string;  // WETH, human-readable (e.g. "0.5")
  seller?:   string;
  buyer:     string;  // buyer wallet address
  txHash?:   string;
  block?:    number;
  timestamp: number;  // unix ms
}

const _store = new Map<string, NftSaleRecord[]>();

/** Record a completed sale for a given marketplace contract. */
export function recordSale(contractId: string, record: NftSaleRecord): void {
  let list = _store.get(contractId);
  if (!list) { list = []; _store.set(contractId, list); }
  list.unshift(record);
  // Keep at most 200 entries per contract
  if (list.length > 200) list.pop();
}

/** Return all sales for a contract, newest first. */
export function getSales(contractId: string): NftSaleRecord[] {
  return _store.get(contractId) ?? [];
}

/** Clear sales for a contract (call on challenge stop). */
export function clearSales(contractId: string): void {
  _store.delete(contractId);
}

/** Clear all sales (full reset). */
export function clearAllSales(): void {
  _store.clear();
}
