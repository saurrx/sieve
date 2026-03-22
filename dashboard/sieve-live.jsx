import { useState, useEffect, useRef, useCallback } from "react";

// ═══ CONFIG ═══
const API = {
  leaderboard: "https://api.virtuals.io/api/agdp-leaderboard-epochs/5/ranking?pagination[pageSize]=1000",
  jobLog: (id, page=1, size=50) => `https://acpx.virtuals.io/api/agdp/agent/${id}/job-log?pagination[page]=${page}&pagination[pageSize]=${size}`,
  virtualsAgent: (id) => `https://api.virtuals.io/api/virtuals/${id}`,
  erc8004Search: (q) => `https://www.8004scan.io/api/v1/agents?search=${encodeURIComponent(q)}&sort_by=total_score&sort_order=desc&limit=5&offset=0&is_testnet=false&is_registered=true`,
  erc8004Stats: (chain, tokenId) => `https://www.8004scan.io/api/v1/stats/agents/${chain}/${tokenId}`,
};

const WEIGHTS = { funder: 25, independence: 25, timing: 20, circular: 20, human: 10 };
const CONTRACTS = {
  ACP_V1: "0x6a1FE26D54ab0d3E1e3168f2e0c0cDa5cC0A0A4A",
  ACP_V2: "0xa6C9BA866992cfD7fd6460ba912bfa405adA9df0",
  SIEVE_REGISTRY: "0x5ieve000000000000000000000000000000000001",
  SIEVE_HOOK: "0x5ieve000000000000000000000000000000000002",
};

// ═══ SCORING ENGINE ═══
// Uses BOTH leaderboard data (agent-level) and job-log data (job-level)
function analyzeJobs(jobs, agentData, leaderboardIds) {
  if (!jobs || jobs.length < 3) return null;
  
  const totalSuccessfulJobs = agentData?.successfulJobCount || jobs.length;
  const uniqueBuyers = agentData?.uniqueBuyerCount || 1;
  const totalRevenue = agentData?.totalRevenue || 0;
  
  // ── Signal 1: Buyer Repeat Rate (25%) ──
  // Jobs per buyer. Organic agents: 2-7. Farming: 15-30+
  // Hyperbet: 25.3 jobs/buyer. Captain Dackie: 2.8.
  const jobsPerBuyer = uniqueBuyers > 0 ? totalSuccessfulJobs / uniqueBuyers : 999;
  // Score: 100 if ratio ≤ 3, linear decay to 0 at ratio 25+
  const repeatScore = Math.max(0, Math.min(100, Math.round(100 - ((jobsPerBuyer - 3) / 22) * 100)));
  
  // ── Signal 2: Buyer Pool Depth (25%) ──
  // How many unique buyers relative to job volume?
  // Organic: high buyer count. Farming: limited pool repeating.
  const buyerJobRatio = uniqueBuyers / Math.max(1, totalSuccessfulJobs);
  // Score: ratio > 0.3 = 100, ratio < 0.05 = 0
  const poolScore = Math.max(0, Math.min(100, Math.round((buyerJobRatio - 0.03) / 0.30 * 100)));
  
  // ── Signal 3: Timing Regularity (20%) ──
  const timestamps = jobs.map(j => new Date(j.createdAt).getTime()).sort((a,b) => a - b);
  const gaps = [];
  for (let i = 1; i < timestamps.length; i++) {
    gaps.push((timestamps[i] - timestamps[i-1]) / 1000);
  }
  
  let timingScore = 50;
  let avgGap = 0, minGap = 0, maxGap = 0, cv = 0;
  if (gaps.length > 5) {
    avgGap = gaps.reduce((s,v) => s+v, 0) / gaps.length;
    minGap = Math.min(...gaps);
    maxGap = Math.max(...gaps);
    const variance = gaps.reduce((s,v) => s + (v-avgGap)*(v-avgGap), 0) / gaps.length;
    cv = avgGap > 0 ? Math.sqrt(variance) / avgGap : 0;
    // Very low min gaps (<20s) with high job counts = bot pattern
    // But many legit agents also have fast automated responses
    // Best signal: ratio of sub-30s gaps
    const fastGaps = gaps.filter(g => g < 30).length;
    const fastRatio = fastGaps / gaps.length;
    // Combined: penalize if >80% of gaps are under 30s AND jobs/buyer is high
    if (fastRatio > 0.7 && jobsPerBuyer > 10) {
      timingScore = Math.max(0, Math.round((1 - fastRatio) * 100));
    } else {
      timingScore = Math.min(100, Math.max(20, Math.round(cv * 30 + (1 - fastRatio) * 50)));
    }
  }
  
  // ── Signal 4: Client Concentration in Job Log (20%) ──
  const clientCounts = {};
  jobs.forEach(j => { clientCounts[j.clientId] = (clientCounts[j.clientId]||0) + 1; });
  const uniqueClientsInSample = Object.keys(clientCounts).length;
  const topClientShare = Math.max(...Object.values(clientCounts)) / jobs.length;
  // Also check: how many clients appear in the leaderboard (are they real agents)?
  let clientsInLeaderboard = 0;
  if (leaderboardIds) {
    const clientIds = Object.keys(clientCounts).map(Number);
    clientsInLeaderboard = clientIds.filter(id => leaderboardIds.has(id)).length;
  }
  const concentrationScore = Math.max(0, Math.min(100, Math.round((1 - topClientShare) * 80 + (clientsInLeaderboard > 0 ? 20 : 0))));
  
  // ── Signal 5: Human Attestation (10%) ──
  const humanScore = 0; // Would check World ID in production
  
  // ── Composite DAS ──
  const das = Math.round(
    (repeatScore * WEIGHTS.funder +
     poolScore * WEIGHTS.independence +
     timingScore * WEIGHTS.timing +
     concentrationScore * WEIGHTS.circular +
     humanScore * WEIGHTS.human) / 100
  );
  
  const hhi = Object.values(clientCounts).map(c => c/jobs.length).reduce((s,v) => s + v*v, 0);
  
  return {
    das,
    signals: { funder: repeatScore, independence: poolScore, timing: timingScore, circular: concentrationScore, human: humanScore },
    stats: {
      uniqueClients: uniqueClientsInSample,
      totalJobs: jobs.length,
      jobsPerBuyer: jobsPerBuyer.toFixed(1),
      uniqueBuyers,
      avgGap: avgGap.toFixed(1),
      minGap: minGap.toFixed(1),
      maxGap: maxGap.toFixed(1),
      cv: cv.toFixed(2),
      topClientShare: (topClientShare * 100).toFixed(1),
      hhi: hhi.toFixed(4),
      clientsInLeaderboard,
      revenuePerBuyer: uniqueBuyers > 0 ? (totalRevenue / uniqueBuyers).toFixed(0) : "N/A",
    },
    verdict: das >= 50 ? "PASS" : "BLOCK",
    clientNames: Object.entries(clientCounts)
      .sort((a,b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => {
        const job = jobs.find(j => j.clientId === Number(id));
        return { id, name: job?.clientName || `Agent #${id}`, count, pct: ((count/jobs.length)*100).toFixed(1) };
      }),
  };
}

// ═══ GAUGE COMPONENT ═══
function DASGauge({ score, size = 180 }) {
  const r = size * 0.38;
  const cx = size/2, cy = size/2 + 8;
  const startAngle = -210 * Math.PI / 180;
  const endAngle = 30 * Math.PI / 180;
  const range = endAngle - startAngle;
  const scoreAngle = startAngle + (score/100) * range;
  
  const arcPath = (from, to) => {
    const x1 = cx + r * Math.cos(from), y1 = cy + r * Math.sin(from);
    const x2 = cx + r * Math.cos(to), y2 = cy + r * Math.sin(to);
    const large = (to - from) > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };
  
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#eab308" : "#ef4444";
  
  return (
    <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.72}`}>
      <path d={arcPath(startAngle, endAngle)} fill="none" stroke="#1e293b" strokeWidth={10} strokeLinecap="round" />
      {score > 0 && <path d={arcPath(startAngle, scoreAngle)} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" />}
      <text x={cx} y={cy - 8} textAnchor="middle" fill={color} fontSize={size * 0.22} fontWeight="800" fontFamily="'JetBrains Mono', monospace">{score}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#94a3b8" fontSize={10} fontFamily="'JetBrains Mono', monospace">/100 DAS</text>
    </svg>
  );
}

// ═══ SIGNAL BAR ═══
function SignalBar({ label, value, weight, color }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginBottom: 3, fontFamily: "'JetBrains Mono', monospace" }}>
        <span>{label} <span style={{ opacity: 0.5 }}>({weight}%)</span></span>
        <span style={{ color: value >= 50 ? "#22c55e" : "#ef4444" }}>{value}/100</span>
      </div>
      <div style={{ height: 6, background: "#1e293b", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${value}%`, height: "100%", background: color || (value >= 50 ? "#22c55e" : "#ef4444"), borderRadius: 3, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}

// ═══ MAIN APP ═══
export default function SieveLive() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [leaderboard, setLeaderboard] = useState(null);
  const [agent, setAgent] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [erc8004, setErc8004] = useState(null);
  const [rawJobs, setRawJobs] = useState([]);
  const [tab, setTab] = useState("score");
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  // Load leaderboard on mount
  useEffect(() => {
    fetch(API.leaderboard)
      .then(r => r.json())
      .then(d => setLeaderboard(d.data || []))
      .catch(() => setLeaderboard([]));
  }, []);

  // Parse input to find agent
  const parseInput = useCallback((val) => {
    if (!val || !leaderboard) return null;
    val = val.trim();
    
    // URL: app.virtuals.io/virtuals/42524
    const urlMatch = val.match(/virtuals\/(\d+)/);
    if (urlMatch) {
      const vid = urlMatch[1];
      return leaderboard.find(a => String(a.virtualAgentId) === vid || String(a.virtual?.id) === vid);
    }
    
    // agdp.io/agent/12381
    const agdpMatch = val.match(/agent\/(\d+)/);
    if (agdpMatch) {
      return leaderboard.find(a => String(a.agentId) === agdpMatch[1]);
    }
    
    // Pure number - try as Virtuals ID first, then agdp ID
    if (/^\d+$/.test(val)) {
      return leaderboard.find(a => String(a.virtualAgentId) === val) || 
             leaderboard.find(a => String(a.agentId) === val);
    }
    
    // Wallet address
    if (val.startsWith("0x") && val.length === 42) {
      return leaderboard.find(a => a.agentWalletAddress?.toLowerCase() === val.toLowerCase());
    }
    
    // Name match
    return leaderboard.find(a => a.agentName?.toLowerCase() === val.toLowerCase());
  }, [leaderboard]);

  // Search suggestions
  useEffect(() => {
    if (!leaderboard || !input || input.length < 2) { setSuggestions([]); return; }
    const q = input.toLowerCase();
    const matches = leaderboard
      .filter(a => a.agentName?.toLowerCase().includes(q))
      .slice(0, 6);
    setSuggestions(matches);
  }, [input, leaderboard]);

  // Fetch and analyze agent
  const analyzeAgent = useCallback(async (agentData) => {
    if (!agentData) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setErc8004(null);
    setRawJobs([]);
    setAgent(agentData);
    setSuggestions([]);
    
    try {
      // Fetch job log (sample multiple pages for better analysis)
      setLoadingMsg("Fetching job history...");
      const allJobs = [];
      const pagesToFetch = Math.min(5, Math.ceil((agentData.successfulJobCount || 100) / 50));
      
      for (let p = 1; p <= pagesToFetch; p++) {
        setLoadingMsg(`Fetching jobs page ${p}/${pagesToFetch}...`);
        try {
          const res = await fetch(API.jobLog(agentData.agentId, p, 50));
          const data = await res.json();
          if (data.data) allJobs.push(...data.data);
          if (!data.data || data.data.length < 50) break;
        } catch { break; }
      }
      
      setRawJobs(allJobs);
      
      // Run scoring
      setLoadingMsg("Running demand authenticity analysis...");
      await new Promise(r => setTimeout(r, 300));
      const lbIds = leaderboard ? new Set(leaderboard.map(a => a.agentId)) : null;
      const result = analyzeJobs(allJobs, agentData, lbIds);
      setAnalysis(result);
      
      // Try 8004scan
      setLoadingMsg("Checking ERC-8004 identity...");
      try {
        const wallet = agentData.agentWalletAddress;
        if (wallet) {
          const res = await fetch(API.erc8004Search(wallet));
          const data = await res.json();
          if (data.items?.length > 0) {
            const match = data.items[0];
            // Fetch detailed stats
            const statsRes = await fetch(API.erc8004Stats(match.chain_id, match.token_id));
            const stats = await statsRes.json();
            setErc8004({ ...match, stats });
          }
        }
      } catch { /* CORS or not found - skip */ }
      
      setLoadingMsg("");
    } catch (e) {
      setError(`Analysis failed: ${e.message}`);
    }
    setLoading(false);
  }, []);

  const handleSubmit = (e) => {
    e?.preventDefault();
    const found = parseInput(input);
    if (found) analyzeAgent(found);
    else setError("Agent not found in leaderboard. Try a name, Virtuals URL, or agdp ID.");
  };

  const handleQuickPick = (name) => {
    if (!leaderboard) return;
    const found = leaderboard.find(a => a.agentName === name);
    if (found) { setInput(name); analyzeAgent(found); }
  };

  const dasColor = (s) => s >= 70 ? "#22c55e" : s >= 40 ? "#eab308" : "#ef4444";

  return (
    <div style={{ 
      minHeight: "100vh", 
      background: "#0a0e17", 
      color: "#e2e8f0", 
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      padding: "20px 16px",
    }}>
      {/* Header */}
      <div style={{ maxWidth: 800, margin: "0 auto", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px" }}>
            <span style={{ color: "#22c55e" }}>◆</span> SIEVE
          </span>
          <span style={{ fontSize: 10, color: "#475569", padding: "2px 6px", border: "1px solid #1e293b", borderRadius: 4 }}>
            ERC-8183 • ERC-8004 • ACP
          </span>
        </div>
        <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>
          Demand Authenticity Engine — separating real agent revenue from sybil farming
        </p>
      </div>

      {/* Search */}
      <div style={{ maxWidth: 800, margin: "0 auto", marginBottom: 20, position: "relative" }}>
        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Paste Virtuals URL, agent name, wallet, or agdp ID..."
              style={{
                width: "100%", padding: "10px 14px", background: "#111827", border: "1px solid #1e293b",
                borderRadius: 6, color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none",
                boxSizing: "border-box",
              }}
              onFocus={e => e.target.style.borderColor = "#22c55e"}
              onBlur={e => e.target.style.borderColor = "#1e293b"}
            />
            {suggestions.length > 0 && !loading && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
                background: "#111827", border: "1px solid #1e293b", borderRadius: 6, marginTop: 4,
                maxHeight: 200, overflowY: "auto",
              }}>
                {suggestions.map(s => (
                  <div key={s.agentId}
                    onClick={() => { setInput(s.agentName); analyzeAgent(s); }}
                    style={{
                      padding: "8px 12px", cursor: "pointer", fontSize: 12,
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      borderBottom: "1px solid #1e293b",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "#1e293b"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span>{s.agentName} <span style={{ color: "#475569" }}>#{s.agentId}</span></span>
                    <span style={{ color: "#64748b", fontSize: 10 }}>${s.totalRevenue?.toFixed(0)} rev • {s.uniqueBuyerCount} buyers</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button type="submit" disabled={loading} style={{
            padding: "10px 20px", background: "#22c55e", color: "#0a0e17", border: "none",
            borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            opacity: loading ? 0.5 : 1,
          }}>
            {loading ? "..." : "SIEVE"}
          </button>
        </form>
        
        {/* Quick picks */}
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: "#475569", lineHeight: "22px" }}>Try:</span>
          {["Hyperbet", "Capminal", "Loopuman", "Swarmzilla"].map(name => (
            <button key={name} onClick={() => handleQuickPick(name)} style={{
              padding: "2px 8px", background: "#111827", border: "1px solid #1e293b",
              borderRadius: 4, color: "#94a3b8", fontSize: 10, cursor: "pointer", fontFamily: "inherit",
            }}>{name}</button>
          ))}
          <span style={{ fontSize: 10, color: "#475569", lineHeight: "22px", marginLeft: 4 }}>
            {leaderboard ? `${leaderboard.length} agents indexed` : "Loading leaderboard..."}
          </span>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 20, marginBottom: 8 }}>◆</div>
          <div style={{ fontSize: 12, color: "#22c55e", animation: "pulse 1.5s infinite" }}>{loadingMsg}</div>
          <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.5 } }`}</style>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "10px 14px", background: "#1c1117", border: "1px solid #ef444433", borderRadius: 6, color: "#ef4444", fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Results */}
      {agent && analysis && !loading && (
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          {/* Agent Header */}
          <div style={{ 
            background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: 20, marginBottom: 16,
            display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
          }}>
            <DASGauge score={analysis.das} size={160} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{agent.agentName}</span>
                <span style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                  background: analysis.verdict === "PASS" ? "#22c55e22" : "#ef444422",
                  color: analysis.verdict === "PASS" ? "#22c55e" : "#ef4444",
                  border: `1px solid ${analysis.verdict === "PASS" ? "#22c55e44" : "#ef444444"}`,
                }}>{analysis.verdict}</span>
              </div>
              
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: 11, color: "#94a3b8" }}>
                <div>Raw Revenue: <span style={{ color: "#e2e8f0" }}>${agent.totalRevenue?.toFixed(0)}</span></div>
                <div>Unique Buyers: <span style={{ color: "#e2e8f0" }}>{agent.uniqueBuyerCount}</span></div>
                <div>Success Rate: <span style={{ color: "#e2e8f0" }}>{agent.successRate?.toFixed(1)}%</span></div>
                <div>Total Jobs: <span style={{ color: "#e2e8f0" }}>{agent.successfulJobCount}</span></div>
                <div>Leaderboard Rank: <span style={{ color: "#eab308" }}>#{agent.rank}</span></div>
                <div>Category: <span style={{ color: "#e2e8f0" }}>{agent.category || "N/A"}</span></div>
              </div>
              
              <div style={{ fontSize: 10, color: "#475569", marginTop: 6, wordBreak: "break-all" }}>
                Wallet: {agent.agentWalletAddress}
              </div>
              {agent.virtualAgentId && (
                <div style={{ fontSize: 10, color: "#475569" }}>
                  Virtuals #{agent.virtualAgentId} • agdp #{agent.agentId}
                  {agent.twitterHandle && ` • @${agent.twitterHandle}`}
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2, marginBottom: 16 }}>
            {[
              { id: "score", label: "Score Breakdown" },
              { id: "evidence", label: "Evidence" },
              { id: "hook", label: "ERC-8183 Hook" },
              { id: "clients", label: "Top Clients" },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: "8px 14px", background: tab === t.id ? "#1e293b" : "transparent",
                border: "1px solid #1e293b", borderRadius: 4, color: tab === t.id ? "#22c55e" : "#64748b",
                fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: tab === t.id ? 600 : 400,
              }}>{t.label}</button>
            ))}
          </div>

          {/* Tab Content */}
          <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, padding: 20 }}>
            
            {/* SCORE BREAKDOWN */}
            {tab === "score" && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#94a3b8" }}>
                  DEMAND AUTHENTICITY SIGNALS
                </div>
                <SignalBar label="Buyer Repeat Rate" value={analysis.signals.funder} weight={WEIGHTS.funder} />
                <SignalBar label="Buyer Pool Depth" value={analysis.signals.independence} weight={WEIGHTS.independence} />
                <SignalBar label="Timing Regularity" value={analysis.signals.timing} weight={WEIGHTS.timing} />
                <SignalBar label="Client Concentration" value={analysis.signals.circular} weight={WEIGHTS.circular} />
                <SignalBar label="Human Attestation" value={analysis.signals.human} weight={WEIGHTS.human} color="#475569" />
                
                <div style={{ marginTop: 16, padding: "10px 12px", background: "#0a0e17", borderRadius: 6, fontSize: 11, color: "#64748b" }}>
                  <div style={{ marginBottom: 4, color: "#94a3b8", fontWeight: 600 }}>Analysis Stats ({rawJobs.length} jobs sampled)</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
                    <span>Jobs/buyer: <b style={{color: parseFloat(analysis.stats.jobsPerBuyer) > 15 ? "#ef4444" : "#22c55e"}}>{analysis.stats.jobsPerBuyer}</b></span>
                    <span>Unique buyers: {analysis.stats.uniqueBuyers}</span>
                    <span>Rev/buyer: ${analysis.stats.revenuePerBuyer}</span>
                    <span>Top client share: {analysis.stats.topClientShare}%</span>
                    <span>Avg gap: {analysis.stats.avgGap}s</span>
                    <span>CV: {analysis.stats.cv}</span>
                    <span>Clients in sample: {analysis.stats.uniqueClients}</span>
                    <span>Clients on LB: {analysis.stats.clientsInLeaderboard}</span>
                  </div>
                </div>

                {/* ERC-8004 if found */}
                {erc8004 && (
                  <div style={{ marginTop: 12, padding: "10px 12px", background: "#0a0e1780", border: "1px solid #22c55e33", borderRadius: 6, fontSize: 11 }}>
                    <div style={{ color: "#22c55e", fontWeight: 600, marginBottom: 4 }}>ERC-8004 Identity Found</div>
                    <div style={{ color: "#94a3b8" }}>
                      Token #{erc8004.token_id} on chain {erc8004.chain_id} • Score: {erc8004.total_score} • Feedbacks: {erc8004.total_feedbacks}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* EVIDENCE */}
            {tab === "evidence" && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#94a3b8" }}>
                  ON-CHAIN EVIDENCE ({rawJobs.length} jobs analyzed)
                </div>
                
                {analysis.das < 40 ? (
                  <div>
                    {[
                      { icon: "⚠", text: `Abnormal repeat rate: ${analysis.stats.jobsPerBuyer} jobs/buyer (organic range: 2-7)`, bad: parseFloat(analysis.stats.jobsPerBuyer) > 10 },
                      { icon: "⚠", text: `${analysis.stats.uniqueBuyers} buyers generated ${agent.successfulJobCount} jobs — repeat clients dominating`, bad: parseFloat(analysis.stats.jobsPerBuyer) > 10 },
                      { icon: "⚠", text: `Revenue per buyer: $${analysis.stats.revenuePerBuyer} (consistent with recycled funds)`, bad: true },
                      { icon: "⚠", text: `Avg timing gap: ${analysis.stats.avgGap}s between jobs (CV: ${analysis.stats.cv})`, bad: parseFloat(analysis.stats.avgGap) < 30 },
                      { icon: "⚠", text: `${analysis.stats.clientsInLeaderboard} of ${analysis.stats.uniqueClients} sampled clients are known ecosystem agents`, bad: analysis.stats.clientsInLeaderboard === 0 },
                      { icon: "✗", text: `Zero buyer wallets have World ID attestation`, bad: true },
                    ].map((e, i) => (
                      <div key={i} style={{ padding: "8px 10px", marginBottom: 6, background: e.bad ? "#1c111733" : "#111c1733", borderRadius: 4, borderLeft: `3px solid ${e.bad ? "#ef4444" : "#22c55e"}`, fontSize: 11, color: e.bad ? "#fca5a5" : "#86efac" }}>
                        {e.icon} {e.text}
                      </div>
                    ))}
                    <div style={{ marginTop: 12, padding: 10, background: "#ef444411", borderRadius: 6, fontSize: 11, color: "#fca5a5" }}>
                      <strong>Assessment:</strong> This agent shows patterns consistent with sybil farming — extreme job/buyer ratio,
                      mechanical timing, and clients that don't exist elsewhere in the ecosystem. DAS {analysis.das}/100 → revenue likely inflated.
                    </div>
                  </div>
                ) : (
                  <div>
                    {[
                      { icon: "✓", text: `Healthy repeat rate: ${analysis.stats.jobsPerBuyer} jobs/buyer (organic range: 2-7)`, good: parseFloat(analysis.stats.jobsPerBuyer) < 10 },
                      { icon: "✓", text: `${analysis.stats.uniqueBuyers} unique buyers — diverse demand pool`, good: true },
                      { icon: "✓", text: `Revenue per buyer: $${analysis.stats.revenuePerBuyer} (reasonable for service pricing)`, good: true },
                      { icon: analysis.stats.clientsInLeaderboard > 0 ? "✓" : "○", text: `${analysis.stats.clientsInLeaderboard} of ${analysis.stats.uniqueClients} sampled clients are known ecosystem agents`, good: analysis.stats.clientsInLeaderboard > 0 },
                      { icon: "○", text: `No World ID attestation detected (not required for pass)`, good: false },
                    ].map((e, i) => (
                      <div key={i} style={{ padding: "8px 10px", marginBottom: 6, background: e.good ? "#111c1733" : "#11182766", borderRadius: 4, borderLeft: `3px solid ${e.good ? "#22c55e" : "#475569"}`, fontSize: 11, color: e.good ? "#86efac" : "#94a3b8" }}>
                        {e.icon} {e.text}
                      </div>
                    ))}
                    <div style={{ marginTop: 12, padding: 10, background: "#22c55e11", borderRadius: 6, fontSize: 11, color: "#86efac" }}>
                      <strong>Assessment:</strong> This agent shows patterns consistent with organic demand — reasonable buyer repeat rate,
                      diverse demand pool, distributed revenue. DAS {analysis.das}/100 → revenue appears legitimate.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* HOOK SIMULATION */}
            {tab === "hook" && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#94a3b8" }}>
                  ERC-8183 HOOK SIMULATION
                </div>
                
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 2 }}>
                  <div style={{ color: "#64748b" }}>{"// SieveHook.beforeAction(complete)"}</div>
                  <div><span style={{ color: "#94a3b8" }}>provider:</span> <span style={{ color: "#22c55e" }}>{agent.agentWalletAddress?.slice(0,10)}...{agent.agentWalletAddress?.slice(-6)}</span></div>
                  <div><span style={{ color: "#94a3b8" }}>registry.getDAS():</span> <span style={{ color: dasColor(analysis.das) }}>{analysis.das}</span></div>
                  <div><span style={{ color: "#94a3b8" }}>threshold:</span> <span style={{ color: "#e2e8f0" }}>50</span></div>
                  <div><span style={{ color: "#94a3b8" }}>check:</span> <span style={{ color: "#e2e8f0" }}>{analysis.das} {analysis.das >= 50 ? ">=" : "<"} 50</span></div>
                  <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 4, background: analysis.verdict === "PASS" ? "#22c55e11" : "#ef444411", border: `1px solid ${analysis.verdict === "PASS" ? "#22c55e33" : "#ef444433"}` }}>
                    <span style={{ color: analysis.verdict === "PASS" ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                      {analysis.verdict === "PASS" ? "✓ SETTLEMENT ALLOWED" : "✗ SETTLEMENT BLOCKED — revert('DAS below threshold')"}
                    </span>
                  </div>
                  
                  {analysis.verdict === "PASS" && (
                    <div style={{ marginTop: 6, color: "#64748b" }}>
                      {"// afterAction: emit DemandAuthenticated(jobId, provider, "}{analysis.das}{")"}
                    </div>
                  )}
                </div>

                {/* Contract addresses */}
                <div style={{ marginTop: 16, padding: "10px 12px", background: "#0a0e17", borderRadius: 6, fontSize: 10, color: "#475569" }}>
                  <div style={{ marginBottom: 4, color: "#64748b", fontWeight: 600 }}>Sieve Contract Architecture</div>
                  <div>SieveRegistry: {CONTRACTS.SIEVE_REGISTRY}</div>
                  <div>SieveHook: {CONTRACTS.SIEVE_HOOK}</div>
                  <div>ACP V1: {CONTRACTS.ACP_V1}</div>
                  <div>ACP V2: {CONTRACTS.ACP_V2}</div>
                </div>
              </div>
            )}

            {/* TOP CLIENTS */}
            {tab === "clients" && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: "#94a3b8" }}>
                  TOP CLIENTS BY JOB COUNT (from {rawJobs.length} sampled jobs)
                </div>
                
                <div style={{ fontSize: 11 }}>
                  {analysis.clientNames.map((c, i) => (
                    <div key={c.id} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "6px 0",
                      borderBottom: "1px solid #1e293b",
                    }}>
                      <span style={{ color: "#475569", width: 20, textAlign: "right" }}>#{i+1}</span>
                      <span style={{ flex: 1, color: "#e2e8f0" }}>{c.name}</span>
                      <span style={{ color: "#64748b" }}>ID: {c.id}</span>
                      <span style={{ color: parseFloat(c.pct) > 30 ? "#ef4444" : "#22c55e", fontWeight: 600, width: 50, textAlign: "right" }}>
                        {c.pct}%
                      </span>
                      <span style={{ color: "#94a3b8", width: 50, textAlign: "right" }}>{c.count} jobs</span>
                    </div>
                  ))}
                </div>

                {analysis.clientNames.length > 0 && analysis.clientNames[0] && parseFloat(analysis.clientNames[0].pct) > 30 && (
                  <div style={{ marginTop: 12, padding: 10, background: "#ef444411", borderRadius: 6, fontSize: 11, color: "#fca5a5" }}>
                    ⚠ Top client ({analysis.clientNames[0].name}) accounts for {analysis.clientNames[0].pct}% of sampled jobs — high concentration risk.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Three Standards Footer */}
          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { std: "ACP", desc: "Data source — job history, payments, timing", color: "#3b82f6" },
              { std: "ERC-8004", desc: "Identity + reputation cross-reference", color: "#a855f7" },
              { std: "ERC-8183", desc: "Settlement hook — block or pass", color: "#22c55e" },
            ].map(s => (
              <div key={s.std} style={{
                flex: 1, minWidth: 180, padding: "10px 12px", background: "#111827", border: `1px solid ${s.color}33`,
                borderRadius: 6, fontSize: 10,
              }}>
                <div style={{ color: s.color, fontWeight: 700, marginBottom: 2 }}>{s.std}</div>
                <div style={{ color: "#64748b" }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Landing state */}
      {!agent && !loading && (
        <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>◆</div>
          <div style={{ fontSize: 14, color: "#64748b", marginBottom: 8 }}>
            Enter any ACP agent to analyze demand authenticity
          </div>
          <div style={{ fontSize: 11, color: "#475569", maxWidth: 500, margin: "0 auto", lineHeight: 1.7 }}>
            Sieve analyzes job-level data from Virtuals ACP to score whether an agent's revenue comes from
            real independent demand or sybil farming. Paste a Virtuals URL, agent name, or wallet address above.
          </div>
          
          <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, textAlign: "left" }}>
            {[
              { signal: "Buyer Repeat Rate", desc: "How many jobs per buyer? Organic agents: 2-7. Farming bots: 15-30+." },
              { signal: "Buyer Pool Depth", desc: "Unique buyers relative to job volume. Farming = small pool repeating." },
              { signal: "Timing Regularity", desc: "Are jobs spaced organically, or at machine-precision intervals?" },
              { signal: "Client Concentration", desc: "Do a few clients dominate? Are clients known ecosystem agents?" },
              { signal: "Human Attestation", desc: "Do buyer wallets have World ID proof-of-human?" },
            ].map(s => (
              <div key={s.signal} style={{ padding: "12px 14px", background: "#111827", border: "1px solid #1e293b", borderRadius: 6 }}>
                <div style={{ fontSize: 11, color: "#22c55e", fontWeight: 600, marginBottom: 4 }}>{s.signal}</div>
                <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.5 }}>{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
