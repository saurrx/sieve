import { useState, useEffect, useCallback } from "react";

// ═══ CONFIG ═══
const SIEVE_API = (import.meta.env.VITE_API_URL || "") + "/api";
const CONTRACTS = {
  ACP_V1: "0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A",
  ACP_V2: "0xa6C9BA866992cfD7fd6460ba912bfa405adA9df0",
  SIEVE_REGISTRY: "0x5ieve000000000000000000000000000000000001",
  SIEVE_HOOK: "0x5ieve000000000000000000000000000000000002",
};

const SIGNAL_LABELS = {
  funderConcentration: {
    name: "Funding Source Diversity",
    desc: "Do buyer wallets come from independent sources, or one batch-funding operation?",
  },
  buyerIndependence: {
    name: "Buyer Behavior",
    desc: "Do buyers act independently, or move in lockstep across the same targets?",
  },
  timingDistribution: {
    name: "Transaction Timing",
    desc: "Is the pattern of job requests natural, or mechanically regular?",
  },
  circularFlow: {
    name: "Circular Flow",
    desc: "Is revenue recycled from the provider back through buyer wallets?",
  },
  humanAttestation: {
    name: "Human Verification",
    desc: "Do buyer wallets have World ID or proof-of-human attestation?",
  },
};

function signalVerdict(value) {
  if (value >= 70) return { label: "NORMAL", color: "#22c55e" };
  if (value >= 40) return { label: "SUSPICIOUS", color: "#eab308" };
  return { label: "FAILED", color: "#ef4444" };
}

const dasColor = (s) => s >= 70 ? "#22c55e" : s >= 40 ? "#eab308" : "#ef4444";
const bsLink = (addr) => `https://base.blockscout.com/address/${addr}`;
const shortAddr = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

// ═══ GAUGE ═══
function DASGauge({ score, size = 180 }) {
  const r = size * 0.38;
  const cx = size / 2, cy = size / 2 + 8;
  const startAngle = -210 * Math.PI / 180;
  const endAngle = 30 * Math.PI / 180;
  const range = endAngle - startAngle;
  const scoreAngle = startAngle + (score / 100) * range;
  const arcPath = (from, to) => {
    const x1 = cx + r * Math.cos(from), y1 = cy + r * Math.sin(from);
    const x2 = cx + r * Math.cos(to), y2 = cy + r * Math.sin(to);
    const large = (to - from) > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };
  const color = dasColor(score);
  return (
    <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.72}`}>
      <path d={arcPath(startAngle, endAngle)} fill="none" stroke="#1e293b" strokeWidth={10} strokeLinecap="round" />
      {score > 0 && <path d={arcPath(startAngle, scoreAngle)} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" />}
      <text x={cx} y={cy - 8} textAnchor="middle" fill={color} fontSize={size * 0.22} fontWeight="800" fontFamily="'JetBrains Mono', monospace">{score}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#94a3b8" fontSize={10} fontFamily="'JetBrains Mono', monospace">/100 DAS</text>
    </svg>
  );
}

// ═══ SIGNAL BAR — plain English ═══
function SignalBar({ signalKey, sig, blocked }) {
  const [expanded, setExpanded] = useState(false);
  const meta = SIGNAL_LABELS[signalKey] || { name: signalKey, desc: "" };
  const verdict = signalVerdict(sig.value);

  // When the agent is BLOCK, mute passing signals so they don't visually compete
  const barColor = blocked
    ? (sig.value >= 50 ? "#475569" : "#ef4444")
    : (sig.value >= 50 ? "#22c55e" : "#ef4444");
  const verdictColor = blocked && sig.value >= 50 ? "#64748b" : verdict.color;

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 11, marginBottom: 4, cursor: "pointer" }}
      >
        <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
          {expanded ? "▾" : "▸"} {meta.name}
          <span style={{ fontWeight: 700, marginLeft: 8, color: verdictColor, fontSize: 10 }}>{verdict.label}</span>
        </span>
        <span style={{ color: verdictColor, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 12 }}>{sig.value}<span style={{ color: "#475569", fontWeight: 400, fontSize: 10 }}>/100</span></span>
      </div>
      {/* Plain-english summary from API evidence */}
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4, lineHeight: 1.5, paddingLeft: 14 }}>
        {sig.evidence}
      </div>
      <div style={{ height: 5, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${sig.value}%`, height: "100%", background: barColor, borderRadius: 3, transition: "width 0.8s ease" }} />
      </div>
      {expanded && (
        <div style={{ marginTop: 6, padding: "6px 10px", background: "#0a0e17", borderRadius: 4, fontSize: 10, color: "#64748b", lineHeight: 1.6, paddingLeft: 14 }}>
          {meta.desc}
          <br />Weight: {sig.weight}% of composite DAS score.
        </div>
      )}
    </div>
  );
}

// ═══ FLOW DIAGRAM for sybil agents ═══
function FlowDiagram({ score, agent, meta }) {
  const sig = score.signals;
  const funderEvidence = sig.funderConcentration?.evidence || "";
  const circularEvidence = sig.circularFlow?.evidence || "";

  // Extract funder info from evidence strings
  const funderMatch = funderEvidence.match(/Top funder: (\d+)\/(\d+)/);
  const disperseMatch = circularEvidence.match(/(\w+) \(contract\) funds (\d+)\/(\d+)/);
  const isSybil = score.das < 50;

  if (!isSybil) return null;

  const contractName = disperseMatch?.[1] || "Single Funder";
  const fundedCount = disperseMatch?.[2] || funderMatch?.[1] || "?";
  const totalCount = disperseMatch?.[3] || funderMatch?.[2] || meta?.clientWalletsAnalyzed || "?";

  const boxStyle = (color) => ({
    padding: "8px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600,
    border: `1px solid ${color}44`, background: `${color}11`, color,
    textAlign: "center", whiteSpace: "nowrap",
  });
  const arrowStyle = { color: "#475569", fontSize: 16, textAlign: "center", lineHeight: "20px" };

  return (
    <div style={{ padding: 16, background: "#0a0e17", borderRadius: 8, border: "1px solid #1e293b", marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 12 }}>MONEY FLOW</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <div style={boxStyle("#ef4444")}>
          {contractName}
          {disperseMatch && <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.7 }}>contract</div>}
        </div>
        <div style={arrowStyle}>→</div>
        <div style={boxStyle("#eab308")}>
          {fundedCount} shell wallets
          <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.7 }}>of {totalCount} traced</div>
        </div>
        <div style={arrowStyle}>→</div>
        <div style={boxStyle("#ef4444")}>
          {agent.name}
          <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.7 }}>${agent.revenue?.toFixed(0)} "revenue"</div>
        </div>
      </div>
      {disperseMatch && (
        <div style={{ textAlign: "center", marginTop: 10, fontSize: 10, color: "#64748b" }}>
          A single contract batch-funds buyer wallets, which all pay the agent. This creates artificial revenue that looks organic on the leaderboard.
        </div>
      )}
    </div>
  );
}

// ═══ MAIN ═══
export default function SieveLive() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [leaderboard, setLeaderboard] = useState(null);
  const [result, setResult] = useState(null);
  const [tab, setTab] = useState("evidence");
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    fetch(`${SIEVE_API}/leaderboard?limit=20`)
      .then(r => r.json())
      .then(d => setLeaderboard(d.data || []))
      .catch(() => {
        fetch("https://api.virtuals.io/api/agdp-leaderboard-epochs/5/ranking?pagination[pageSize]=1000")
          .then(r => r.json())
          .then(d => setLeaderboard(d.data || []))
          .catch(() => setLeaderboard([]));
      });
  }, []);

  useEffect(() => {
    if (!leaderboard || !input || input.length < 2) { setSuggestions([]); return; }
    const q = input.toLowerCase();
    setSuggestions(leaderboard.filter(a => (a.name || a.agentName || "").toLowerCase().includes(q)).slice(0, 6));
  }, [input, leaderboard]);

  const scoreAgent = useCallback(async (identifier) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSuggestions([]);
    setTab("evidence");
    setLoadingMsg("Querying Sieve backend...");
    try {
      const res = await fetch(`${SIEVE_API}/score/${encodeURIComponent(identifier)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `API returned ${res.status}`);
      }
      setResult(await res.json());
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
    setLoadingMsg("");
  }, []);

  const handleSubmit = (e) => { e?.preventDefault(); if (input.trim()) scoreAgent(input.trim()); };
  const handlePick = (a) => { const n = a.name || a.agentName; setInput(n); scoreAgent(n); };

  const agent = result?.agent;
  const score = result?.score;
  const meta = result?.meta;
  const blocked = score?.verdict === "BLOCK";

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e17", color: "#e2e8f0", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", padding: "20px 16px" }}>
      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
        @keyframes scan { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
        .scanning { background: linear-gradient(90deg, #475569 0%, #64748b 50%, #475569 100%); background-size: 200% 100%; animation: scan 2s linear infinite; -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
      `}</style>

      {/* Header */}
      <div style={{ maxWidth: 820, margin: "0 auto", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>
            <span style={{ color: "#22c55e" }}>◆</span> SIEVE
          </span>
          <span style={{ fontSize: 10, color: "#475569", padding: "2px 6px", border: "1px solid #1e293b", borderRadius: 4 }}>
            ERC-8183 • ERC-8004 • ACP
          </span>
        </div>
        <p style={{ fontSize: 12, color: "#94a3b8", margin: 0, lineHeight: 1.6 }}>
          The aGDP leaderboard distributes <span style={{ color: "#eab308", fontWeight: 600 }}>$81K/month</span> in rewards based on agent revenue.
          Sieve checks if that revenue is real.
        </p>
      </div>

      {/* Search */}
      <div style={{ maxWidth: 820, margin: "0 auto", marginBottom: 20, position: "relative" }}>
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              value={input} onChange={e => setInput(e.target.value)}
              placeholder="Search any agent — name, Virtuals URL, wallet, or ID..."
              style={{ width: "100%", padding: "10px 14px", background: "#111827", border: "1px solid #1e293b", borderRadius: 6, color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
              onFocus={e => e.target.style.borderColor = "#22c55e"}
              onBlur={e => e.target.style.borderColor = "#1e293b"}
            />
            {suggestions.length > 0 && !loading && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#111827", border: "1px solid #1e293b", borderRadius: 6, marginTop: 4, maxHeight: 200, overflowY: "auto" }}>
                {suggestions.map(s => (
                  <div key={s.agentId} onClick={() => handlePick(s)}
                    style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1e293b" }}
                    onMouseEnter={e => e.currentTarget.style.background = "#1e293b"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span>{s.name || s.agentName} {s.das != null && <span style={{ color: dasColor(s.das), fontWeight: 700, fontSize: 10, marginLeft: 4 }}>DAS {s.das}</span>}</span>
                    <span style={{ color: "#64748b", fontSize: 10 }}>${(s.revenue || s.totalRevenue || 0).toFixed(0)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="submit" disabled={loading} style={{ padding: "10px 20px", background: "#22c55e", color: "#0a0e17", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit", opacity: loading ? 0.5 : 1 }}>
            {loading ? "..." : "SIEVE"}
          </button>
        </form>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#475569", lineHeight: "22px" }}>Try:</span>
          {["Hyperbet", "Capminal", "Captain Dackie", "Verdict Protocol"].map(n => (
            <button key={n} onClick={() => handlePick({ name: n })} style={{ padding: "2px 8px", background: "#111827", border: "1px solid #1e293b", borderRadius: 4, color: "#94a3b8", fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>{n}</button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ maxWidth: 820, margin: "0 auto", textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 20, marginBottom: 8, animation: "pulse 1.5s infinite" }}>◆</div>
          <div style={{ fontSize: 12, color: "#22c55e", animation: "pulse 1.5s infinite" }}>{loadingMsg}</div>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 8 }}>First-time analysis traces every client wallet via Blockscout. Cached results return instantly.</div>
        </div>
      )}

      {error && (
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "10px 14px", background: "#1c1117", border: "1px solid #ef444433", borderRadius: 6, color: "#ef4444", fontSize: 12, marginBottom: 16 }}>{error}</div>
      )}

      {/* ═══ RESULT DETAIL ═══ */}
      {agent && score && !loading && (
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {/* Agent Header — no wallet noise */}
          <div style={{ background: "#111827", border: `1px solid ${blocked ? "#ef444433" : "#22c55e33"}`, borderRadius: 8, padding: 20, marginBottom: 16, display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <DASGauge score={score.das} size={160} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 20, fontWeight: 700 }}>{agent.name}</span>
                <span style={{
                  padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 700,
                  background: blocked ? "#ef444422" : "#22c55e22",
                  color: blocked ? "#ef4444" : "#22c55e",
                  border: `1px solid ${blocked ? "#ef444444" : "#22c55e44"}`,
                }}>{score.verdict}</span>
                <span style={{ padding: "2px 6px", borderRadius: 4, fontSize: 9, background: "#111827", border: "1px solid #1e293b", color: score.confidence === "high" ? "#22c55e" : "#eab308" }}>
                  {score.confidence}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: 11, color: "#94a3b8" }}>
                <div>Revenue: <span style={{ color: "#e2e8f0", fontWeight: 600 }}>${agent.revenue?.toFixed(0)}</span></div>
                <div>Unique Buyers: <span style={{ color: "#e2e8f0" }}>{agent.buyers}</span></div>
                <div>Rank: <span style={{ color: "#eab308" }}>#{agent.rank}</span></div>
                <div>Wallets Traced: <span style={{ color: "#e2e8f0" }}>{meta?.clientWalletsAnalyzed}/{meta?.clientWalletsTotal}</span></div>
              </div>
              {blocked && (
                <div style={{ marginTop: 8, fontSize: 10, color: "#ef4444", padding: "4px 8px", background: "#ef444411", borderRadius: 4 }}>
                  Would be rejected by ERC-8183 settlement hook (DAS {score.das} &lt; threshold 50)
                </div>
              )}
            </div>
          </div>

          {/* Tabs — evidence first */}
          <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
            {[
              { id: "evidence", label: "Evidence" },
              { id: "score", label: "Signal Details" },
              { id: "hook", label: "ERC-8183 Hook" },
              { id: "meta", label: "Analysis Meta" },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "8px 14px", background: tab === t.id ? "#1e293b" : "transparent",
                border: "1px solid #1e293b", borderRadius: 4, color: tab === t.id ? "#22c55e" : "#64748b",
                fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: tab === t.id ? 600 : 400,
              }}>{t.label}</button>
            ))}
          </div>

          <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: 20 }}>

            {/* ── EVIDENCE (default) ── */}
            {tab === "evidence" && (
              <div>
                {/* Flow diagram for sybil agents */}
                <FlowDiagram score={score} agent={agent} meta={meta} />

                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#94a3b8" }}>
                  FINDINGS ({meta?.clientWalletsAnalyzed} wallets traced, {meta?.jobsSampled} jobs sampled)
                </div>

                {Object.entries(score.signals).map(([key, sig]) => {
                  const meta2 = SIGNAL_LABELS[key] || { name: key };
                  const verdict = signalVerdict(sig.value);
                  const bad = sig.value < 50;
                  return (
                    <div key={key} style={{
                      padding: "12px 14px", marginBottom: 8,
                      background: bad ? "#1c111715" : "#111c1715",
                      borderRadius: 6, borderLeft: `3px solid ${verdict.color}`,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: verdict.color }}>
                          {verdict.label} — {meta2.name}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: verdict.color, fontFamily: "'JetBrains Mono', monospace" }}>
                          {sig.value}/100
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#c8cdd5", lineHeight: 1.6 }}>
                        {sig.evidence}
                      </div>
                    </div>
                  );
                })}

                <div style={{
                  marginTop: 14, padding: 12, borderRadius: 6, fontSize: 12, lineHeight: 1.6,
                  background: blocked ? "#ef444411" : "#22c55e11",
                  color: blocked ? "#fca5a5" : "#86efac",
                  border: `1px solid ${blocked ? "#ef444422" : "#22c55e22"}`,
                }}>
                  <strong>Assessment:</strong>{" "}
                  {blocked
                    ? `Patterns consistent with sybil farming. DAS ${score.das}/100 — this agent's revenue would be blocked at the settlement layer.`
                    : `Patterns consistent with organic demand. DAS ${score.das}/100 — this agent's revenue passes settlement checks.`
                  }
                </div>
              </div>
            )}

            {/* ── SIGNAL DETAILS ── */}
            {tab === "score" && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#94a3b8" }}>
                  DEMAND AUTHENTICITY SIGNALS
                </div>
                {Object.entries(score.signals).map(([key, sig]) => (
                  <SignalBar key={key} signalKey={key} sig={sig} blocked={blocked} />
                ))}

                {result.erc8004 && (
                  <div style={{ marginTop: 12, padding: "10px 12px", background: "#0a0e1780", border: "1px solid #22c55e33", borderRadius: 6, fontSize: 11 }}>
                    <div style={{ color: "#22c55e", fontWeight: 600, marginBottom: 4 }}>ERC-8004 Identity</div>
                    <div style={{ color: "#94a3b8" }}>Token #{result.erc8004.tokenId} on chain {result.erc8004.chainId} • Score: {result.erc8004.totalScore}</div>
                  </div>
                )}
              </div>
            )}

            {/* ── HOOK ── */}
            {tab === "hook" && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#94a3b8" }}>ERC-8183 HOOK SIMULATION</div>
                <div style={{ fontSize: 11, lineHeight: 2 }}>
                  <div style={{ color: "#64748b" }}>{"// SieveHook.beforeAction(complete)"}</div>
                  <div><span style={{ color: "#94a3b8" }}>provider:</span> <a href={bsLink(agent.wallet)} target="_blank" rel="noreferrer" style={{ color: "#22c55e", textDecoration: "none" }}>{shortAddr(agent.wallet)}</a></div>
                  <div><span style={{ color: "#94a3b8" }}>registry.getDAS():</span> <span style={{ color: dasColor(score.das) }}>{score.das}</span></div>
                  <div><span style={{ color: "#94a3b8" }}>threshold:</span> <span style={{ color: "#e2e8f0" }}>50</span></div>
                  <div><span style={{ color: "#94a3b8" }}>check:</span> <span style={{ color: "#e2e8f0" }}>{score.das} {score.das >= 50 ? ">=" : "<"} 50</span></div>
                  <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 4, background: blocked ? "#ef444411" : "#22c55e11", border: `1px solid ${blocked ? "#ef444433" : "#22c55e33"}` }}>
                    <span style={{ color: blocked ? "#ef4444" : "#22c55e", fontWeight: 700 }}>
                      {blocked ? "✗ SETTLEMENT BLOCKED — revert('DAS below threshold')" : "✓ SETTLEMENT ALLOWED"}
                    </span>
                  </div>
                  {!blocked && <div style={{ marginTop: 6, color: "#64748b" }}>{"// afterAction: emit DemandAuthenticated(jobId, provider, "}{score.das}{")"}</div>}
                </div>
                <div style={{ marginTop: 16, padding: "10px 12px", background: "#0a0e17", borderRadius: 6, fontSize: 10, color: "#475569" }}>
                  <div style={{ marginBottom: 4, color: "#64748b", fontWeight: 600 }}>Contract Architecture</div>
                  <div>SieveRegistry: {CONTRACTS.SIEVE_REGISTRY}</div>
                  <div>SieveHook: {CONTRACTS.SIEVE_HOOK}</div>
                  <div>ACP V1: {CONTRACTS.ACP_V1}</div>
                  <div>ACP V2: {CONTRACTS.ACP_V2}</div>
                </div>
              </div>
            )}

            {/* ── META (wallet, IDs, data sources) ── */}
            {tab === "meta" && meta && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#94a3b8" }}>ANALYSIS METADATA</div>

                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, color: "#64748b", marginBottom: 6 }}>Agent Identifiers</div>
                  <div>Wallet: <a href={bsLink(agent.wallet)} target="_blank" rel="noreferrer" style={{ color: "#22c55e", textDecoration: "none", fontFamily: "'JetBrains Mono', monospace" }}>{agent.wallet}</a></div>
                  {agent.virtualId && <div>Virtuals ID: #{agent.virtualId}</div>}
                  {agent.agdpId && <div>aGDP ID: #{agent.agdpId}</div>}
                  <div>Success Rate: {agent.successRate?.toFixed(1)}%</div>
                  <div>Total Jobs: {agent.jobs}</div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px", fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>
                  <div>Jobs sampled: <span style={{ color: "#e2e8f0" }}>{meta.jobsSampled}</span></div>
                  <div>Wallets traced: <span style={{ color: "#e2e8f0" }}>{meta.clientWalletsAnalyzed}/{meta.clientWalletsTotal}</span></div>
                  <div>Analysis time: <span style={{ color: "#e2e8f0" }}>{(meta.analysisDurationMs / 1000).toFixed(1)}s</span></div>
                  <div>From cache: <span style={{ color: meta.fromCache ? "#22c55e" : "#eab308" }}>{meta.fromCache ? "yes" : "fresh"}</span></div>
                  <div>Cached at: <span style={{ color: "#e2e8f0" }}>{new Date(meta.cachedAt).toLocaleString()}</span></div>
                  <div>Confidence: <span style={{ color: score.confidence === "high" ? "#22c55e" : "#eab308" }}>{score.confidence}</span></div>
                </div>

                <div style={{ fontSize: 11, color: "#64748b" }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Data Sources</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {meta.dataSources?.map(src => (
                      <span key={src} style={{ padding: "2px 8px", background: "#0a0e17", border: "1px solid #1e293b", borderRadius: 4, fontSize: 10 }}>{src}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer standards */}
          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { std: "ACP", desc: "Job history, client wallets, timing", color: "#3b82f6" },
              { std: "ERC-8004", desc: "Agent identity + reputation", color: "#a855f7" },
              { std: "ERC-8183", desc: "Settlement hook enforcement", color: "#22c55e" },
              { std: "Blockscout", desc: "On-chain fund tracing", color: "#f59e0b" },
            ].map(s => (
              <div key={s.std} style={{ flex: 1, minWidth: 160, padding: "10px 12px", background: "#111827", border: `1px solid ${s.color}33`, borderRadius: 6, fontSize: 10 }}>
                <div style={{ color: s.color, fontWeight: 700, marginBottom: 2 }}>{s.std}</div>
                <div style={{ color: "#64748b" }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ LANDING — LEADERBOARD ═══ */}
      {!result && !loading && (
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {leaderboard && leaderboard.filter(a => a.das != null).length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 10 }}>
                TOP {leaderboard.filter(a => a.das != null).length} aGDP AGENTS — SIEVE AUDIT
              </div>
              <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 75px 55px 50px 70px", padding: "8px 12px", fontSize: 10, color: "#475569", borderBottom: "1px solid #1e293b", fontWeight: 600 }}>
                  <span>#</span><span>Agent</span><span style={{ textAlign: "right" }}>Revenue</span>
                  <span style={{ textAlign: "right" }}>Buyers</span><span style={{ textAlign: "center" }}>DAS</span>
                  <span style={{ textAlign: "center" }}>Settlement</span>
                </div>
                {leaderboard.filter(a => a.das != null).map(a => {
                  const das = a.das;
                  const scored = das != null;
                  const v = a.verdict;
                  return (
                    <div key={a.agentId} onClick={() => handlePick(a)}
                      style={{ display: "grid", gridTemplateColumns: "36px 1fr 75px 55px 50px 70px", padding: "9px 12px", fontSize: 11, borderBottom: "1px solid #1e293b08", cursor: "pointer", alignItems: "center" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#1e293b"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <span style={{ color: "#475569" }}>{a.rank}</span>
                      <span style={{ color: "#e2e8f0", fontWeight: 500 }}>{a.name || a.agentName}</span>
                      <span style={{ textAlign: "right", color: "#94a3b8" }}>${(a.revenue || a.totalRevenue || 0).toFixed(0)}</span>
                      <span style={{ textAlign: "right", color: "#94a3b8" }}>{a.buyers || a.uniqueBuyerCount}</span>
                      <span style={{ textAlign: "center", fontWeight: 700, color: scored ? dasColor(das) : "#475569" }}>
                        {scored ? das : <span className="scanning">...</span>}
                      </span>
                      <span style={{ textAlign: "center", fontWeight: 600, fontSize: 10, color: v === "PASS" ? "#22c55e" : v === "BLOCK" ? "#ef4444" : "#475569" }}>
                        {scored ? (v === "BLOCK" ? "BLOCKED" : "ALLOWED") : <span className="scanning">Scanning</span>}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* DAS Legend */}
              <div style={{ marginTop: 10, padding: "10px 14px", background: "#111827", border: "1px solid #1e293b", borderRadius: 6, fontSize: 10, color: "#64748b", lineHeight: 1.8 }}>
                <span style={{ color: "#94a3b8", fontWeight: 600 }}>DAS</span> = Demand Authenticity Score (0-100). Scored by tracing buyer wallet funding sources on-chain.
                <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                  <span><span style={{ color: "#22c55e" }}>■</span> 70+ — Revenue appears organic</span>
                  <span><span style={{ color: "#eab308" }}>■</span> 50-69 — Some concerns, review evidence</span>
                  <span><span style={{ color: "#ef4444" }}>■</span> &lt;50 — Patterns consistent with sybil farming</span>
                </div>
                <div style={{ marginTop: 4, color: "#475569" }}>
                  Settlement = ERC-8183 hook verdict. BLOCKED agents cannot extract revenue at the protocol layer (threshold: 50).
                </div>
              </div>
            </div>
          )}

          {/* Signal cards */}
          <div style={{ textAlign: "center", padding: "20px 0 12px" }}>
            <div style={{ fontSize: 14, color: "#64748b" }}>Click any agent above to see the full audit</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, textAlign: "left" }}>
            {Object.entries(SIGNAL_LABELS).map(([key, s]) => (
              <div key={key} style={{ padding: "12px 14px", background: "#111827", border: "1px solid #1e293b", borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: "#22c55e", fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
                <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.5 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
