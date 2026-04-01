import { useState, useEffect, useCallback, useRef } from "react";
import {
    AreaChart, Area, LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip,
    CartesianGrid, ReferenceLine,
} from "recharts";
import { fetchNeuralData, fetchBioSignalState, setMode, fetchMode } from "../api";
import BioSignalPanel from "./BioSignalPanel";

// ── Custom tooltip ───────────────────────────────────────────────────────────
const WaveformTooltip = ({ active, payload }) => {
    if (active && payload?.length) {
        return (
            <div className="glass-panel px-3 py-1.5 text-xs font-mono text-neural-cyan">
                {payload[0].value.toFixed(4)} mV
            </div>
        );
    }
    return null;
};

// ── RMS History mini chart ───────────────────────────────────────────────────
function RMSHistoryChart({ data }) {
    return (
        <div className="h-20">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <defs>
                        <linearGradient id="rmsGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <XAxis dataKey="t" hide />
                    <YAxis domain={["auto", "auto"]} hide />
                    <Area
                        type="monotoneX" dataKey="rms"
                        stroke="#a78bfa" strokeWidth={1.5}
                        fill="url(#rmsGrad)" dot={false}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

// ── Signal quality indicator ─────────────────────────────────────────────────
function SignalQuality({ rms, connected }) {
    let level = "NONE";
    let color = "#3a3f5c";
    let bars = 0;

    if (connected && rms > 0) {
        if (rms > 100) { level = "STRONG"; color = "#34d399"; bars = 4; }
        else if (rms > 50) { level = "GOOD"; color = "#00d4ff"; bars = 3; }
        else if (rms > 20) { level = "WEAK"; color = "#f5a623"; bars = 2; }
        else { level = "NOISE"; color = "#f472b6"; bars = 1; }
    }

    return (
        <div className="flex items-center gap-2">
            <div className="flex items-end gap-0.5 h-4">
                {[1, 2, 3, 4].map((i) => (
                    <div
                        key={i}
                        className="w-1 rounded-full transition-all duration-300"
                        style={{
                            height: `${i * 25}%`,
                            background: i <= bars ? color : "rgba(255,255,255,0.06)",
                            boxShadow: i <= bars ? `0 0 4px ${color}40` : "none",
                        }}
                    />
                ))}
            </div>
            <span className="text-[9px] font-mono" style={{ color }}>{level}</span>
        </div>
    );
}

// ── Frequency analysis from EMG buffer ───────────────────────────────────────
function analyzeSignal(data) {
    if (!data || data.length < 10) return { freq: null, peakMv: 0, meanMv: 0 };

    let crossings = 0;
    let peakMv = 0;
    let sumAbs = 0;

    for (let i = 1; i < data.length; i++) {
        if ((data[i - 1].v >= 0) !== (data[i].v >= 0)) crossings++;
        const abs = Math.abs(data[i].v);
        if (abs > peakMv) peakMv = abs;
        sumAbs += abs;
    }

    const sampleRate = 100; // approx display rate
    const durationSec = data.length / sampleRate;
    const freq = crossings >= 2 ? ((crossings / 2) / durationSec).toFixed(1) : null;
    const meanMv = (sumAbs / data.length).toFixed(4);

    return { freq, peakMv: peakMv.toFixed(4), meanMv };
}

export default function BioSignalPage() {
    const [emgData, setEmgData] = useState([]);
    const [sensorConnected, setSensorConnected] = useState(false);
    const [sampleCount, setSampleCount] = useState(0);
    const [bio, setBio] = useState(null);
    const [mode, setCurrentMode] = useState("manual");
    const [rmsHistory, setRmsHistory] = useState([]);
    const rmsCountRef = useRef(0);
    const emgPollRef = useRef(null);
    const bioPollRef = useRef(null);

    // Poll EMG waveform data at ~4 Hz
    const loadEmg = useCallback(async () => {
        try {
            const res = await fetchNeuralData();
            setSensorConnected(res.sensor_connected);
            setEmgData(res.data || []);
            setSampleCount(res.sample_count || 0);
        } catch {
            setSensorConnected(false);
        }
    }, []);

    // Poll bio-signal state at ~5 Hz
    const loadBio = useCallback(async () => {
        try {
            const [bioRes, modeRes] = await Promise.all([
                fetchBioSignalState(),
                fetchMode(),
            ]);
            setBio(bioRes);
            setCurrentMode(modeRes.mode);

            // Track RMS history for the mini chart
            rmsCountRef.current++;
            if (rmsCountRef.current % 2 === 0) { // every ~400ms
                setRmsHistory(prev => {
                    const next = [...prev, { t: rmsCountRef.current, rms: bioRes.rms }];
                    return next.slice(-100); // keep last 100 points (~40s)
                });
            }
        } catch { /* offline */ }
    }, []);

    useEffect(() => {
        loadEmg();
        loadBio();
        emgPollRef.current = setInterval(loadEmg, 250);
        bioPollRef.current = setInterval(loadBio, 200);
        return () => {
            clearInterval(emgPollRef.current);
            clearInterval(bioPollRef.current);
        };
    }, [loadEmg, loadBio]);

    const chartData = emgData.slice(-300);
    const analysis = analyzeSignal(chartData);
    const isActive = mode === "biosignal" || mode === "hybrid";

    const handleModeToggle = async () => {
        const newMode = isActive ? "manual" : "biosignal";
        try {
            const res = await setMode(newMode);
            if (res.status === "ok") setCurrentMode(res.mode);
        } catch { /* error */ }
    };

    return (
        <div className="flex flex-col gap-4">
            {/* ── Top row: Mode toggle + Signal Quality ── */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={handleModeToggle}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-300 ${
                            isActive
                                ? "bg-neural-cyan/15 border border-neural-cyan/40 text-neural-cyan shadow-[0_0_20px_rgba(0,212,255,0.15)]"
                                : "bg-neural-bg border border-neural-border text-neural-muted hover:border-neural-cyan/30 hover:text-neural-text"
                        }`}
                    >
                        <span className={`w-2 h-2 rounded-full transition-all ${isActive ? "bg-neural-cyan animate-pulse" : "bg-neutral-600"}`} />
                        {isActive ? "EMG Control Active" : "Activate EMG Control"}
                    </button>

                    <div className="flex items-center gap-3 px-4 py-2 rounded-lg"
                        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                        <span className="text-[9px] font-mono text-neural-muted uppercase">Signal</span>
                        <SignalQuality rms={bio?.rms || 0} connected={sensorConnected} />
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {[
                        { label: "Samples", value: sampleCount ? sampleCount.toLocaleString() : "—" },
                        { label: "Freq", value: analysis.freq ? `${analysis.freq} Hz` : "—" },
                        { label: "Peak", value: `${analysis.peakMv} mV` },
                    ].map((s) => (
                        <div key={s.label} className="text-right">
                            <p className="text-[8px] uppercase tracking-widest text-neural-muted">{s.label}</p>
                            <p className="text-xs font-mono text-neural-text">{s.value}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Main content: 2-column layout ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Left: Large EMG waveform */}
                <div className="lg:col-span-2 flex flex-col gap-4">
                    {/* Primary EMG waveform */}
                    <div className="glass-panel p-5">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-0.5">
                                    BioAmp EXG Pill · CH1
                                </p>
                                <h2 className="text-sm font-semibold text-neural-text">
                                    EMG Waveform — Real-Time
                                </h2>
                            </div>
                            <div className="flex items-center gap-2">
                                {sensorConnected ? (
                                    <>
                                        <span className="status-dot online" />
                                        <span className="text-xs text-neural-cyan font-mono">STREAMING</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="status-dot offline" />
                                        <span className="text-xs text-red-400 font-mono">NO SENSOR</span>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="h-64 relative">
                            {sensorConnected && chartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="emgStroke" x1="0" y1="0" x2="1" y2="0">
                                                <stop offset="0%" stopColor="#00d4ff" stopOpacity={0.3} />
                                                <stop offset="50%" stopColor="#00d4ff" stopOpacity={1} />
                                                <stop offset="100%" stopColor="#00d4ff" stopOpacity={0.8} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            stroke="rgba(255,255,255,0.03)"
                                            verticalFill={["rgba(0,0,0,0.1)", "transparent"]}
                                        />
                                        <XAxis dataKey="t" hide />
                                        <YAxis
                                            domain={["auto", "auto"]}
                                            tickCount={7}
                                            tick={{ fill: "#3a3f5c", fontSize: 9, fontFamily: "JetBrains Mono" }}
                                            axisLine={false} tickLine={false}
                                            width={40}
                                        />
                                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                                        <Tooltip content={<WaveformTooltip />} />
                                        <Line
                                            type="monotoneX" dataKey="v"
                                            stroke="url(#emgStroke)" strokeWidth={1.5}
                                            dot={false}
                                            isAnimationActive={false}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="w-full h-full rounded-lg flex flex-col items-center justify-center gap-4"
                                    style={{ background: "rgba(0,0,0,0.35)", border: "1px dashed rgba(255,255,255,0.06)" }}>
                                    {/* Animated EEG flatline */}
                                    <svg width="280" height="48" viewBox="0 0 280 48" fill="none">
                                        <line x1="0" y1="24" x2="280" y2="24"
                                            stroke="#1e2440" strokeWidth="1.5" strokeDasharray="4 4" />
                                        <circle cx="140" cy="24" r="4" fill="#3a3f5c" opacity="0.5">
                                            <animate attributeName="opacity" values="0.5;0.15;0.5" dur="1.5s" repeatCount="indefinite" />
                                        </circle>
                                        {/* Grid lines */}
                                        {[70, 140, 210].map(x => (
                                            <line key={x} x1={x} y1="0" x2={x} y2="48"
                                                stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
                                        ))}
                                    </svg>
                                    <p className="text-xs font-mono text-neural-muted">
                                        Connect BioAmp EXG Pill to start streaming
                                    </p>
                                    <p className="text-[10px] text-neural-muted/50 uppercase tracking-widest">
                                        Use Connection Manager above
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Waveform footer stats */}
                        <div className="flex gap-6 pt-3 mt-3 border-t border-neural-border">
                            {[
                                { label: "Mean |V|", value: `${analysis.meanMv} mV` },
                                { label: "Peak", value: `${analysis.peakMv} mV` },
                                { label: "Window", value: `${chartData.length} pts` },
                                { label: "Channel", value: "CH1 — EMG" },
                                { label: "Filter", value: "HPF 70Hz · Notch 50Hz · LPF 2.5kHz" },
                            ].map((s) => (
                                <div key={s.label}>
                                    <p className="text-[9px] uppercase tracking-widest text-neural-muted">{s.label}</p>
                                    <p className="text-xs font-mono text-neural-text mt-0.5">{s.value}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* RMS Envelope History */}
                    <div className="glass-panel p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-0.5">
                                    Signal Processing
                                </p>
                                <h3 className="text-xs font-semibold text-neural-text">RMS Envelope — History</h3>
                            </div>
                            <span className="text-[9px] font-mono text-neural-muted">
                                ~{rmsHistory.length * 0.4}s window
                            </span>
                        </div>
                        {rmsHistory.length > 2 ? (
                            <RMSHistoryChart data={rmsHistory} />
                        ) : (
                            <div className="h-20 flex items-center justify-center rounded-lg"
                                style={{ background: "rgba(0,0,0,0.2)" }}>
                                <span className="text-[10px] font-mono text-neural-muted animate-pulse">
                                    Accumulating RMS data…
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right column: Bio-signal gauges panel */}
                <div className="flex flex-col gap-4">
                    <BioSignalPanel />
                </div>
            </div>
        </div>
    );
}
