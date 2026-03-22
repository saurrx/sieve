# ◆ SIEVE — Demand Authenticity Engine for AI Agent Commerce

> **On-chain ≠ real. Sieve proves which agent revenue comes from genuine demand and which is farmed.**

Sieve is the missing trust layer for ERC-8183 agent commerce. It analyzes ACP job data to score every agent's demand authenticity (0-100), separating real independent buyers from sybil farming operations. Think of it as **DeFiLlama for agent legitimacy** or **TrustMRR for agentic GDP**.

## The Problem

Virtuals Protocol's aGDP leaderboard distributes **$1M/month** in incentives based on raw job revenue. But this metric is trivially gameable:

**Case Study: Hyperbet (Virtuals #42524)**

We audited a top-10 leaderboard agent and found:
- **206 buyer wallets**, all funded from a single Disperse contract
- **~$65K** recycled through a closed USDC loop
- **~$13K** paid in protocol fees (20% ACP tax) — net profitable against incentive payouts
- **12-second intervals** — one job per Base block, mechanical precision
- **Zero** buyer wallets had any provider activity — all were single-purpose shells

The aGDP leaderboard counted all of this as legitimate revenue. Nothing detected it.

**This is not an isolated case.** When the incentive payout exceeds the farming cost, rational actors will farm. The leaderboard that the entire ecosystem uses to allocate capital, attention, and rewards is gameable.

## The Solution

Sieve produces two outputs for every agent on ACP:

| Output | Description |
|--------|-------------|
| **Demand Authenticity Score (DAS)** | 0-100 composite from 5 behavioral signals |
| **Verified Revenue** | Dollar amount that passed all authenticity checks |

### Five Scoring Signals

| Signal | Weight | What it measures |
|--------|--------|-----------------|
| Funder Concentration | 25% | HHI of buyer funding sources — flags single-source wallets |
| Buyer Independence | 25% | % of buyers that interact with multiple providers |
| Timing Distribution | 20% | Coefficient of variation of inter-arrival times (bot vs organic) |
| Circular Flow | 20% | Revenue that loops Provider → Buyer → Provider |
| Human Attestation | 10% | % of buyers with World ID or proof-of-human |

### Results on Live Data

| Agent | Raw Revenue | DAS | Verdict | Evidence |
|-------|-------------|-----|---------|----------|
| Hyperbet | $65,000 | **2/100** | BLOCK | 206 sybil buyers, 16s intervals, 95% circular |
| Captain Dackie | $25,000 | **91/100** | PASS | 3064 diverse buyers, organic timing |
| Loopuman | $12,000 | **84/100** | PASS | 150 independent buyers, varied patterns |

## Architecture

Sieve is built on three composable layers from the Ethereum standards stack:

```
┌──────────────────────────────────────────────────────┐
│  Layer 3: ERC-8183 Settlement Hook                    │
│  SieveHook.sol — reads DAS from registry,             │
│  reverts complete() if score < threshold              │
│  → Providers opt-in to signal legitimacy              │
├──────────────────────────────────────────────────────┤
│  Layer 2: ERC-8004 Identity + Proof                   │
│  Cross-references agent identity (106K+ registered)   │
│  with reputation data (feedback, stars)               │
│  → Verified identity enriches scoring                 │
├──────────────────────────────────────────────────────┤
│  Layer 1: ACP Contracts (Data Source)                  │
│  Reads JobCreated, ClaimedProviderFee events           │
│  from ACP V1/V2 on Base mainnet                       │
│  → Raw on-chain job history                            │
└──────────────────────────────────────────────────────┘
```

### How It Works

1. **Scoring Engine** fetches job-level data from ACP contracts (or agdp.io API for the demo)
2. **Five signals** are computed per agent from buyer behavior, timing, and fund flows
3. **DAS score** is written to the **SieveRegistry** (on-chain, public, anyone can read)
4. **SieveHook** (ERC-8183 `IACPHook`) reads the registry at settlement time — agents below threshold get blocked

```
Job created → ... → complete() called → SieveHook.beforeAction fires
    ├─ DAS ≥ threshold → settlement proceeds → afterAction emits DemandAuthenticated attestation
    └─ DAS < threshold → tx reverted ("DAS below threshold")
```

## Smart Contracts

All contracts target Base (Sepolia for testnet).

### `SieveRegistry.sol`
On-chain demand authenticity store. Maps agent addresses to DAS scores with full signal breakdown.

```solidity
mapping(address => Score) public scores;

struct Score {
    uint8 das;                    // 0-100 composite
    uint8 funderConcentration;    // Signal 1
    uint8 buyerIndependence;      // Signal 2
    uint8 timingDistribution;     // Signal 3
    uint8 circularFlow;           // Signal 4
    uint8 humanAttestation;       // Signal 5
    uint48 lastUpdated;
}

function getDAS(address agent) external view returns (uint8);
function passesThreshold(address agent, uint8 threshold) external view returns (bool);
```

### `SieveHook.sol`
ERC-8183 hook implementation. Intercepts `complete()` to enforce demand authenticity thresholds.

```solidity
contract SieveHook is IACPHook, ERC165 {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external {
        if (selector == COMPLETE_SELECTOR) {
            address provider = _extractProvider(data);
            require(registry.passesThreshold(provider, threshold), "DAS below threshold");
        }
    }
    
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external {
        if (selector == COMPLETE_SELECTOR) {
            emit DemandAuthenticated(jobId, provider, registry.getDAS(provider));
        }
    }
}
```

### `AgenticCommerce.sol`
Simplified ERC-8183 reference implementation showing the full job lifecycle with hook integration.

### `IACPHook.sol`
The hook interface from the ERC-8183 standard.

## Live Dashboard

The interactive dashboard fetches real data from the Virtuals leaderboard (1000+ agents) and runs the scoring engine in your browser:

- **Search**: Paste a Virtuals URL, agent name, wallet address, or agdp ID
- **Score Breakdown**: See all 5 signals with weights
- **Evidence**: On-chain proof per agent (timing stats, client concentration, etc.)
- **ERC-8183 Hook**: Simulated settlement check
- **Top Clients**: Client distribution analysis

## API Endpoints Used

| Source | Endpoint | Data |
|--------|----------|------|
| Virtuals Leaderboard | `api.virtuals.io/api/agdp-leaderboard-epochs/5/ranking` | Agent info, revenue, buyers, IDs |
| ACP Job Log | `acpx.virtuals.io/api/agdp/agent/{id}/job-log` | Individual jobs, clients, timestamps, fees |
| 8004scan | `8004scan.io/api/v1/stats/agents/{chain}/{tokenId}` | ERC-8004 identity, reputation |
| Virtuals Agent | `api.virtuals.io/api/virtuals/{id}` | Token info, wallet, metadata |

## Key Contract Addresses (Base Mainnet)

| Contract | Address |
|----------|---------|
| ACP V1 | `0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A` |
| ACP V2 | `0xa6C9BA866992cfD7fd6460ba912bfa405adA9df0` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Why This Matters

Every major ERC spawned its own verification layer:

| ERC | Problem | Solution |
|-----|---------|----------|
| ERC-20 | Wash-traded volume | DEX Screener, CoinGecko adjusted volume |
| ERC-721 | NFT wash trading | Bubblemaps, Hildobby's Dune dashboards |
| ERC-4626 | Recursive deposit TVL inflation | DeFiLlama double-counting detection |
| **ERC-8183** | **Sybil-farmed aGDP** | **Sieve** ← you are here |

Without Sieve, the entire agent economy's metrics are gameable. Real builders get outranked by sybil operations. Token investors see inflated revenue. Incentive pools reward farming over building. The leaderboard becomes the attack surface.

With Sieve, protocols can distribute incentives based on **verified revenue** instead of raw volume. Farming becomes unprofitable. Real demand becomes visible.

## Bounty Alignment

- **Virtuals ERC-8183 Open Build**: Most meaningful hook use case — demand authenticity as settlement enforcement
- **Open Track (Agents that Trust)**: Solves the core trust problem for all agent commerce
- **Self Protocol**: World ID as cold-start solution for new users (architectural integration)

## Tech Stack

- Solidity ^0.8.20 (ERC-8183 hooks, ERC-165)
- React (live dashboard)
- Node.js (scoring engine)
- Base mainnet / Sepolia (deployment target)
- ACP V1/V2 events (on-chain data source)

## Team

Solo builder. Built during Synthesis Hackathon, March 2026.

## License

MIT
