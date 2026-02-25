import { useState } from "react";
import NeuralGraph from "./components/NeuralGraph";
import SystemStatus from "./components/SystemStatus";
import ServoControl from "./components/ServoControl";
import SystemLogs from "./components/SystemLogs";
import ConnectionPanel from "./components/ConnectionPanel";
import Diagnostics from "./components/Diagnostics";
import Config from "./components/Config";

const NAV_ITEMS = ["Dashboard", "Diagnostics", "Config"];

const PAGE_META = {
  Dashboard: { group: "Control System", title: "Main Dashboard" },
  Diagnostics: { group: "Hardware", title: "Diagnostics" },
  Config: { group: "Settings", title: "Configuration" },
};

export default function App() {
  const [page, setPage] = useState("Dashboard");
  const meta = PAGE_META[page];

  return (
    <div
      className="min-h-screen bg-neural-bg text-neural-text"
      style={{ background: "radial-gradient(ellipse at 20% 20%, rgba(0,87,255,0.04) 0%, transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(0,212,255,0.04) 0%, transparent 60%), #06060f" }}
    >
      {/* ── Top nav ─────────────────────────────────────────────────────── */}
      <header
        className="border-b border-neural-border px-6 py-4 flex items-center justify-between"
        style={{ background: "rgba(13,13,26,0.7)", backdropFilter: "blur(12px)", position: "sticky", top: 0, zIndex: 50 }}
      >
        {/* Logo */}
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.3)", boxShadow: "0 0 18px rgba(0,212,255,0.12)" }}
          >
            <svg width="26" height="26" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="3" fill="#00d4ff" fillOpacity="0.9" />
              <circle cx="9" cy="9" r="7" stroke="#00d4ff" strokeWidth="1" strokeOpacity="0.4" />
              <line x1="9" y1="2" x2="9" y2="0" stroke="#00d4ff" strokeWidth="1.5" strokeOpacity="0.6" />
              <line x1="9" y1="18" x2="9" y2="16" stroke="#00d4ff" strokeWidth="1.5" strokeOpacity="0.6" />
              <line x1="2" y1="9" x2="0" y2="9" stroke="#00d4ff" strokeWidth="1.5" strokeOpacity="0.6" />
              <line x1="18" y1="9" x2="16" y2="9" stroke="#00d4ff" strokeWidth="1.5" strokeOpacity="0.6" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white leading-none">
              SynapticX <span style={{ color: "#00d4ff" }}>6X</span>
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted leading-tight mt-1">
              Neural Augmented Robotic Arm Interface
            </p>
          </div>
        </div>

        {/* Nav */}
        <div className="flex items-center gap-6">
          <div className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = item === page;
              return (
                <button
                  key={item}
                  onClick={() => setPage(item)}
                  className="relative text-xs tracking-wide px-4 py-2 rounded-lg transition-all duration-200 cursor-pointer"
                  style={{
                    color: active ? "#00d4ff" : "#3a3f5c",
                    background: active ? "rgba(0,212,255,0.08)" : "transparent",
                    border: active ? "1px solid rgba(0,212,255,0.2)" : "1px solid transparent",
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "#c8d0e8"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "#3a3f5c"; }}
                >
                  {item}
                  {active && (
                    <span
                      className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full"
                      style={{ background: "#00d4ff", boxShadow: "0 0 8px #00d4ff" }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 pl-4 border-l border-neural-border">
            <span className="status-dot online" />
            <span className="text-xs font-mono text-neural-muted">v1.0.0</span>
          </div>
        </div>
      </header>

      {/* ── Main ────────────────────────────────────────────────────────── */}
      <main className="p-5 lg:p-6 max-w-[1600px] mx-auto">
        {/* Sub-header */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-neural-muted">{meta.group}</p>
            <h2 className="text-xl font-semibold text-white mt-0.5">{meta.title}</h2>
          </div>
          <div className="text-[10px] font-mono text-neural-muted">
            {new Date().toLocaleString("en-US", { hour12: false })}
          </div>
        </div>

        {/* ── Dashboard ── */}
        {page === "Dashboard" && (
          <>
            <div className="mb-4">
              <ConnectionPanel />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 flex flex-col gap-4">
                <NeuralGraph />
                <div className="flex-1 min-h-[280px]">
                  <SystemLogs />
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <SystemStatus />
                <ServoControl />
              </div>
            </div>
          </>
        )}

        {/* ── Diagnostics ── */}
        {page === "Diagnostics" && <Diagnostics />}

        {/* ── Config ── */}
        {page === "Config" && <Config />}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-neural-border px-6 py-3 flex items-center justify-between mt-4">
        <span className="text-[10px] font-mono text-neural-muted">
          SynapticX 6X · BioAmp EXG Pill Interface
        </span>
        <span className="text-[10px] font-mono text-neural-muted">© 2026 Neural Systems Lab</span>
      </footer>
    </div>
  );
}
