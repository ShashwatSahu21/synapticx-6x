import { useState, useEffect, useCallback, useRef } from "react";
import { fetchBioSignalState } from "../api";

// Mini radial gauge component for RMS/Fatigue
function RadialGauge({ value, max, label, color, unit = "" }) {
    const pct = Math.min(1, Math.max(0, value / max));
    const angle = pct * 270 - 135; // -135° to +135° sweep
    const r = 36;
    const cx = 44, cy = 44;
    // Arc path
    const startAngle = -135 * (Math.PI / 180);
    const endAngle = angle * (Math.PI / 180);
    const fullEnd = 135 * (Math.PI / 180);
    const bgArc = describeArc(cx, cy, r, startAngle, fullEnd);
    const valArc = describeArc(cx, cy, r, startAngle, endAngle);

    return (
        <div className="flex flex-col items-center gap-1">
            <svg width="88" height="68" viewBox="0 0 88 68">
                {/* Background track */}
                <path d={bgArc} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" strokeLinecap="round" />
                {/* Value arc */}
                <path d={valArc} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 4px ${color}40)`, transition: "d 0.15s ease-out" }} />
                {/* Value text */}
                <text x={cx} y={cy - 2} textAnchor="middle" fill="#e2e4f0" fontSize="13" fontFamily="JetBrains Mono, monospace" fontWeight="600">
                    {typeof value === "number" ? value.toFixed(1) : value}
                </text>
                <text x={cx} y={cy + 12} textAnchor="middle" fill="#3a3f5c" fontSize="8" fontFamily="JetBrains Mono, monospace">
                    {unit}
                </text>
            </svg>
            <span className="text-[9px] font-mono text-neural-muted uppercase tracking-widest">{label}</span>
        </div>
    );
}

function describeArc(cx, cy, r, startAngle, endAngle) {
    const sx = cx + r * Math.cos(startAngle);
    const sy = cy + r * Math.sin(startAngle);
    const ex = cx + r * Math.cos(endAngle);
    const ey = cy + r * Math.sin(endAngle);
    const largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
    return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 1 ${ex} ${ey}`;
}

// Bar-style joint angle indicator
function AngleBar({ angle, label }) {
    const pct = (angle / 180) * 100;
    return (
        <div className="flex items-center gap-3">
            <span className="text-[9px] font-mono text-neural-muted w-16">{label}</span>
            <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                <div
                    className="h-full rounded-full transition-all duration-150"
                    style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, #00d4ff, #a78bfa)`,
                        boxShadow: "0 0 8px rgba(0,212,255,0.3)",
                    }}
                />
            </div>
            <span className="text-xs font-mono text-neural-cyan tabular-nums w-10 text-right">{angle.toFixed(0)}°</span>
        </div>
    );
}

export default function BioSignalPanel() {
    const [bio, setBio] = useState(null);
    const pollRef = useRef(null);

    const load = useCallback(async () => {
        try {
            const res = await fetchBioSignalState();
            setBio(res);
        } catch { /* backend offline */ }
    }, []);

    useEffect(() => {
        load();
        pollRef.current = setInterval(load, 200); // 5 Hz for responsive gauges
        return () => clearInterval(pollRef.current);
    }, [load]);

    if (!bio) {
        return (
            <div className="glass-panel p-5 flex items-center justify-center h-48">
                <span className="text-xs font-mono text-neural-muted animate-pulse">Loading bio-signal engine…</span>
            </div>
        );
    }

    const isActive = bio.mode === "biosignal" || bio.mode === "hybrid";
    const fatiguePct = bio.fatigue_level * 100;
    const fatigueColor = fatiguePct > 70 ? "#ff3c5a" : fatiguePct > 40 ? "#f5a623" : "#34d399";

    return (
        <div className="glass-panel p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-0.5">
                        Bio-Signal Engine
                    </p>
                    <h2 className="text-sm font-semibold text-neural-text">EMG → Servo Control</h2>
                </div>
                <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                        isActive
                            ? bio.emg_connected
                                ? "bg-green-400 animate-pulse"
                                : "bg-yellow-400 animate-pulse"
                            : "bg-neutral-600"
                    }`} />
                    <span className={`text-xs font-mono ${
                        isActive ? "text-neural-cyan" : "text-neural-muted"
                    }`}>
                        {isActive
                            ? bio.emg_connected ? "ACTIVE" : "NO EMG"
                            : "STANDBY"}
                    </span>
                </div>
            </div>

            {/* Inactive notice */}
            {!isActive && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <span className="text-[10px]">💡</span>
                    <span className="text-[10px] font-mono text-neural-muted">
                        Switch to Bio-Signal or Hybrid mode to activate EMG control
                    </span>
                </div>
            )}

            {/* Gauges row */}
            <div className="flex justify-around">
                <RadialGauge
                    value={bio.rms}
                    max={bio.rms_max}
                    label="RMS Amplitude"
                    color="#00d4ff"
                    unit="µV"
                />
                <RadialGauge
                    value={fatiguePct}
                    max={100}
                    label="Fatigue"
                    color={fatigueColor}
                    unit="%"
                />
                <RadialGauge
                    value={bio.smoothed_angle}
                    max={180}
                    label="Joint Angle"
                    color="#a78bfa"
                    unit="deg"
                />
            </div>

            {/* Mapped angle bar */}
            <AngleBar angle={bio.smoothed_angle} label={bio.target_joint} />

            {/* Stats footer */}
            <div className="flex gap-5 pt-2 border-t border-neural-border">
                {[
                    { label: "Raw RMS",     value: `${bio.rms.toFixed(1)}` },
                    { label: "Threshold",   value: `${bio.rms_threshold}` },
                    { label: "Gamma",       value: `${bio.config?.gamma?.toFixed(1)}` },
                    { label: "Smoothing",   value: `${bio.config?.ema_alpha?.toFixed(2)}` },
                    { label: "Mode",        value: bio.mode.toUpperCase() },
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
