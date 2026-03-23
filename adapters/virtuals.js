/**
 * Virtuals Protocol API adapter
 * - Leaderboard: agent discovery, revenue, buyer counts
 * - Job-log: per-agent job history with timestamps and clientIds
 */
import * as cache from "../engine/cache.js";

const API = {
  leaderboard: "https://api.virtuals.io/api/agdp-leaderboard-epochs/5/ranking?pagination[pageSize]=1000",
  jobLog: (id, page = 1, size = 50) =>
    `https://acpx.virtuals.io/api/agdp/agent/${id}/job-log?pagination[page]=${page}&pagination[pageSize]=${size}`,
};

const DELAY_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch the full leaderboard (up to 1000 agents).
 * Cached for 1 hour.
 * @returns {Promise<Array>} Array of agent objects with agentId, agentName, agentWalletAddress, totalRevenue, uniqueBuyerCount, successfulJobCount, etc.
 */
export async function getLeaderboard() {
  const cached = cache.get("leaderboard");
  if (cached) return cached;

  const res = await fetch(API.leaderboard);
  if (!res.ok) throw new Error(`Leaderboard API ${res.status}: ${res.statusText}`);
  const json = await res.json();
  const data = json.data || [];

  cache.set("leaderboard", data, cache.TTL.LEADERBOARD);
  return data;
}

/**
 * Find an agent in the leaderboard by various identifiers.
 * @param {string} identifier - Virtuals URL, wallet, agdpId, virtualId, or name
 * @returns {Promise<Object|null>}
 */
export async function findAgent(identifier) {
  const lb = await getLeaderboard();
  const val = identifier.trim();

  // URL: app.virtuals.io/virtuals/42524
  const urlMatch = val.match(/virtuals\/(\d+)/);
  if (urlMatch) {
    const vid = urlMatch[1];
    return lb.find((a) => String(a.virtualAgentId) === vid || String(a.virtual?.id) === vid) || null;
  }

  // agdp.io/agent/12381
  const agdpMatch = val.match(/agent\/(\d+)/);
  if (agdpMatch) {
    return lb.find((a) => String(a.agentId) === agdpMatch[1]) || null;
  }

  // Pure number
  if (/^\d+$/.test(val)) {
    return lb.find((a) => String(a.virtualAgentId) === val) ||
           lb.find((a) => String(a.agentId) === val) || null;
  }

  // Wallet address
  if (val.startsWith("0x") && val.length === 42) {
    return lb.find((a) => a.agentWalletAddress?.toLowerCase() === val.toLowerCase()) || null;
  }

  // Name match (case-insensitive)
  return lb.find((a) => a.agentName?.toLowerCase() === val.toLowerCase()) || null;
}

/**
 * Fetch job-log pages for an agent.
 * Cached per agent for 4 hours.
 * @param {number} agdpId
 * @param {number} [pages=5] - Number of pages to fetch (50 jobs each)
 * @returns {Promise<Array>} Array of job objects with createdAt, clientId, clientName, fee, etc.
 */
export async function getJobLog(agdpId, pages = 5) {
  const cacheKey = `agents/${agdpId}-jobs`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const allJobs = [];
  for (let p = 1; p <= pages; p++) {
    try {
      const res = await fetch(API.jobLog(agdpId, p, 50));
      if (!res.ok) break;
      const json = await res.json();
      const data = json.data || [];
      allJobs.push(...data);
      if (data.length < 50) break; // last page
      if (p < pages) await sleep(DELAY_MS);
    } catch {
      break;
    }
  }

  cache.set(cacheKey, allJobs, cache.TTL.AGENT_JOBS);
  return allJobs;
}
