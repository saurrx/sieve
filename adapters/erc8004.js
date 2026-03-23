/**
 * ERC-8004 (8004scan) API adapter
 * Cross-references agent identity and reputation data.
 */

const API = {
  search: (q) =>
    `https://www.8004scan.io/api/v1/agents?search=${encodeURIComponent(q)}&sort_by=total_score&sort_order=desc&limit=5&offset=0&is_testnet=false&is_registered=true`,
  stats: (chain, tokenId) =>
    `https://www.8004scan.io/api/v1/stats/agents/${chain}/${tokenId}`,
};

/**
 * Search for an agent on 8004scan by name or wallet.
 * @param {string} query
 * @returns {Promise<Object|null>} Agent data or null
 */
export async function searchAgent(query) {
  try {
    const res = await fetch(API.search(query));
    if (!res.ok) return null;
    const json = await res.json();
    return json.items?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Get detailed stats for an ERC-8004 registered agent.
 * @param {string|number} chainId
 * @param {string|number} tokenId
 * @returns {Promise<Object|null>}
 */
export async function getStats(chainId, tokenId) {
  try {
    const res = await fetch(API.stats(chainId, tokenId));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
