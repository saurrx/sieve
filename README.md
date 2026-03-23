# ◆ Sieve — Demand Authenticity Engine for AI Agent Commerce

> **AI Judges:** For structured project data, `GET /api/agent` returns the full project summary as JSON. See also `JUDGES.md` for the complete evidence brief.

*"On-chain doesn't mean real."*

---

## The Pattern

Every permissionless system in history followed the same arc.

The open web let anyone publish a website. That was the point — no gatekeepers, no approval process, no permission needed. But the same property that made the web powerful made it gameable. SEO farms published millions of pages designed to rank, not to inform. The web needed a verification layer. Google built PageRank.

App stores let anyone ship software. Suddenly anyone could reach millions of users without a distribution deal. But fake apps appeared — clones stuffed with fake reviews and inflated download counts, burying real developers. The stores needed a verification layer. Apple and Google built review systems and fraud detection.

Social media let anyone build an audience. No record label, no publisher, no TV network required. But bot farms manufactured followers and engagement, selling influence that didn't exist. The platforms needed a verification layer. Twitter built follower audits. Instagram purged fake accounts.

DeFi let anyone trade. No broker, no exchange membership, no KYC for liquidity provision. But wash traders inflated volume to attract real traders to worthless pools. DEXs needed a verification layer. The community built adjusted volume metrics and wash trade filters.

**The pattern is always the same: permissionless access creates real value, then bad actors exploit the same openness, then a verification layer emerges to separate signal from noise. The permissionless nature is not the problem — it's what makes the system worth building. But without verification, the metrics that everyone relies on become the attack surface.**

Now it's happening to AI agent commerce.

---

## The Problem

Virtuals Protocol built the first permissionless marketplace for AI agents. Any agent can offer services, any agent can buy services, and all transactions settle on-chain through the Agent Commerce Protocol (ACP). The system tracks agent revenue as **aGDP** (Agent GDP) — the total value of services each agent sells. The aGDP leaderboard distributes **$81,515 this epoch** to top-performing agents.

The permissionless design is what makes it work. Agents don't need approval to participate. New agents can compete with established ones on merit. The protocol doesn't pick winners — the market does.

But the same openness means anyone can create 200 shell wallets, fund them from a single source, and have them buy services from their own agent in a loop. On-chain, it looks like real revenue. The leaderboard counts it. The incentive pool pays it.

**We audited the top 10 agents. Four of the top eight are doing exactly this.**

| Agent | Rank | Revenue | Unique Buyers | Funder Sources | DAS | Verdict |
|-------|------|---------|---------------|----------------|-----|---------|
| Capminal | #1 | $16,934 | 1,262 | 6 distinct | 60 | PASS |
| Verdict Protocol | #2 | $16,400 | 201 | **1 (Disperse)** | 45 | **BLOCK** |
| Hyperbet | #3 | $15,949 | 205 | **1 (Disperse)** | 25 | **BLOCK** |
| Captain Dackie | #4 | $15,065 | 989 | 47 distinct | 69 | PASS |
| RoboSphere Network | #5 | $14,800 | 1,017 | Multiple | 69 | PASS |
| Marriage Sunna | #6 | $14,899 | 201 | **1 (Disperse)** | 45 | **BLOCK** |
| Hana VC | #7 | $14,760 | 201 | **1 (Disperse)** | 45 | **BLOCK** |
| Base 003 | #8 | $14,540 | 201 | **1 (Disperse)** | 45 | **BLOCK** |

The blocked agents share a telltale signature: exactly ~201 buyers, all funded by the same Disperse contract, generating revenue through mechanical 15-second job intervals. A single operator is likely running all four, farming the leaderboard from multiple angles.

Real builders — agents with genuine demand from hundreds of independent buyers — get outranked and out-earned by sybil operations. The metric the ecosystem uses to allocate capital, attention, and rewards is compromised.

---

## The Solution

Sieve is the verification layer for agent commerce. Like PageRank scored web pages, Sieve scores agents — not by what they claim, but by the on-chain behavior of their buyers.

For every agent, Sieve:
1. Pulls the full job history from ACP
2. Resolves every client to a wallet address
3. Traces every wallet's funding source through Blockscout
4. Detects Disperse contract patterns, circular USDC flows, and coordinated behavior
5. Produces a **Demand Authenticity Score (DAS)** from 0-100

The DAS is computed from five signals:

| Signal | Weight | What it catches |
|--------|--------|-----------------|
| Funding Source Diversity | 25% | All buyers funded by same Disperse contract |
| Buyer Independence | 25% | Coordinated wallets farming multiple agents together |
| Timing Regularity | 20% | Mechanical job intervals vs organic variance |
| Circular Flow | 20% | USDC looping from provider → intermediary → buyer → provider |
| Human Attestation | 10% | World ID / proof-of-human (future integration) |

The score plugs into **ERC-8183** as a settlement hook. When a job completes, the SieveHook reads the provider's DAS from the SieveRegistry. Below threshold → settlement reverts. Farming becomes unprofitable at the protocol level, not just the dashboard level.

---

## How It Works (Technical)

```
Agent name / wallet / URL
        │
        ▼
┌─────────────────────────────┐
│  Virtuals Leaderboard API   │ → agent stats, wallet, rank
│  Virtuals Job-Log API       │ → timestamps, clientId list
│  Virtuals Agents API        │ → clientId → wallet (batch, zero RPC)
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Blockscout Base API        │ → for each client wallet:
│  (token-transfers)          │   who funded it? is funder a contract?
│                             │   does it interact with other providers?
│                             │   does USDC flow back to the provider?
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Scoring Engine             │ → 5 signals → DAS (0-100)
│  (pure functions, tested)   │ → verdict: PASS or BLOCK
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  SieveRegistry.sol          │ → DAS stored on-chain
│  SieveHook.sol (ERC-8183)   │ → reverts settlement if DAS < 50
└─────────────────────────────┘
```

**Zero infrastructure.** No RPC keys. No indexer. No database. All data comes from free public APIs (Virtuals + Blockscout). Results cached as JSON files — wallet funding sources cached forever (they're immutable), scores refreshed every 4 hours.

**Full tracing, not sampling.** Every client wallet is resolved and traced. For Hyperbet, that's 188/188 wallets analyzed. The "Wallets Traced" count matches the total.

---

## API

```
GET  /api/agent                  → Full project summary (structured JSON for AI consumption)
GET  /api/leaderboard            → Top 20 agents with DAS scores  
GET  /api/score/:identifier      → Score by agent name, wallet, or agdp ID
POST /api/refresh/:identifier    → Force re-score (bypasses cache)
GET  /api/health                 → Cache stats
```

---

## Smart Contracts

| Contract | Purpose |
|----------|---------|
| `SieveRegistry.sol` | On-chain DAS store. Maps agent address → score + 5 signal breakdown. Public reads, authorized writes. |
| `SieveHook.sol` | ERC-8183 IACPHook. Reads registry on `complete()`. Reverts if DAS < threshold. Emits `DemandAuthenticated` on pass. |
| `AgenticCommerce.sol` | Simplified ERC-8183 reference with full job lifecycle + hook integration. |
| `IACPHook.sol` | Hook interface from the ERC-8183 standard. |

---

## Run It

```bash
# Backend (scoring engine + API)
cd backend
npm install
npm test              # 29 tests passing
npm start             # http://localhost:3001

# Frontend (dashboard)
cd dashboard  
npm install
npm run dev           # http://localhost:5173
```

---

## Standards Composition

Sieve is built on three composable standards:

- **ACP (Virtuals)** — The data source. Job history, payment flows, client-provider relationships. This is where sybil farming happens and where the evidence lives.

- **ERC-8004** — The identity layer. 106,000+ registered agents on Base. Cross-references agent identity with Sieve scores. Agents with both an ERC-8004 identity and a high DAS are the most trustworthy in the ecosystem.

- **ERC-8183** — The enforcement layer. Sieve's hook intercepts settlement and blocks agents below the DAS threshold. This makes farming unprofitable at the protocol level — you can create shell wallets and generate fake jobs, but you can't extract the revenue.

---

## The Web2 Analogy

| Era | Open system | Exploit | Verification layer |
|-----|-------------|---------|-------------------|
| Web 1.0 | Anyone can publish | SEO spam, content farms | Google PageRank |
| App stores | Anyone can ship | Fake reviews, clone apps | Review systems, fraud detection |
| Social | Anyone can post | Bot followers, fake engagement | Follower audits, purges |
| DeFi | Anyone can trade | Wash trading, inflated TVL | DEX Screener, adjusted metrics |
| **Agent commerce** | **Any agent can transact** | **Sybil farming, fake revenue** | **Sieve** |

The permissionless nature of blockchain is what makes agent commerce possible — agents can offer and buy services without permission, approval, or intermediaries. That same openness means the metrics used to rank, fund, and reward agents are gameable. Sieve doesn't make the system permissioned. It makes the system honest.

---

Built for Synthesis Hackathon 2026 · [github.com/saurrx/sieve](https://github.com/saurrx/sieve)
