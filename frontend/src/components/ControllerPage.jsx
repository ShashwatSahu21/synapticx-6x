import { useState, useEffect, useRef, useCallback } from "react";
import { updateServos } from "../api";

const SERVO_MAP = [
    { key: "base", dof: "Base Rotation", input: "Left X (Axis 0)", color: "#00d4ff" },
    { key: "shoulder", dof: "Shoulder", input: "Left Y (Axis 1)", color: "#a78bfa" },
    { key: "elbow", dof: "Elbow", input: "Right Y (Axis 3)", color: "#f59e0b" },
    { key: "wrist", dof: "Wrist Pitch", input: "Right X (Axis 2)", color: "#34d399" },
    { key: "gripper",   dof: "Wrist Roll", input: "× / ○", color: "#fb923c" },
    { key: "auxiliary", dof: "Gripper",    input: "L2 / R2", color: "#f472b6" },
];

const BUTTON_LABELS = [
    "×", "○", "□", "△", "L1", "R1", "L2", "R2",
    "Select", "Start", "L3", "R3", "↑", "↓", "←", "→", "PS"
];

const AXIS_LABELS = ["LX", "LY", "RX", "RY"];
const AXIS_COLORS = ["#00d4ff", "#a78bfa", "#34d399", "#f59e0b"];
const DEAD_ZONE = 0.10;

function applyDeadZone(v) {
    if (Math.abs(v) < DEAD_ZONE) return 0;
    const sign = v >= 0 ? 1 : -1;
    return sign * (Math.abs(v) - DEAD_ZONE) / (1 - DEAD_ZONE);
}

const EXP_CURVE = 2.0;
function expResponse(v) {
    const sign = v >= 0 ? 1 : -1;
    return sign * Math.pow(Math.abs(v), EXP_CURVE);
}

const SMOOTH_ALPHA = 0.22;   
const BUTTON_STEP = 3;       

function StickViz({ label, x, y, color }) {
    const cx = applyDeadZone(x);
    const cy = applyDeadZone(y);
    const R = 44; 
    const dotX = 50 + cx * R;
    const dotY = 50 + cy * R;
    const dist = Math.sqrt(cx * cx + cy * cy);

    return (
        <div className="flex flex-col items-center gap-1.5">
            <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="48" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                <circle cx="50" cy="50" r={DEAD_ZONE * R * 2} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" strokeDasharray="2 2" />
                <line x1="50" y1="6" x2="50" y2="94" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
                <line x1="6" y1="50" x2="94" y2="50" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
                {dist > 0.01 && (
                    <line x1="50" y1="50" x2={dotX} y2={dotY} stroke={color} strokeWidth="1" strokeOpacity="0.5" />
                )}
                <circle cx={dotX} cy={dotY} r="7" fill={color} fillOpacity={dist > 0.01 ? 0.9 : 0.25} style={{ filter: dist > 0.01 ? `drop-shadow(0 0 5px ${color})` : "none", transition: "all 0.04s" }} />
                <circle cx="50" cy="50" r="2" fill="rgba(255,255,255,0.2)" />
            </svg>
            <span className="text-[10px] font-mono text-neural-muted">{label}</span>
            <span className="text-[9px] font-mono" style={{ color }}>{cx.toFixed(2)}, {cy.toFixed(2)}</span>
        </div>
    );
}

function AxisBar({ label, value, color }) {
    const v = applyDeadZone(value);
    const pct = ((v + 1) / 2) * 100;
    return (
        <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-neural-muted w-6 flex-shrink-0">{label}</span>
            <div className="flex-1 h-2.5 rounded-full relative overflow-hidden bg-white/5">
                <div className="absolute top-0 bottom-0 w-px bg-white/20" style={{ left: "50%" }} />
                <div className="absolute top-0 bottom-0 rounded-full transition-all duration-[40ms]" style={{ left: v >= 0 ? "50%" : `${pct}%`, width: `${Math.abs(v) * 50}%`, background: color, boxShadow: `0 0 6px ${color}88` }} />
            </div>
            <span className="text-[10px] font-mono w-12 text-right" style={{ color }}>{v.toFixed(3)}</span>
        </div>
    );
}

function ButtonGrid({ buttons }) {
    return (
        <div className="grid grid-cols-8 gap-1.5">
            {BUTTON_LABELS.map((label, i) => {
                const pressed = buttons[i]?.pressed || false;
                const val = buttons[i]?.value ?? 0;
                return (
                    <div key={i} className="flex flex-col items-center justify-center rounded-lg h-11 text-[10px] font-mono transition-all duration-75" style={{ background: pressed ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.03)", border: pressed ? "1px solid rgba(0,212,255,0.5)" : "1px solid rgba(255,255,255,0.07)", color: pressed ? "#00d4ff" : "#3a3f5c" }}>
                        <span>{label}</span>
                        {val > 0.01 && <span className="text-[8px] opacity-60">{val.toFixed(2)}</span>}
                    </div>
                );
            })}
        </div>
    );
}

export default function ControllerPage() {
    const [gamepad, setGamepad] = useState(null);
    const [axes, setAxes] = useState([0, 0, 0, 0]);
    const [buttons, setButtons] = useState([]);
    const [pollRate, setPollRate] = useState(0);
    const [lastInputTime, setLastInputTime] = useState(null);
    const [liveSync, setLiveSync] = useState(true);
    
    const lastSentAngles = useRef({});
    const smoothedAnglesRef = useRef({ base: 90, shoulder: 90, elbow: 90, wrist: 90, auxiliary: 90, gripper: 90 });
    const lastSentTime = useRef(0);
    const rafRef = useRef(null);
    const lastFrameTime = useRef(performance.now());
    const frameCount = useRef(0);

    const poll = useCallback(() => {
        const gps = navigator.getGamepads();
        let found = null;
        for (const gp of gps) { if (gp) { found = gp; break; } }

        if (found) {
            const newAxes = Array.from(found.axes);
            const newButtons = found.buttons.map((b) => ({ pressed: b.pressed, value: b.value }));
            const anyInput = newAxes.some((a) => Math.abs(a) > DEAD_ZONE) || newButtons.some((b) => b.pressed);
            
            if (anyInput) setLastInputTime(Date.now());
            setAxes(newAxes);
            setButtons(newButtons);
            
            // Only update gamepad state if index or status changed to prevent excessive re-renders
            setGamepad((prev) => (!prev || prev.index !== found.index) ? { id: found.id, index: found.index } : prev);
        } else {
            setGamepad(null);
        }

        frameCount.current++;
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

    useEffect(() => {
        if (!liveSync || !gamepad) {
            if (lastSentAngles.current && Object.keys(lastSentAngles.current).length > 0) {
                lastSentAngles.current = {}; 
            }
            return;
        }
        if (axes.length < 4) return;

        const calcAxis = (v) => {
            const dz = applyDeadZone(v);
            const curved = expResponse(dz);
            return Math.max(0, Math.min(180, 90 + curved * 90));
        };

        const rawTarget = {
            base:      calcAxis(axes[0] || 0),
            shoulder:  calcAxis(axes[1] || 0),
            elbow:     calcAxis(axes[3] || 0),
            wrist:     calcAxis(axes[2] || 0),
            auxiliary: Math.max(0, Math.min(180, 90 + ((buttons[6]?.value || 0) - (buttons[7]?.value || 0)) * 90)),
            gripper:   (() => {
                const prev = smoothedAnglesRef.current.gripper;
                if (buttons[0]?.pressed) return Math.min(180, prev + BUTTON_STEP);
                if (buttons[1]?.pressed) return Math.max(0, prev - BUTTON_STEP);
                return prev;
            })(),
        };

        const prev = smoothedAnglesRef.current;
        const smoothed = {};
        for (const key of Object.keys(rawTarget)) {
            const current = prev[key] ?? 90;
            const target = rawTarget[key];
            smoothed[key] = Math.round(current + (target - current) * SMOOTH_ALPHA);
        }
        smoothedAnglesRef.current = smoothed;

        const hasDiff = Object.keys(smoothed).some(k => smoothed[k] !== lastSentAngles.current[k]);
        const now = Date.now();

        if (hasDiff && (now - lastSentTime.current) > 40) { // Slightly faster update 25Hz
            updateServos(smoothed).catch(() => {});
            lastSentAngles.current = { ...smoothed };
            lastSentTime.current = now;
        }
    }, [axes, buttons, gamepad, liveSync]);

    const handleSyncToggle = (e) => {
        e.stopPropagation(); // Prevent bubbling
        console.log("ControllerPage: Toggling liveSync to", !liveSync);
        setLiveSync((prev) => !prev);
    };

    return (
        <div className="flex flex-col gap-5 h-full overflow-y-auto pr-1 custom-scroll">
            <div className="glass-panel px-6 py-4 flex items-center justify-between border-white/5" style={{ minHeight: "80px" }}>
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                         style={{ background: gamepad ? "rgba(0,212,255,0.1)" : "rgba(255,60,90,0.07)", border: gamepad ? "1px solid rgba(0,212,255,0.25)" : "1px solid rgba(255,60,90,0.2)" }}>
                        🎮
                    </div>
                    <div>
                        <p className="text-[10px] uppercase tracking-widest text-neural-muted font-bold">Hardware Input</p>
                        <p className="text-base font-bold" style={{ color: gamepad ? "#00d4ff" : "#ff3c5a" }}>
                            {gamepad ? "Controller Ready" : "Disconnected"}
                        </p>
                    </div>
                </div>

                {gamepad && (
                    <div className="flex items-center gap-4 bg-black/40 border border-white/5 px-4 py-2.5 rounded-2xl">
                        <span className="text-[10px] uppercase tracking-widest text-neural-muted font-bold">Sync</span>
                        <div 
                            onClick={handleSyncToggle}
                            className={`relative w-14 h-7 rounded-full transition-all duration-300 flex items-center px-1 cursor-pointer ${liveSync ? "bg-neural-cyan/20 border border-neural-cyan/40" : "bg-white/5 border border-white/10"}`}
                        >
                            <div className={`w-5 h-5 rounded-full transition-all duration-500 shadow-lg ${liveSync ? "translate-x-7 bg-neural-cyan shadow-[0_0_12px_#00d4ff]" : "translate-x-0 bg-neutral-600"}`} />
                        </div>
                    </div>
                )}

                <div className="flex gap-6">
                    {[{ label: "POLL", val: pollRate+"Hz" }, { label: "DELAY", val: lastInputTime ? "0ms" : "—" }].map(s => (
                        <div key={s.label} className="text-right">
                            <p className="text-[9px] uppercase tracking-widest text-neural-muted">{s.label}</p>
                            <p className="text-xs font-mono text-white font-bold">{s.val}</p>
                        </div>
                    ))}
                </div>
            </div>

            {!gamepad ? (
                <div className="glass-panel py-16 flex flex-col items-center justify-center gap-4 text-center border-white/5">
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center animate-pulse mb-2 text-3xl">🔌</div>
                    <p className="text-white font-bold text-lg">Input Required</p>
                    <p className="text-neural-muted text-sm px-10">Connect PS4/PS5 controller and press any button to initialize serial mapping.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-5">
                    <div className="grid grid-cols-2 gap-5">
                        <div className="glass-panel p-6 border-white/5">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-6 font-bold">Sticks</p>
                            <div className="flex justify-around items-center">
                                <StickViz label="LX / LY" x={axes[0]} y={axes[1]} color="#00d4ff" />
                                <StickViz label="RX / RY" x={axes[2]} y={axes[3]} color="#a78bfa" />
                            </div>
                        </div>
                        <div className="glass-panel p-6 border-white/5 flex flex-col gap-4">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted font-bold font-bold">Calibration</p>
                            {AXIS_LABELS.map((l, i) => <AxisBar key={l} label={l} value={axes[i]} color={AXIS_COLORS[i]} />)}
                        </div>
                    </div>
                    <div className="glass-panel p-6 border-white/5">
                         <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-6 font-bold">Mapping Matrix</p>
                         <ButtonGrid buttons={buttons} />
                    </div>
                    <div className="glass-panel p-6 border-white/5">
                         <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-4 font-bold">DOF Assignment</p>
                         <div className="grid grid-cols-3 gap-3">
                            {SERVO_MAP.map(m => (
                                <div key={m.dof} className="bg-white/5 border border-white/5 p-3 rounded-xl flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: m.color, boxShadow: `0 0 5px ${m.color}` }} />
                                        <span className="text-xs text-white font-medium">{m.dof}</span>
                                    </div>
                                    <span className="text-[10px] font-mono opacity-50" style={{ color: m.color }}>{m.input}</span>
                                </div>
                            ))}
                         </div>
                    </div>
                </div>
            )}
        </div>
    );
}
