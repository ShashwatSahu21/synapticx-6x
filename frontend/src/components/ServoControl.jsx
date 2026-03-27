import { useState, useCallback } from "react";
import { updateServos } from "../api";

const SERVOS = [
    { id: "base",      label: "Base Rotation",   min: 0, max: 180 },
    { id: "shoulder",  label: "Shoulder Pitch",  min: 0, max: 180 },
    { id: "elbow",     label: "Elbow Flex",      min: 0, max: 180 },
    { id: "wrist",     label: "Wrist Roll",      min: 0, max: 180 },
    { id: "auxiliary", label: "Wrist Pitch",     min: 0, max: 180 },
    { id: "gripper",   label: "Gripper",         min: 0, max: 180 },
];

const DEFAULT_ANGLES = { base: 90, shoulder: 90, elbow: 90, wrist: 90, auxiliary: 90, gripper: 90 };
const RELEASE_ANGLES = { base: 90, shoulder: 90, elbow: 90, wrist: 90, auxiliary: 90, gripper: 90 };

export default function ServoControl() {
    const [angles, setAngles] = useState(DEFAULT_ANGLES);
    const [engaged, setEngaged] = useState(false);
    const [sending, setSending] = useState(false);

    const send = useCallback(async (next) => {
        setSending(true);
        try {
            await updateServos(next);
        } catch { /* backend offline — UI still works */ }
        setSending(false);
    }, []);

    const handleSlider = (id, val) => {
        const next = { ...angles, [id]: Number(val) };
        setAngles(next);
        if (engaged) send(next);
    };

    const engage = async () => {
        setEngaged(true);
        await send(angles);
    };

    const release = async () => {
        setEngaged(false);
        const next = RELEASE_ANGLES;
        setAngles(next);
        await send(next);
    };

    const reset = async () => {
        const next = DEFAULT_ANGLES;
        setAngles(next);
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
                    <span className={`status-dot ${engaged ? "online" : "offline"}`} />
                    <span className={`text-xs font-mono ${engaged ? "text-neural-cyan" : "text-red-400"}`}>
                        {engaged ? "ENGAGED" : "IDLE"}
                    </span>
                </div>
            </div>

            {/* Sliders */}
            <div className="flex flex-col gap-3.5">
                {SERVOS.map(({ id, label }) => {
                    const val = angles[id];
                    const pct = (val / 180) * 100;
                    return (
                        <div key={id}>
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
                    className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Engage
                </button>
                <button
                    onClick={release}
                    disabled={!engaged || sending}
                    className="btn-danger flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Release
                </button>
                <button
                    onClick={reset}
                    disabled={sending}
                    className="btn-neutral flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Reset
                </button>
            </div>

            {sending && (
                <p className="text-[10px] font-mono text-neural-muted text-center -mt-2 animate-pulse">
                    Transmitting…
                </p>
            )}
        </div>
    );
}
