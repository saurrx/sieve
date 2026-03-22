import { useState, useEffect, useRef } from "react";

// ═══ SCORING ENGINE (embedded) ═══════════════════════════════════════
const CONTRACTS = {
  ACP_V1: "0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A",
  ACP_V2: "0xa6C9BA866992cfD7fd6460ba912bfa405adA9df0",
  ERC8004_IDENTITY: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  ERC8004_REPUTATION: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
};

const AGENTS = [
  {
    id: "hyperbet",
    name: "Hyperbet",
    virtualsId: 42524,
    erc8004Id: null,
    service: "roulette_hbet",
    das: 2,
    signals: { funder: 0, independence: 0, timing: 5, circular: 5, human: 0 },
    rawRevenue: 65000,
    verifiedRevenue: 0,
    totalBuyers: 206,
    uniqueBuyers: 0,
    sybilBuyers: 206,
    successRate: 80.6,
    totalJobs: 5186,
    evidence: [
      "206 buyer wallets funded from single Disperse contract",
      "~$65K recycled in closed USDC loop",
      "~$13K paid in ACP protocol fees (20% tax)",
      "12-second intervals — one transaction per Base block",
      "Zero buyer wallets have provider activity",
      "All buyers are single-purpose shell wallets",
    ],
    hookVerdict: "BLOCK",
    acpVersion: "V1",
    chain: "Base",
  },
  {
    id: "captain_dackie",
    name: "Captain Dackie",
    virtualsId: 23397,
    erc8004Id: 1380,
    service: "defi_x402_agent",
    das: 91,
    signals: { funder: 100, independence: 100, timing: 98, circular: 98, human: 15 },
    rawRevenue: 25000,
    verifiedRevenue: 25000,
    totalBuyers: 3064,
    uniqueBuyers: 3064,
    sybilBuyers: 0,
    successRate: 95.0,
    totalJobs: 1520,
    evidence: [
      "~2500 unique funding sources across buyers",
      "Buyers interact with 2-9 different providers on average",
      "Organic timing distribution (high variance, CV ≈ 1.0)",
      "Minimal circular flow ($500 of $25K = 2%)",
      "15% of buyers have human attestation",
      "ERC-8004 registered: Agent #1380 with 1520 feedback items",
    ],
    hookVerdict: "PASS",
    acpVersion: "V1+V2",
    chain: "Base",
  },
  {
    id: "loopuman",
    name: "Loopuman",
    virtualsId: null,
    erc8004Id: null,
    service: "human_task_routing",
    das: 84,
    signals: { funder: 99, independence: 77, timing: 100, circular: 98, human: 8 },
    rawRevenue: 12000,
    verifiedRevenue: 12000,
    totalBuyers: 150,
    uniqueBuyers: 150,
    sybilBuyers: 0,
    successRate: 92.0,
    totalJobs: 800,
    evidence: [
      "~120 unique funding sources across 150 buyers",
      "77% of buyers interact with multiple providers",
      "Fully organic timing (exponential distribution)",
      "Negligible circular flow ($200 of $12K = 1.7%)",
      "8% buyer attestation rate",
      "Routes tasks to verified human workers via Telegram",
    ],
    hookVerdict: "PASS",
    acpVersion: "V1",
    chain: "Base + Celo",
  },
];

const SIGNAL_LABELS = [
  { key: "funder", label: "Funder Concentration", weight: "25%", desc: "Do buyers share a common funding source?" },
  { key: "independence", label: "Buyer Independence", weight: "25%", desc: "Do buyers interact with multiple providers?" },
  { key: "timing", label: "Timing Distribution", weight: "20%", desc: "Are transaction intervals organic or bot-like?" },
  { key: "circular", label: "Circular Flow", weight: "20%", desc: "Does USDC loop Provider → Buyer → Provider?" },
  { key: "human", label: "Human Attestation", weight: "10%", desc: "Do buyers have World ID / proof-of-human?" },
];

// ═══ COMPONENTS ══════════════════════════════════════════════════════

function DASGauge({ score, size = 120 }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * 0.75;
  const offset = arc - (arc * score) / 100;
  const color = score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="#1e293b" strokeWidth="8"
          strokeDasharray={`${arc} ${circumference}`}
          strokeDashoffset="0"
          transform={`rotate(135 ${size / 2} ${size / 2})`}
          strokeLinecap="round"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${arc} ${circumference}`}
          strokeDashoffset={offset}
          transform={`rotate(135 ${size / 2} ${size / 2})`}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1.2s ease-out, stroke 0.5s" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        paddingTop: 4,
      }}>
        <span style={{ fontSize: size * 0.3, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>
          {score}
        </span>
        <span style={{ fontSize: 9, color: "#64748b", letterSpacing: 1, textTransform: "uppercase" }}>
          / 100
        </span>
      </div>
    </div>
  );
}

function SignalBar({ value, color }) {
  return (
    <div style={{ height: 6, background: "#0f172a", borderRadius: 3, flex: 1 }}>
      <div style={{
        height: "100%", borderRadius: 3,
        width: `${value}%`,
        background: color || (value >= 70 ? "#10b981" : value >= 40 ? "#f59e0b" : "#ef4444"),
        transition: "width 0.8s ease-out",
      }} />
    </div>
  );
}

function HookSimulator({ agent }) {
  const [simulating, setSimulating] = useState(false);
  const [step, setStep] = useState(0);

  const steps = agent.hookVerdict === "BLOCK"
    ? [
        { text: "evaluator calls complete(jobId, reason)", type: "action" },
        { text: `SieveHook.beforeAction(jobId, 0x..., data)`, type: "hook" },
        { text: `registry.getScore(provider) → DAS: ${agent.das}/100`, type: "check" },
        { text: `DAS ${agent.das} < threshold 50 → REVERT`, type: "block" },
        { text: `"Suspected demand farming detected"`, type: "error" },
        { text: `Settlement BLOCKED. Funds remain in escrow.`, type: "result" },
      ]
    : [
        { text: "evaluator calls complete(jobId, reason)", type: "action" },
        { text: `SieveHook.beforeAction(jobId, 0x..., data)`, type: "hook" },
        { text: `registry.getScore(provider) → DAS: ${agent.das}/100`, type: "check" },
        { text: `DAS ${agent.das} ≥ threshold 50 → CONTINUE`, type: "pass" },
        { text: `Funds released to provider. Job completed.`, type: "result" },
        { text: `afterAction emits DemandAuthenticated event`, type: "attest" },
      ];

  const simulate = () => {
    setSimulating(true);
    setStep(0);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setStep(i);
      if (i >= steps.length) clearInterval(interval);
    }, 600);
  };

  const typeColors = {
    action: "#94a3b8",
    hook: "#818cf8",
    check: "#60a5fa",
    block: "#ef4444",
    error: "#f87171",
    pass: "#10b981",
    result: agent.hookVerdict === "BLOCK" ? "#ef4444" : "#10b981",
    attest: "#a78bfa",
  };

  return (
    <div style={{ background: "#020617", borderRadius: 8, padding: 16, border: "1px solid #1e293b" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", letterSpacing: 1 }}>
          ERC-8183 HOOK SIMULATION
        </span>
        <button
          onClick={simulate}
          style={{
            background: agent.hookVerdict === "BLOCK" ? "#7f1d1d" : "#064e3b",
            color: agent.hookVerdict === "BLOCK" ? "#fca5a5" : "#6ee7b7",
            border: "none", borderRadius: 4, padding: "4px 12px",
            fontSize: 11, cursor: "pointer", fontFamily: "monospace",
          }}
        >
          {simulating ? "↻ replay" : "▶ simulate"}
        </button>
      </div>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 2 }}>
        {steps.map((s, i) => (
          <div key={i} style={{
            opacity: step >= i + 1 ? 1 : 0.15,
            color: typeColors[s.type],
            transition: "opacity 0.3s",
            display: "flex", gap: 8,
          }}>
            <span style={{ color: "#334155", width: 16, textAlign: "right" }}>{i + 1}</span>
            <span>{s.type === "error" ? `» ${s.text}` : `→ ${s.text}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentCard({ agent, selected, onClick }) {
  const color = agent.das >= 70 ? "#10b981" : agent.das >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <button onClick={onClick} style={{
      background: selected ? "#0f172a" : "#020617",
      border: selected ? `1px solid ${color}` : "1px solid #1e293b",
      borderRadius: 10, padding: 16, cursor: "pointer",
      textAlign: "left", width: "100%",
      transition: "all 0.2s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0" }}>{agent.name}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {agent.service} · {agent.chain}
          </div>
        </div>
        <DASGauge score={agent.das} size={56} />
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 11 }}>
        <span style={{ color: "#64748b" }}>
          Rev: <span style={{ color: "#e2e8f0" }}>${agent.rawRevenue.toLocaleString()}</span>
        </span>
        <span style={{ color: "#64748b" }}>
          Verified: <span style={{ color: color }}>${agent.verifiedRevenue.toLocaleString()}</span>
        </span>
        <span style={{
          color: agent.hookVerdict === "BLOCK" ? "#ef4444" : "#10b981",
          fontWeight: 700, fontFamily: "monospace",
        }}>
          {agent.hookVerdict === "BLOCK" ? "✗ BLOCK" : "✓ PASS"}
        </span>
      </div>
    </button>
  );
}

// ═══ MAIN APP ════════════════════════════════════════════════════════

export default function SieveDashboard() {
  const [selectedAgent, setSelectedAgent] = useState(AGENTS[0]);
  const [activeTab, setActiveTab] = useState("signals");

  const dasColor = selectedAgent.das >= 70 ? "#10b981" : selectedAgent.das >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div style={{
      fontFamily: "'DM Sans', system-ui, sans-serif",
      background: "#020617",
      color: "#e2e8f0",
      minHeight: "100vh",
      padding: 0,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{
        background: "linear-gradient(180deg, #0f172a 0%, #020617 100%)",
        borderBottom: "1px solid #1e293b",
        padding: "20px 24px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5 }}>SIEVE</span>
              <span style={{
                background: "#1e293b", borderRadius: 4, padding: "2px 8px",
                fontSize: 10, color: "#94a3b8", fontFamily: "monospace",
              }}>v0.1 · Synthesis Hackathon</span>
            </div>
            <div style={{ color: "#64748b", fontSize: 13, marginTop: 4, fontStyle: "italic" }}>
              "On-chain doesn't mean real."
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 10, color: "#475569", fontFamily: "monospace", lineHeight: 1.8 }}>
            <div>ACP V1: {CONTRACTS.ACP_V1.slice(0, 10)}...{CONTRACTS.ACP_V1.slice(-4)}</div>
            <div>ERC-8004: {CONTRACTS.ERC8004_IDENTITY.slice(0, 10)}...{CONTRACTS.ERC8004_IDENTITY.slice(-4)}</div>
          </div>
        </div>

        {/* Architecture badges */}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {[
            { label: "ACP Contracts", desc: "Data source", color: "#818cf8" },
            { label: "ERC-8004", desc: "Agent identity + proof", color: "#60a5fa" },
            { label: "ERC-8183 Hook", desc: "Settlement enforcement", color: "#a78bfa" },
          ].map((b) => (
            <div key={b.label} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "#0f172a", borderRadius: 6, padding: "5px 10px",
              border: "1px solid #1e293b",
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: b.color }} />
              <span style={{ fontSize: 11, fontWeight: 600 }}>{b.label}</span>
              <span style={{ fontSize: 10, color: "#64748b" }}>· {b.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div style={{ padding: "16px 24px", display: "flex", gap: 20, flexDirection: "column" }}>
        
        {/* Agent selector */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {AGENTS.map((a) => (
            <AgentCard
              key={a.id}
              agent={a}
              selected={selectedAgent.id === a.id}
              onClick={() => setSelectedAgent(a)}
            />
          ))}
        </div>

        {/* Detail panel */}
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20 }}>
          
          {/* Left: DAS gauge + key metrics */}
          <div style={{
            background: "#0f172a", borderRadius: 12, padding: 20,
            border: "1px solid #1e293b",
            display: "flex", flexDirection: "column", alignItems: "center",
          }}>
            <DASGauge score={selectedAgent.das} size={140} />
            <div style={{
              marginTop: 8, fontSize: 12, fontWeight: 700,
              color: dasColor, fontFamily: "monospace", letterSpacing: 1,
            }}>
              {selectedAgent.hookVerdict === "BLOCK" ? "✗ SETTLEMENT BLOCKED" : "✓ SETTLEMENT ALLOWED"}
            </div>
            <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
              Threshold: 50/100
            </div>

            <div style={{ width: "100%", marginTop: 20, fontSize: 12 }}>
              {[
                { label: "Raw Revenue", value: `$${selectedAgent.rawRevenue.toLocaleString()}` },
                { label: "Verified Revenue", value: `$${selectedAgent.verifiedRevenue.toLocaleString()}`, color: dasColor },
                { label: "Revenue Gap", value: selectedAgent.rawRevenue > 0 ? `${Math.round((1 - selectedAgent.verifiedRevenue / selectedAgent.rawRevenue) * 100)}%` : "0%", color: selectedAgent.verifiedRevenue < selectedAgent.rawRevenue ? "#ef4444" : "#10b981" },
                { label: "Total Buyers", value: selectedAgent.totalBuyers },
                { label: "Sybil Buyers", value: selectedAgent.sybilBuyers, color: selectedAgent.sybilBuyers > 0 ? "#ef4444" : "#10b981" },
                { label: "Jobs", value: selectedAgent.totalJobs.toLocaleString() },
                { label: "Virtuals ID", value: selectedAgent.virtualsId ? `#${selectedAgent.virtualsId}` : "—" },
                { label: "ERC-8004 ID", value: selectedAgent.erc8004Id ? `#${selectedAgent.erc8004Id}` : "—" },
              ].map((m) => (
                <div key={m.label} style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "6px 0", borderBottom: "1px solid #1e293b",
                }}>
                  <span style={{ color: "#64748b" }}>{m.label}</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 600, color: m.color || "#e2e8f0" }}>{m.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Tabs */}
          <div>
            {/* Tab bar */}
            <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
              {[
                { key: "signals", label: "Signal Breakdown" },
                { key: "evidence", label: "Evidence" },
                { key: "hook", label: "ERC-8183 Hook" },
              ].map((t) => (
                <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                  background: activeTab === t.key ? "#1e293b" : "transparent",
                  color: activeTab === t.key ? "#e2e8f0" : "#64748b",
                  border: "none", borderRadius: 6, padding: "7px 14px",
                  fontSize: 12, cursor: "pointer", fontWeight: 600,
                  transition: "all 0.2s",
                }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === "signals" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {SIGNAL_LABELS.map((s) => {
                  const val = selectedAgent.signals[s.key];
                  const color = val >= 70 ? "#10b981" : val >= 40 ? "#f59e0b" : "#ef4444";
                  return (
                    <div key={s.key} style={{
                      background: "#0f172a", borderRadius: 8, padding: 14,
                      border: "1px solid #1e293b",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                          <span style={{ fontSize: 10, color: "#475569", marginLeft: 8 }}>weight: {s.weight}</span>
                        </div>
                        <span style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color }}>
                          {val}
                        </span>
                      </div>
                      <SignalBar value={val} color={color} />
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{s.desc}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {activeTab === "evidence" && (
              <div style={{
                background: "#0f172a", borderRadius: 8, padding: 16,
                border: "1px solid #1e293b",
              }}>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12, fontFamily: "monospace" }}>
                  ON-CHAIN EVIDENCE · {selectedAgent.chain} · ACP {selectedAgent.acpVersion}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {selectedAgent.evidence.map((e, i) => (
                    <div key={i} style={{
                      display: "flex", gap: 10, fontSize: 12, lineHeight: 1.5,
                      padding: "8px 10px",
                      background: i % 2 === 0 ? "#020617" : "transparent",
                      borderRadius: 4,
                    }}>
                      <span style={{
                        color: selectedAgent.hookVerdict === "BLOCK" ? "#ef4444" : "#10b981",
                        fontFamily: "monospace", fontWeight: 700, flexShrink: 0,
                      }}>
                        {selectedAgent.hookVerdict === "BLOCK" ? "⚠" : "✓"}
                      </span>
                      <span style={{ color: "#cbd5e1" }}>{e}</span>
                    </div>
                  ))}
                </div>
                {selectedAgent.id === "hyperbet" && (
                  <div style={{
                    marginTop: 16, padding: 12, background: "#1c1917",
                    borderRadius: 6, border: "1px solid #7f1d1d",
                    fontSize: 11, color: "#fca5a5", fontFamily: "monospace",
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>FARMING PATTERN DETECTED</div>
                    <div>Single Disperse contract → 206 shell wallets → Hyperbet roulette → USDC recycled</div>
                    <div style={{ marginTop: 4, color: "#ef4444" }}>
                      Revenue inflation: $65,000 reported → $0 verified (100% discrepancy)
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "hook" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <HookSimulator agent={selectedAgent} />
                
                {/* Contract architecture */}
                <div style={{
                  background: "#0f172a", borderRadius: 8, padding: 16,
                  border: "1px solid #1e293b", fontSize: 11, fontFamily: "monospace",
                }}>
                  <div style={{ color: "#64748b", marginBottom: 8 }}>CONTRACT ARCHITECTURE</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, color: "#94a3b8" }}>
                    <div><span style={{ color: "#818cf8" }}>AgenticCommerce.sol</span> — ERC-8183 reference (Base Sepolia)</div>
                    <div style={{ paddingLeft: 16 }}>↓ complete() calls hook.beforeAction()</div>
                    <div><span style={{ color: "#a78bfa" }}>SieveHook.sol</span> — implements IACPHook</div>
                    <div style={{ paddingLeft: 16 }}>↓ reads provider score from registry</div>
                    <div><span style={{ color: "#60a5fa" }}>SieveRegistry.sol</span> — DAS scores on-chain</div>
                    <div style={{ paddingLeft: 16 }}>↓ scores computed from ACP + ERC-8004 data</div>
                    <div><span style={{ color: "#475569" }}>Scoring Engine</span> — off-chain indexer (5 signals)</div>
                    <div style={{ paddingLeft: 16 }}>↓ reads events from:</div>
                    <div style={{ paddingLeft: 16 }}><span style={{ color: "#f97316" }}>ACP V1</span> {CONTRACTS.ACP_V1.slice(0, 14)}... (Base mainnet)</div>
                    <div style={{ paddingLeft: 16 }}><span style={{ color: "#f97316" }}>ERC-8004</span> {CONTRACTS.ERC8004_IDENTITY.slice(0, 14)}... (Base mainnet)</div>
                  </div>
                </div>

                {/* Three-standard composition */}
                <div style={{
                  background: "#0f172a", borderRadius: 8, padding: 16,
                  border: "1px solid #1e293b",
                }}>
                  <div style={{ fontSize: 11, color: "#64748b", fontFamily: "monospace", marginBottom: 10 }}>
                    THREE-STANDARD COMPOSITION
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {[
                      { std: "ACP (Virtuals)", role: "Data Source", desc: "Job events, USDC flows, buyer→provider relationships", color: "#f97316" },
                      { std: "ERC-8004", role: "Identity + Proof", desc: "Agent registry, reputation feedback, cross-reference scores", color: "#60a5fa" },
                      { std: "ERC-8183", role: "Enforcement", desc: "Hook blocks settlement for farming agents via beforeAction revert", color: "#a78bfa" },
                    ].map((s) => (
                      <div key={s.std} style={{
                        background: "#020617", borderRadius: 6, padding: 12,
                        borderTop: `2px solid ${s.color}`,
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.std}</div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0", marginTop: 4 }}>{s.role}</div>
                        <div style={{ fontSize: 10, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>{s.desc}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
