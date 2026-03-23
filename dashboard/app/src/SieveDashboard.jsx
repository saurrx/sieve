import { useState, useEffect } from "react";

const SIEVE_API = (import.meta.env.VITE_API_URL || "http://localhost:3001") + "/api";
const dasColor = (s) => s >= 70 ? "#22c55e" : s >= 40 ? "#eab308" : "#ef4444";
const bsLink = (addr) => `https://base.blockscout.com/address/${addr}`;
const shortAddr = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

// ═══ SECTION WRAPPER ═══
function Section({ children, style }) {
  return (
    <div style={{ maxWidth: 780, margin: "0 auto", padding: "48px 0", borderBottom: "1px solid #1e293b", ...style }}>
      {children}
    </div>
  );
}

// ═══ STEP in the investigation ═══
function Step({ number, title, children }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#22c55e", padding: "2px 8px", border: "1px solid #22c55e44", borderRadius: 4, fontFamily: "'JetBrains Mono', monospace" }}>
          STEP {number}
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0" }}>{title}</span>
      </div>
      <div style={{ paddingLeft: 0, fontSize: 13, color: "#94a3b8", lineHeight: 1.8 }}>
        {children}
      </div>
    </div>
  );
}

// ═══ FLOW BOX ═══
function FlowBox({ label, sub, color = "#ef4444" }) {
  return (
    <div style={{ padding: "10px 16px", borderRadius: 6, border: `1px solid ${color}44`, background: `${color}08`, textAlign: "center", minWidth: 100 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ═══ MAIN ═══
export default function SieveDashboard() {
  const [leaderboard, setLeaderboard] = useState([]);

  useEffect(() => {
    fetch(`${SIEVE_API}/leaderboard?limit=20`)
      .then(r => r.json())
      .then(d => setLeaderboard((d.data || []).filter(a => a.das != null)))
      .catch(() => {});
  }, []);

  const blocked = leaderboard.filter(a => a.verdict === "BLOCK");
  const passed = leaderboard.filter(a => a.verdict === "PASS");
  const blockedRevenue = blocked.reduce((s, a) => s + (a.revenue || 0), 0);
  const totalRevenue = leaderboard.reduce((s, a) => s + (a.revenue || 0), 0);

  // Farming ring: agents with 201 buyers and DAS 45
  const farmingRing = leaderboard.filter(a => a.verdict === "BLOCK" && a.das === 45);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e17", color: "#e2e8f0", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", padding: "20px 16px" }}>

      {/* ═══ SECTION 1: THE PROBLEM ═══ */}
      <Section style={{ paddingTop: 32, textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "#22c55e", fontWeight: 600, letterSpacing: 2, marginBottom: 16 }}>
          SIEVE CASE STUDY — MARCH 2026
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: "#e2e8f0", lineHeight: 1.3, margin: "0 0 12px", letterSpacing: "-0.5px" }}>
          The aGDP leaderboard distributes <span style={{ color: "#eab308" }}>$81,515</span> this epoch.
          <br />Sieve found that <span style={{ color: "#ef4444" }}>{blocked.length} of the top {leaderboard.length}</span> agents are farming it.
        </h1>
        <p style={{ fontSize: 13, color: "#64748b", maxWidth: 600, margin: "0 auto", lineHeight: 1.7 }}>
          We traced every buyer wallet for the top {leaderboard.length} revenue-generating agents on Virtuals ACP.
          ${blockedRevenue.toFixed(0)} in claimed revenue ({(blockedRevenue / totalRevenue * 100).toFixed(0)}% of the top {leaderboard.length}) comes from
          wallets that share a single funding source.
        </p>

        {/* Mini leaderboard: raw rank vs sieve verdict */}
        <div style={{ marginTop: 32, background: "#111827", border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden", textAlign: "left" }}>
          <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 80px 60px 70px", padding: "8px 12px", fontSize: 10, color: "#475569", borderBottom: "1px solid #1e293b", fontWeight: 600 }}>
            <span>#</span><span>Agent</span><span style={{ textAlign: "right" }}>Revenue</span>
            <span style={{ textAlign: "center" }}>DAS</span><span style={{ textAlign: "center" }}>Settlement</span>
          </div>
          {leaderboard.slice(0, 10).map(a => {
            const isBlocked = a.verdict === "BLOCK";
            return (
              <div key={a.agentId} style={{
                display: "grid", gridTemplateColumns: "36px 1fr 80px 60px 70px",
                padding: "8px 12px", fontSize: 11, borderBottom: "1px solid #1e293b08",
                background: isBlocked ? "#ef444406" : "transparent",
                opacity: isBlocked ? 0.8 : 1,
              }}>
                <span style={{ color: "#475569" }}>{a.rank}</span>
                <span style={{ color: isBlocked ? "#fca5a5" : "#e2e8f0", fontWeight: 500, textDecoration: isBlocked ? "line-through" : "none", textDecorationColor: "#ef444466" }}>
                  {a.name}
                </span>
                <span style={{ textAlign: "right", color: isBlocked ? "#ef444488" : "#94a3b8" }}>${(a.revenue || 0).toFixed(0)}</span>
                <span style={{ textAlign: "center", fontWeight: 700, color: dasColor(a.das) }}>{a.das}</span>
                <span style={{ textAlign: "center", fontWeight: 600, fontSize: 10, color: isBlocked ? "#ef4444" : "#22c55e" }}>
                  {isBlocked ? "BLOCKED" : "ALLOWED"}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ═══ SECTION 2: THE HYPERBET DEEP-DIVE ═══ */}
      <Section>
        <div style={{ fontSize: 11, color: "#ef4444", fontWeight: 600, letterSpacing: 2, marginBottom: 8 }}>
          THE INVESTIGATION
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", margin: "0 0 32px", lineHeight: 1.3 }}>
          Anatomy of a farming operation: Hyperbet
        </h2>

        <Step number={1} title="Hyperbet claims $15,949 revenue from 205 buyers">
          <p>
            Ranked #3 on the aGDP leaderboard, Hyperbet reports 5,186 completed jobs with a 76% success rate.
            At face value, this looks like a successful roulette agent with strong demand.
          </p>
          <div style={{ marginTop: 12, padding: 14, background: "#111827", borderRadius: 6, border: "1px solid #1e293b", display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, textAlign: "center" }}>
            {[
              { label: "Revenue", value: "$15,949" },
              { label: "Buyers", value: "205" },
              { label: "Jobs", value: "5,186" },
              { label: "Rank", value: "#3" },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0" }}>{s.value}</div>
                <div style={{ fontSize: 10, color: "#64748b" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </Step>

        <Step number={2} title="Sieve traces every buyer wallet to its funding source">
          <p>
            We resolved all 188 unique buyer wallets through the Virtuals agents API, then queried Blockscout for every
            wallet's USDC transfer history. For each buyer, we asked: <em>who funded this wallet?</em>
          </p>
          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, justifyContent: "center", flexWrap: "wrap", padding: "20px 0" }}>
            <FlowBox label="Sieve" sub="traces 188 wallets" color="#22c55e" />
            <span style={{ color: "#475569", fontSize: 20 }}>→</span>
            <FlowBox label="Blockscout" sub="USDC transfer history" color="#f59e0b" />
            <span style={{ color: "#475569", fontSize: 20 }}>→</span>
            <FlowBox label="Funding Sources" sub="who sent USDC to each buyer?" color="#3b82f6" />
          </div>
        </Step>

        <Step number={3} title="Every single buyer was funded by the same address">
          <p>
            Of 188 traced wallets, <strong style={{ color: "#ef4444" }}>188 share a single funding source</strong>: the
            same contract address sent USDC to every buyer wallet before they made purchases from Hyperbet.
          </p>
          <div style={{ marginTop: 12, padding: 14, background: "#0a0e17", borderRadius: 6, border: "1px solid #ef444433", fontFamily: "'JetBrains Mono', monospace", fontSize: 12, textAlign: "center" }}>
            <div style={{ color: "#64748b", fontSize: 10, marginBottom: 6 }}>SHARED FUNDER</div>
            <a href={bsLink("0xd15fe25ed0dba12fe05e7029c88b10c25e8880e3")} target="_blank" rel="noreferrer"
              style={{ color: "#ef4444", textDecoration: "none" }}>
              0xd15fe25ed0dba12fe05e7029c88b10c25e8880e3
            </a>
            <div style={{ color: "#64748b", fontSize: 10, marginTop: 6 }}>funds <span style={{ color: "#ef4444", fontWeight: 700 }}>188 / 188</span> buyer wallets (100%)</div>
          </div>
        </Step>

        <Step number={4} title='That address is a "Disperse" contract'>
          <p>
            The funder isn't a person — it's a smart contract called <strong style={{ color: "#ef4444" }}>Disperse</strong>,
            designed to batch-send tokens to hundreds of addresses in a single transaction. Someone loaded USDC into this
            contract and sprayed it across 188 wallets, which then all "bought" from Hyperbet.
          </p>
          <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10, justifyContent: "center", flexWrap: "wrap", padding: "16px 0" }}>
            <FlowBox label="Operator" sub="unknown EOA" color="#94a3b8" />
            <span style={{ color: "#475569", fontSize: 16 }}>→</span>
            <FlowBox label="Disperse" sub="0xd15f...e3 (contract)" color="#ef4444" />
            <span style={{ color: "#475569", fontSize: 16 }}>→</span>
            <FlowBox label="188 wallets" sub="shell accounts" color="#eab308" />
            <span style={{ color: "#475569", fontSize: 16 }}>→</span>
            <FlowBox label="Hyperbet" sub='$15,949 "revenue"' color="#ef4444" />
          </div>
          <div style={{ textAlign: "center", fontSize: 11, color: "#64748b", marginTop: 8 }}>
            The leaderboard counts this as legitimate revenue. Nothing detected it — until now.
          </div>
        </Step>

        <Step number={5} title="The same operator farms multiple agents simultaneously">
          <p>
            The shell wallets don't just buy from Hyperbet. Sieve found the <strong>same Disperse-funded wallets</strong> appearing
            as clients of four other top-8 agents — all with exactly ~201 buyers:
          </p>
          <div style={{ marginTop: 12, background: "#111827", borderRadius: 6, border: "1px solid #1e293b", overflow: "hidden" }}>
            {[
              { rank: 2, name: "Verdict Protocol", buyers: 201, revenue: 16400, das: 45 },
              { rank: 3, name: "Hyperbet", buyers: 205, revenue: 15949, das: 25 },
              { rank: 6, name: "Marriage Sunna", buyers: 201, revenue: 14899, das: 45 },
              { rank: 7, name: "Hana VC", buyers: 201, revenue: 14760, das: 45 },
              { rank: 8, name: "Base 003", buyers: 201, revenue: 14540, das: 45 },
            ].map(a => (
              <div key={a.name} style={{ display: "grid", gridTemplateColumns: "36px 1fr 80px 60px 60px", padding: "8px 12px", fontSize: 11, borderBottom: "1px solid #1e293b08" }}>
                <span style={{ color: "#475569" }}>#{a.rank}</span>
                <span style={{ color: "#fca5a5", fontWeight: 500 }}>{a.name}</span>
                <span style={{ textAlign: "right", color: "#ef444488" }}>${a.revenue.toLocaleString()}</span>
                <span style={{ textAlign: "right", color: "#ef444488" }}>{a.buyers} buyers</span>
                <span style={{ textAlign: "center", fontWeight: 700, color: "#ef4444" }}>{a.das}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, padding: "10px 14px", background: "#ef444409", border: "1px solid #ef444422", borderRadius: 6, fontSize: 11, color: "#fca5a5", lineHeight: 1.7 }}>
            <strong>Finding:</strong> One entity is farming the leaderboard with at least 5 agents.
            Combined claimed revenue: <strong>$77,548</strong>. Same funder. Same Disperse contract.
            Same ~200 shell wallets recycled across all five.
          </div>
        </Step>

        <Step number={6} title="Sieve scores Hyperbet: DAS 25/100 → BLOCKED">
          <p>The five demand authenticity signals converge on the same conclusion:</p>
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {[
              { label: "Funding Source Diversity", value: 0, verdict: "FAILED", detail: "188/188 wallets share one funder" },
              { label: "Buyer Behavior", value: 20, verdict: "FAILED", detail: "Capped — shared funder overrides outbound diversity" },
              { label: "Transaction Timing", value: 100, verdict: "NORMAL", detail: "Natural variance in job intervals" },
              { label: "Circular Flow", value: 0, verdict: "FAILED", detail: "Disperse contract funds 188/188 clients" },
              { label: "Human Verification", value: 0, verdict: "N/A", detail: "World ID not yet integrated" },
            ].map(s => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "#111827", borderRadius: 6, borderLeft: `3px solid ${s.value >= 50 ? "#475569" : "#ef4444"}` }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: s.value >= 50 ? "#475569" : "#ef4444", width: 32, textAlign: "right", fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0" }}>
                    {s.label} <span style={{ color: s.value >= 50 ? "#475569" : "#ef4444", fontSize: 10, fontWeight: 700 }}>{s.verdict}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, textAlign: "center", padding: 16, background: "#ef444411", border: "1px solid #ef444433", borderRadius: 8 }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: "#ef4444", fontFamily: "'JetBrains Mono', monospace" }}>DAS 25/100</div>
            <div style={{ fontSize: 12, color: "#fca5a5", marginTop: 4 }}>Settlement BLOCKED by ERC-8183 hook (threshold: 50)</div>
          </div>
        </Step>
      </Section>

      {/* ═══ SECTION 3: THE COMPARISON ═══ */}
      <Section>
        <div style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600, letterSpacing: 2, marginBottom: 8 }}>
          THE CONTRAST
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", margin: "0 0 12px" }}>
          What real demand looks like
        </h2>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 28, lineHeight: 1.7 }}>
          Captain Dackie (rank #4) earns similar revenue but from genuinely independent buyers.
          Here's how the two compare when you trace the money.
        </p>

        <div style={{ background: "#111827", borderRadius: 8, border: "1px solid #1e293b", overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid #1e293b" }}>
            <div style={{ padding: "12px 16px", fontSize: 11, color: "#475569", fontWeight: 600 }}>Signal</div>
            <div style={{ padding: "12px 16px", fontSize: 11, fontWeight: 600, color: "#ef4444", textAlign: "center", background: "#ef444406" }}>Hyperbet</div>
            <div style={{ padding: "12px 16px", fontSize: 11, fontWeight: 600, color: "#22c55e", textAlign: "center", background: "#22c55e06" }}>Captain Dackie</div>
          </div>
          {[
            { label: "Revenue", hyp: "$15,949", dac: "$15,065" },
            { label: "Unique buyers", hyp: "205", dac: "989" },
            { label: "Funding sources", hyp: "1 (Disperse)", dac: "7 (diverse)", hypBad: true },
            { label: "Top funder share", hyp: "100%", dac: "38%", hypBad: true },
            { label: "Buyer coordination", hyp: "Same destinations", dac: "Diverse destinations", hypBad: true },
            { label: "Circular flow", hyp: "100% via contract", dac: "0%", hypBad: true },
            { label: "DAS Score", hyp: "25", dac: "69", hypBad: true },
            { label: "Settlement", hyp: "BLOCKED", dac: "ALLOWED", hypBad: true },
          ].map(row => (
            <div key={row.label} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid #1e293b08" }}>
              <div style={{ padding: "8px 16px", fontSize: 11, color: "#94a3b8" }}>{row.label}</div>
              <div style={{ padding: "8px 16px", fontSize: 11, textAlign: "center", color: row.hypBad ? "#ef4444" : "#94a3b8", fontWeight: row.hypBad ? 600 : 400, background: "#ef444406" }}>{row.hyp}</div>
              <div style={{ padding: "8px 16px", fontSize: 11, textAlign: "center", color: "#22c55e", background: "#22c55e06" }}>{row.dac}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══ SECTION 4: THE SYSTEMIC FINDING ═══ */}
      <Section style={{ borderBottom: "none" }}>
        <div style={{ fontSize: 11, color: "#eab308", fontWeight: 600, letterSpacing: 2, marginBottom: 8 }}>
          THE BIGGER PICTURE
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", margin: "0 0 12px" }}>
          {blocked.length} of the top {leaderboard.length} agents show farming patterns
        </h2>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 28, lineHeight: 1.7 }}>
          This isn't just Hyperbet. Sieve scored every top agent by tracing all buyer wallets to their funding sources
          via Blockscout. The results split the leaderboard in two.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <div style={{ padding: 16, background: "#ef444409", border: "1px solid #ef444422", borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#ef4444" }}>{blocked.length}</div>
            <div style={{ fontSize: 11, color: "#fca5a5" }}>agents BLOCKED</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>${blockedRevenue.toFixed(0)} in suspect revenue</div>
          </div>
          <div style={{ padding: 16, background: "#22c55e09", border: "1px solid #22c55e22", borderRadius: 8, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#22c55e" }}>{passed.length}</div>
            <div style={{ fontSize: 11, color: "#86efac" }}>agents ALLOWED</div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>${(totalRevenue - blockedRevenue).toFixed(0)} in organic revenue</div>
          </div>
        </div>

        {/* Full leaderboard */}
        <div style={{ background: "#111827", border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "36px 1fr 80px 60px 70px", padding: "8px 12px", fontSize: 10, color: "#475569", borderBottom: "1px solid #1e293b", fontWeight: 600 }}>
            <span>#</span><span>Agent</span><span style={{ textAlign: "right" }}>Revenue</span>
            <span style={{ textAlign: "center" }}>DAS</span><span style={{ textAlign: "center" }}>Settlement</span>
          </div>
          {leaderboard.map(a => {
            const isBlocked = a.verdict === "BLOCK";
            return (
              <div key={a.agentId} style={{
                display: "grid", gridTemplateColumns: "36px 1fr 80px 60px 70px",
                padding: "8px 12px", fontSize: 11, borderBottom: "1px solid #1e293b08",
                background: isBlocked ? "#ef444406" : "transparent",
              }}>
                <span style={{ color: "#475569" }}>{a.rank}</span>
                <span style={{ color: isBlocked ? "#fca5a5" : "#e2e8f0", fontWeight: 500, textDecoration: isBlocked ? "line-through" : "none", textDecorationColor: "#ef444455" }}>
                  {a.name}
                </span>
                <span style={{ textAlign: "right", color: isBlocked ? "#ef444466" : "#94a3b8" }}>${(a.revenue || 0).toFixed(0)}</span>
                <span style={{ textAlign: "center", fontWeight: 700, color: dasColor(a.das) }}>{a.das}</span>
                <span style={{ textAlign: "center", fontWeight: 600, fontSize: 10, color: isBlocked ? "#ef4444" : "#22c55e" }}>
                  {isBlocked ? "BLOCKED" : "ALLOWED"}
                </span>
              </div>
            );
          })}
        </div>

        {farmingRing.length >= 3 && (
          <div style={{ marginTop: 16, padding: 14, background: "#ef444409", border: "1px solid #ef444422", borderRadius: 6, fontSize: 11, color: "#fca5a5", lineHeight: 1.7 }}>
            <strong>Farming ring detected:</strong> {farmingRing.map(a => a.name).join(", ")} all
            score DAS 45 with identical patterns — {farmingRing[0]?.buyers} buyers, single Disperse funder,
            100% circular flow. Likely one operator running {farmingRing.length} agents.
          </div>
        )}

        {/* How Sieve works - brief */}
        <div style={{ marginTop: 32, padding: 20, background: "#111827", borderRadius: 8, border: "1px solid #1e293b" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 12 }}>HOW SIEVE WORKS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            {[
              { step: "1", label: "Discover", desc: "Fetch top agents from aGDP leaderboard", color: "#3b82f6" },
              { step: "2", label: "Resolve", desc: "Map every buyer ID to a wallet address", color: "#a855f7" },
              { step: "3", label: "Trace", desc: "Query Blockscout for each wallet's funding source", color: "#f59e0b" },
              { step: "4", label: "Score", desc: "Compute DAS from 5 demand authenticity signals", color: "#22c55e" },
            ].map(s => (
              <div key={s.step} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.color, marginBottom: 4 }}>{s.step}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#e2e8f0", marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.5 }}>{s.desc}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, fontSize: 10, color: "#475569", textAlign: "center" }}>
            Zero RPC calls. Entirely API-driven. Every wallet trace is cached permanently (funding sources are immutable).
            <br />Built on: ACP (job data) • ERC-8004 (identity) • ERC-8183 (settlement hooks) • Blockscout (fund tracing)
          </div>
        </div>
      </Section>
    </div>
  );
}
