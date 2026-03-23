/**
 * Sieve Scoring Engine — Pure Functions
 *
 * Five signals, each 0-100.
 * Weighted composite produces the Demand Authenticity Score (DAS).
 */

export const WEIGHTS = {
  funderConcentration: 0.25,
  buyerIndependence: 0.25,
  timingDistribution: 0.20,
  circularFlow: 0.20,
  humanAttestation: 0.10,
};

/**
 * Signal 1: Funder Concentration (25%)
 * HHI of buyer funding sources. Single funder = 0, all unique = ~100.
 *
 * @param {Record<string, string[]>} fundingSources - clientWallet → [funderAddresses]
 * @param {Object} [flags] - { disperseContracts: Set, providerWallet: string }
 * @returns {{ value: number, evidence: string }}
 */
export function scoreFunderConcentration(fundingSources, flags = {}) {
  const wallets = Object.keys(fundingSources);
  if (wallets.length === 0) return { value: 50, evidence: "No client wallets to analyze" };

  // Map each client to its primary funder (first/largest)
  const primaryFunders = {};
  for (const [client, funders] of Object.entries(fundingSources)) {
    primaryFunders[client] = funders[0] || "unknown";
  }

  // Count clients per funder
  const funderCounts = {};
  for (const funder of Object.values(primaryFunders)) {
    const key = funder.toLowerCase();
    funderCounts[key] = (funderCounts[key] || 0) + 1;
  }

  const total = wallets.length;
  const uniqueFunders = Object.keys(funderCounts).length;

  // HHI: sum of (share)^2 for each funder
  let hhi = 0;
  for (const count of Object.values(funderCounts)) {
    const share = count / total;
    hhi += share * share;
  }

  // HHI = 1.0 means perfect concentration (one funder), HHI = 1/N means perfectly distributed
  // Score = (1 - HHI) * 100, but normalize so that 1/N → 100 and 1.0 → 0
  let score = Math.round((1 - hhi) * 100);

  // Flag known Disperse contracts
  let disperseDetected = false;
  if (flags.disperseContracts) {
    for (const funder of Object.keys(funderCounts)) {
      if (flags.disperseContracts.has(funder.toLowerCase())) {
        disperseDetected = true;
        score = Math.min(score, 15);
      }
    }
  }

  // Flag provider self-funding
  let selfFunding = false;
  if (flags.providerWallet) {
    const providerKey = flags.providerWallet.toLowerCase();
    if (funderCounts[providerKey]) {
      selfFunding = true;
      const selfFundedShare = funderCounts[providerKey] / total;
      if (selfFundedShare > 0.3) score = Math.min(score, 10);
    }
  }

  // If >50% share same funder, cap score
  const maxShare = Math.max(...Object.values(funderCounts)) / total;
  if (maxShare > 0.5) score = Math.min(score, 15);

  score = Math.max(0, Math.min(100, score));

  const topFunder = Object.entries(funderCounts).sort((a, b) => b[1] - a[1])[0];
  let evidence = `${uniqueFunders} unique funders for ${total} clients. Top funder: ${topFunder[1]}/${total} clients (${(topFunder[1]/total*100).toFixed(0)}%)`;
  if (disperseDetected) evidence += ". Disperse contract detected";
  if (selfFunding) evidence += ". Provider self-funding detected";

  return { value: score, evidence };
}

/**
 * Signal 2: Buyer Independence (25%)
 *
 * Two-layer analysis:
 *   Layer A: What % of buyers transact with providers other than this one?
 *   Layer B (Jaccard): Do all these clients interact with the SAME set of others?
 *            High overlap = coordinated farming across multiple targets.
 *
 * Also: if funderConcentrationScore < 20 (shared funding source), cap at 20.
 * Wallets batch-funded from a single source cannot be "independent."
 *
 * @param {Record<string, string[]>} clientTransfers - clientWallet → [recipientAddresses they've sent USDC to]
 * @param {string} providerWallet - The agent being scored
 * @param {Object} [opts]
 * @param {number} [opts.funderConcentrationScore] - Score from signal 1, for the cap
 * @returns {{ value: number, evidence: string }}
 */
export function scoreBuyerIndependence(clientTransfers, providerWallet, opts = {}) {
  const clients = Object.keys(clientTransfers);
  if (clients.length === 0) return { value: 50, evidence: "No client transfer data" };

  const providerKey = providerWallet.toLowerCase();

  // ── Layer A: basic independence rate ──
  let independentCount = 0;
  const clientDestSets = []; // for Jaccard

  for (const [client, recipients] of Object.entries(clientTransfers)) {
    const otherRecipients = new Set(
      recipients.filter(r => r.toLowerCase() !== providerKey).map(r => r.toLowerCase())
    );
    if (otherRecipients.size > 0) independentCount++;
    clientDestSets.push(otherRecipients);
  }

  const independenceRate = independentCount / clients.length;
  let baseScore = Math.round(independenceRate * 100);

  // ── Layer B: Jaccard similarity of outbound destination sets ──
  // If clients all send to the same providers, they're coordinated.
  // Sample pairs to keep it O(n) not O(n^2).
  let avgJaccard = 0;
  let jaccardEvidence = "";

  const setsWithDests = clientDestSets.filter(s => s.size > 0);
  if (setsWithDests.length >= 10) {
    let totalSim = 0;
    let pairCount = 0;
    const sampleSize = Math.min(setsWithDests.length, 100);

    for (let i = 0; i < sampleSize; i++) {
      // Compare each to 3 random others
      for (let k = 0; k < 3; k++) {
        const j = (i + 1 + Math.floor(Math.random() * (sampleSize - 1))) % sampleSize;
        if (i === j) continue;
        const a = setsWithDests[i];
        const b = setsWithDests[j];
        const intersection = [...a].filter(x => b.has(x)).length;
        const union = new Set([...a, ...b]).size;
        if (union > 0) {
          totalSim += intersection / union;
          pairCount++;
        }
      }
    }

    avgJaccard = pairCount > 0 ? totalSim / pairCount : 0;

    // High Jaccard = coordinated. Penalize the score.
    // avgJaccard > 0.7 → all moving in lockstep → cap at 10
    // avgJaccard 0.4-0.7 → suspicious overlap → reduce score
    // avgJaccard < 0.4 → genuinely diverse
    if (avgJaccard > 0.7) {
      baseScore = Math.min(baseScore, 10);
      jaccardEvidence = `Coordinated: avg Jaccard similarity ${(avgJaccard * 100).toFixed(0)}% — clients share same destination set`;
    } else if (avgJaccard > 0.4) {
      const penalty = Math.round(((avgJaccard - 0.4) / 0.3) * 60);
      baseScore = Math.max(0, baseScore - penalty);
      jaccardEvidence = `Moderate overlap: avg Jaccard ${(avgJaccard * 100).toFixed(0)}%`;
    } else {
      jaccardEvidence = `Diverse destinations: avg Jaccard ${(avgJaccard * 100).toFixed(0)}%`;
    }
  }

  // ── Cap: shared funder → cannot be independent ──
  let funderCap = false;
  if (opts.funderConcentrationScore != null && opts.funderConcentrationScore < 20) {
    baseScore = Math.min(baseScore, 20);
    funderCap = true;
  }

  const score = Math.max(0, Math.min(100, baseScore));

  let evidence = `${independentCount}/${clients.length} clients transact with other providers`;
  if (jaccardEvidence) evidence += `. ${jaccardEvidence}`;
  if (funderCap) evidence += `. Capped: shared funding source overrides outbound diversity`;

  return { value: score, evidence };
}

/**
 * Signal 3: Timing Distribution (20%)
 * Pure CV (coefficient of variation) of inter-arrival times.
 * Measures REGULARITY, not speed. Fast automated responses are fine —
 * mechanical precision (constant intervals) is the sybil signal.
 *
 *   CV < 0.15 → score 0-20  (bot: one-job-per-block at 12s intervals)
 *   CV 0.15-0.5 → score 20-60  (suspicious: low variance)
 *   CV > 0.5 → score 60-100  (organic: high variance, natural patterns)
 *
 * @param {number[]} gaps - Inter-arrival times in seconds
 * @returns {{ value: number, evidence: string }}
 */
export function scoreTimingDistribution(gaps) {
  if (!gaps || gaps.length < 10) return { value: 50, evidence: "Insufficient timing data" };

  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((s, t) => s + (t - mean) ** 2, 0) / gaps.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;

  let score;
  if (cv < 0.15) {
    // Mechanical precision — bot territory
    score = Math.round((cv / 0.15) * 20);
  } else if (cv < 0.5) {
    // Suspicious — low variance but not perfectly regular
    score = Math.round(20 + ((cv - 0.15) / 0.35) * 40);
  } else {
    // Organic — high variance, natural patterns
    score = Math.round(60 + Math.min(40, ((cv - 0.5) / 0.5) * 40));
  }

  score = Math.max(0, Math.min(100, score));

  return {
    value: score,
    evidence: `CV=${cv.toFixed(2)}, avg=${mean.toFixed(1)}s, stddev=${stdDev.toFixed(1)}s, min=${Math.min(...gaps).toFixed(1)}s, max=${Math.max(...gaps).toFixed(1)}s`,
  };
}

/**
 * Signal 4: Circular Flow Detection (20%)
 * What % of clients were funded by the provider, its owner, or a batch-funding contract?
 *
 * Checks three layers:
 *   1. Direct: funder === provider wallet
 *   2. Owner: funder === agent's ownerAddress (from leaderboard)
 *   3. Contract intermediary: funder is a contract (Disperse, etc.) that batch-funds clients
 *      → if a contract funds >30% of clients, treat those as circular
 *
 * @param {Record<string, string[]>} clientFunders - clientWallet → [funderAddresses]
 * @param {string} providerWallet
 * @param {Object} [opts]
 * @param {string} [opts.ownerAddress] - Agent owner from leaderboard
 * @param {Record<string, { isContract: boolean, name?: string }>} [opts.funderInfo] - Funder metadata
 * @returns {{ value: number, evidence: string }}
 */
export function scoreCircularFlow(clientFunders, providerWallet, opts = {}) {
  const clients = Object.keys(clientFunders);
  if (clients.length === 0) return { value: 50, evidence: "No client funding data" };

  const providerKey = providerWallet.toLowerCase();
  const ownerKey = opts.ownerAddress?.toLowerCase();
  const funderInfo = opts.funderInfo || {};

  // Count how many clients each funder sources
  const funderClientCount = {};
  for (const [client, funders] of Object.entries(clientFunders)) {
    for (const f of funders) {
      const key = f.toLowerCase();
      funderClientCount[key] = (funderClientCount[key] || 0) + 1;
    }
  }

  // Identify suspicious funders: provider, owner, or high-concentration contracts
  const suspiciousFunders = new Set();
  const reasons = [];

  // Direct provider funding
  if (funderClientCount[providerKey]) {
    suspiciousFunders.add(providerKey);
    reasons.push(`provider wallet funds ${funderClientCount[providerKey]} clients`);
  }

  // Owner funding
  if (ownerKey && funderClientCount[ownerKey]) {
    suspiciousFunders.add(ownerKey);
    reasons.push(`owner wallet funds ${funderClientCount[ownerKey]} clients`);
  }

  // Contract intermediaries: any contract that funds >30% of clients
  for (const [funder, count] of Object.entries(funderClientCount)) {
    const share = count / clients.length;
    const info = funderInfo[funder];
    if (info?.isContract && share > 0.3) {
      suspiciousFunders.add(funder);
      const name = info.name || "unknown contract";
      reasons.push(`${name} (contract) funds ${count}/${clients.length} clients (${(share*100).toFixed(0)}%)`);
    }
  }

  // Count clients funded by any suspicious source
  let circularCount = 0;
  for (const [client, funders] of Object.entries(clientFunders)) {
    const fundersLower = funders.map(f => f.toLowerCase());
    if (fundersLower.some(f => suspiciousFunders.has(f))) {
      circularCount++;
    }
  }

  const circularRate = circularCount / clients.length;
  const score = Math.max(0, Math.min(100, Math.round((1 - circularRate) * 100)));

  const evidence = circularCount > 0
    ? `${circularCount}/${clients.length} clients funded via suspicious sources (${(circularRate*100).toFixed(0)}% circular). ${reasons.join("; ")}`
    : `${circularCount}/${clients.length} clients funded by provider/owner/contracts (0% circular)`;

  return { value: score, evidence };
}

/**
 * Signal 5: Human Attestation (10%)
 * Stub — returns 0 for all agents. Would check World ID in production.
 *
 * @returns {{ value: number, evidence: string }}
 */
export function scoreHumanAttestation() {
  return { value: 0, evidence: "Not implemented — World ID integration pending" };
}

/**
 * Composite DAS from 5 signal values.
 * @param {Record<string, number>} signals - { funderConcentration, buyerIndependence, timingDistribution, circularFlow, humanAttestation }
 * @returns {number} 0-100
 */
export function computeDAS(signals) {
  const das = Math.round(
    signals.funderConcentration * WEIGHTS.funderConcentration +
    signals.buyerIndependence * WEIGHTS.buyerIndependence +
    signals.timingDistribution * WEIGHTS.timingDistribution +
    signals.circularFlow * WEIGHTS.circularFlow +
    signals.humanAttestation * WEIGHTS.humanAttestation
  );
  return Math.max(0, Math.min(100, das));
}
