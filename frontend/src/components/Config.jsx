import { useState } from "react";

const ADC_PRESETS = {
    "Arduino Uno / Nano (10-bit, 5V)": { bits: 10, vref: 5.0 },
    "Arduino Due (12-bit, 3.3V)": { bits: 12, vref: 3.3 },
    "ESP32 (12-bit, 3.3V)": { bits: 12, vref: 3.3 },
    "Custom": { bits: 10, vref: 5.0 },
};

function Field({ label, hint, children }) {
    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-widest text-neural-muted">{label}</label>
            {children}
            {hint && <p className="text-[9px] text-neural-muted/60">{hint}</p>}
        </div>
    );
}

function InputNum({ value, onChange, min, max, step = 1, unit }) {
    return (
        <div className="flex items-center gap-2">
            <input
                type="number" value={value} min={min} max={max} step={step}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-24 text-xs font-mono rounded-md px-3 py-1.5 outline-none border transition-all"
                style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d0e8" }}
            />
            {unit && <span className="text-[10px] text-neural-muted font-mono">{unit}</span>}
        </div>
    );
}

function Section({ title, children }) {
    return (
        <div className="glass-panel p-5 flex flex-col gap-4">
            <p className="text-[10px] uppercase tracking-[0.25em] text-neural-muted">{title}</p>
            {children}
        </div>
    );
}

export default function Config({ onSave }) {
    const [emgBaud, setEmgBaud] = useState(115200);
    const [armBaud, setArmBaud] = useState(9600);
    const [adcPreset, setAdcPreset] = useState("Arduino Uno / Nano (10-bit, 5V)");
    const [adcBits, setAdcBits] = useState(10);
    const [adcVref, setAdcVref] = useState(5.0);
    const [bufSize, setBufSize] = useState(300);
    const [saved, setSaved] = useState(false);

    const handlePreset = (name) => {
        setAdcPreset(name);
        const p = ADC_PRESETS[name];
        setAdcBits(p.bits);
        setAdcVref(p.vref);
    };

    const save = () => {
        // Persist config to localStorage so backend can be told on next connect
        const cfg = { emgBaud, armBaud, adcBits, adcVref, bufSize };
        localStorage.setItem("synapticx_config", JSON.stringify(cfg));
        if (onSave) onSave(cfg);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    // Derived: voltage formula preview
    const maxAdc = Math.pow(2, adcBits) - 1;
    const formula = `V = (raw / ${maxAdc}) × ${adcVref}V − ${(adcVref / 2).toFixed(2)}V`;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Serial config */}
            <Section title="Serial Configuration">
                <Field label="BioAmp EXG Pill baud rate"
                    hint="Must match the baud rate in your Arduino sketch. Default: 115200.">
                    <select
                        value={emgBaud}
                        onChange={(e) => setEmgBaud(Number(e.target.value))}
                        className="text-xs font-mono rounded-md px-3 py-1.5 outline-none border w-48"
                        style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d0e8" }}
                    >
                        {[9600, 19200, 38400, 57600, 115200, 230400, 500000].map((b) => (
                            <option key={b} value={b}>{b} bps</option>
                        ))}
                    </select>
                </Field>

                <Field label="Arduino ARM baud rate"
                    hint="Baud rate for the servo control Arduino. Default: 9600.">
                    <select
                        value={armBaud}
                        onChange={(e) => setArmBaud(Number(e.target.value))}
                        className="text-xs font-mono rounded-md px-3 py-1.5 outline-none border w-48"
                        style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d0e8" }}
                    >
                        {[9600, 19200, 38400, 57600, 115200].map((b) => (
                            <option key={b} value={b}>{b} bps</option>
                        ))}
                    </select>
                </Field>
            </Section>

            {/* ADC config */}
            <Section title="ADC / Signal Conversion">
                <Field label="Board preset">
                    <select
                        value={adcPreset}
                        onChange={(e) => handlePreset(e.target.value)}
                        className="text-xs font-mono rounded-md px-3 py-1.5 outline-none border w-full max-w-xs"
                        style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", color: "#c8d0e8" }}
                    >
                        {Object.keys(ADC_PRESETS).map((k) => <option key={k}>{k}</option>)}
                    </select>
                </Field>

                <div className="grid grid-cols-2 gap-4">
                    <Field label="ADC resolution (bits)"
                        hint="10-bit = 0-1023, 12-bit = 0-4095">
                        <InputNum value={adcBits} onChange={setAdcBits} min={8} max={16} unit="bit" />
                    </Field>
                    <Field label="Reference voltage"
                        hint="Supply voltage of your Arduino board">
                        <InputNum value={adcVref} onChange={setAdcVref} min={1.0} max={5.5} step={0.1} unit="V" />
                    </Field>
                </div>

                {/* Live formula preview */}
                <div className="rounded-lg px-3 py-2.5 border mt-1"
                    style={{ background: "rgba(0,212,255,0.04)", borderColor: "rgba(0,212,255,0.15)" }}>
                    <p className="text-[9px] uppercase tracking-widest text-neural-muted mb-1">Conversion formula (backend)</p>
                    <p className="text-xs font-mono text-neural-cyan">{formula}</p>
                </div>
            </Section>

            {/* Buffer config */}
            <Section title="Data Buffer">
                <Field label="Rolling buffer size"
                    hint="Number of samples kept in memory. At 100 Hz, 300 = 3 s of history.">
                    <InputNum value={bufSize} onChange={setBufSize} min={50} max={2000} step={50} unit="samples" />
                </Field>
                <p className="text-[10px] text-neural-muted">
                    At 100 Hz sample rate → {(bufSize / 100).toFixed(1)}s of signal history displayed
                </p>
            </Section>

            {/* Save */}
            <div className="flex items-end">
                <div className="glass-panel p-5 flex flex-col gap-3 w-full">
                    <p className="text-[10px] uppercase tracking-[0.25em] text-neural-muted">Apply</p>
                    <p className="text-xs text-neural-muted">
                        Config is saved locally and applied on next hardware connection.
                        Restart the backend after changing baud rates.
                    </p>
                    <button
                        onClick={save}
                        className="text-xs font-semibold uppercase tracking-widest px-5 py-2 rounded-lg border transition-all duration-200 self-start"
                        style={{
                            background: saved ? "rgba(0,212,255,0.2)" : "rgba(0,212,255,0.08)",
                            borderColor: "rgba(0,212,255,0.4)",
                            color: "#00d4ff",
                        }}
                    >
                        {saved ? "✓ Saved" : "Save Config"}
                    </button>
                </div>
            </div>
        </div>
    );
}
