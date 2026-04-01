import { useState, useEffect, useRef, useCallback } from "react";
import { fetchLogs } from "../api";

const LEVEL_STYLE = {
    INFO: "text-neural-muted",
    OK: "text-neural-cyan",
    WARN: "text-yellow-400",
    ERROR: "text-red-400",
};

const LEVEL_PREFIX = {
    INFO: "·",
    OK: "✓",
    WARN: "⚠",
    ERROR: "✗",
};

function formatTime(iso) {
    try {
        return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
    } catch {
        return iso;
    }
}

export default function SystemLogs() {
    const [logs, setLogs] = useState([]);
    const scrollRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const res = await fetchLogs();
            setLogs(res.logs || []);
        } catch { }
    }, []);

    useEffect(() => {
        load();
        const id = setInterval(load, 1500);
        return () => clearInterval(id);
    }, [load]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className="glass-panel p-5 flex flex-col gap-3 h-full">
            {/* Header */}
            <div className="flex items-center justify-between flex-shrink-0">
                <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-0.5">
                        Telemetry
                    </p>
                    <h2 className="text-sm font-semibold text-neural-text">System Logs</h2>
                </div>
                <div className="flex items-center gap-2">
                    <span className="status-dot online" />
                    <span className="text-xs font-mono text-neural-muted">{logs.length} entries</span>
                </div>
            </div>

            {/* Terminal */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto rounded-lg p-3 min-h-0"
                style={{ background: "rgba(0,0,0,0.4)", fontFamily: "'JetBrains Mono', monospace" }}
            >
                {logs.length === 0 && (
                    <p className="text-xs text-neural-muted italic">Waiting for telemetry...</p>
                )}
                {logs.map((log, i) => (
                    <div key={i} className={`log-line flex gap-2 ${LEVEL_STYLE[log.level] || "text-neural-muted"}`}>
                        <span className="flex-shrink-0 text-neural-muted/50">{formatTime(log.time)}</span>
                        <span className="flex-shrink-0">
                            [{log.level?.padEnd(4)}]
                        </span>
                        <span className="flex-shrink-0">{LEVEL_PREFIX[log.level] || "·"}</span>
                        <span className="flex-1">{log.message}</span>
                    </div>
                ))}

            </div>
        </div>
    );
}
