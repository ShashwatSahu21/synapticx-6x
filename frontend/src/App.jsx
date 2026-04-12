import { useState, useEffect } from "react";
import ConnectionPanel from "./components/ConnectionPanel";
import Config from "./components/Config";
import ControllerPage from "./components/ControllerPage";
import BioSignalPage from "./components/BioSignalPage";
import SystemLogs from "./components/SystemLogs";
import RoboticArm3D from "./components/RoboticArm3D";
import ServoControl from "./components/ServoControl";
import TeachReplayPage from "./components/TeachReplayPage";

const NAV_ITEMS = [
  { id: "Dashboard",   label: "Dashboard",  icon: "⬡" },
  { id: "Mission",     label: "Mission",    icon: "◉" },
  { id: "Bio-Signal",  label: "Bio-Signal", icon: "◉" },
  { id: "Controller",  label: "Controller", icon: "◎" },
  { id: "Config",      label: "Config",     icon: "⚙" },
];

function LiveClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return <span className="text-[10px] font-mono text-neural-muted tabular-nums">{t.toLocaleTimeString("en-US", { hour12: false })}</span>;
}

function LogoMark() {
  return (
    <div className="logo-mark" style={{ width: "2.5rem", height: "2.5rem" }}>
      <svg width="1.4rem" height="1.4rem" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" fill="#00d4ff" fillOpacity="0.9">
          <animate attributeName="r" values="3;3.5;3" dur="3s" repeatCount="indefinite" />
        </circle>
        <circle cx="12" cy="12" r="6" stroke="#00d4ff" strokeWidth="0.8" strokeOpacity="0.3" strokeDasharray="2 3">
          <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="12s" repeatCount="indefinite" />
        </circle>
        <circle cx="12" cy="12" r="9.5" stroke="#00d4ff" strokeWidth="0.6" strokeOpacity="0.15" strokeDasharray="4 6">
          <animateTransform attributeName="transform" type="rotate" from="360 12 12" to="0 12 12" dur="18s" repeatCount="indefinite" />
        </circle>
        <line x1="12" y1="2" x2="12" y2="5" stroke="#00d4ff" strokeWidth="1" strokeOpacity="0.5" strokeLinecap="round" />
        <line x1="12" y1="19" x2="12" y2="22" stroke="#00d4ff" strokeWidth="1" strokeOpacity="0.5" strokeLinecap="round" />
        <line x1="2" y1="12" x2="5" y2="12" stroke="#00d4ff" strokeWidth="1" strokeOpacity="0.5" strokeLinecap="round" />
        <line x1="19" y1="12" x2="22" y2="12" stroke="#00d4ff" strokeWidth="1" strokeOpacity="0.5" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("Dashboard");

  return (
    <div className="min-h-screen flex flex-col bg-neural-bg text-neural-text selection:bg-neural-cyan selection:text-black"
      style={{
        background: `
          radial-gradient(ellipse at 15% 10%, rgba(0,87,255,0.08) 0%, transparent 50%),
          radial-gradient(ellipse at 85% 90%, rgba(0,212,255,0.06) 0%, transparent 50%),
          #06060f
        `,
      }}>

      {/* ── Navbar ── */}
      <header className="nav-header flex-shrink-0 sticky top-0 z-50 backdrop-blur-xl border-b border-white/5" style={{ padding: "0.75rem 2rem" }}>
        <div className="flex items-center gap-3">
          <LogoMark />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-white leading-none font-['Outfit']">
              SynapticX <span className="glow-text">6X</span>
            </h1>
            <p className="text-[9px] uppercase tracking-[0.2em] text-neural-muted mt-1 font-mono">Neural Interface Platform</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {NAV_ITEMS.map(({ id, label }) => (
            <button key={id} onClick={() => setPage(id)}
              className={`nav-btn ${id === page ? "active" : ""}`}
              style={{ padding: "0.5rem 1.25rem" }}>
              {label}
            </button>
          ))}
          <div className="flex items-center gap-2 ml-4 pl-4 border-l border-white/10">
            <span className="status-dot online" />
            <LiveClock />
          </div>
        </div>
      </header>

      {/* ── Connection Manager ── */}
      <div className="px-6 py-2">
        <ConnectionPanel />
      </div>

      {/* ── Main Content Area ── */}
      <main className="flex-1 px-6 pb-8">
        
        {page === "Dashboard" && (
          <div className="flex flex-col gap-4 page-enter">
            <div className="flex gap-4 min-h-[650px]">
              {/* 3D Visual (60%) */}
              <div className="flex-[6]">
                <RoboticArm3D height="650px" />
              </div>
              {/* Slider Control (40%) */}
              <div className="flex-[4]">
                <ServoControl />
              </div>
            </div>
            {/* System Logs */}
            <div className="w-full">
              <SystemLogs height="220px" />
            </div>
          </div>
        )}

        {page === "Mission" && (
          <div className="page-enter h-[calc(100vh-180px)]">
            <TeachReplayPage />
          </div>
        )}

        {page === "Bio-Signal" && (
          <div className="page-enter">
            <div className="glass-panel p-1 border-white/5 overflow-hidden">
               {/* This is the "biological window" focused on signals */}
               <BioSignalPage />
            </div>
          </div>
        )}

        {page === "Controller" && (
          <div className="flex flex-col gap-4 page-enter">
            <div className="flex gap-4 min-h-[650px]">
              {/* 3D Visual for perspective */}
              <div className="flex-[5]">
                <RoboticArm3D height="650px" />
              </div>
              {/* Controller Management Dashboard */}
              <div className="flex-[5]">
                <ControllerPage />
              </div>
            </div>
          </div>
        )}

        {page === "Config" && (
          <div className="page-enter max-w-5xl mx-auto w-full">
            <Config />
          </div>
        )}

      </main>

      {/* Footer decoration */}
      <footer className="py-4 px-8 border-t border-white/5 opacity-30 pointer-events-none">
        <div className="flex justify-between items-center text-[8px] font-mono tracking-widest text-neural-muted">
          <span>SYNAPTICX V2.4.0 // OPEN SOURCE 6-DOF ARM SYSTEM</span>
          <span>LATENCY: 12ms // BUFFER: ACTIVE</span>
        </div>
      </footer>
    </div>
  );
}
