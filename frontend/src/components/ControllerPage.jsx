import { useState, useEffect, useRef, useCallback } from "react";
import { updateServos } from "../api";

// ── Servo mapping: which axis/button → which DOF ─────────────────────────────
const SERVO_MAP = [
    { key: "base", dof: "Base Rotation", input: "Left X (Axis 0)", color: "#00d4ff" },
    { key: "shoulder", dof: "Shoulder", input: "Left Y (Axis 1)", color: "#a78bfa" },
    { key: "elbow", dof: "Elbow", input: "Right Y (Axis 3)", color: "#f59e0b" },
    { key: "wrist", dof: "Wrist Pitch", input: "Right X (Axis 2)", color: "#34d399" },
    { key: "auxiliary", dof: "Wrist Roll", input: "L2 / R2", color: "#f472b6" },
    { key: "gripper", dof: "Gripper", input: "○ / ×", color: "#fb923c" },
];

const BUTTON_LABELS = [
    "×", "○", "□", "△", "L1", "R1", "L2", "R2",
    "Select", "Start", "L3", "R3", "↑", "↓", "←", "→", "PS"
];

const AXIS_LABELS = ["LX", "LY", "RX", "RY"];
const AXIS_COLORS = ["#00d4ff", "#a78bfa", "#34d399", "#f59e0b"];

// Dead-zone threshold
const DEAD_ZONE = 0.08;

function applyDeadZone(v) {
    return Math.abs(v) < DEAD_ZONE ? 0 : v;
}

// ── Analog Stick Visualizer ──────────────────────────────────────────────────
function StickViz({ label, x, y, color }) {
    const cx = applyDeadZone(x);
    const cy = applyDeadZone(y);
    const R = 44; // radius of the field
    const dotX = 50 + cx * R;
    const dotY = 50 + cy * R;
    const dist = Math.sqrt(cx * cx + cy * cy);

    return (
        <div className="flex flex-col items-center gap-1.5">
            <svg width="100" height="100" viewBox="0 0 100 100">
                {/* Outer ring */}
                <circle cx="50" cy="50" r="48" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                {/* Dead-zone ring */}
                <circle cx="50" cy="50" r={DEAD_ZONE * R * 2} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" strokeDasharray="2 2" />
                {/* Cross-hair */}
                <line x1="50" y1="6" x2="50" y2="94" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
                <line x1="6" y1="50" x2="94" y2="50" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
                {/* Reach line */}
                {dist > 0.01 && (
                    <line x1="50" y1="50" x2={dotX} y2={dotY} stroke={color} strokeWidth="1" strokeOpacity="0.5" />
                )}
                {/* Dot */}
                <circle
                    cx={dotX} cy={dotY} r="7"
                    fill={color} fillOpacity={dist > 0.01 ? 0.9 : 0.25}
                    style={{ filter: dist > 0.01 ? `drop-shadow(0 0 5px ${color})` : "none", transition: "all 0.04s" }}
                />
                {/* Center dot */}
                <circle cx="50" cy="50" r="2" fill="rgba(255,255,255,0.2)" />
            </svg>
            <span className="text-[10px] font-mono text-neural-muted">{label}</span>
            <span className="text-[9px] font-mono" style={{ color }}>
                {cx.toFixed(2)}, {cy.toFixed(2)}
            </span>
        </div>
    );
}

// ── Axis Bar ─────────────────────────────────────────────────────────────────
function AxisBar({ label, value, color }) {
    const v = applyDeadZone(value);
    const pct = ((v + 1) / 2) * 100; // 0–100%
    return (
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-neural-muted w-6 flex-shrink-0">{label}</span>
            <div className="flex-1 h-3 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                {/* Center marker */}
                <div className="absolute top-0 bottom-0 w-px bg-white/20" style={{ left: "50%" }} />
                {/* Filled bar */}
                <div
                    className="absolute top-0.5 bottom-0.5 rounded-full transition-all duration-[40ms]"
                    style={{
                        left: v >= 0 ? "50%" : `${pct}%`,
                        width: `${Math.abs(v) * 50}%`,
                        background: color,
                        boxShadow: `0 0 6px ${color}88`,
                    }}
                />
            </div>
            <span className="text-[10px] font-mono w-12 text-right" style={{ color }}>
                {v.toFixed(3)}
            </span>
        </div>
    );
}

// ── Button Grid ───────────────────────────────────────────────────────────────
function ButtonGrid({ buttons }) {
    return (
        <div className="grid grid-cols-8 gap-1.5">
            {BUTTON_LABELS.map((label, i) => {
                const pressed = buttons[i]?.pressed || false;
                const val = buttons[i]?.value ?? 0;
                return (
                    <div
                        key={i}
                        className="flex flex-col items-center justify-center rounded-lg h-10 text-[10px] font-mono transition-all duration-75"
                        style={{
                            background: pressed ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.03)",
                            border: pressed ? "1px solid rgba(0,212,255,0.5)" : "1px solid rgba(255,255,255,0.07)",
                            color: pressed ? "#00d4ff" : "#3a3f5c",
                            boxShadow: pressed ? "0 0 10px rgba(0,212,255,0.3)" : "none",
                            transform: pressed ? "scale(0.94)" : "scale(1)",
                        }}
                    >
                        <span>{label}</span>
                        {val > 0.01 && (
                            <span className="text-[8px] opacity-60">{val.toFixed(2)}</span>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

// ── Main Controller Page ──────────────────────────────────────────────────────
export default function ControllerPage() {
    const [gamepad, setGamepad] = useState(null);
    const [axes, setAxes] = useState([0, 0, 0, 0]);
    const [buttons, setButtons] = useState([]);
    const [pollRate, setPollRate] = useState(0);
    const [lastInputTime, setLastInputTime] = useState(null);
    const [liveSync, setLiveSync] = useState(false);
    
    const lastSentAngles = useRef({});
    const lastSentTime = useRef(0);
    const rafRef = useRef(null);
    const lastFrameTime = useRef(performance.now());
    const frameCount = useRef(0);

    const poll = useCallback(() => {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        let found = null;
        for (const gp of gamepads) {
            if (gp) { found = gp; break; }
        }

        if (found) {
            const newAxes = Array.from(found.axes);
            const newButtons = found.buttons.map((b) => ({ pressed: b.pressed, value: b.value }));

            // Detect any input for "last input" timestamp
            const anyInput = newAxes.some((a) => Math.abs(a) > DEAD_ZONE) ||
                newButtons.some((b) => b.pressed);
            if (anyInput) setLastInputTime(Date.now());

            setAxes(newAxes);
            setButtons(newButtons);
            setGamepad({ id: found.id, index: found.index });
        } else {
            setGamepad(null);
        }

        // Poll rate calculation (every 60 frames)
        frameCount.current += 1;
        const now = performance.now();
        const elapsed = now - lastFrameTime.current;
        if (elapsed >= 1000) {
            setPollRate(Math.round((frameCount.current / elapsed) * 1000));
            frameCount.current = 0;
            lastFrameTime.current = now;
        }

        rafRef.current = requestAnimationFrame(poll);
    }, []);

    useEffect(() => {
        rafRef.current = requestAnimationFrame(poll);
        return () => cancelAnimationFrame(rafRef.current);
    }, [poll]);

    // ── Live Sync Logic ────────────────────────────────────────────────────────
    useEffect(() => {
        if (!liveSync || !gamepad || axes.length < 4) return;

        // Calculate angles
        // 1. Center around 90 + input * 90. Clamp 0..180
        const calc = (v) => Math.max(0, Math.min(180, Math.round(90 + v * 90)));
        
        const nextAngles = {
            base:     calc(applyDeadZone(axes[0] || 0)),
            shoulder: calc(applyDeadZone(axes[1] || 0)),
            elbow:    calc(applyDeadZone(axes[3] || 0)), // Right Y
            wrist:    calc(applyDeadZone(axes[2] || 0)), // Right X
            // Auxiliary (L2/R2) - map diff of triggers
            auxiliary: calc((buttons[7]?.value || 0) - (buttons[6]?.value || 0)),
            // Gripper: Cross (0) to toggle or hold? Let's use Cross for closed (180), Circle for open (0)
            gripper:   buttons[0]?.pressed ? 180 : (buttons[1]?.pressed ? 0 : (lastSentAngles.current.gripper ?? 90))
        };

        // Check for meaningful change (avoid noise)
        const hasDiff = Object.keys(nextAngles).some(k => nextAngles[k] !== lastSentAngles.current[k]);
        const now = Date.now();
        
        // Throttled update (max 20 Hz / 50ms)
        if (hasDiff && (now - lastSentTime.current) > 50) {
            updateServos(nextAngles);
            lastSentAngles.current = nextAngles;
            lastSentTime.current = now;
        }
    }, [axes, buttons, gamepad, liveSync]);

    const formatLastInput = () => {
        if (!lastInputTime) return "—";
        const s = ((Date.now() - lastInputTime) / 1000).toFixed(1);
        return `${s}s ago`;
    };

    return (
        <div className="flex flex-col gap-4">

            {/* ── Controller Detection Banner ─── */}
            <div
                className="glass-panel px-5 py-3.5 flex items-center justify-between"
                style={{ borderColor: gamepad ? "rgba(0,212,255,0.2)" : "rgba(255,60,90,0.15)" }}
            >
                <div className="flex items-center gap-3">
                    <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
                        style={{
                            background: gamepad ? "rgba(0,212,255,0.1)" : "rgba(255,60,90,0.07)",
                            border: gamepad ? "1px solid rgba(0,212,255,0.25)" : "1px solid rgba(255,60,90,0.2)",
                        }}
                    >
                        🎮
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-neural-muted">PS Controller</p>
                        <p className="text-sm font-semibold" style={{ color: gamepad ? "#00d4ff" : "#ff3c5a" }}>
                            {gamepad ? "Controller Connected" : "No Controller Detected"}
                        </p>
                        {gamepad && (
                            <p className="text-[10px] font-mono text-neural-muted truncate max-w-xs">{gamepad.id}</p>
                        )}
                    </div>
                </div>

                {/* Live Sync Toggle */}
                {gamepad && (
                    <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-2 rounded-xl">
                        <span className="text-[10px] uppercase tracking-widest text-neural-muted font-bold">Arm Sync</span>
                        <button
                            onClick={() => setLiveSync(!liveSync)}
                            className="relative w-12 h-6 rounded-full transition-all duration-300 flex items-center px-1"
                            style={{
                                background: liveSync ? "rgba(0,212,255,0.2)" : "rgba(255,255,255,0.1)",
                                border: `1px solid ${liveSync ? "rgba(0,212,255,0.4)" : "rgba(255,255,255,0.2)"}`,
                                boxShadow: liveSync ? "0 0 12px rgba(0,212,255,0.2)" : "none"
                            }}
                        >
                            <div
                                className="w-4 h-4 rounded-full transition-transform duration-300"
                                style={{
                                    background: liveSync ? "#00d4ff" : "#3a3f5c",
                                    transform: liveSync ? "translateX(24px)" : "translateX(0)",
                                    boxShadow: liveSync ? "0 0 8px #00d4ff" : "none"
                                }}
                            />
                        </button>
                    </div>
                )}

                {/* Telemetry strip */}
                <div className="flex items-center gap-5 flex-shrink-0">
                    {[
                        { label: "POLL RATE", value: gamepad ? `${pollRate} Hz` : "—" },
                        { label: "LAST INPUT", value: formatLastInput() },
                        { label: "GAMEPAD IDX", value: gamepad ? `#${gamepad.index}` : "—" },
                    ].map(({ label, value }) => (
                        <div key={label} className="text-right">
                            <p className="text-[9px] uppercase tracking-widest text-neural-muted">{label}</p>
                            <p className="text-xs font-mono text-white">{value}</p>
                        </div>
                    ))}
                </div>
            </div>

            {!gamepad && (
                <div className="glass-panel px-5 py-8 flex flex-col items-center justify-center gap-3 text-center">
                    <span className="text-4xl">🎮</span>
                    <p className="text-neural-muted text-sm">Connect your PS4 / PS5 controller via USB or Bluetooth,</p>
                    <p className="text-neural-muted text-sm">then press any button to activate it.</p>
                </div>
            )}

            {gamepad && (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

                    {/* ── Left: Stick Visualizers + Axes ─── */}
                    <div className="flex flex-col gap-4 xl:col-span-1">

                        {/* Sticks */}
                        <div className="glass-panel px-5 py-4">
                            <p className="text-[10px] uppercase tracking-widest text-neural-muted mb-4">Analog Sticks</p>
                            <div className="flex items-center justify-around">
                                <StickViz label="LEFT STICK" x={axes[0] ?? 0} y={axes[1] ?? 0} color="#00d4ff" />
                                <StickViz label="RIGHT STICK" x={axes[2] ?? 0} y={axes[3] ?? 0} color="#a78bfa" />
                            </div>
                        </div>

                        {/* Axes bars */}
                        <div className="glass-panel px-5 py-4">
                            <p className="text-[10px] uppercase tracking-widest text-neural-muted mb-3">Axis Calibration</p>
                            <div className="flex flex-col gap-2.5">
                                {AXIS_LABELS.map((label, i) => (
                                    <AxisBar key={label} label={label} value={axes[i] ?? 0} color={AXIS_COLORS[i]} />
                                ))}
                            </div>
                            <p className="text-[9px] text-neural-muted mt-3 font-mono">
                                Dead-zone: ±{DEAD_ZONE} · Range: −1.000 to +1.000
                            </p>
                        </div>
                    </div>

                    {/* ── Center: Button Grid ─── */}
                    <div className="flex flex-col gap-4">
                        <div className="glass-panel px-5 py-4 flex-1">
                            <p className="text-[10px] uppercase tracking-widest text-neural-muted mb-4">Button States</p>
                            <ButtonGrid buttons={buttons} />

                            {/* L2/R2 analog values */}
                            <div className="mt-4 flex gap-3">
                                {[{ label: "L2", idx: 6, color: "#f472b6" }, { label: "R2", idx: 7, color: "#fb923c" }].map(({ label, idx, color }) => {
                                    const val = buttons[idx]?.value ?? 0;
                                    return (
                                        <div key={label} className="flex-1">
                                            <div className="flex justify-between mb-1">
                                                <span className="text-[10px] font-mono text-neural-muted">{label} Trigger</span>
                                                <span className="text-[10px] font-mono" style={{ color }}>{val.toFixed(3)}</span>
                                            </div>
                                            <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                                                <div
                                                    className="h-full rounded-full transition-all duration-[40ms]"
                                                    style={{ width: `${val * 100}%`, background: color, boxShadow: `0 0 6px ${color}88` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* ── Right: Servo Mapping ─── */}
                    <div className="flex flex-col gap-4">
                        <div className="glass-panel px-5 py-4">
                            <p className="text-[10px] uppercase tracking-widest text-neural-muted mb-4">Servo DOF Mapping</p>
                            <div className="flex flex-col gap-2">
                                {SERVO_MAP.map(({ dof, input, color }) => (
                                    <div
                                        key={dof}
                                        className="flex items-center justify-between px-3 py-2.5 rounded-lg"
                                        style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${color}22` }}
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />
                                            <span className="text-xs text-white font-medium">{dof}</span>
                                        </div>
                                        <span className="text-[10px] font-mono" style={{ color }}>{input}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[9px] font-mono text-neural-muted mt-3">
                                ⓘ Mapping is informational. Connect Arduino ARM to activate control.
                            </p>
                        </div>

                        {/* Raw axes dump */}
                        <div className="glass-panel px-5 py-4">
                            <p className="text-[10px] uppercase tracking-widest text-neural-muted mb-3">Raw Telemetry</p>
                            <div className="grid grid-cols-2 gap-1.5">
                                {axes.map((v, i) => (
                                    <div key={i} className="flex justify-between px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.03)" }}>
                                        <span className="text-[10px] font-mono text-neural-muted">axis[{i}]</span>
                                        <span className="text-[10px] font-mono" style={{ color: AXIS_COLORS[i] }}>{v.toFixed(4)}</span>
                                    </div>
                                ))}
                                {buttons.slice(0, 8).map((b, i) => (
                                    <div key={`b${i}`} className="flex justify-between px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.03)" }}>
                                        <span className="text-[10px] font-mono text-neural-muted">btn[{i}]</span>
                                        <span className="text-[10px] font-mono" style={{ color: b?.pressed ? "#00d4ff" : "#3a3f5c" }}>
                                            {b?.value?.toFixed(2) ?? "0.00"}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
