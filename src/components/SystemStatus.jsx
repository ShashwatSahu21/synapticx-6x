import { useState, useEffect, useCallback } from "react";
import { fetchSystemStatus, fetchPorts } from "../api";

export default function SystemStatus() {
    const [status, setStatus] = useState({
        active_servos: 6,
        servo_angles: {},
    });
    const [latency, setLatency] = useState(null);
    const [nodes, setNodes] = useState({ emg: { status: "disconnected" }, arm: { status: "disconnected" } });

    const load = useCallback(async () => {
        try {
            const t0 = performance.now();
            const [sysRes, portsRes] = await Promise.all([fetchSystemStatus(), fetchPorts()]);
            const rtt = Math.round(performance.now() - t0);

            const conns = portsRes.connections || {};
            const anyConnected = Object.values(conns).some((c) => c.status === "connected");

            setNodes(conns);
            setStatus(sysRes);
            // Only show latency when at least one real node is connected
            setLatency(anyConnected ? rtt : null);
        } catch {
            setLatency(null);
        }
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, 2000);
        return () => clearInterval(id);
    }, [load]);

    const emg = nodes.emg || {};
    const arm = nodes.arm || {};

    const nodeRow = (label, conn, color) => (
        <div className="flex items-center justify-between">
            <span className="text-xs text-neural-muted">{label}</span>
            <div className="flex items-center gap-1.5">
                <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                        background: conn.status === "connected" ? color : conn.status === "error" ? "#ff3c5a" : "#3a3f5c",
                        boxShadow: conn.status === "connected" ? `0 0 6px ${color}` : "none",
                    }}
                />
                <span className="text-[10px] font-mono" style={{ color: conn.status === "connected" ? color : conn.status === "error" ? "#ff3c5a" : "#3a3f5c" }}>
                    {conn.status === "connected"
                        ? conn.port
                        : conn.status === "error"
                            ? "Error"
                            : "—"}
                </span>
            </div>
        </div>
    );

    return (
        <div className="glass-panel p-5 flex flex-col gap-4">
            {/* Header */}
            <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-0.5">Interface</p>
                <h2 className="text-sm font-semibold text-neural-text">System Status</h2>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-neural-bg rounded-lg p-3 border border-neural-border">
                    <p className="text-[9px] uppercase tracking-widest text-neural-muted mb-1">API Latency</p>
                    <p className={`text-lg font-semibold font-mono ${latency === null ? "text-neural-muted" : latency < 30 ? "text-neural-cyan" : "text-yellow-400"}`}>
                        {latency !== null ? `${latency} ms` : "— ms"}
                    </p>
                    <p className="text-[9px] text-neural-muted mt-0.5">
                        {latency !== null ? "Backend round-trip" : "No hardware connected"}
                    </p>
                </div>

                <div className="bg-neural-bg rounded-lg p-3 border border-neural-border">
                    <p className="text-[9px] uppercase tracking-widest text-neural-muted mb-1">Servos</p>
                    <p className="text-lg font-semibold font-mono text-neural-text">
                        {status.active_servos ?? 6} / 6
                    </p>
                    <p className="text-[9px] text-neural-muted mt-0.5">Manual control</p>
                </div>
            </div>

            {/* Hardware nodes */}
            <div className="bg-neural-bg rounded-lg p-3 border border-neural-border flex flex-col gap-2.5">
                <p className="text-[9px] uppercase tracking-widest text-neural-muted">Hardware</p>
                {nodeRow("BioAmp EXG Pill", emg, "#00d4ff")}
                {nodeRow("Arduino ARM", arm, "#a78bfa")}
            </div>

            {/* Backend indicator */}
            <div className="flex items-center gap-2 pt-1">
                <span className="status-dot online" />
                <span className="text-xs text-neural-muted font-mono">Backend online — port 8000</span>
            </div>
        </div>
    );
}
