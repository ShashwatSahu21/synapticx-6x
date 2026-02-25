import { useState, useEffect, useRef, useCallback } from "react";
import {
    AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { fetchNeuralData } from "../api";

const CustomTooltip = ({ active, payload }) => {
    if (active && payload?.length) {
        return (
            <div className="glass-panel px-3 py-1.5 text-xs text-neural-cyan">
                {payload[0].value.toFixed(3)} mV
            </div>
        );
    }
    return null;
};

/**
 * Estimate dominant frequency from a time-series buffer using zero-crossing.
 * Simple, cheap, works well for EMG signals.
 * @param {Array<{v: number}>} data
 * @param {number} sampleRate  Hz — must be known or estimated
 */
function estimateFrequency(data, sampleRate = 100) {
    if (data.length < 4) return null;
    let crossings = 0;
    for (let i = 1; i < data.length; i++) {
        if ((data[i - 1].v >= 0) !== (data[i].v >= 0)) crossings++;
    }
    if (crossings < 2) return null;
    const durationSec = data.length / sampleRate;
    return ((crossings / 2) / durationSec).toFixed(1);
}

function getDisplayState(sensorConnected, data) {
    if (!sensorConnected) return "no_sensor";
    if (!data || data.length === 0) return "waiting";
    return "streaming";
}

export default function NeuralGraph() {
    const [data, setData] = useState([]);
    const [sensorConnected, setSensorConn] = useState(false);
    const [sampleCount, setSampleCount] = useState(0);
    const intervalRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const res = await fetchNeuralData();
            setSensorConn(res.sensor_connected);
            setData(res.data || []);
            setSampleCount(res.sample_count || 0);
        } catch {
            setSensorConn(false);
            setData([]);
        }
    }, []);

    useEffect(() => {
        load();
        // Poll every 250 ms for a responsive live graph
        intervalRef.current = setInterval(load, 250);
        return () => clearInterval(intervalRef.current);
    }, [load]);

    const displayState = getDisplayState(sensorConnected, data);
    const freq = displayState === "streaming" ? estimateFrequency(data) : null;
    // Show last 200 samples max for performance
    const chartData = data.slice(-200);

    return (
        <div className="glass-panel p-5 flex flex-col gap-3">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-0.5">
                        BioAmp EXG Pill
                    </p>
                    <h2 className="text-sm font-semibold text-neural-text">EMG Signal — Live</h2>
                </div>

                <div className="flex items-center gap-2">
                    {displayState === "streaming" && (
                        <>
                            <span className="status-dot online" />
                            <span className="text-xs text-neural-cyan font-mono">LIVE</span>
                        </>
                    )}
                    {displayState === "waiting" && (
                        <>
                            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
                            <span className="text-xs text-yellow-400 font-mono">WAITING</span>
                        </>
                    )}
                    {displayState === "no_sensor" && (
                        <>
                            <span className="status-dot offline" />
                            <span className="text-xs text-red-400 font-mono">NO SENSOR</span>
                        </>
                    )}
                </div>
            </div>

            {/* Chart */}
            <div className="h-44 relative">
                {displayState === "streaming" ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                            <defs>
                                <linearGradient id="emgGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.2} />
                                    <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <XAxis dataKey="t" hide />
                            <YAxis
                                domain={["auto", "auto"]}
                                tickCount={5}
                                tick={{ fill: "#3a3f5c", fontSize: 9, fontFamily: "JetBrains Mono" }}
                                axisLine={false} tickLine={false}
                            />
                            <Tooltip content={<CustomTooltip />} />
                            <Area
                                type="monotoneX" dataKey="v"
                                stroke="#00d4ff" strokeWidth={1.5}
                                fill="url(#emgGrad)" dot={false}
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="w-full h-full rounded-lg flex flex-col items-center justify-center gap-3"
                        style={{ background: "rgba(0,0,0,0.35)", border: "1px dashed rgba(255,255,255,0.06)" }}>

                        {displayState === "waiting" ? (
                            <>
                                <svg width="180" height="32" viewBox="0 0 180 32" fill="none">
                                    <line x1="0" y1="16" x2="180" y2="16"
                                        stroke="#f5a623" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.5" />
                                    <circle cx="90" cy="16" r="4" fill="#f5a623" opacity="0.7">
                                        <animate attributeName="opacity" values="0.7;0.2;0.7" dur="1.2s" repeatCount="indefinite" />
                                    </circle>
                                </svg>
                                <p className="text-xs font-mono text-yellow-400">BioAmp EXG Pill connected</p>
                                <p className="text-[10px] text-neural-muted/60 uppercase tracking-widest">
                                    Waiting for serial data…
                                </p>
                            </>
                        ) : (
                            <>
                                <svg width="180" height="32" viewBox="0 0 180 32" fill="none">
                                    <line x1="0" y1="16" x2="180" y2="16"
                                        stroke="#1e2440" strokeWidth="1.5" strokeDasharray="4 4" />
                                    <circle cx="90" cy="16" r="3" fill="#3a3f5c" opacity="0.6" />
                                </svg>
                                <p className="text-xs font-mono text-neural-muted">No sensor detected</p>
                                <p className="text-[10px] text-neural-muted/60 uppercase tracking-widest">
                                    Connect BioAmp EXG Pill via Connection Manager
                                </p>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Footer stats — real values when streaming */}
            <div className={`flex gap-6 pt-1 border-t border-neural-border transition-opacity
                ${displayState === "streaming" ? "opacity-100" : "opacity-25"}`}>
                {[
                    { label: "Freq", value: freq ? `${freq} Hz` : "— Hz" },
                    { label: "Samples", value: sampleCount ? `${sampleCount}` : "—" },
                    { label: "Window", value: chartData.length ? `${chartData.length} pts` : "—" },
                    { label: "Channel", value: "CH1" },
                ].map((s) => (
                    <div key={s.label}>
                        <p className="text-[9px] uppercase tracking-widest text-neural-muted">{s.label}</p>
                        <p className="text-xs font-mono text-neural-text mt-0.5">{s.value}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
