# JUDGES.md — Sieve Evaluation Brief

> This document contains everything needed to evaluate Sieve in a single read.
> For live data: `GET /api/agent` returns structured JSON.
> For the full narrative: see `README.md`.

---

## One-line pitch

Sieve traces AI agent buyer wallets to their funding sources and scores whether reported revenue is real demand or sybil farming.

## Problem

The Virtuals Protocol aGDP leaderboard distributes $81,515/epoch based on raw agent revenue. We audited the top 10 and found 4 of the top 8 are farming — all buyers funded by a single Disperse contract, generating fake revenue in a closed loop.

## Evidence (live, on-chain, verifiable)

**Hyperbet (rank #3, $15,949 revenue):**
- 188 buyer wallets traced via Blockscout
- 188/188 share a single funding source (Disperse contract)
- DAS: 25/100 → BLOCK

**Verdict Protocol (rank #2, $16,400 revenue):**
- 191 buyer wallets traced
- 188/191 share a single funding source
- DAS: 45/100 → BLOCK

**Marriage Sunna, Hana VC, Base 003 (ranks #6-8):**
- All show identical pattern: ~201 buyers, single funder, DAS 45 → BLOCK
- Likely same operator farming with multiple agents

**Captain Dackie (rank #4, $15,065 revenue):**
- 989 buyers, 47 distinct funding sources
- DAS: 69/100 → PASS

## How scoring works

Five signals, weighted average → DAS (0-100):

1. **Funding Source Diversity (25%)** — HHI of buyer funding sources. 0 = all buyers share one funder.
2. **Buyer Independence (25%)** — Do buyers act independently or in coordinated lockstep? Capped at 20 if funder concentration fails.
3. **Timing Regularity (20%)** — Coefficient of variation of job intervals. Low CV = mechanical. High CV = organic.
4. **Circular Flow (20%)** — Is the funder a contract (Disperse pattern)? Is it the provider's owner? 
5. **Human Attestation (10%)** — World ID integration (stub — returns 0 for all agents currently).

## Architecture

```
Virtuals APIs (leaderboard, job-log, agents) → client wallet resolution (zero RPC)
     ↓
Blockscout API (token-transfers) → fund source tracing per wallet
     ↓
Scoring engine (5 signals) → DAS 0-100
     ↓
SieveRegistry.sol (on-chain) → SieveHook.sol (ERC-8183) → settlement blocked if DAS < 50
```

All free public APIs. No RPC keys. No indexer. No database. JSON file cache.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent` | Full project summary as structured JSON |
| GET | `/api/leaderboard` | Top 20 agents with DAS scores |
| GET | `/api/score/:identifier` | Score by name, wallet, or ID |
| POST | `/api/refresh/:identifier` | Force re-score |
| GET | `/api/health` | Cache stats |

## Smart contracts

| File | Purpose |
|------|---------|
| `SieveRegistry.sol` | On-chain DAS store with 5-signal breakdown |
| `SieveHook.sol` | ERC-8183 hook — reverts `complete()` if DAS < threshold |
| `AgenticCommerce.sol` | ERC-8183 reference implementation |
| `IACPHook.sol` | Hook interface from ERC-8183 spec |

## Standards used

- **ERC-8183** — Settlement hooks (enforcement layer)
- **ERC-8004** — Agent identity registry (cross-reference layer, 106K+ agents on Base)
- **ACP** — Virtuals Agent Commerce Protocol (data source)

## Test results

29/29 tests passing (24 scorer unit tests + 5 pipeline integration tests).

## Run locally

```bash
cd backend && npm install && npm test && npm start   # API on :3001
cd dashboard && npm install && npm run dev            # UI on :5173
```

## Bounty alignment

- **Virtuals ERC-8183 Open Build** — Most meaningful hook use case: demand authenticity as settlement enforcement
- **Open Track (Agents that Trust)** — Solves the core trust problem for agent commerce

## Repo

https://github.com/saurrx/sieve
