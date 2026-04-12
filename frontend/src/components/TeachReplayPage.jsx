import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "../api";
import RoboticArm3D from "./RoboticArm3D";

/**
 * TEACH & REPLAY - MISSION CONTROL PAGE
 * Simplified for robustness, enhanced for visual feedback.
 */
export default function TeachReplayPage() {
    const [sequences, setSequences] = useState([]);
    const [activeSeqId, setActiveSeqId] = useState(null);
    const [activeSeq, setActiveSeq] = useState(null);
    const [playback, setPlayback] = useState({ active: false, status: "idle", progress: 0 });
    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState("");
    const [error, setError] = useState(null);
    
    const pollRef = useRef(null);

    // ── DATA LOADING ──
    const loadSequences = useCallback(async () => {
        try {
            console.log("Fetching mission sequences...");
            const res = await api.fetchSequences();
            if (res.status === "ok") {
                setSequences(res.sequences);
            }
        } catch (err) {
            console.error("Failed to load mission list", err);
        }
    }, []);

    const loadActiveSequence = useCallback(async (id) => {
        if (!id) return;
        try {
            const res = await api.getSequence(id);
            if (res.status === "ok") setActiveSeq(res.sequence);
        } catch (err) {
            console.error("Failed to load details for", id, err);
        }
    }, []);

    const updatePlaybackState = useCallback(async () => {
        try {
            const res = await api.fetchPlaybackState();
            if (res.status === "ok" && res.playback) {
                setPlayback(res.playback);
            }
        } catch (e) {}
    }, []);

    // ── LIFECYCLE ──
    useEffect(() => {
        loadSequences();
        // High-frequency poll for smooth timeline updates (10Hz)
        pollRef.current = setInterval(() => {
            updatePlaybackState();
        }, 100);
        return () => clearInterval(pollRef.current);
    }, [loadSequences, updatePlaybackState]);

    useEffect(() => {
        if (activeSeqId) {
            loadActiveSequence(activeSeqId);
            api.setSelectedSequence(activeSeqId).catch(console.error);
        } else {
            setActiveSeq(null);
            api.setSelectedSequence(null).catch(console.error);
        }
    }, [activeSeqId, loadActiveSequence]);

    // ── ACTIONS ──
    const handleStartCreate = () => {
        setIsCreating(true);
        setNewName(`Mission ${sequences.length + 1}`);
    };

    const handleConfirmCreate = async () => {
        if (!newName.trim()) return;
        try {
            const res = await api.createSequence(newName);
            if (res.status === "ok") {
                await loadSequences();
                setActiveSeqId(res.id);
                setIsCreating(false);
            }
        } catch (err) {
            setError("Failed to initialize mission storage");
        }
    };

    const handleRecordWaypoint = async () => {
        if (!activeSeqId) return;
        try {
            const res = await api.addWaypoint(activeSeqId);
            if (res.status === "ok") {
                await loadActiveSequence(activeSeqId);
            }
        } catch (err) {
            setError("Failed to capture arm position");
        }
    };

    const handlePlay = async () => {
        if (!activeSeqId) return;
        try {
            await api.playSequence(activeSeqId);
        } catch (err) {
            setError("Mission execution failed");
        }
    };

    const handleStop = async () => {
        try {
            await api.stopPlayback();
        } catch (err) {
            setError("Stop failed");
        }
    };

    const handleDeleteSequence = async (id, name) => {
        if (!window.confirm(`Are you sure you want to delete the mission: "${name}"?`)) return;
        try {
            const res = await api.deleteSequence(id);
            if (res.status === "ok") {
                if (activeSeqId === id) setActiveSeqId(null);
                await loadSequences();
            }
        } catch (err) {
            setError("Failed to remove mission archive");
        }
    };

    return (
        <div className="flex flex-col gap-4 h-full relative overflow-hidden">
            <div className="flex gap-4 min-h-[600px] flex-1">
                {/* ── LEFT: MISSION LIST ── */}
                <div className="w-80 glass-panel flex flex-col border-white/5 overflow-hidden">
                    <div className="p-5 border-b border-white/10 flex items-center justify-between">
                        <div>
                            <h2 className="text-[11px] font-bold text-white tracking-widest uppercase">Missions</h2>
                            <p className="text-[9px] text-neural-muted font-mono uppercase mt-0.5">Automation Deck</p>
                        </div>
                        <button 
                            onClick={handleStartCreate}
                            className="w-7 h-7 rounded-lg bg-neural-cyan/10 border border-neural-cyan/40 text-neural-cyan flex items-center justify-center hover:bg-neural-cyan/20 transition-all font-bold group"
                        >
                            <span className="group-hover:scale-125 transition-transform">+</span>
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 custom-scroll">
                        {isCreating && (
                            <div className="p-3 rounded-xl border border-neural-cyan/30 bg-neural-cyan/5 animate-page-in">
                                <input 
                                    autoFocus
                                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-neural-cyan/50 mb-2 font-mono"
                                    value={newName}
                                    onChange={e => setNewName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleConfirmCreate()}
                                />
                                <div className="flex gap-2">
                                    <button onClick={handleConfirmCreate} className="flex-1 text-[10px] bg-neural-cyan/20 py-1.5 rounded-md text-neural-cyan font-bold transition-all hover:bg-neural-cyan/30">SAVE</button>
                                    <button onClick={() => setIsCreating(false)} className="flex-1 text-[10px] bg-white/5 py-1.5 rounded-md text-white/50 font-bold transition-all hover:bg-white/10">CANCEL</button>
                                </div>
                            </div>
                        )}

                        {sequences.length === 0 && !isCreating ? (
                            <div className="flex flex-col items-center justify-center h-48 opacity-20 text-center grayscale">
                                <span className="text-3xl mb-3">🗄️</span>
                                <p className="text-[10px] uppercase tracking-widest font-mono">Archive Empty</p>
                            </div>
                        ) : (
                            sequences.map(seq => (
                                <button 
                                    key={seq.id}
                                    onClick={() => setActiveSeqId(seq.id)}
                                    className={`relative p-4 rounded-xl border text-left transition-all group ${
                                        activeSeqId === seq.id 
                                        ? "bg-neural-cyan/15 border-neural-cyan/60 shadow-[0_0_15px_rgba(0,212,255,0.08)]" 
                                        : "bg-white/5 border-white/5 hover:border-white/10 hover:bg-white/8"
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-2">
                                        <h3 className="text-xs font-bold text-white group-hover:text-neural-cyan transition-colors truncate">{seq.name}</h3>
                                        <div 
                                            onClick={(e) => { e.stopPropagation(); handleDeleteSequence(seq.id, seq.name); }}
                                            className="opacity-0 group-hover:opacity-100 p-1 -m-1 text-red-500/40 hover:text-red-500 transition-all text-[14px]"
                                        >
                                            ✕
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-neural-cyan/40" />
                                            <span className="text-[9px] font-mono text-neural-muted uppercase">
                                                {seq.waypoint_count} Points
                                            </span>
                                        </div>
                                        <span className="text-[9px] font-mono text-neural-cyan/60">
                                            {(seq.total_duration_ms / 1000).toFixed(1)}s Cycle
                                        </span>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* ── CENTER: VISUALIZATION ── */}
                <div className="flex-1 glass-panel border-white/5 relative bg-neural-bg/20 backdrop-blur-md">
                    <RoboticArm3D height="100%" />
                    
                    {/* Execution Display overlay */}
                    {playback.active && (
                        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-[80%] max-w-md pointer-events-none">
                            <div className="glass-panel p-5 border-neural-cyan/20 animate-fade-in">
                                <div className="flex justify-between items-end mb-3">
                                    <div>
                                        <p className="text-[9px] font-bold text-neural-cyan tracking-[0.2em] uppercase mb-1">Live Execution</p>
                                        <h4 className="text-sm font-bold text-white leading-none">{playback.sequence_name}</h4>
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[10px] font-mono text-neural-muted">Waypoints</span>
                                        <p className="text-[11px] font-bold text-white font-mono">{playback.current_waypoint_idx + 1} of {playback.total_waypoints}</p>
                                    </div>
                                </div>
                                <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                    <div 
                                        className="h-full bg-neural-cyan shadow-[0_0_15px_#00d4ff] transition-all duration-200 ease-out"
                                        style={{ width: `${playback.progress * 100}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* ── RIGHT: EDITOR ── */}
                <div className="w-96 glass-panel border-white/5 flex flex-col shadow-2xl bg-neural-panel/40">
                    <div className="p-6 border-b border-white/5">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-2 h-2 rounded-full bg-neural-cyan animate-pulse shadow-[0_0_8px_#00d4ff]" />
                            <p className="text-[10px] uppercase font-bold tracking-[0.3em] text-neural-muted">Teach Terminal</p>
                        </div>
                        <h2 className="text-lg font-bold text-white font-['Outfit']">Manual Training</h2>
                    </div>

                    {!activeSeq ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-10 opacity-30 text-center">
                            <div className="w-20 h-20 rounded-[2rem] bg-white/5 border border-white/10 flex items-center justify-center mb-6 text-3xl">🧩</div>
                            <h3 className="text-sm font-bold text-white mb-2 uppercase tracking-widest">Select Mission</h3>
                            <p className="text-[10px] leading-relaxed max-w-[200px]">Synchronize a mission to start waypoint capturing sequences.</p>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0">
                            {/* Mission Actions */}
                            <div className="p-6 bg-white/5 flex flex-col gap-4 border-b border-white/5">
                                <div className="grid grid-cols-2 gap-3">
                                    <button 
                                        onClick={handlePlay}
                                        disabled={playback.active && !playback.paused}
                                        className="btn-primary py-4 flex items-center justify-center gap-3 transition-transform active:scale-95"
                                    >
                                        <span className="text-xl">▶</span>
                                        <span className="font-bold tracking-widest">Initiate</span>
                                    </button>
                                    <button 
                                        onClick={handleStop}
                                        disabled={!playback.active}
                                        className="btn-danger py-4 flex items-center justify-center gap-3 transition-transform active:scale-95"
                                    >
                                        <span className="text-xl">■</span>
                                        <span className="font-bold tracking-widest">Shutdown</span>
                                    </button>
                                </div>
                                <button 
                                    onClick={handleRecordWaypoint}
                                    className="w-full bg-neural-cyan/10 border border-neural-cyan/30 py-4 rounded-xl text-xs font-bold text-neural-cyan hover:bg-neural-cyan/20 transition-all uppercase tracking-[0.2em] flex items-center justify-center gap-3"
                                >
                                    <span className="text-lg">⊕</span>
                                    Record Current Position
                                </button>
                            </div>

                            {/* Waypoints List */}
                            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3 custom-scroll bg-black/10">
                                <h4 className="text-[10px] uppercase tracking-[0.2em] font-bold text-neural-muted mb-2">Cycle Architecture</h4>
                                {activeSeq.waypoints.length === 0 ? (
                                    <div className="py-20 border-2 border-dashed border-white/5 rounded-2xl flex flex-col items-center opacity-20 text-center grayscale">
                                        <p className="text-[10px] uppercase font-mono tracking-widest">Timeline Clear</p>
                                    </div>
                                ) : (
                                    activeSeq.waypoints.map((wp, idx) => (
                                        <div 
                                            key={idx}
                                            className={`p-4 rounded-xl border transition-all animate-page-in ${
                                                playback.active && playback.current_waypoint_idx === idx 
                                                ? "border-neural-cyan bg-neural-cyan/10 ring-1 ring-neural-cyan/40" 
                                                : "border-white/5 bg-white/5 hover:border-white/20"
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] font-mono font-bold ${
                                                        playback.active && playback.current_waypoint_idx === idx 
                                                        ? "bg-neural-cyan text-black" 
                                                        : "bg-white/10 text-neural-muted"
                                                    }`}>
                                                        {idx + 1}
                                                    </div>
                                                    <span className="text-xs font-bold text-white tracking-tight">{wp.label}</span>
                                                </div>
                                                {playback.active && playback.current_waypoint_idx === idx && (
                                                    <span className="text-[10px] text-neural-cyan font-bold animate-pulse">ACTIVE</span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-3 gap-2 px-1">
                                                {Object.entries(wp.angles).map(([joint, val]) => (
                                                    <div key={joint} className="flex flex-col gap-0.5">
                                                        <span className="text-[8px] font-mono text-white/30 uppercase">{joint.slice(0,3)}</span>
                                                        <span className="text-[10px] font-mono text-neural-cyan font-semibold">{val.toFixed(0)}°</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ERROR TOAST */}
            {error && (
                <div className="fixed bottom-10 right-10 z-[100] bg-[#ff3c5a] border border-white/10 text-white px-8 py-4 rounded-2xl shadow-[0_10px_50px_rgba(255,60,90,0.4)] flex items-center gap-5 animate-page-in cursor-pointer" onClick={() => setError(null)}>
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl">⚠️</div>
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase font-bold tracking-widest opacity-60">System Fault</span>
                        <span className="text-sm font-bold tracking-tight">{error}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
