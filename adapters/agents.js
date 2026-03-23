/**
 * Virtuals Agents API adapter
 * Batch-resolves agdp clientIds to wallet addresses.
 *
 * Key discovery: acpx.virtuals.io/api/agents supports $in filter:
 *   filters[id][$in][0]=10915&filters[id][$in][1]=10914&pagination[pageSize]=100
 * This cuts 200 individual calls down to 2-3 batch calls.
 */
import * as cache from "../engine/cache.js";

const API_BASE = "https://acpx.virtuals.io/api/agents";
const BATCH_SIZE = 100;
const DELAY_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve a single clientId to its wallet address.
 * @param {number} clientId
 * @returns {Promise<string|null>} wallet address or null
 */
export async function resolveWallet(clientId) {
  const map = await resolveWallets([clientId]);
  return map[clientId] || null;
}

/**
 * Batch-resolve clientIds to wallet addresses.
 * Uses $in filter for efficient batch lookups.
 * Results cached forever (wallet mappings are immutable).
 *
 * @param {number[]} clientIds
 * @returns {Promise<Record<number, string>>} clientId → walletAddress
 */
export async function resolveWallets(clientIds) {
  const result = {};
  const uncached = [];

  // Check cache first
  for (const id of clientIds) {
    const cached = cache.get(`wallets/agent-${id}`);
    if (cached) {
      result[id] = cached;
    } else {
      uncached.push(id);
    }
  }

  if (uncached.length === 0) return result;

  // Batch fetch uncached IDs
  const batches = [];
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    batches.push(uncached.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    try {
      const params = new URLSearchParams();
      batch.forEach((id, idx) => params.append(`filters[id][$in][${idx}]`, id));
      params.append("pagination[pageSize]", "100");

      const url = `${API_BASE}?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`Agents API ${res.status} for batch of ${batch.length}`);
        continue;
      }

      const json = await res.json();
      const agents = json.data || [];

      for (const agent of agents) {
        if (agent.id && agent.walletAddress) {
          result[agent.id] = agent.walletAddress;
          cache.set(`wallets/agent-${agent.id}`, agent.walletAddress, cache.TTL.CLIENT_WALLETS);
        }
      }

      await sleep(DELAY_MS);
    } catch (err) {
      console.error(`Agents API batch error:`, err.message);
    }
  }

  return result;
}

/**
 * Given a list of jobs, extract unique clientIds and resolve all to wallets.
 * @param {Array} jobs - Job objects with clientId field
 * @returns {Promise<Record<number, string>>} clientId → walletAddress
 */
export async function resolveJobClients(jobs) {
  const clientIds = [...new Set(jobs.map((j) => j.clientId).filter(Boolean))];
  return resolveWallets(clientIds);
}
