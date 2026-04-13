import { useState, useEffect, useRef, useCallback } from "react";
import { updateServos, captureWaypoint, playSequence, getSelectedSequence, fetchSequences } from "../api";

// ═══════════════════════════════════════════════════════════════════════════════
// CORRECTED CONTROLLER MAPPING — Verified Against Physical Wiring
// ═══════════════════════════════════════════════════════════════════════════════
//
// LEFT STICK:
//   X (Axis 0) → Base Rotation        (analog, 0–270°)
//   Y (Axis 1) → Shoulder             (analog, 0–270°)
//
// RIGHT STICK:
//   Y (Axis 3) → Elbow Flex           (analog, 0–270°)
//   X (Axis 2) → *** DISABLED ***     (no command)
//
// BUTTONS:
//   ← / → D-Pad    → Wrist Roll (auxiliary)  ±5° per press, home = 90°
//   L1 (Button 4)   → Gripper CLOSE  −5°
//   R1 (Button 5)   → Gripper OPEN   +5°
//   L2 + R2         → 🎯 CAPTURE position to active mission
//   Start           → ▶ EXECUTE active mission
//
// WRIST PITCH: Controlled only via Dashboard sliders (not on controller)
// WRIST ROLL:  Home = 90°, only changes via D-Pad
//
// SERVO RANGE: All servos 0–270° (270° servo motors with torque protection)
// ═══════════════════════════════════════════════════════════════════════════════

const SERVO_MAX = 270;
const SERVO_CENTER = 135; // 270/2

const SERVO_MAP = [
    { key: "base",      dof: "Base Rotation", input: "Left X (Axis 0)",  color: "#00d4ff" },
    { key: "shoulder",  dof: "Shoulder",       input: "Left Y (Axis 1)",  color: "#a78bfa" },
    { key: "elbow",     dof: "Elbow Flex",     input: "Right Y (Axis 3)", color: "#f59e0b" },
    { key: "wrist",     dof: "Wrist Pitch",    input: "Dashboard Only",   color: "#34d399" },
    { key: "gripper",   dof: "Gripper",        input: "R1 +5° / L1 −5°", color: "#fb923c" },
    { key: "auxiliary",  dof: "Wrist Roll",     input: "← / → D-Pad ±5°", color: "#f472b6" },
];

const BUTTON_LABELS = [
    "×", "○", "□", "△", "L1", "R1", "L2", "R2",
    "Select", "Start", "L3", "R3", "↑", "↓", "←", "→", "PS"
];

const AXIS_LABELS = ["LX", "LY", "RX", "RY"];
const AXIS_COLORS = ["#00d4ff", "#a78bfa", "#555", "#f59e0b"];
const DEAD_ZONE = 0.10;
const DPAD_STEP = 5;
const GRIPPER_STEP = 5;

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

function StickViz({ label, x, y, color, disabledX, disabledY }) {
    const cx = disabledX ? 0 : applyDeadZone(x);
    const cy = disabledY ? 0 : applyDeadZone(y);
    const R = 44;
    const dotX = 50 + cx * R;
    const dotY = 50 + cy * R;
    const dist = Math.sqrt(cx * cx + cy * cy);

    return (
        <div className="flex flex-col items-center gap-1.5">
            <svg width="100" height="100" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="48" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                <circle cx="50" cy="50" r={DEAD_ZONE * R * 2} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" strokeDasharray="2 2" />
                {/* Vertical guide (Y axis) */}
                <line x1="50" y1="6" x2="50" y2="94" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
                {/* Horizontal guide (X axis) — dim if disabled */}
                <line x1="6" y1="50" x2="94" y2="50" stroke={disabledX ? "rgba(255,60,60,0.15)" : "rgba(255,255,255,0.08)"} strokeWidth="0.8" strokeDasharray={disabledX ? "3 3" : "none"} />
                {disabledX && (
                    <text x="50" y="94" textAnchor="middle" fill="rgba(255,60,60,0.3)" fontSize="7" fontFamily="monospace">X OFF</text>
                )}
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

function AxisBar({ label, value, color, disabled }) {
    const v = disabled ? 0 : applyDeadZone(value);
    const pct = ((v + 1) / 2) * 100;
    return (
        <div className="flex items-center gap-3">
            <span className={`text-[10px] font-mono w-6 flex-shrink-0 ${disabled ? "text-red-400/40 line-through" : "text-neural-muted"}`}>{label}</span>
            <div className="flex-1 h-2.5 rounded-full relative overflow-hidden bg-white/5">
                <div className="absolute top-0 bottom-0 w-px bg-white/20" style={{ left: "50%" }} />
                {!disabled && (
                    <div className="absolute top-0 bottom-0 rounded-full transition-all duration-[40ms]" style={{ left: v >= 0 ? "50%" : `${pct}%`, width: `${Math.abs(v) * 50}%`, background: color, boxShadow: `0 0 6px ${color}88` }} />
                )}
            </div>
            <span className="text-[10px] font-mono w-12 text-right" style={{ color: disabled ? "#555" : color }}>{disabled ? "OFF" : v.toFixed(3)}</span>
        </div>
    );
}

function ButtonGrid({ buttons }) {
    return (
        <div className="grid grid-cols-8 gap-1.5">
            {BUTTON_LABELS.map((label, i) => {
                const pressed = buttons[i]?.pressed || false;
                const val = buttons[i]?.value ?? 0;
                const isMapping = [4, 5, 6, 7, 14, 15].includes(i);
                const mapColor = isMapping ? "#f59e0b" : "#00d4ff";
                return (
                    <div key={i} className="flex flex-col items-center justify-center rounded-lg h-11 text-[10px] font-mono transition-all duration-75" style={{ background: pressed ? `rgba(${isMapping ? '245,158,11' : '0,212,255'},0.15)` : "rgba(255,255,255,0.03)", border: pressed ? `1px solid ${mapColor}80` : "1px solid rgba(255,255,255,0.07)", color: pressed ? mapColor : "#3a3f5c" }}>
                        <span>{label}</span>
                        {val > 0.01 && <span className="text-[8px] opacity-60">{val.toFixed(2)}</span>}
                    </div>
                );
            })}
        </div>
    );
}

function CaptureFlash({ visible, count, mission }) {
    if (!visible) return null;
    return (
        <div className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center"
             style={{ animation: "flashPulse 0.6s ease-out forwards" }}>
            <div className="px-8 py-5 rounded-2xl border border-neural-cyan/40 backdrop-blur-xl"
                 style={{ background: "rgba(0,212,255,0.08)", boxShadow: "0 0 60px rgba(0,212,255,0.3)" }}>
                <p className="text-neural-cyan text-xl font-bold text-center">🎯 Position Captured!</p>
                <p className="text-white/60 text-sm text-center mt-1">
                    Waypoint #{count} → <span className="text-neural-cyan">{mission}</span>
                </p>
            </div>
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
    const [selectedMission, setSelectedMission] = useState(null);
    const [captureFlash, setCaptureFlash] = useState({ visible: false, count: 0, mission: "" });
    const [captureCount, setCaptureCount] = useState(0);

    const lastSentAngles = useRef({});
    const smoothedAnglesRef = useRef({
        base: SERVO_CENTER, shoulder: SERVO_CENTER, elbow: SERVO_CENTER,
        wrist: SERVO_CENTER, auxiliary: 90, gripper: 90
    });
    const lastSentTime = useRef(0);
    const rafRef = useRef(null);
    const lastFrameTime = useRef(performance.now());
    const frameCount = useRef(0);

    // Trigger debounce refs
    const comboTriggered = useRef(false);
    const startTriggered = useRef(false);
    const currentSeqId = useRef(null);

    // D-Pad debounce refs
    const dpadLeftTriggered = useRef(false);
    const dpadRightTriggered = useRef(false);
    // L1/R1 debounce refs
    const l1Triggered = useRef(false);
    const r1Triggered = useRef(false);

    useEffect(() => {
        const fetchMission = async () => {
            try {
                const res = await getSelectedSequence();
                if (res.status === "ok" && res.id) {
                    currentSeqId.current = res.id;
                    const list = await fetchSequences();
                    const seq = list.sequences.find(s => s.id === res.id);
                    setSelectedMission(seq ? seq.name : "Unknown");
                    if (seq) setCaptureCount(seq.waypoint_count || 0);
                } else {
                    currentSeqId.current = null;
                    setSelectedMission(null);
                }
            } catch (e) {}
        };
        fetchMission();
        const id = setInterval(fetchMission, 2000);
        return () => clearInterval(id);
    }, []);

    const poll = useCallback(() => {
        const gps = navigator.getGamepads();
        let found = null;
        for (const gp of gps) { if (gp) { found = gp; break; } }

        if (found) {
            const newAxes = Array.from(found.axes);
            const newButtons = found.buttons.map((b) => ({ pressed: b.pressed, value: b.value }));

            // ═══════════════════════════════════════════════════════════════
            // L2 + R2 COMBO → CAPTURE POSITION TO ACTIVE MISSION
            // ═══════════════════════════════════════════════════════════════
            const l2 = newButtons[6]?.pressed;
            const r2 = newButtons[7]?.pressed;
            if (l2 && r2) {
                if (!comboTriggered.current) {
                    captureWaypoint().then(res => {
                        if (res.status === "ok") {
                            const newCount = res.total_waypoints || captureCount + 1;
                            setCaptureCount(newCount);
                            setCaptureFlash({ visible: true, count: newCount, mission: res.mission || selectedMission });
                            setTimeout(() => setCaptureFlash(prev => ({ ...prev, visible: false })), 800);
                        }
                    }).catch(console.error);
                    comboTriggered.current = true;
                }
            } else {
                comboTriggered.current = false;
            }

            // ═══════════════════════════════════════════════════════════════
            // START → EXECUTE ACTIVE MISSION
            // ═══════════════════════════════════════════════════════════════
            const startBtn = newButtons[9]?.pressed;
            if (startBtn) {
                if (!startTriggered.current && currentSeqId.current) {
                    playSequence(currentSeqId.current).catch(console.error);
                    startTriggered.current = true;
                }
            } else {
                startTriggered.current = false;
            }

            // ═══════════════════════════════════════════════════════════════
            // D-PAD LEFT/RIGHT → WRIST ROLL (AUXILIARY) ±5°, home=90°
            // ═══════════════════════════════════════════════════════════════
            const dpadLeft = newButtons[14]?.pressed;
            const dpadRight = newButtons[15]?.pressed;

            if (dpadLeft) {
                if (!dpadLeftTriggered.current) {
                    smoothedAnglesRef.current.auxiliary = Math.max(0, smoothedAnglesRef.current.auxiliary - DPAD_STEP);
                    dpadLeftTriggered.current = true;
                }
            } else {
                dpadLeftTriggered.current = false;
            }

            if (dpadRight) {
                if (!dpadRightTriggered.current) {
                    smoothedAnglesRef.current.auxiliary = Math.min(SERVO_MAX, smoothedAnglesRef.current.auxiliary + DPAD_STEP);
                    dpadRightTriggered.current = true;
                }
            } else {
                dpadRightTriggered.current = false;
            }

            // ═══════════════════════════════════════════════════════════════
            // R1 → GRIPPER OPEN (+5°)  |  L1 → GRIPPER CLOSE (-5°)
            // ═══════════════════════════════════════════════════════════════
            const l1 = newButtons[4]?.pressed;
            const r1 = newButtons[5]?.pressed;

            if (r1) {
                if (!r1Triggered.current) {
                    smoothedAnglesRef.current.gripper = Math.min(SERVO_MAX, smoothedAnglesRef.current.gripper + GRIPPER_STEP);
                    r1Triggered.current = true;
                }
            } else {
                r1Triggered.current = false;
            }

            if (l1) {
                if (!l1Triggered.current) {
                    smoothedAnglesRef.current.gripper = Math.max(0, smoothedAnglesRef.current.gripper - GRIPPER_STEP);
                    l1Triggered.current = true;
                }
            } else {
                l1Triggered.current = false;
            }

            const anyInput = newAxes.some((a) => Math.abs(a) > DEAD_ZONE) || newButtons.some((b) => b.pressed);

            if (anyInput) setLastInputTime(Date.now());
            setAxes(newAxes);
            setButtons(newButtons);

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
    }, [pollRate, lastInputTime]);

    useEffect(() => {
        rafRef.current = requestAnimationFrame(poll);
        return () => cancelAnimationFrame(rafRef.current);
    }, [poll]);

    // ── Servo sync — maps controller input to servo angles ───────────────
    useEffect(() => {
        if (!liveSync || !gamepad) {
            if (lastSentAngles.current && Object.keys(lastSentAngles.current).length > 0) {
                lastSentAngles.current = {};
            }
            return;
        }
        if (axes.length < 4) return;

        // Map stick -1..+1 → 0..270 range
        const calcAxis = (v) => {
            const dz = applyDeadZone(v);
            const curved = expResponse(dz);
            return Math.max(0, Math.min(SERVO_MAX, SERVO_CENTER + curved * SERVO_CENTER));
        };

        const rawTarget = {
            base:      calcAxis(axes[0] || 0),          // Left Stick X
            shoulder:  calcAxis(axes[1] || 0),          // Left Stick Y
            elbow:     calcAxis(axes[3] || 0),          // Right Stick Y ONLY
            // RIGHT STICK X (Axis 2) → DISABLED / NO COMMAND
            // Wrist pitch stays wherever it was last set (dashboard/manual)
            wrist:     smoothedAnglesRef.current.wrist,
            // Gripper & Wrist Roll: button-stepped only
            gripper:   smoothedAnglesRef.current.gripper,
            auxiliary:  smoothedAnglesRef.current.auxiliary,
        };

        const prev = smoothedAnglesRef.current;
        const smoothed = {};
        for (const key of Object.keys(rawTarget)) {
            const current = prev[key] ?? SERVO_CENTER;
            const target = rawTarget[key];
            // Button-controlled axes: instant (no smoothing)
            if (key === "gripper" || key === "auxiliary" || key === "wrist") {
                smoothed[key] = Math.round(target);
            } else {
                smoothed[key] = Math.round(current + (target - current) * SMOOTH_ALPHA);
            }
        }
        smoothedAnglesRef.current = smoothed;

        const hasDiff = Object.keys(smoothed).some(k => smoothed[k] !== lastSentAngles.current[k]);
        const now = Date.now();

        if (hasDiff && (now - lastSentTime.current) > 40) {
            updateServos(smoothed).catch(() => {});
            lastSentAngles.current = { ...smoothed };
            lastSentTime.current = now;
        }
    }, [axes, buttons, gamepad, liveSync]);

    const handleSyncToggle = (e) => {
        e.stopPropagation();
        setLiveSync((prev) => !prev);
    };

    const gripAngle = smoothedAnglesRef.current.gripper;
    const rollAngle = smoothedAnglesRef.current.auxiliary;

    return (
        <div className="flex flex-col gap-5 h-full overflow-y-auto pr-1 custom-scroll">
            <CaptureFlash visible={captureFlash.visible} count={captureFlash.count} mission={captureFlash.mission} />

            {/* ── Header Bar ── */}
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

                <div className="flex flex-col items-center gap-1">
                    <p className="text-[10px] uppercase tracking-widest text-neural-muted font-bold">Record Target</p>
                    <div className={`px-4 py-1.5 rounded-lg border flex items-center gap-2 transition-all ${selectedMission ? "border-neural-cyan/30 bg-neural-cyan/5 text-neural-cyan" : "border-white/5 bg-white/5 text-white/20"}`}>
                        <span className="text-[9px]">⦿</span>
                        <span className="text-[10px] font-bold tracking-tight truncate max-w-[120px]">{selectedMission || "No Active Mission"}</span>
                        {selectedMission && <span className="text-[9px] opacity-50 font-mono">({captureCount}pts)</span>}
                    </div>
                </div>

                <div className="flex gap-6">
                    {[{ label: "POLL", val: pollRate+"Hz" }, { label: "RANGE", val: "0–270°" }].map(s => (
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
                    {/* ── Sticks + Calibration Row ── */}
                    <div className="grid grid-cols-2 gap-5">
                        <div className="glass-panel p-6 border-white/5">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-6 font-bold">Sticks</p>
                            <div className="flex justify-around items-center">
                                <StickViz label="Left Stick" x={axes[0]} y={axes[1]} color="#00d4ff" />
                                <StickViz label="Right Stick" x={axes[2]} y={axes[3]} color="#a78bfa" disabledX={true} />
                            </div>
                        </div>
                        <div className="glass-panel p-6 border-white/5 flex flex-col gap-4">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted font-bold">Axis Calibration</p>
                            {AXIS_LABELS.map((l, i) => (
                                <AxisBar key={l} label={l} value={axes[i]} color={AXIS_COLORS[i]} disabled={i === 2} />
                            ))}
                            <div className="bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-1.5 mt-1">
                                <span className="text-[8px] font-mono text-red-400/60">RX (Axis 2) disabled — Wrist Roll on D-Pad only</span>
                            </div>
                        </div>
                    </div>

                    {/* ── Gripper + Wrist Roll Live Gauges ── */}
                    <div className="grid grid-cols-2 gap-5">
                        <div className="glass-panel p-5 border-white/5">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted font-bold">Gripper</p>
                                <span className="text-xs font-mono text-neural-cyan">{Math.round(gripAngle)}°</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-[9px] font-mono text-white/40 w-8">L1 −</span>
                                <div className="flex-1 h-4 rounded-full relative overflow-hidden bg-white/5 border border-white/5">
                                    <div className="absolute top-0 bottom-0 rounded-full transition-all duration-150"
                                         style={{ width: `${(gripAngle / SERVO_MAX) * 100}%`, background: "linear-gradient(90deg, #fb923c, #f97316)", boxShadow: "0 0 10px rgba(251,146,60,0.4)" }} />
                                </div>
                                <span className="text-[9px] font-mono text-white/40 w-8 text-right">R1 +</span>
                            </div>
                            <div className="flex justify-between mt-2 text-[8px] font-mono text-white/20">
                                <span>CLOSED 0°</span>
                                <span>OPEN {SERVO_MAX}°</span>
                            </div>
                        </div>
                        <div className="glass-panel p-5 border-white/5">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted font-bold">Wrist Roll</p>
                                <span className="text-xs font-mono text-neural-cyan">{Math.round(rollAngle)}°</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <span className="text-[9px] font-mono text-white/40 w-8">← −</span>
                                <div className="flex-1 h-4 rounded-full relative overflow-hidden bg-white/5 border border-white/5">
                                    <div className="absolute top-0 bottom-0 w-px bg-white/20" style={{ left: `${(90 / SERVO_MAX) * 100}%` }} />
                                    <div className="absolute top-0 bottom-0 rounded-full transition-all duration-150"
                                         style={{ width: `${(rollAngle / SERVO_MAX) * 100}%`, background: "linear-gradient(90deg, #f472b6, #ec4899)", boxShadow: "0 0 10px rgba(244,114,182,0.4)" }} />
                                </div>
                                <span className="text-[9px] font-mono text-white/40 w-8 text-right">→ +</span>
                            </div>
                            <div className="flex justify-between mt-2 text-[8px] font-mono text-white/20">
                                <span>0°</span>
                                <span>90° home</span>
                                <span>{SERVO_MAX}°</span>
                            </div>
                        </div>
                    </div>

                    {/* ── Button Mapping Grid ── */}
                    <div className="glass-panel p-6 border-white/5">
                         <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-6 font-bold">Mapping Matrix</p>
                         <ButtonGrid buttons={buttons} />
                    </div>

                    {/* ── DOF Assignment + Controller Shortcuts ── */}
                    <div className="grid grid-cols-2 gap-5">
                        <div className="glass-panel p-6 border-white/5">
                             <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-4 font-bold">DOF Assignment</p>
                             <div className="grid grid-cols-3 gap-3">
                                {SERVO_MAP.map(m => (
                                    <div key={m.dof} className={`bg-white/5 border p-3 rounded-xl flex items-center justify-between ${m.input === "Dashboard Only" ? "border-white/3 opacity-50" : "border-white/5"}`}>
                                        <div className="flex items-center gap-2">
                                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: m.color, boxShadow: `0 0 5px ${m.color}` }} />
                                            <span className="text-xs text-white font-medium">{m.dof}</span>
                                        </div>
                                        <span className="text-[10px] font-mono opacity-50" style={{ color: m.color }}>{m.input}</span>
                                    </div>
                                ))}
                             </div>
                        </div>
                        <div className="glass-panel p-6 border-white/5">
                            <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-4 font-bold">Controller Shortcuts</p>
                            <div className="flex flex-col gap-2.5">
                                {[
                                    { keys: "L2 + R2", action: "Capture Position", desc: "Save joint angles to active mission", color: "#00d4ff" },
                                    { keys: "Start", action: "Execute Mission", desc: "Play all saved waypoints", color: "#34d399" },
                                    { keys: "R1", action: "Open Gripper", desc: `+${GRIPPER_STEP}° per press`, color: "#fb923c" },
                                    { keys: "L1", action: "Close Gripper", desc: `−${GRIPPER_STEP}° per press`, color: "#fb923c" },
                                    { keys: "← D-Pad", action: "Roll Left", desc: `−${DPAD_STEP}° wrist roll`, color: "#f472b6" },
                                    { keys: "→ D-Pad", action: "Roll Right", desc: `+${DPAD_STEP}° wrist roll`, color: "#f472b6" },
                                ].map(s => (
                                    <div key={s.keys} className="flex items-center gap-3 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2">
                                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white/5 border border-white/10 flex-shrink-0" style={{ color: s.color, minWidth: "70px", textAlign: "center" }}>{s.keys}</span>
                                        <div className="flex-1">
                                            <span className="text-xs text-white font-medium">{s.action}</span>
                                            <span className="text-[9px] text-white/30 ml-2">{s.desc}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes flashPulse {
                    0% { opacity: 0; transform: scale(0.9); }
                    20% { opacity: 1; transform: scale(1.05); }
                    100% { opacity: 0; transform: scale(1); }
                }
            `}</style>
        </div>
    );
}
