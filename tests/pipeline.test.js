import { describe, test, expect } from "vitest";
import { scoreAgent } from "../engine/pipeline.js";

// ═══ Integration Tests with Fixtures ══════════════════════════════

const HYPERBET_FIXTURE = {
  agent: {
    agentId: 12381,
    agentName: "Hyperbet",
    agentWalletAddress: "0xdF33B1fD3abA85eA27194222875b80ABe0F5D766",
    virtualAgentId: 42524,
    rank: 3,
    totalRevenue: 15949,
    uniqueBuyerCount: 205,
    successfulJobCount: 5186,
    successRate: 76.4,
    ownerAddress: "0xfaf52b1c29c5c2b0119f0a73c358d7f0f6b1816a",
  },
  jobs: (() => {
    // 250 jobs with 12-second intervals (bot pattern)
    const jobs = [];
    const base = Date.now() - 250 * 12 * 1000;
    const clients = [10915, 10914, 10903, 11200, 11201]; // small pool
    for (let i = 0; i < 250; i++) {
      jobs.push({
        createdAt: new Date(base + i * 12000 + Math.random() * 2000).toISOString(),
        clientId: clients[i % clients.length],
        clientName: `SybilClient_${clients[i % clients.length]}`,
        fee: 3.07,
      });
    }
    return jobs;
  })(),
  clientWallets: {
    10915: "0xAxionWallet1111111111111111111111111111111",
    10914: "0xKairoWallet2222222222222222222222222222222",
    10903: "0xSybil3333333333333333333333333333333333333",
    11200: "0xSybil4444444444444444444444444444444444444",
    11201: "0xSybil5555555555555555555555555555555555555",
  },
  traces: {
    "0xaxionwallet1111111111111111111111111111111": {
      funders: ["0xd15fe25ed0dba1000000000000000000000000000"],
      outbound: ["0xdF33B1fD3abA85eA27194222875b80ABe0F5D766"],
      totalReceived: 5000000000,
      txCount: 3,
    },
    "0xkairowallet2222222222222222222222222222222": {
      funders: ["0xd15fe25ed0dba1000000000000000000000000000"],
      outbound: ["0xdF33B1fD3abA85eA27194222875b80ABe0F5D766"],
      totalReceived: 5000000000,
      txCount: 3,
    },
    "0xsybil3333333333333333333333333333333333333": {
      funders: ["0xd15fe25ed0dba1000000000000000000000000000"],
      outbound: ["0xdF33B1fD3abA85eA27194222875b80ABe0F5D766"],
      totalReceived: 3000000000,
      txCount: 2,
    },
    "0xsybil4444444444444444444444444444444444444": {
      funders: ["0xd15fe25ed0dba1000000000000000000000000000"],
      outbound: ["0xdF33B1fD3abA85eA27194222875b80ABe0F5D766"],
      totalReceived: 2000000000,
      txCount: 1,
    },
    "0xsybil5555555555555555555555555555555555555": {
      funders: ["0xd15fe25ed0dba1000000000000000000000000000"],
      outbound: ["0xdF33B1fD3abA85eA27194222875b80ABe0F5D766"],
      totalReceived: 2000000000,
      txCount: 1,
    },
  },
  funderInfo: {
    "0xd15fe25ed0dba1000000000000000000000000000": { isContract: true, name: "Disperse" },
  },
};

const ORGANIC_FIXTURE = {
  agent: {
    agentId: 8001,
    agentName: "OrganicAgent",
    agentWalletAddress: "0xOrganicProvider00000000000000000000000000",
    virtualAgentId: 99999,
    rank: 15,
    totalRevenue: 25000,
    uniqueBuyerCount: 3000,
    successfulJobCount: 1500,
    successRate: 95.0,
  },
  jobs: (() => {
    const jobs = [];
    const base = Date.now() - 1500 * 120 * 1000;
    let t = base;
    for (let i = 0; i < 250; i++) {
      // Exponential-like gaps (organic)
      t += (30 + Math.abs(Math.sin(i * 0.7) * 300) + (i % 11) * 20) * 1000;
      jobs.push({
        createdAt: new Date(t).toISOString(),
        clientId: 5000 + i, // all unique
        clientName: `Buyer_${5000 + i}`,
        fee: 1.5 + Math.random() * 3,
      });
    }
    return jobs;
  })(),
  clientWallets: (() => {
    const map = {};
    for (let i = 0; i < 250; i++) map[5000 + i] = `0xBuyer${String(i).padStart(36, "0")}0000`;
    return map;
  })(),
  traces: (() => {
    const map = {};
    for (let i = 0; i < 50; i++) {
      const addr = `0xbuyer${String(i).padStart(36, "0")}0000`;
      map[addr] = {
        funders: [`0xUniqueFunder${String(i).padStart(30, "0")}000000`],
        outbound: [`0xOrganicProvider00000000000000000000000000`, `0xOtherProvider${String(i).padStart(26, "0")}00`],
        totalReceived: 1000000000,
        txCount: 5,
      };
    }
    return map;
  })(),
};

describe("pipeline with fixtures", () => {
  test("Hyperbet-like agent → BLOCK with low DAS", async () => {
    const result = await scoreAgent("12381", { fixtures: HYPERBET_FIXTURE, force: true });

    expect(result.agent.name).toBe("Hyperbet");
    expect(result.score.das).toBeLessThan(30);
    expect(result.score.verdict).toBe("BLOCK");
    expect(result.score.confidence).toBeDefined();
    expect(result.meta.clientWalletsAnalyzed).toBe(5);
    expect(result.meta.jobsSampled).toBe(250);
    expect(result.meta.fromCache).toBe(false);
  });

  test("Hyperbet signals show sybil patterns", async () => {
    const result = await scoreAgent("12381", { fixtures: HYPERBET_FIXTURE });
    const signals = result.score.signals;

    // All clients share one funder → low funder concentration
    expect(signals.funderConcentration.value).toBeLessThan(20);
    // All clients only send to provider → low independence
    expect(signals.buyerIndependence.value).toBe(0);
    // 12s intervals → low timing score
    expect(signals.timingDistribution.value).toBeLessThan(30);
  });

  test("organic agent → PASS with high DAS", async () => {
    const result = await scoreAgent("8001", { fixtures: ORGANIC_FIXTURE });

    expect(result.agent.name).toBe("OrganicAgent");
    expect(result.score.das).toBeGreaterThan(50);
    expect(result.score.verdict).toBe("PASS");
  });

  test("organic agent signals show healthy patterns", async () => {
    const result = await scoreAgent("8001", { fixtures: ORGANIC_FIXTURE });
    const signals = result.score.signals;

    // All unique funders → high
    expect(signals.funderConcentration.value).toBeGreaterThan(80);
    // Clients send to multiple providers → high
    expect(signals.buyerIndependence.value).toBe(100);
    // High-variance timing → high
    expect(signals.timingDistribution.value).toBeGreaterThan(30);
    // No circular funding → high
    expect(signals.circularFlow.value).toBe(100);
  });

  test("result has complete structure", async () => {
    const result = await scoreAgent("12381", { fixtures: HYPERBET_FIXTURE });

    // Agent
    expect(result.agent).toHaveProperty("name");
    expect(result.agent).toHaveProperty("wallet");
    expect(result.agent).toHaveProperty("agdpId");
    expect(result.agent).toHaveProperty("revenue");

    // Score
    expect(result.score).toHaveProperty("das");
    expect(result.score).toHaveProperty("verdict");
    expect(result.score).toHaveProperty("confidence");
    expect(result.score.signals).toHaveProperty("funderConcentration");
    expect(result.score.signals.funderConcentration).toHaveProperty("value");
    expect(result.score.signals.funderConcentration).toHaveProperty("weight");
    expect(result.score.signals.funderConcentration).toHaveProperty("evidence");

    // Meta
    expect(result.meta).toHaveProperty("cachedAt");
    expect(result.meta).toHaveProperty("analysisDurationMs");
    expect(result.meta).toHaveProperty("dataSources");
    expect(result.meta.dataSources).toContain("virtuals_leaderboard");
  });
});
