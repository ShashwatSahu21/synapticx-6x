import { useState, useCallback, useEffect, useRef } from "react";
import { updateServos } from "../api";

const SERVOS = [
    { id: "S1", label: "Base Rotation",   min: 0, max: 180 },
    { id: "S2", label: "Shoulder Pitch",  min: 0, max: 180 },
    { id: "S3", label: "Elbow Flex",      min: 0, max: 180 },
    { id: "S4", label: "Wrist Roll",      min: 0, max: 180 },
    { id: "S5", label: "Wrist Pitch",     min: 0, max: 180 },
    { id: "S6", label: "Gripper",         min: 0, max: 180 },
];

const DEFAULT_ANGLES = { S1: 90, S2: 90, S3: 90, S4: 90, S5: 90, S6: 90 };
const RELEASE_ANGLES = { S1: 0,  S2: 0,  S3: 0,  S4: 0,  S5: 0,  S6: 0  };

export default function ServoControl() {
    const [angles, setAngles] = useState(DEFAULT_ANGLES);
    const [engaged, setEngaged] = useState(false);
    const [sending, setSending] = useState(false);
    const [gamepadActive, setGamepadActive] = useState(false);
    
    const rafRef = useRef(null);
    const lastSentRef = useRef(Date.now());
    const anglesRef = useRef(DEFAULT_ANGLES);

    const send = useCallback(async (next) => {
        const now = Date.now();
        // Throttle to max 20Hz (50ms) to avoid overworking Serial buffer
        if (now - lastSentRef.current < 50) return;
        
        lastSentRef.current = now;
        setSending(true);
        try {
            await updateServos(next);
        } catch { /* backend offline */ }
        setSending(false);
    }, []);

    // --- Gamepad Logic ---
    useEffect(() => {
        if (!gamepadActive || !engaged) {
            cancelAnimationFrame(rafRef.current);
            return;
        }

        const pollGamepad = () => {
            const gamepads = navigator.getGamepads();
            const gp = gamepads[0]; // Primary controller
            
            if (gp) {
                // Mapping PS4 Axis (0-3: Sticks, 4: L2, 5: R2)
                const next = { ...anglesRef.current };
                
                // Axis Mapping (Analog Sticks)
                // - Stick inputs (-1 to 1) converted to Degrees (0 to 180)
                next.S1 = Math.round((gp.axes[0] + 1) * 90);           // LX: Base
                next.S2 = Math.round((gp.axes[1] + 1) * 90);           // LY: Shoulder
                next.S3 = Math.round((gp.axes[3] + 1) * 90);           // RY: Elbow
                next.S4 = Math.round((gp.axes[2] + 1) * 90);           // RX: Wrist Roll
                
                // Button Mapping (Triggers for Gripper)
                // L2 (Buttons[6]) closes, R2 (Buttons[7]) opens
                const l2 = gp.buttons[6].value;
                const r2 = gp.buttons[7].value;
                if (l2 > 0.1) next.S6 = Math.max(0, next.S6 - 5);
                if (r2 > 0.1) next.S6 = Math.min(180, next.S6 + 5);

                // Update state if changed
                if (JSON.stringify(next) !== JSON.stringify(anglesRef.current)) {
                    anglesRef.current = next;
                    setAngles(next);
                    send(next);
                }
            }
            rafRef.current = requestAnimationFrame(pollGamepad);
        };

        rafRef.current = requestAnimationFrame(pollGamepad);
        return () => cancelAnimationFrame(rafRef.current);
    }, [gamepadActive, engaged, send]);

    const handleSlider = (id, val) => {
        if (gamepadActive) return; // Ignore manual slider if Gamepad is taking over
        const next = { ...angles, [id]: Number(val) };
        setAngles(next);
        anglesRef.current = next;
        if (engaged) send(next);
    };

    const engage = async () => {
        setEngaged(true);
        await send(angles);
    };

    const release = async () => {
        setEngaged(false);
        setGamepadActive(false);
        const next = RELEASE_ANGLES;
        setAngles(next);
        anglesRef.current = next;
        await send(next);
    };

    const reset = async () => {
        const next = DEFAULT_ANGLES;
        setAngles(next);
        anglesRef.current = next;
        if (engaged) await send(next);
    };

    return (
        <div className="glass-panel p-5 flex flex-col gap-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-neural-muted mb-0.5">
                        Servo Array
                    </p>
                    <h2 className="text-sm font-semibold text-neural-text">6-DOF Control</h2>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={() => setGamepadActive(!gamepadActive)}
                        className={`text-[9px] font-mono border rounded px-1.5 py-0.5 transition-colors ${gamepadActive ? "border-neural-cyan text-neural-cyan bg-neural-cyan/10" : "border-neural-border text-neural-muted"}`}
                    >
                        🎮 {gamepadActive ? "PAD ACTIVE" : "PAD OFF"}
                    </button>
                    <span className={`status-dot ${engaged ? "online" : "offline"}`} />
                </div>
            </div>

            {/* Sliders */}
            <div className="flex flex-col gap-3.5 opacity-90">
                {SERVOS.map(({ id, label }) => {
                    const val = angles[id];
                    const pct = (val / 180) * 100;
                    return (
                        <div key={id} className={gamepadActive ? "pointer-events-none grayscale-[0.5]" : ""}>
                            <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-mono text-neural-muted bg-neural-bg border border-neural-border rounded px-1.5 py-0.5">
                                        {id}
                                    </span>
                                    <span className="text-xs text-neural-text">{label}</span>
                                </div>
                                <span className="text-xs font-mono text-neural-cyan tabular-nums">
                                    {val}°
                                </span>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={180}
                                value={val}
                                onChange={(e) => handleSlider(id, e.target.value)}
                                className="servo-slider"
                                style={{ "--val": `${pct}%` }}
                            />
                        </div>
                    );
                })}
            </div>

            {/* Controls */}
            <div className="flex gap-2 pt-1 border-t border-neural-border">
                <button
                    onClick={engage}
                    disabled={engaged || sending}
                    className="btn-primary flex-1 disabled:opacity-40"
                >
                    Engage
                </button>
                <button
                    onClick={release}
                    disabled={!engaged || sending}
                    className="btn-danger flex-1 disabled:opacity-40"
                >
                    Release
                </button>
                <button
                    onClick={reset}
                    disabled={sending}
                    className="btn-neutral flex-1 disabled:opacity-40"
                >
                    Reset
                </button>
            </div>
        </div>
    );
}
