import { useState } from "react";
import SieveLive from "./SieveLive";
import SieveDashboard from "./SieveDashboard";

function App() {
  const [view, setView] = useState("live");

  return (
    <div style={{ minHeight: "100vh", background: "#030712" }}>
      <div style={{ display: "flex", gap: 8, padding: "12px 16px", background: "#0a0f1a", borderBottom: "1px solid #1e293b" }}>
        <button
          onClick={() => setView("live")}
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            border: "1px solid #1e293b",
            background: view === "live" ? "#22c55e" : "#111827",
            color: view === "live" ? "#000" : "#94a3b8",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Live Scanner
        </button>
        <button
          onClick={() => setView("dashboard")}
          style={{
            padding: "6px 16px",
            borderRadius: 6,
            border: "1px solid #1e293b",
            background: view === "dashboard" ? "#22c55e" : "#111827",
            color: view === "dashboard" ? "#000" : "#94a3b8",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Case Study Dashboard
        </button>
      </div>
      {view === "live" ? <SieveLive /> : <SieveDashboard />}
    </div>
  );
}

export default App;
