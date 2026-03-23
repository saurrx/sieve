import { describe, test, expect } from "vitest";
import {
  scoreFunderConcentration,
  scoreBuyerIndependence,
  scoreTimingDistribution,
  scoreCircularFlow,
  scoreHumanAttestation,
  computeDAS,
} from "../engine/scorer.js";

// ═══ Signal 1: Funder Concentration ═══════════════════════════════

describe("scoreFunderConcentration", () => {
  test("single funder for all clients → near 0", () => {
    const sources = {};
    for (let i = 0; i < 100; i++) sources[`wallet_${i}`] = ["0xSameFunder"];
    const result = scoreFunderConcentration(sources);
    expect(result.value).toBe(0);
  });

  test("all unique funders → high score", () => {
    const sources = {};
    for (let i = 0; i < 100; i++) sources[`wallet_${i}`] = [`0xFunder_${i}`];
    const result = scoreFunderConcentration(sources);
    expect(result.value).toBeGreaterThan(95);
  });

  test("50% concentrated → capped at 15", () => {
    const sources = {};
    for (let i = 0; i < 60; i++) sources[`wallet_${i}`] = ["0xMainFunder"];
    for (let i = 60; i < 100; i++) sources[`wallet_${i}`] = [`0xOther_${i}`];
    const result = scoreFunderConcentration(sources);
    expect(result.value).toBeLessThanOrEqual(15);
  });

  test("provider self-funding detected", () => {
    const sources = {};
    for (let i = 0; i < 50; i++) sources[`wallet_${i}`] = ["0xProvider"];
    for (let i = 50; i < 100; i++) sources[`wallet_${i}`] = [`0xOther_${i}`];
    const result = scoreFunderConcentration(sources, { providerWallet: "0xProvider" });
    expect(result.value).toBeLessThanOrEqual(10);
    expect(result.evidence).toContain("self-funding");
  });

  test("empty input → neutral 50", () => {
    const result = scoreFunderConcentration({});
    expect(result.value).toBe(50);
  });
});

// ═══ Signal 2: Buyer Independence ═════════════════════════════════

describe("scoreBuyerIndependence", () => {
  test("all clients transact with only this provider → 0", () => {
    const transfers = {};
    for (let i = 0; i < 100; i++) transfers[`wallet_${i}`] = ["0xProvider"];
    const result = scoreBuyerIndependence(transfers, "0xProvider");
    expect(result.value).toBe(0);
  });

  test("all clients transact with DIVERSE other providers → high", () => {
    const transfers = {};
    for (let i = 0; i < 100; i++) transfers[`wallet_${i}`] = ["0xProvider", `0xUnique_${i}`];
    const result = scoreBuyerIndependence(transfers, "0xProvider");
    expect(result.value).toBeGreaterThan(70);
  });

  test("all clients transact with the SAME other providers → low (Jaccard)", () => {
    // Sybil pattern: 100 wallets all sending to the same 3 targets
    const transfers = {};
    for (let i = 0; i < 100; i++) {
      transfers[`wallet_${i}`] = ["0xProvider", "0xTarget_A", "0xTarget_B", "0xTarget_C"];
    }
    const result = scoreBuyerIndependence(transfers, "0xProvider");
    expect(result.value).toBeLessThanOrEqual(10);
    expect(result.evidence).toContain("Jaccard");
  });

  test("shared funder caps independence at 20", () => {
    const transfers = {};
    for (let i = 0; i < 100; i++) transfers[`wallet_${i}`] = ["0xProvider", `0xOther_${i}`];
    const result = scoreBuyerIndependence(transfers, "0xProvider", { funderConcentrationScore: 5 });
    expect(result.value).toBeLessThanOrEqual(20);
    expect(result.evidence).toContain("Capped");
  });

  test("high funder score does not cap independence", () => {
    const transfers = {};
    for (let i = 0; i < 100; i++) transfers[`wallet_${i}`] = ["0xProvider", `0xOther_${i}`];
    const result = scoreBuyerIndependence(transfers, "0xProvider", { funderConcentrationScore: 80 });
    expect(result.value).toBeGreaterThan(70);
  });

  test("empty input → neutral 50", () => {
    const result = scoreBuyerIndependence({}, "0xProvider");
    expect(result.value).toBe(50);
  });
});

// ═══ Signal 3: Timing Distribution ════════════════════════════════

describe("scoreTimingDistribution", () => {
  test("constant 12s intervals (bot, CV≈0) → low score", () => {
    const gaps = Array(100).fill(12);
    const result = scoreTimingDistribution(gaps);
    expect(result.value).toBeLessThan(5); // CV ≈ 0
  });

  test("near-constant with tiny noise (CV≈0.08) → low score", () => {
    // Simulates one-per-block with ±1s jitter
    const gaps = Array(100).fill(0).map(() => 12 + (Math.random() * 2 - 1));
    const result = scoreTimingDistribution(gaps);
    expect(result.value).toBeLessThan(15);
  });

  test("high variance gaps (organic, CV>0.5) → high score", () => {
    // Mix of fast responses and long waits — natural agent pattern
    const gaps = [];
    for (let i = 0; i < 100; i++) {
      gaps.push(5 + (i % 7) * 30 + (i % 3) * 60); // range: 5-215s
    }
    const result = scoreTimingDistribution(gaps);
    expect(result.value).toBeGreaterThan(50);
  });

  test("fast but varied responses (CV>0.5) → passes", () => {
    // Agent responds in 5-45s — fast but with natural variance
    const gaps = [];
    for (let i = 0; i < 100; i++) {
      gaps.push(5 + (i % 13) * 3.5 + (i % 5) * 2);
    }
    const result = scoreTimingDistribution(gaps);
    expect(result.value).toBeGreaterThan(30);
  });

  test("insufficient data → neutral 50", () => {
    const result = scoreTimingDistribution([10, 20, 30]);
    expect(result.value).toBe(50);
  });
});

// ═══ Signal 4: Circular Flow ══════════════════════════════════════

describe("scoreCircularFlow", () => {
  test("all clients funded by provider → 0", () => {
    const clientFunders = {};
    for (let i = 0; i < 50; i++) clientFunders[`wallet_${i}`] = ["0xProvider"];
    const result = scoreCircularFlow(clientFunders, "0xProvider");
    expect(result.value).toBe(0);
  });

  test("no clients funded by provider → 100", () => {
    const clientFunders = {};
    for (let i = 0; i < 50; i++) clientFunders[`wallet_${i}`] = [`0xRandomFunder_${i}`];
    const result = scoreCircularFlow(clientFunders, "0xProvider");
    expect(result.value).toBe(100);
  });

  test("owner funding detected via opts", () => {
    const clientFunders = {};
    for (let i = 0; i < 50; i++) clientFunders[`wallet_${i}`] = ["0xOwner"];
    const result = scoreCircularFlow(clientFunders, "0xProvider", { ownerAddress: "0xOwner" });
    expect(result.value).toBe(0);
    expect(result.evidence).toContain("100% circular");
  });

  test("Disperse contract funding >30% → flagged as circular", () => {
    const clientFunders = {};
    for (let i = 0; i < 40; i++) clientFunders[`wallet_${i}`] = ["0xDisperse"];
    for (let i = 40; i < 50; i++) clientFunders[`wallet_${i}`] = [`0xOther_${i}`];
    const funderInfo = { "0xdisperse": { isContract: true, name: "Disperse" } };
    const result = scoreCircularFlow(clientFunders, "0xProvider", { funderInfo });
    expect(result.value).toBeLessThanOrEqual(20);
    expect(result.evidence).toContain("Disperse");
  });

  test("contract funding <30% → not flagged", () => {
    const clientFunders = {};
    for (let i = 0; i < 10; i++) clientFunders[`wallet_${i}`] = ["0xContract"];
    for (let i = 10; i < 50; i++) clientFunders[`wallet_${i}`] = [`0xOther_${i}`];
    const funderInfo = { "0xcontract": { isContract: true, name: "SomeContract" } };
    const result = scoreCircularFlow(clientFunders, "0xProvider", { funderInfo });
    expect(result.value).toBe(100); // Below 30% threshold, not flagged
  });

  test("empty input → neutral 50", () => {
    const result = scoreCircularFlow({}, "0xProvider");
    expect(result.value).toBe(50);
  });
});

// ═══ Signal 5: Human Attestation ══════════════════════════════════

describe("scoreHumanAttestation", () => {
  test("always returns 0 (stub)", () => {
    const result = scoreHumanAttestation();
    expect(result.value).toBe(0);
    expect(result.evidence).toContain("Not implemented");
  });
});

// ═══ Composite DAS ════════════════════════════════════════════════

describe("computeDAS", () => {
  test("Hyperbet-like signals → BLOCK (<50)", () => {
    const das = computeDAS({
      funderConcentration: 5,
      buyerIndependence: 2,
      timingDistribution: 8,
      circularFlow: 10,
      humanAttestation: 0,
    });
    expect(das).toBeLessThan(50);
    expect(das).toBeGreaterThanOrEqual(0);
  });

  test("organic agent signals → PASS (>50)", () => {
    const das = computeDAS({
      funderConcentration: 85,
      buyerIndependence: 70,
      timingDistribution: 90,
      circularFlow: 95,
      humanAttestation: 0,
    });
    expect(das).toBeGreaterThan(50);
  });

  test("all zeros → 0", () => {
    const das = computeDAS({
      funderConcentration: 0,
      buyerIndependence: 0,
      timingDistribution: 0,
      circularFlow: 0,
      humanAttestation: 0,
    });
    expect(das).toBe(0);
  });

  test("all 100 → 100", () => {
    const das = computeDAS({
      funderConcentration: 100,
      buyerIndependence: 100,
      timingDistribution: 100,
      circularFlow: 100,
      humanAttestation: 100,
    });
    expect(das).toBe(100);
  });

  test("clamped to 0-100 range", () => {
    const das = computeDAS({
      funderConcentration: 150,
      buyerIndependence: 150,
      timingDistribution: 150,
      circularFlow: 150,
      humanAttestation: 150,
    });
    expect(das).toBeLessThanOrEqual(100);
  });
});
