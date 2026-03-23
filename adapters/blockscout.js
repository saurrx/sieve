/**
 * Blockscout API adapter (Base mainnet)
 * - Token transfer history for fund tracing
 * - Address info (is_contract check)
 */
import * as cache from "../engine/cache.js";

const BASE_URL = "https://base.blockscout.com/api";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const DELAY_MS = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Get inbound USDC transfers to a wallet (= funding sources).
 * Returns the set of addresses that have sent USDC to this wallet.
 *
 * @param {string} address - Wallet address to trace
 * @returns {Promise<{ funders: string[], totalReceived: number, txCount: number }>}
 */
export async function traceWalletFunding(address) {
  const cacheKey = `wallets/${address.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}?module=account&action=tokentx&address=${address}&page=1&offset=100`;

  let transfers;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Blockscout ${res.status}`);
    const json = await res.json();
    transfers = json.result || [];
  } catch (err) {
    console.error(`Blockscout trace failed for ${address}: ${err.message}`);
    return { funders: [], outbound: [], totalReceived: 0, txCount: 0 };
  }

  // Filter to USDC transfers TO this address (= inbound funding)
  const addrLower = address.toLowerCase();
  const inbound = transfers.filter(
    (tx) => tx.to?.toLowerCase() === addrLower &&
            tx.contractAddress?.toLowerCase() === USDC_BASE.toLowerCase()
  );

  // Unique funders
  const funderCounts = {};
  let totalReceived = 0;
  for (const tx of inbound) {
    const from = tx.from.toLowerCase();
    funderCounts[from] = (funderCounts[from] || 0) + 1;
    totalReceived += parseInt(tx.value || "0", 10);
  }

  // Also get outbound USDC transfers (to check buyer independence)
  const outbound = transfers.filter(
    (tx) => tx.from?.toLowerCase() === addrLower &&
            tx.contractAddress?.toLowerCase() === USDC_BASE.toLowerCase()
  );
  const recipients = [...new Set(outbound.map((tx) => tx.to.toLowerCase()))];

  const result = {
    funders: Object.keys(funderCounts).sort((a, b) => funderCounts[b] - funderCounts[a]),
    outbound: recipients,
    totalReceived,
    txCount: inbound.length,
  };

  cache.set(cacheKey, result, cache.TTL.WALLET_TRACES);
  return result;
}

/**
 * Batch-trace funding for ALL wallets with rate limiting.
 * No sampling — traces every address. Cached wallets return instantly.
 *
 * @param {string[]} addresses - Wallet addresses
 * @param {function} [onProgress] - Optional progress callback (traced, total)
 * @returns {Promise<Record<string, { funders: string[], outbound: string[] }>>}
 */
export async function batchTraceFunding(addresses, onProgress) {
  const results = {};
  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    results[addr.toLowerCase()] = await traceWalletFunding(addr);
    onProgress?.(i + 1, addresses.length);
    // Rate limit only for uncached (traceWalletFunding returns instantly if cached)
    if (i < addresses.length - 1) await sleep(DELAY_MS);
  }

  return results;
}

/**
 * Check if an address is a contract.
 * @param {string} address
 * @returns {Promise<boolean>}
 */
export async function isContract(address) {
  try {
    const res = await fetch(`https://base.blockscout.com/api/v2/addresses/${address}`);
    if (!res.ok) return false;
    const json = await res.json();
    return json.is_contract === true;
  } catch {
    return false;
  }
}
