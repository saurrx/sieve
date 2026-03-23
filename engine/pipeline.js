/**
 * Sieve Pipeline — Orchestrator
 *
 * fetch (leaderboard + jobs + client wallets) → trace (blockscout) → score (5 signals)
 */
import * as virtuals from "../adapters/virtuals.js";
import * as agents from "../adapters/agents.js";
import * as blockscout from "../adapters/blockscout.js";
import * as erc8004 from "../adapters/erc8004.js";
import * as cache from "./cache.js";
import * as scorer from "./scorer.js";

/**
 * Full scoring pipeline for a single agent.
 *
 * @param {string} identifier - Wallet, agdpId, virtualId, name, or URL
 * @param {Object} [opts]
 * @param {boolean} [opts.force] - Bypass cache
 * @param {function} [opts.onProgress] - Progress callback (step, detail)
 * @param {Object} [opts.fixtures] - Inject fixture data (for tests)
 * @returns {Promise<Object>} Full score result
 */
export async function scoreAgent(identifier, opts = {}) {
  const start = Date.now();
  const progress = opts.onProgress || (() => {});

  // ── Step 1: Agent Discovery ───────────────────────────────────────
  progress("discovery", "Finding agent in leaderboard...");

  let agentData;
  if (opts.fixtures?.agent) {
    agentData = opts.fixtures.agent;
  } else {
    agentData = await virtuals.findAgent(String(identifier));
    if (!agentData) {
      throw new Error(`Agent not found: ${identifier}`);
    }
  }

  // Check full-result cache (unless forced)
  const scoreCacheKey = `agents/${agentData.agentId}-score`;
  if (!opts.force) {
    const cachedScore = cache.get(scoreCacheKey);
    if (cachedScore) {
      return { ...cachedScore, meta: { ...cachedScore.meta, fromCache: true } };
    }
  }

  // ── Step 2: Job-Log (timestamps + clientIds) ──────────────────────
  progress("jobs", "Fetching job history...");

  let jobs;
  if (opts.fixtures?.jobs) {
    jobs = opts.fixtures.jobs;
  } else {
    jobs = await virtuals.getJobLog(agentData.agentId, 5);
  }

  if (!jobs || jobs.length < 3) {
    return buildResult(agentData, null, null, null, null, start, "low", "Insufficient job data");
  }

  // Extract timing gaps
  const timestamps = jobs.map((j) => new Date(j.createdAt).getTime()).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < timestamps.length; i++) {
    gaps.push((timestamps[i] - timestamps[i - 1]) / 1000);
  }

  // ── Step 3: Resolve Client Wallets ────────────────────────────────
  progress("clients", "Resolving client wallets...");

  const clientIds = [...new Set(jobs.map((j) => j.clientId).filter(Boolean))];

  let clientWalletMap;
  if (opts.fixtures?.clientWallets) {
    clientWalletMap = opts.fixtures.clientWallets;
  } else {
    clientWalletMap = await agents.resolveWallets(clientIds);
  }

  const resolvedWallets = Object.values(clientWalletMap).filter(Boolean);
  if (resolvedWallets.length === 0) {
    return buildResult(agentData, gaps, null, null, null, start, "low", "Could not resolve client wallets");
  }

  // ── Step 4: Fund Tracing (Blockscout) ─────────────────────────────
  progress("tracing", `Tracing funding for ${resolvedWallets.length} wallets...`);

  let traces;
  if (opts.fixtures?.traces) {
    traces = opts.fixtures.traces;
  } else {
    traces = await blockscout.batchTraceFunding(
      resolvedWallets,
      (done, total) => progress("tracing", `Traced ${done}/${total} wallets`)
    );
  }

  // ── Step 4b: Identify suspicious funders (contracts) ──────────────
  progress("scoring", "Analyzing funder addresses...");

  // Collect all unique primary funders across traced clients
  const allFunders = new Set();
  for (const trace of Object.values(traces)) {
    if (trace.funders?.[0]) allFunders.add(trace.funders[0].toLowerCase());
  }

  // For high-concentration funders, check if they're contracts
  const funderClientCount = {};
  for (const trace of Object.values(traces)) {
    const f = trace.funders?.[0]?.toLowerCase();
    if (f) funderClientCount[f] = (funderClientCount[f] || 0) + 1;
  }
  const totalTraced = Object.keys(traces).length;

  const funderInfo = {};
  if (!opts.fixtures?.funderInfo) {
    for (const [funder, count] of Object.entries(funderClientCount)) {
      // Only check funders that source >20% of clients (worth the API call)
      if (count / totalTraced > 0.2) {
        try {
          const isC = await blockscout.isContract(funder);
          if (isC) {
            // Try to get the name
            let name = "unknown contract";
            try {
              const res = await fetch(`https://base.blockscout.com/api/v2/addresses/${funder}`);
              if (res.ok) {
                const data = await res.json();
                if (data.name) name = data.name;
              }
            } catch { /* skip */ }
            funderInfo[funder] = { isContract: true, name };
          }
        } catch { /* skip */ }
      }
    }
  } else {
    Object.assign(funderInfo, opts.fixtures.funderInfo);
  }

  // ── Step 5: Compute Signals ───────────────────────────────────────
  progress("scoring", "Computing demand authenticity signals...");

  // Build funding sources map: clientWallet → [funders]
  const fundingSources = {};
  const clientTransfers = {};
  for (const [addr, trace] of Object.entries(traces)) {
    fundingSources[addr] = trace.funders || [];
    clientTransfers[addr] = trace.outbound || [];
  }

  const providerWallet = agentData.agentWalletAddress || "";
  const ownerAddress = agentData.ownerAddress || "";

  const sig1 = scorer.scoreFunderConcentration(fundingSources, { providerWallet });
  const sig2 = scorer.scoreBuyerIndependence(clientTransfers, providerWallet, { funderConcentrationScore: sig1.value });
  const sig3 = scorer.scoreTimingDistribution(gaps);
  const sig4 = scorer.scoreCircularFlow(fundingSources, providerWallet, { ownerAddress, funderInfo });
  const sig5 = scorer.scoreHumanAttestation();

  const signals = {
    funderConcentration: sig1.value,
    buyerIndependence: sig2.value,
    timingDistribution: sig3.value,
    circularFlow: sig4.value,
    humanAttestation: sig5.value,
  };

  const das = scorer.computeDAS(signals);

  // Confidence level
  const walletsAnalyzed = Object.keys(traces).length;
  let confidence;
  if (walletsAnalyzed >= 50) confidence = "high";
  else if (walletsAnalyzed >= 20) confidence = "medium";
  else confidence = "low";

  // ── Step 5b: ERC-8004 Lookup (non-blocking) ──────────────────────
  let erc8004Data = null;
  if (providerWallet) {
    try {
      erc8004Data = await erc8004.searchAgent(providerWallet);
    } catch { /* skip */ }
  }

  // ── Build result ──────────────────────────────────────────────────
  const result = {
    agent: {
      name: agentData.agentName,
      wallet: agentData.agentWalletAddress,
      agdpId: agentData.agentId,
      virtualId: agentData.virtualAgentId,
      rank: agentData.rank,
      revenue: agentData.totalRevenue,
      buyers: agentData.uniqueBuyerCount,
      jobs: agentData.successfulJobCount,
      successRate: agentData.successRate,
    },
    score: {
      das,
      verdict: das >= 50 ? "PASS" : "BLOCK",
      confidence,
      signals: {
        funderConcentration: { value: sig1.value, weight: 25, evidence: sig1.evidence },
        buyerIndependence: { value: sig2.value, weight: 25, evidence: sig2.evidence },
        timingDistribution: { value: sig3.value, weight: 20, evidence: sig3.evidence },
        circularFlow: { value: sig4.value, weight: 20, evidence: sig4.evidence },
        humanAttestation: { value: sig5.value, weight: 10, evidence: sig5.evidence },
      },
    },
    erc8004: erc8004Data ? {
      tokenId: erc8004Data.token_id,
      chainId: erc8004Data.chain_id,
      totalScore: erc8004Data.total_score,
      totalFeedbacks: erc8004Data.total_feedbacks,
    } : null,
    meta: {
      cachedAt: new Date().toISOString(),
      analysisDurationMs: Date.now() - start,
      clientWalletsAnalyzed: walletsAnalyzed,
      clientWalletsTotal: resolvedWallets.length,
      jobsSampled: jobs.length,
      dataSources: ["virtuals_leaderboard", "virtuals_joblog", "virtuals_agents", "blockscout_traces"],
      fromCache: false,
    },
  };

  // Cache the result
  cache.set(scoreCacheKey, result, cache.TTL.AGENT_JOBS);

  return result;
}

function buildResult(agentData, gaps, fundingSources, clientTransfers, traces, start, confidence, note) {
  // Partial result when we can't do full analysis
  const sig3 = gaps ? scorer.scoreTimingDistribution(gaps) : { value: 50, evidence: note };

  // Use leaderboard-only heuristics for other signals
  const jobsPerBuyer = agentData.uniqueBuyerCount > 0
    ? agentData.successfulJobCount / agentData.uniqueBuyerCount
    : 999;
  const repeatScore = Math.max(0, Math.min(100, Math.round(100 - ((jobsPerBuyer - 3) / 22) * 100)));

  const signals = {
    funderConcentration: repeatScore, // fallback: use repeat rate as proxy
    buyerIndependence: 50,
    timingDistribution: sig3.value,
    circularFlow: 50,
    humanAttestation: 0,
  };

  const das = scorer.computeDAS(signals);

  return {
    agent: {
      name: agentData.agentName,
      wallet: agentData.agentWalletAddress,
      agdpId: agentData.agentId,
      virtualId: agentData.virtualAgentId,
      rank: agentData.rank,
      revenue: agentData.totalRevenue,
      buyers: agentData.uniqueBuyerCount,
      jobs: agentData.successfulJobCount,
      successRate: agentData.successRate,
    },
    score: {
      das,
      verdict: das >= 50 ? "PASS" : "BLOCK",
      confidence,
      signals: {
        funderConcentration: { value: signals.funderConcentration, weight: 25, evidence: `Fallback: ${jobsPerBuyer.toFixed(1)} jobs/buyer` },
        buyerIndependence: { value: 50, weight: 25, evidence: "No wallet data — neutral" },
        timingDistribution: { value: sig3.value, weight: 20, evidence: sig3.evidence },
        circularFlow: { value: 50, weight: 20, evidence: "No wallet data — neutral" },
        humanAttestation: { value: 0, weight: 10, evidence: "Not implemented" },
      },
    },
    erc8004: null,
    meta: {
      cachedAt: new Date().toISOString(),
      analysisDurationMs: Date.now() - start,
      clientWalletsAnalyzed: 0,
      clientWalletsTotal: 0,
      jobsSampled: 0,
      dataSources: ["virtuals_leaderboard"],
      fromCache: false,
      note,
    },
  };
}

/**
 * Score top N agents from the leaderboard.
 * Scores sequentially to avoid rate limiting.
 *
 * @param {number} [n=10]
 * @param {function} [onProgress]
 * @returns {Promise<Array>}
 */
export async function scoreTopAgents(n = 10, onProgress) {
  const lb = await virtuals.getLeaderboard();
  const top = lb.slice(0, n);
  const results = [];

  for (let i = 0; i < top.length; i++) {
    const agent = top[i];
    onProgress?.(`Scoring ${i + 1}/${top.length}: ${agent.agentName}...`);
    try {
      const result = await scoreAgent(String(agent.agentId));
      results.push(result);
    } catch (err) {
      console.error(`Failed to score ${agent.agentName}: ${err.message}`);
      results.push({
        agent: { name: agent.agentName, agdpId: agent.agentId, wallet: agent.agentWalletAddress },
        score: { das: null, verdict: "ERROR", confidence: "none" },
        error: err.message,
      });
    }
  }

  return results;
}
