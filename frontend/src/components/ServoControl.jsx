import { useState, useCallback, useRef, useEffect } from "react";
import { updateServos, fetchSystemStatus } from "../api";

const SERVOS = [
    { id: "base",      label: "Base Rotation",   min: 0, max: 180, color: "#00d4ff" },
    { id: "shoulder",  label: "Shoulder Pitch",  min: 0, max: 180, color: "#a78bfa" },
    { id: "elbow",     label: "Elbow Flex",      min: 0, max: 180, color: "#f59e0b" },
    { id: "wrist",     label: "Wrist Pitch",     min: 0, max: 180, color: "#34d399" },
    { id: "gripper",   label: "Wrist Roll",      min: 0, max: 180, color: "#fb923c" },
    { id: "auxiliary", label: "Gripper",         min: 0, max: 180, color: "#f472b6" },
];

const DEFAULT_ANGLES = { base: 90, shoulder: 90, elbow: 90, wrist: 90, gripper: 90, auxiliary: 90 };

export default function ServoControl() {
    const [angles, setAngles] = useState(DEFAULT_ANGLES);
    const [engaged, setEngaged] = useState(false);
    const [sending, setSending] = useState(false);
    const [serialOk, setSerialOk] = useState(null);
    const [serialErr, setSerialErr] = useState(null);
    const throttleRef = useRef(null);

    // Sync with backend state on mount
    useEffect(() => {
        const sync = async () => {
            try {
                const res = await fetchSystemStatus();
                if (res.servo_angles) setAngles(res.servo_angles);
            } catch (e) {}
        };
        sync();
    }, []);

    const send = useCallback(async (next) => {
        setSending(true);
        try {
            const res = await updateServos(next);
            setSerialOk(res.serial_sent === true);
            setSerialErr(res.serial_error || null);
        } catch {
            setSerialOk(false);
            setSerialErr("Backend offline");
        }
        setSending(false);
    }, []);

    const handleSlider = (id, val) => {
        const next = { ...angles, [id]: Number(val) };
        setAngles(next);
        if (engaged) {
            if (throttleRef.current) return;
            throttleRef.current = setTimeout(() => {
                throttleRef.current = null;
            }, 50);
            send(next);
        }
    };

    const engage = async () => {
        setEngaged(true);
        await send(angles);
    };

    const release = async () => {
        setEngaged(false);
        const next = DEFAULT_ANGLES;
        setAngles(next);
        await send(next);
    };

    const reset = async () => {
        const next = DEFAULT_ANGLES;
        setAngles(next);
        if (engaged) await send(next);
    };

    return (
        <div className="glass-panel p-6 flex flex-col gap-5 border-white/5 shadow-2xl h-full">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-neural-muted font-bold">
                        Manual Override
                    </p>
                    <h2 className="text-base font-bold text-white font-['Outfit'] mt-1">6-DOF Control Desk</h2>
                </div>
                <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2 bg-black/40 px-3 py-1 rounded-full border border-white/5">
                        <span className={`w-1.5 h-1.5 rounded-full ${engaged ? "bg-neural-cyan animate-pulse shadow-[0_0_8px_#00d4ff]" : "bg-red-500"}`} />
                        <span className={`text-[10px] font-mono font-bold ${engaged ? "text-neural-cyan" : "text-red-400"}`}>
                            {engaged ? "SYSTEM LIVE" : "IDLE"}
                        </span>
                    </div>
                </div>
            </div>

            {/* Sliders Container */}
            <div className="flex flex-col gap-5 flex-1 py-2 custom-scroll overflow-y-auto pr-2">
                {SERVOS.map(({ id, label, color }) => {
                    const val = angles[id];
                    const pct = (val / 180) * 100;
                    return (
                        <div key={id} className="group">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />
                                    <span className="text-xs font-semibold text-white group-hover:text-neural-cyan transition-colors">{label}</span>
                                </div>
                                <div className="bg-white/5 px-2 py-0.5 rounded border border-white/5">
                                    <span className="text-xs font-mono text-neural-cyan tabular-nums">
                                        {val.toFixed(0)}°
                                    </span>
                                </div>
                            </div>
                            <div className="relative">
                                <input
                                    type="range"
                                    min={0}
                                    max={180}
                                    value={val}
                                    onChange={(e) => handleSlider(id, e.target.value)}
                                    className="servo-slider"
                                    style={{ "--val": `${pct}%` }}
                                />
                                {/* Under-glow for active slider */}
                                <div className="absolute top-1/2 left-0 h-[2px] blur-[2px] pointer-events-none opacity-20" 
                                     style={{ width: `${pct}%`, background: color }} />
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Warning Section */}
            {engaged && !serialOk && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-start gap-3 animate-pulse">
                    <span className="text-red-400 text-sm">⚠</span>
                    <p className="text-[10px] font-mono text-red-300 leading-relaxed">
                        {serialErr || "Serial link error"} — Hardware status: Hardware not polled. Ensure COM port is active.
                    </p>
                </div>
            )}

            {/* Global Controls */}
            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-white/5">
                <button
                    onClick={engage}
                    disabled={engaged || sending}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-neural-cyan/10 border border-neural-cyan/30 text-neural-cyan hover:bg-neural-cyan/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed group"
                >
                    <span className="text-xs font-bold uppercase tracking-wider">Engage</span>
                </button>
                <button
                    onClick={release}
                    disabled={!engaged || sending}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <span className="text-xs font-bold uppercase tracking-wider">Release</span>
                </button>
                <button
                    onClick={reset}
                    disabled={sending}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-xl bg-white/5 border border-white/10 text-neural-muted hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                    <span className="text-xs font-bold uppercase tracking-wider">Reset</span>
                </button>
            </div>
        </div>
    );
}
