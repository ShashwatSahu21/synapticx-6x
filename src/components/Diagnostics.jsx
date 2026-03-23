import { useState, useEffect, useCallback } from "react";
import { fetchPorts, fetchSystemStatus } from "../api";

function StatRow({ label, value, mono = true, color = "text-neural-text" }) {
    return (
        <div className="flex items-center justify-between py-2 border-b border-neural-border last:border-0">
            <span className="text-xs text-neural-muted">{label}</span>
            <span className={`text-xs ${mono ? "font-mono" : ""} ${color}`}>{value}</span>
        </div>
    );
}

function Section({ title, children }) {
    return (
        <div className="glass-panel p-5 flex flex-col gap-1">
            <p className="text-[10px] uppercase tracking-[0.25em] text-neural-muted mb-2">{title}</p>
            {children}
        </div>
    );
}

export default function Diagnostics() {
    const [ports, setPorts] = useState([]);
    const [conns, setConns] = useState({});
    const [sys, setSys] = useState({});
    const [latency, setLatency] = useState(null);

    const load = useCallback(async () => {
        try {
            const t0 = performance.now();
            const [p, s] = await Promise.all([fetchPorts(), fetchSystemStatus()]);
            setLatency(Math.round(performance.now() - t0));
            setPorts(p.ports || []);
            setConns(p.connections || {});
            setSys(s);
        } catch {
            setLatency(null);
        }
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, 2000);
        return () => clearInterval(id);
    }, [load]);

    const emg = conns.emg || {};
    const arm = conns.arm || {};

    const statusColor = (s) =>
        s === "connected" ? "text-neural-cyan"
            : s === "error" ? "text-red-400"
                : s === "connecting" ? "text-yellow-400"
                    : "text-neural-muted";

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* EMG / BioAmp */}
            <Section title="BioAmp EXG Pill">
                <StatRow label="Status" value={emg.status || "disconnected"} color={statusColor(emg.status)} />
                <StatRow label="Port" value={emg.port || "—"} />
                <StatRow label="Baud" value={emg.baud ? `${emg.baud} bps` : "—"} />
                <StatRow label="Last seen" value={emg.last_seen ? new Date(emg.last_seen).toLocaleTimeString() : "—"} />
                {emg.error && (
                    <p className="text-[10px] text-red-400 font-mono mt-2 bg-red-500/5 rounded p-2 border border-red-500/20">
                        {emg.error}
                    </p>
                )}
            </Section>

            {/* Arduino ARM */}
            <Section title="Arduino ARM">
                <StatRow label="Status" value={arm.status || "disconnected"} color={statusColor(arm.status)} />
                <StatRow label="Port" value={arm.port || "—"} />
                <StatRow label="Baud" value={arm.baud ? `${arm.baud} bps` : "—"} />
                <StatRow label="Last seen" value={arm.last_seen ? new Date(arm.last_seen).toLocaleTimeString() : "—"} />
                {arm.error && (
                    <p className="text-[10px] text-red-400 font-mono mt-2 bg-red-500/5 rounded p-2 border border-red-500/20">
                        {arm.error}
                    </p>
                )}
            </Section>

            {/* System */}
            <Section title="System">
                <StatRow label="API latency" value={latency !== null ? `${latency} ms` : "—"} color={latency < 30 ? "text-neural-cyan" : "text-yellow-400"} />
                <StatRow label="Active servos" value={`${sys.active_servos ?? "—"} / 6`} />
                <StatRow label="Serial library" value={conns.emg ? "pyserial" : "—"} />
                <StatRow label="Backend" value="localhost:8000" color="text-neural-cyan" />
                <StatRow label="Frontend" value="localhost:5173" color="text-neural-cyan" />
            </Section>

            {/* Detected COM ports */}
            <div className="lg:col-span-3">
                <Section title={`Detected COM Ports (${ports.length})`}>
                    {ports.length === 0 ? (
                        <p className="text-xs text-neural-muted">No COM ports detected on this machine.</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-1">
                            {ports.map((p) => {
                                const used = Object.values(conns).find((c) => c.port === p.port);
                                return (
                                    <div key={p.port}
                                        className="rounded-lg px-3 py-2.5 border"
                                        style={{
                                            background: used ? "rgba(0,212,255,0.05)" : "rgba(0,0,0,0.3)",
                                            borderColor: used ? "rgba(0,212,255,0.25)" : "rgba(255,255,255,0.07)",
                                        }}>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs font-mono text-neural-cyan">{p.port}</span>
                                            {used && (
                                                <span className="text-[9px] uppercase tracking-widest text-neural-cyan bg-neural-cyan/10 px-1.5 py-0.5 rounded">
                                                    {used.device}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-[10px] text-neural-muted truncate">{p.description}</p>
                                        <p className="text-[9px] text-neural-muted/50 font-mono truncate mt-0.5">{p.hwid}</p>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Section>
            </div>
        </div>
    );
}
