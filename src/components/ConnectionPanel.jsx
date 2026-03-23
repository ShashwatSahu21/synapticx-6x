import { useState, useEffect, useCallback } from "react";
import { fetchPorts, connectNode, disconnectNode } from "../api";

const NODES = [
    { id: "emg", label: "EMG Node", icon: "⚡", defaultBaud: 115200, color: "#00d4ff" },
    { id: "arm", label: "Arduino ARM", icon: "🤖", defaultBaud: 9600, color: "#a78bfa" },
];

const STATUS_META = {
    disconnected: { dot: "bg-red-500", text: "text-red-400", label: "Disconnected" },
    connecting: { dot: "bg-yellow-400 animate-pulse", text: "text-yellow-400", label: "Connecting…" },
    connected: { dot: "bg-neural-cyan", text: "text-neural-cyan", label: "Connected" },
    error: { dot: "bg-red-600", text: "text-red-500", label: "Error" },
};

function NodeRow({ node, ports, connections, onConnect, onDisconnect, onRefresh, refreshing }) {
    const [selectedPort, setSelectedPort] = useState("");
    const conn = connections[node.id] || {};
    const status = conn.status || "disconnected";
    const meta = STATUS_META[status] || STATUS_META.disconnected;
    const isConnected = status === "connected";
    const isBusy = status === "connecting";

    // Pre-fill last known port
    useEffect(() => {
        if (conn.port) setSelectedPort(conn.port);
        else if (ports.length > 0 && !selectedPort) setSelectedPort(ports[0].port);
    }, [conn.port, ports]);

    // Auto-disconnect if port is changed while connected
    const handlePortChange = (newPort) => {
        if (isConnected && newPort !== selectedPort) {
            onDisconnect(node.id, conn.port);
        }
        setSelectedPort(newPort);
    };

    return (
        <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Node label */}
            <div className="flex items-center gap-2 w-28 flex-shrink-0">
                <span className="text-base">{node.icon}</span>
                <div>
                    <p className="text-[10px] uppercase tracking-widest text-neural-muted">{node.label}</p>
                </div>
            </div>

            {/* Port selector */}
            <select
                value={selectedPort}
                onChange={(e) => handlePortChange(e.target.value)}
                disabled={isBusy}
                className="text-xs font-mono rounded-md px-2 py-1.5 border transition-all outline-none flex-shrink-0 w-28
                    disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                    background: "rgba(0,0,0,0.4)",
                    border: `1px solid ${isConnected ? node.color + "55" : "rgba(255,255,255,0.1)"}`,
                    color: "#c8d0e8",
                }}
            >
                {ports.length === 0
                    ? <option value="">No ports</option>
                    : ports.map((p) => (
                        <option key={p.port} value={p.port}>{p.port}</option>
                    ))
                }
            </select>

            {/* Connect / Disconnect button */}
            {isConnected ? (
                <button
                    onClick={() => onDisconnect(node.id, conn.port)}
                    className="text-[10px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-md border transition-all duration-200"
                    style={{ border: "1px solid rgba(255,60,90,0.35)", color: "#ff3c5a", background: "rgba(255,60,90,0.08)" }}
                >
                    Disconnect
                </button>
            ) : (
                <button
                    onClick={() => onConnect(node.id, selectedPort, node.defaultBaud)}
                    disabled={isBusy || !selectedPort}
                    className="text-[10px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-md border transition-all duration-200
                        disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ border: `1px solid ${node.color}55`, color: node.color, background: `${node.color}12` }}
                >
                    {isBusy ? "Connecting…" : "Connect"}
                </button>
            )}

            {/* Status */}
            <div className="flex items-center gap-1.5 min-w-[90px]">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                <span className={`text-[10px] font-mono ${meta.text}`}>{meta.label}</span>
            </div>

            {/* Last seen port when connected */}
            {isConnected && conn.port && (
                <span className="text-[10px] font-mono text-neural-muted hidden md:block">
                    @ {conn.port} · {conn.baud} baud
                </span>
            )}
        </div>
    );
}

export default function ConnectionPanel() {
    const [ports, setPorts] = useState([]);
    const [connections, setConnections] = useState({
        emg: { status: "disconnected", port: null },
        arm: { status: "disconnected", port: null },
    });
    const [refreshing, setRefreshing] = useState(false);
    const [backendOnline, setBackendOnline] = useState(false);

    const refresh = useCallback(async () => {
        setRefreshing(true);
        try {
            const res = await fetchPorts();
            setPorts(res.ports || []);
            setConnections(res.connections || {});
            setBackendOnline(true);
        } catch {
            setBackendOnline(false);
        }
        setRefreshing(false);
    }, []);

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, 3000);
        return () => clearInterval(id);
    }, [refresh]);

    const handleConnect = async (node, port, baud) => {
        setConnections((c) => ({ ...c, [node]: { ...c[node], status: "connecting" } }));
        try {
            const res = await connectNode(node, port, baud);
            if (res.connections) setConnections(res.connections);
        } catch {
            setConnections((c) => ({ ...c, [node]: { ...c[node], status: "error" } }));
        }
    };

    const handleDisconnect = async (node, port) => {
        try {
            const res = await disconnectNode(node, port);
            if (res.connections) setConnections(res.connections);
        } catch {
            setConnections((c) => ({ ...c, [node]: { ...c[node], status: "disconnected" } }));
        }
    };

    const anyConnected = Object.values(connections).some((c) => c.status === "connected");

    return (
        <div
            className="glass-panel px-5 py-3.5 flex flex-col gap-2"
            style={{ borderColor: anyConnected ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.06)" }}
        >
            {/* Header row */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <circle cx="6" cy="6" r="5" stroke={backendOnline ? "#00d4ff" : "#ff3c5a"} strokeWidth="1.2" />
                        <circle cx="6" cy="6" r="2" fill={backendOnline ? "#00d4ff" : "#ff3c5a"} fillOpacity="0.8" />
                    </svg>
                    <p className="text-[10px] uppercase tracking-[0.25em] text-neural-muted font-semibold">
                        Connection Manager
                    </p>
                </div>
                <button
                    onClick={refresh}
                    disabled={refreshing}
                    className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest px-3 py-1 rounded-md border transition-all duration-200 disabled:opacity-40"
                    style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#8890aa", background: "rgba(255,255,255,0.03)" }}
                >
                    <svg
                        width="10" height="10" viewBox="0 0 10 10" fill="none"
                        className={refreshing ? "animate-spin" : ""}
                    >
                        <path d="M5 1.5A3.5 3.5 0 1 1 1.5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        <path d="M1.5 2.5V1.5H2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {refreshing ? "Scanning…" : `Refresh Ports ${ports.length > 0 ? `(${ports.length})` : ""}`}
                </button>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "rgba(255,255,255,0.05)" }} />

            {/* Node rows */}
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-6">
                {NODES.map((node, i) => (
                    <div key={node.id} className="flex items-center gap-2 flex-1 min-w-0">
                        {i > 0 && (
                            <div className="hidden sm:block w-px self-stretch"
                                style={{ background: "rgba(255,255,255,0.06)" }} />
                        )}
                        <NodeRow
                            node={node}
                            ports={ports}
                            connections={connections}
                            onConnect={handleConnect}
                            onDisconnect={handleDisconnect}
                            onRefresh={refresh}
                            refreshing={refreshing}
                        />
                    </div>
                ))}
            </div>

            {/* No ports warning */}
            {!refreshing && ports.length === 0 && backendOnline && (
                <p className="text-[10px] text-yellow-400/70 font-mono">
                    ⚠ No COM ports detected. Connect a device and refresh.
                </p>
            )}
        </div>
    );
}
