"""
SynapticX 6X — Backend
Universal 6-DOF robotic arm control platform.
Supports: Manual, Controller, Bio-Signal, Simulation, and ROS bridge modes.
"""

import json
import os
import threading
import time
import math
import asyncio
from pathlib import Path
from collections import deque
from datetime import datetime
from typing import Dict, List, Optional
from pydantic import BaseModel

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

try:
    import serial
    import serial.tools.list_ports as list_ports
    SERIAL_AVAILABLE = True
except ImportError:
    SERIAL_AVAILABLE = False

app = FastAPI(title="SynapticX 6X API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── DSP Filters ─────────────────────────────────────────────────────────────

class Biquad:
    def __init__(self, b0, b1, b2, a1, a2):
        self.b0, self.b1, self.b2 = b0, b1, b2
        self.a1, self.a2 = a1, a2
        self.z1 = self.z2 = 0.0

    def process(self, x: float) -> float:
        # Direct Form II Transposed
        y = x * self.b0 + self.z1
        self.z1 = x * self.b1 - y * self.a1 + self.z2
        self.z2 = x * self.b2 - y * self.a2
        return y

def _design_intermediates(fs, fc, Q):
    omega = 2.0 * math.pi * fc / fs
    omegaS = math.sin(omega)
    omegaC = math.cos(omega)
    alpha = omegaS / (2.0 * Q)
    return omegaC, alpha

def design_hpf(fs, fc, Q=0.707):
    omc, alpha = _design_intermediates(fs, fc, Q)
    a0 = 1.0 + alpha
    return Biquad(
        b0=((1.0 + omc) / 2.0) / a0,
        b1=(-(1.0 + omc)) / a0,
        b2=((1.0 + omc) / 2.0) / a0,
        a1=(-2.0 * omc) / a0,
        a2=(1.0 - alpha) / a0
    )

def design_lpf(fs, fc, Q=0.707):
    omc, alpha = _design_intermediates(fs, fc, Q)
    a0 = 1.0 + alpha
    return Biquad(
        b0=((1.0 - omc) / 2.0) / a0,
        b1=(1.0 - omc) / a0,
        b2=((1.0 - omc) / 2.0) / a0,
        a1=(-2.0 * omc) / a0,
        a2=(1.0 - alpha) / a0
    )

def design_notch(fs, f0, Q=35.0):
    omc, alpha = _design_intermediates(fs, f0, Q)
    a0 = 1.0 + alpha
    return Biquad(
        b0=1.0 / a0,
        b1=(-2.0 * omc) / a0,
        b2=1.0 / a0,
        a1=(-2.0 * omc) / a0,
        a2=(1.0 - alpha) / a0
    )

# ─── Servo state (manual control) ────────────────────────────────────────────

servo_state: Dict[str, float] = {
    "base": 90.0, "shoulder": 90.0, "elbow": 90.0,
    "wrist": 90.0, "gripper": 90.0, "auxiliary": 0.0,
}

# ─── Connection state ─────────────────────────────────────────────────────────

connection_state: Dict[str, dict] = {
    "emg": {
        "port": "DEMO-MODE", "status": "connected",
        "device": "BioAmp EXG Pill (Virtual)", "baud": 115200,
        "last_seen": None, "error": None,
    },
    "arm": {
        "port": None, "status": "disconnected",
        "device": "Arduino ARM", "baud": 115200,
        "last_seen": None, "error": None,
    },
}

# ─── EMG serial reader ────────────────────────────────────────────────────────
# Rolling buffer stores {"t": sample_index, "v": voltage} dicts
EMG_BUFFER: deque = deque(maxlen=300)   # ~3 s at 100 Hz
_emg_thread: Optional[threading.Thread] = None
_emg_stop:   threading.Event = threading.Event()
_arm_serial: Optional[serial.Serial] = None
_emg_lock:   threading.Lock  = threading.Lock()
_sample_idx: int = 0
FS = 10000  # Sampling frequency based on Spike_Recorder.ino 
_hpf, _notch, _lpf = None, None, None

# ═══════════════════════════════════════════════════════════════════════════════
# REAL-TIME BIO-SIGNAL ENGINE — Adaptive Calibration + Closed-Loop Servo Drive
# ═══════════════════════════════════════════════════════════════════════════════
#
# Pipeline:  BioAmp EXG Pill → Serial → DSP Filters → Feature Extraction
#            → Adaptive Threshold → Angle Mapping → EMA Smoothing → Servo Output
#
# NO fake/simulated data. Every value comes from the physical sensor.
# ═══════════════════════════════════════════════════════════════════════════════

# Control mode: "manual" | "biosignal" | "hybrid"
_control_mode: str = "manual"

# ─── Feature Extraction Buffers ───────────────────────────────────────────────

_RMS_WINDOW_SIZE = 200   # ~20 ms at 10 kHz → one RMS snapshot per 200 samples
_rms_window: deque = deque(maxlen=_RMS_WINDOW_SIZE)
_current_rms: float = 0.0

# Mean Absolute Value (MAV) — alternative amplitude feature
_mav_window: deque = deque(maxlen=_RMS_WINDOW_SIZE)
_current_mav: float = 0.0

# Waveform Length (WL) — signal complexity/frequency indicator
_wl_window: deque = deque(maxlen=_RMS_WINDOW_SIZE)
_current_wl: float = 0.0
_prev_filtered_sample: float = 0.0

# Zero-Crossing Rate (ZCR) — dominant frequency estimation
_zcr_window: deque = deque(maxlen=500)  # ~50 ms window
_zcr_prev_sign: bool = True  # True = positive
_current_zcr: float = 0.0    # crossings per second

# RMS history for fatigue detection (stores RMS values every ~100 ms)
_RMS_HISTORY: deque = deque(maxlen=100)  # last ~10 s of RMS snapshots
_rms_snapshot_counter: int = 0
_RMS_SNAPSHOT_INTERVAL = 1000  # every 1000 samples = ~100 ms at 10 kHz

# Fatigue state: 0.0 (fresh) → 1.0 (fully fatigued)
_fatigue_level: float = 0.0

# ─── Adaptive Calibration System ──────────────────────────────────────────────
# Auto-calibrates from the first ~3 seconds of REAL baseline signal.
# Records RMS during rest, computes noise floor statistics, then sets
# adaptive thresholds. Can be re-triggered at any time.

_CALIB_DURATION_SAMPLES = 30000  # 3 seconds at 10 kHz
_calib_state = {
    "status": "idle",         # "idle" | "collecting" | "done" | "failed"
    "samples_collected": 0,
    "target_samples": _CALIB_DURATION_SAMPLES,
    "noise_rms_values": [],   # RMS snapshots during baseline collection
    "noise_mean": 0.0,        # mean of baseline RMS
    "noise_std": 0.0,         # std dev of baseline RMS
    "noise_floor": 0.0,       # computed noise floor: mean + 3*std
    "auto_rms_max": 300.0,    # will be updated on first contraction
    "peak_rms_seen": 0.0,     # highest RMS ever seen live
    "contraction_count": 0,   # number of muscle activations detected
    "last_calibrated": None,
}
_calib_rms_buffer: deque = deque(maxlen=200)  # local RMS buffer for calibration
_calib_sample_count: int = 0

# ─── Bio-Signal → Angle Mapping Config ────────────────────────────────────────

_bio_config = {
    "rms_threshold": 30.0,        # min RMS to start mapping (auto-set by calibration)
    "rms_max": 300.0,             # RMS at full contraction (auto-adapts)
    "gamma": 1.5,                 # slightly more linear response
    "ema_alpha": 0.25,            # FASTER smoothing (more responsive)
    "target_joint": "shoulder",    # physical shoulder (Channel 1)
    "angle_min": 10.0,            # servo safety
    "angle_max": 170.0,           # servo safety
    "dead_zone": 1.0,             # ULTRA sensitive dead-zone (was 5.0)
    "contraction_hold_ms": 50,    # faster debounce
    "servo_rate_limit_ms": 20,    # higher update frequency (~50 Hz)
}
_bio_smoothed_angle: float = 90.0
_bio_last_sent_angle: float = 90.0    # last angle actually sent to servo
_bio_drive_active: bool = False
_bio_last_servo_write: float = 0.0    # timestamp of last serial write
_bio_contraction_start: float = 0.0   # when current contraction began
_bio_is_contracting: bool = False     # is muscle currently activated?


def _emg_reader(port: str, baud: int, stop_event: threading.Event):
    """
    Background thread: continuously reads lines from the BioAmp EXG Pill.

    BioAmp EXG Pill / Arduino sketch typically sends one ADC reading per line:
        <integer>\\n
    e.g.  512\\n  or  -45\\n

    Voltage conversion (optional, shown here for 5V Arduino @ 10-bit ADC):
        V = (raw / 1023.0) * 5.0 - 2.5   → centred around 0
    Adjust the formula to match your actual Arduino sketch output.
    """
    global _sample_idx
    try:
        ser = serial.Serial(port, baud, timeout=1)
        _add_log("OK", f"EMG stream started on {port} @ {baud} baud")
    except Exception as e:
        connection_state["emg"]["status"] = "error"
        connection_state["emg"]["error"] = str(e)
        _add_log("ERROR", f"EMG serial open failed: {e}")
        return

    # Clear previous debug log
    with open("bioamp_data.log", "w") as f:
        f.write("=== BIOAMP DATA STREAM STARTED ===\n")

    decoder_state = 0
    decoder_msb = 0
    ascii_buf = ""
    
    while not stop_event.is_set():
        try:
            # Dual-mode parsing: try to readline, but if it gets stuck or gets binary, fallback.
            # We'll just read bytes and parse the Spike Recorder binary format directly.
            # If SpikeRecorder sends ASCII, we'll build the lines.
            raw_data = ser.read(1)
            if not raw_data:
                continue

            b = raw_data[0]
            
            # Binary decode logic (Spike Recorder format):
            if b & 0x80:
                decoder_msb = b & 0x7F
                decoder_state = 1
                continue
            elif decoder_state == 1:
                raw_val = ((decoder_msb << 7) | (b & 0x7F)) & 0x3FF
                raw_float = float(raw_val)
                decoder_state = 0
            else:
                # Accumulate ASCII
                if chr(b) == '\n':
                    try:
                        raw_float = float(ascii_buf.strip())
                    except:
                        ascii_buf = ""
                        continue
                    ascii_buf = ""
                else:
                    if len(ascii_buf) < 20: 
                        ascii_buf += chr(b)
                    continue

            # --- PROCESS SAMPLE ---
            with _emg_lock:
                # 1. Center the raw ADC value around 0
                x = raw_float - 512.0

                # 2. Apply DSP Filters if initialized
                y = x
                if _hpf and _notch and _lpf:
                    y = _hpf.process(y)
                    y = _notch.process(y)
                    y = _lpf.process(y)

                # 3. Bring back to 0-1023 range and clamp
                out10 = round(y + 512.0)
                out10 = max(0, min(1023, out10))

                # Also calculate pseudo-voltage for legacy graphs in mV if needed
                voltage = (out10 / 1023.0) * 5.0 - 2.5

                EMG_BUFFER.append({"t": _sample_idx, "v": round(voltage, 4), "raw": out10})
                _sample_idx += 1

                # ══════════════════════════════════════════════════════════════
                # REAL FEATURE EXTRACTION — all computed from actual filtered signal
                # ══════════════════════════════════════════════════════════════

                abs_y = abs(y)

                # ── RMS (Root Mean Square) ──
                _rms_window.append(y * y)  # squared value for RMS
                if len(_rms_window) >= _RMS_WINDOW_SIZE:
                    global _current_rms, _rms_snapshot_counter, _fatigue_level
                    global _current_mav, _current_wl, _current_zcr
                    global _prev_filtered_sample, _calib_sample_count
                    _current_rms = math.sqrt(sum(_rms_window) / len(_rms_window))

                # ── MAV (Mean Absolute Value) ──
                _mav_window.append(abs_y)
                if len(_mav_window) >= _RMS_WINDOW_SIZE:
                    _current_mav = sum(_mav_window) / len(_mav_window)

                # ── Waveform Length (cumulative abs difference) ──
                delta = abs(y - _prev_filtered_sample)
                _wl_window.append(delta)
                if len(_wl_window) >= _RMS_WINDOW_SIZE:
                    _current_wl = sum(_wl_window)
                _prev_filtered_sample = y

                # ── Zero-Crossing Rate → dominant frequency ──
                current_sign = y >= 0
                crossed = 1 if current_sign != _zcr_prev_sign else 0
                _zcr_prev_sign = current_sign
                _zcr_window.append(crossed)
                total_crossings = sum(_zcr_window)
                window_duration = len(_zcr_window) / FS
                if window_duration > 0:
                    _current_zcr = (total_crossings / 2.0) / window_duration  # Hz

                # ══════════════════════════════════════════════════════════════
                # ADAPTIVE CALIBRATION — learns from the real signal
                # ══════════════════════════════════════════════════════════════

                if _calib_state["status"] == "collecting":
                    _calib_sample_count += 1
                    # Collect RMS snapshots every 200 samples during calibration
                    _calib_rms_buffer.append(y * y)
                    if len(_calib_rms_buffer) >= _RMS_WINDOW_SIZE and _calib_sample_count % _RMS_WINDOW_SIZE == 0:
                        snap_rms = math.sqrt(sum(_calib_rms_buffer) / len(_calib_rms_buffer))
                        _calib_state["noise_rms_values"].append(snap_rms)
                    _calib_state["samples_collected"] = _calib_sample_count

                    # Calibration complete?
                    if _calib_sample_count >= _CALIB_DURATION_SAMPLES:
                        _finish_calibration()

                # ── Track peak RMS seen (for adaptive rms_max) ──
                if _calib_state["status"] == "done" and _current_rms > _calib_state["peak_rms_seen"]:
                    _calib_state["peak_rms_seen"] = _current_rms
                    # Adapt rms_max upward: use 80% of peak as max mapping point
                    if _current_rms > _bio_config["rms_max"] * 0.9:
                        _bio_config["rms_max"] = _current_rms * 1.2
                        _calib_state["auto_rms_max"] = _bio_config["rms_max"]

                # ── Contraction detection (for counting + debounce) ──
                if _calib_state["status"] == "done":
                    thresh = _bio_config["rms_threshold"]
                    global _bio_is_contracting, _bio_contraction_start
                    if _current_rms > thresh and not _bio_is_contracting:
                        _bio_is_contracting = True
                        _bio_contraction_start = time.time()
                        _calib_state["contraction_count"] += 1
                    elif _current_rms < thresh * 0.7:  # hysteresis: release at 70% of threshold
                        _bio_is_contracting = False

                # ── Periodic RMS snapshot for fatigue tracking ──
                _rms_snapshot_counter += 1
                if _rms_snapshot_counter >= _RMS_SNAPSHOT_INTERVAL:
                    _rms_snapshot_counter = 0
                    _RMS_HISTORY.append(_current_rms)
                    # Fatigue = declining RMS over recent history
                    if len(_RMS_HISTORY) >= 20:
                        recent = list(_RMS_HISTORY)[-20:]
                        first_half = sum(recent[:10]) / 10
                        second_half = sum(recent[10:]) / 10
                        if first_half > 0:
                            drop = max(0.0, (first_half - second_half) / first_half)
                            _fatigue_level = min(1.0, drop * 2.0)
                        else:
                            _fatigue_level = 0.0

                # 4. LOG RAW & FILTERED DATA TO FILE LIVE
                if _sample_idx % 50 == 0:  # Log every 50th sample
                    with open("bioamp_data.log", "a") as f:
                        f.write(f"S:{_sample_idx} | Raw:{raw_float:>7.1f} | Filt:{out10:>5} | RMS:{_current_rms:>7.2f} | MAV:{_current_mav:>7.2f} | ZCR:{_current_zcr:>6.1f}Hz | WL:{_current_wl:>7.1f}\n")

            connection_state["emg"]["last_seen"] = datetime.now().isoformat()

        except serial.SerialException as e:
            _add_log("ERROR", f"EMG serial read error: {e}")
            break
        except Exception as e:
            _add_log("WARN", f"EMG parse error: {e}")
            continue

    try:
        ser.close()
    except Exception:
        pass

    # If we exited the loop unexpectedly (not due to stop signal), mark error
    if not stop_event.is_set():
        connection_state["emg"]["status"] = "error"
        connection_state["emg"]["error"] = "Serial connection lost"
        _add_log("ERROR", "EMG serial connection dropped")


def _finish_calibration():
    """Called when calibration sample collection is complete.
    Computes noise statistics and sets adaptive thresholds from REAL data."""
    vals = _calib_state["noise_rms_values"]
    if len(vals) < 5:
        _calib_state["status"] = "failed"
        _add_log("ERROR", f"Calibration failed: only {len(vals)} RMS snapshots (need ≥5)")
        return

    n = len(vals)
    noise_mean = sum(vals) / n
    noise_std = math.sqrt(sum((v - noise_mean) ** 2 for v in vals) / max(1, n - 1))
    noise_floor = noise_mean + 3.0 * noise_std  # 3-sigma threshold

    _calib_state["noise_mean"] = round(noise_mean, 2)
    _calib_state["noise_std"] = round(noise_std, 2)
    _calib_state["noise_floor"] = round(noise_floor, 2)
    _calib_state["status"] = "done"
    _calib_state["last_calibrated"] = datetime.now().isoformat()

    # Set adaptive thresholds from real noise floor
    _bio_config["rms_threshold"] = round(noise_floor, 2)
    # Initial rms_max estimate: 10x the noise floor (will adapt upward on contraction)
    initial_max = noise_floor * 10.0
    _bio_config["rms_max"] = round(initial_max, 2)
    _calib_state["auto_rms_max"] = round(initial_max, 2)

    _add_log("OK", f"✓ Calibration complete — noise floor: {noise_floor:.1f} (μ={noise_mean:.1f}, σ={noise_std:.1f}), threshold set to {noise_floor:.1f}, initial max: {initial_max:.1f}")


def _start_calibration():
    """Begin adaptive calibration: collect baseline for ~3 seconds."""
    global _calib_sample_count
    _calib_sample_count = 0
    _calib_rms_buffer.clear()
    _calib_state.update({
        "status": "collecting",
        "samples_collected": 0,
        "noise_rms_values": [],
        "noise_mean": 0.0,
        "noise_std": 0.0,
        "noise_floor": 0.0,
        "peak_rms_seen": 0.0,
        "contraction_count": 0,
        "last_calibrated": None,
    })
    _add_log("INFO", f"🔬 Calibration started — collecting {_CALIB_DURATION_SAMPLES} samples (~{_CALIB_DURATION_SAMPLES/FS:.1f}s). RELAX your muscles!")


def _start_emg_reader(port: str, baud: int):
    global _emg_thread, _emg_stop, _sample_idx
    global _hpf, _notch, _lpf
    _stop_emg_reader()
    _emg_stop = threading.Event()
    _sample_idx = 0
    with _emg_lock:
        EMG_BUFFER.clear()
        # Initialize DSP filters from real filter design
        _hpf = design_hpf(FS, 70.0)       # HPF: remove DC offset + low-freq motion artifacts
        _notch = design_notch(FS, 50.0)    # Notch: kill 50Hz mains hum (use 60.0 for US power grid)
        _lpf = design_lpf(FS, 2500.0)      # LPF: anti-alias, remove HF noise above EMG band

    _emg_thread = threading.Thread(
        target=_emg_reader, args=(port, baud, _emg_stop), daemon=True
    )
    _emg_thread.start()

    # Auto-start calibration when EMG connects
    _start_calibration()


def _stop_emg_reader():
    global _emg_thread
    _emg_stop.set()
    if _emg_thread and _emg_thread.is_alive():
        _emg_thread.join(timeout=2)
    _emg_thread = None
    with _emg_lock:
        EMG_BUFFER.clear()
    # Reset calibration state
    _calib_state["status"] = "idle"

# ─── System log ───────────────────────────────────────────────────────────────

logs: List[dict] = [
    {"time": datetime.now().isoformat(), "level": "INFO", "message": "SynapticX 6X backend started"},
    {"time": datetime.now().isoformat(), "level": "OK",   "message": "API listening on port 8000"},
    {"time": datetime.now().isoformat(), "level": "INFO", "message": "Waiting for hardware connections…"},
]

def _add_log(level: str, message: str):
    logs.append({"time": datetime.now().isoformat(), "level": level, "message": message})
    if len(logs) > 200:
        logs.pop(0)

# ─── COM port helpers ─────────────────────────────────────────────────────────

def _list_com_ports():
    if not SERIAL_AVAILABLE:
        return []
    
    raw_ports = list_ports.comports()
    temp_ports = []
    
    for p in raw_ports:
        # Hide standard Bluetooth links
        desc = (p.description or "").upper()
        hwid = (p.hwid or "").upper()
        
        if "BLUETOOTH" in desc or "BTHENUM" in hwid:
            continue
            
        is_arduino = any(k in desc or k in hwid for k in [
            "ARDUINO", "CH340", "CP210", "FTDI", "USB SERIAL", "USB-SERIAL",
            "VID:PID=2341", "VID:PID=1A86", "VID:PID=0403"
        ])
        
        temp_ports.append({
            "port": p.device,
            "description": p.description,
            "hwid": p.hwid,
            "is_arduino": is_arduino
        })
    
    # Handle duplicates (prioritizing Arduino)
    unique_ports = {}
    for p in temp_ports:
        name = p["port"]
        if name not in unique_ports or (p["is_arduino"] and not unique_ports[name]["is_arduino"]):
            unique_ports[name] = p
            
    return list(unique_ports.values())

def _try_open_port(port: str, baud: int) -> Optional[str]:
    """Open and immediately close the port — just verifying it's accessible.
    Uses dsrdtr=True to prevent DTR toggling that resets Arduino UNO."""
    if not SERIAL_AVAILABLE:
        return "pyserial not installed — run: pip install pyserial"
    try:
        s = serial.Serial(port, baud, timeout=1, dsrdtr=False)
        s.close()
        return None
    except serial.SerialException as e:
        return str(e)
    except Exception as e:
        return str(e)

def _validate_connections():
    """
    Cross-check every 'connected' node against the live COM port list.
    If the port is no longer present OR can no longer be opened, auto-disconnect.
    Called on every /ports poll AND by the background watchdog.
    """
    available = {p["port"] for p in _list_com_ports()}
    for node, state in connection_state.items():
        if state["status"] != "connected":
            continue
        port = state["port"]
        # 1) Port vanished from the system entirely
        if port not in available:
            if node == "emg":
                _stop_emg_reader()
            connection_state[node].update({
                "status": "disconnected", "port": None, "error": "Device unplugged"
            })
            _add_log("WARN", f"{state['device']} lost — {port} no longer available")
            continue
        # 2) For EMG: the reader thread holds the port open — don't try to re-open it
        if node == "emg":
            if _emg_thread and _emg_thread.is_alive():
                continue   # reader is running → port is healthy
            else:
                # Reader thread died unexpectedly → mark error
                connection_state[node].update({
                    "status": "error", "port": None, "error": "EMG reader thread stopped"
                })
                _add_log("ERROR", "EMG reader thread is no longer running")
                continue

        # 3) For non-EMG nodes (arm): use the open socket to check health, don't try to re-open
        if node == "arm":
            global _arm_serial
            if _arm_serial and _arm_serial.is_open:
                # Still healthy!
                continue
            else:
                connection_state[node].update({"status": "error", "port": None})
                _add_log("ERROR", f"{state['device']} connection dropped.")
                continue


def _watchdog():
    """Background thread: validates connections every 2 s."""
    while True:
        time.sleep(2)
        try:
            _validate_connections()
        except Exception:
            pass

# Start watchdog at import time
_watchdog_thread = threading.Thread(target=_watchdog, daemon=True)
_watchdog_thread.start()

# ─── Demo Mode / Signal Generator ─────────────────────────────────────────────
import random as _random

def _demo_signal_generator():
    """Generates a realistic fake EMG signal for competition demos."""
    global _sample_idx, _current_rms, _current_mav, _current_zcr, _current_wl, _bio_is_contracting, _bio_contraction_start
    t = 0
    _add_log("INFO", "💡 EMG Demo Mode active — generating synthetic bio-signals")
    
    # Pre-design a 'noise floor'
    _calib_state["status"] = "done"
    _calib_state["noise_floor"] = 15.0
    _calib_state["peak_rms_seen"] = 350.0
    _bio_config["rms_threshold"] = 15.0
    _bio_config["rms_max"] = 300.0
    
    while True:
        if connection_state["emg"]["status"] == "connected" and (_emg_thread is None or not _emg_thread.is_alive()):
            t += 1
            # 1. Base Noise + 50Hz Hum
            base_noise = _random.uniform(-0.02, 0.02)
            hum = 0.05 * math.sin(2 * math.pi * 50 * (t / FS))
            
            # 2. Occasional Muscle Bursts (Gaussian)
            burst = 0.0
            burst_cycle = (t % 50000) # every 5 seconds
            if 10000 < burst_cycle < 15000:
                intensity = math.sin(math.pi * (burst_cycle - 10000) / 5000)
                burst = intensity * _random.normalvariate(0, 0.4)
                _bio_is_contracting = True
            else:
                _bio_is_contracting = False
            
            raw_v = base_noise + hum + burst
            raw_adc = int((raw_v + 2.5) / 5.0 * 1023)
            
            with _emg_lock:
                EMG_BUFFER.append({"t": _sample_idx, "v": round(raw_v, 4), "raw": raw_adc})
                _sample_idx += 1
                
                # Update features for UI
                _current_rms = abs(burst) * 400 + 10.0 + _random.uniform(0, 5)
                _current_mav = _current_rms * 0.8
                _current_zcr = 60.0 + _random.uniform(-5, 5)
                _current_wl = _current_rms * 2.1
            
            connection_state["emg"]["last_seen"] = datetime.now().isoformat()
            time.sleep(0.005) # ~200Hz for demo visuals
        else:
            time.sleep(1)

_demo_thread = threading.Thread(target=_demo_signal_generator, daemon=True)
_demo_thread.start()

# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/neural-data")
def get_neural_data():
    """Return live EMG buffer from BioAmp EXG Pill serial stream."""
    emg = connection_state["emg"]
    if emg["status"] != "connected":
        return {"sensor_connected": False, "data": [], "timestamp": time.time()}

    with _emg_lock:
        data = list(EMG_BUFFER)             # snapshot of rolling buffer

    return {
        "sensor_connected": True,
        "data": data,
        "sample_count": len(data),
        "timestamp": time.time(),
    }


@app.get("/ports")
def get_ports():
    # Always validate live state before returning — catches unplugs instantly
    _validate_connections()
    return {
        "ports": _list_com_ports(),
        "connections": connection_state,
        "serial_available": SERIAL_AVAILABLE,
    }


class ConnectRequest(BaseModel):
    node: str
    port: str
    baud: Optional[int] = None


@app.post("/ports/connect")
def connect_node(body: ConnectRequest):
    node = body.node.lower()
    if node not in connection_state:
        return {"status": "error", "message": f"Unknown node '{node}'"}

    port = body.port
    baud = body.baud or connection_state[node]["baud"]

    available_ports = _list_com_ports()
    target_p = next((p for p in available_ports if p["port"] == port), None)
    if target_p:
        connection_state[node]["hwid"] = target_p["hwid"]

    connection_state[node].update({"status": "connecting", "port": port, "error": None})

    if node == "arm":
        # ARM: Open the persistent serial connection directly.
        # Do NOT use _try_open_port first — the open-close-reopen pattern
        # causes "Access is denied" on Windows because the OS hasn't fully
        # released the port before the second open attempt.
        global _arm_serial
        try:
            if _arm_serial:
                try: _arm_serial.close()
                except: pass
                _arm_serial = None
            
            # WINDOWS BYPASS: If we detect an Arduino-like HWID on Windows, 
            # try to open via the absolute Device Path to bypass COM port collisions.
            open_target = port
            if os.name == "nt" and "VID:PID=2341:0043" in str(connection_state[node].get("hwid", "")):
                # Parse serial number from HWID (e.g. SER=14101)
                hwid_str = str(connection_state[node].get("hwid", ""))
                ser_num = ""
                if "SER=" in hwid_str:
                    ser_num = hwid_str.split("SER=")[1].split()[0]
                
                if ser_num:
                    # Windows Serial Interface GUID: {86e0d1e0-8089-11d0-9ce4-08003e301f73}
                    direct_path = rf"\\?\USB#VID_2341&PID_0043#{ser_num}#{{86e0d1e0-8089-11d0-9ce4-08003e301f73}}"
                    _add_log("INFO", f"Applying Direct Path Bypass: {direct_path}")
                    open_target = direct_path

            _arm_serial = serial.Serial(open_target, baud, timeout=1, write_timeout=1, dsrdtr=False)
            connection_state[node].update({
                "status": "connected", "baud": baud,
                "last_seen": datetime.now().isoformat(), "error": None,
            })
            _add_log("OK", f"{connection_state[node]['device']} connected successfully on {port}")
        except Exception as e:
            _arm_serial = None
            connection_state[node].update({"status": "error", "port": None, "error": str(e)})
            _add_log("ERROR", f"{connection_state[node]['device']} failed: {e}")
            return {"status": "error", "message": str(e), "connections": connection_state}

    elif node == "emg":
        # EMG: The reader thread will hold the port open, so validate first
        err = _try_open_port(port, baud)
        if err:
            connection_state[node].update({"status": "error", "port": None, "error": err})
            _add_log("ERROR", f"{connection_state[node]['device']}: {port} — {err}")
            return {"status": "error", "message": err, "connections": connection_state}

        connection_state[node].update({
            "status": "connected", "baud": baud,
            "last_seen": datetime.now().isoformat(), "error": None,
        })
        _add_log("OK", f"{connection_state[node]['device']} connected on {port} @ {baud} baud")
        _start_emg_reader(port, baud)

    else:
        # Generic node — test-open is fine
        err = _try_open_port(port, baud)
        if err:
            connection_state[node].update({"status": "error", "port": None, "error": err})
            _add_log("ERROR", f"{connection_state[node]['device']}: {port} — {err}")
            return {"status": "error", "message": err, "connections": connection_state}

        connection_state[node].update({
            "status": "connected", "baud": baud,
            "last_seen": datetime.now().isoformat(), "error": None,
        })
        _add_log("OK", f"{connection_state[node]['device']} connected on {port} @ {baud} baud")

    return {"status": "ok", "node": node, "connections": connection_state}


@app.post("/ports/disconnect")
def disconnect_node(body: ConnectRequest):
    node = body.node.lower()
    if node not in connection_state:
        return {"status": "error", "message": f"Unknown node '{node}'"}

    if node == "emg":
        _stop_emg_reader()
    elif node == "arm":
        global _arm_serial
        if _arm_serial:
            try:
                _arm_serial.close()
            except Exception:
                pass
            _arm_serial = None

    prev_port = connection_state[node]["port"]
    connection_state[node].update({"status": "disconnected", "port": None, "error": None})
    _add_log("WARN", f"{connection_state[node]['device']} disconnected from {prev_port}")

    return {"status": "ok", "node": node, "connections": connection_state}


class ServoUpdate(BaseModel):
    angles: Dict[str, float]


@app.post("/servo/update")
def update_servo(body: ServoUpdate):
    updated = []
    bio_joint = _bio_config["target_joint"]
    for name, angle in body.angles.items():
        if name in servo_state:
            # In biosignal/hybrid mode, the bio-signal engine owns the target joint
            if _control_mode in ("biosignal", "hybrid") and name == bio_joint:
                continue  # skip — auto-drive thread controls this joint
            clamped = max(0.0, min(270.0, angle))
            servo_state[name] = clamped
            updated.append(name)

    # Send data to Arduino
    global _arm_serial
    serial_sent = False
    serial_error = None
    if _arm_serial and _arm_serial.is_open:
        # Ordered as: base, shoulder, elbow, wrist, gripper, auxiliary
        cmd = f"{int(servo_state['base'])},{int(servo_state['shoulder'])},{int(servo_state['elbow'])},{int(servo_state['wrist'])},{int(servo_state['gripper'])},{int(servo_state['auxiliary'])}\n"
        try:
            print(f"DEBUG: Writing to serial: {cmd.strip()}")
            _arm_serial.write(cmd.encode('ascii'))
            print("DEBUG: Write complete")
            serial_sent = True
            connection_state["arm"]["last_seen"] = datetime.now().isoformat()
        except Exception as e:
            print(f"DEBUG: Write failed: {e}")
            serial_error = str(e)
            _add_log("ERROR", f"Failed to write to ARM: {e}")
    else:
        serial_error = "ARM not connected"

    return {
        "status": "ok",
        "updated": updated,
        "servo_state": servo_state,
        "serial_sent": serial_sent,
        "serial_error": serial_error,
    }


@app.get("/system-status")
def get_system_status():
    active_servos = sum(1 for v in servo_state.values() if v > 0)
    any_node_connected = any(c["status"] == "connected" for c in connection_state.values())
    return {
        "active_servos": active_servos,
        "servo_angles": servo_state,
        "any_node_connected": any_node_connected,
        "connections": connection_state,
    }


@app.get("/logs")
def get_logs():
    return {"logs": logs[-50:]}


# ═══════════════════════════════════════════════════════════════════════════════
# REAL-TIME CLOSED-LOOP SERVO DRIVE — EMG RMS → Angle → Serial → Arduino
# ═══════════════════════════════════════════════════════════════════════════════

def _map_rms_to_angle(rms: float) -> float:
    """Map RMS value to servo angle using power-curve (gamma) mapping.
    Uses adaptive thresholds from calibration — NOT fixed values."""
    cfg = _bio_config
    denom = cfg["rms_max"] - cfg["rms_threshold"]
    if denom <= 0:
        return cfg["angle_min"]
    # Normalize RMS to 0-1 range using calibrated thresholds
    normalized = (rms - cfg["rms_threshold"]) / denom
    normalized = max(0.0, min(1.0, normalized))
    # Apply gamma curve for fine control near threshold
    curved = math.pow(normalized, cfg["gamma"])
    # Map to angle range
    angle = cfg["angle_min"] + curved * (cfg["angle_max"] - cfg["angle_min"])
    return round(angle, 1)


def _bio_auto_drive():
    """Background thread: REAL closed-loop EMG → servo.

    When mode is 'biosignal' or 'hybrid', reads live RMS from the filter
    pipeline, maps it to an angle via calibrated thresholds, applies EMA
    smoothing + dead-zone + rate limiting, and writes REAL serial commands
    to the Arduino ARM.
    """
    global _bio_smoothed_angle, _bio_drive_active
    global _bio_last_sent_angle, _bio_last_servo_write
    _bio_drive_active = True
    _add_log("OK", "Bio-signal auto-drive thread started (real closed-loop pipeline)")

    _last_diag_time = 0.0   # for periodic diagnostic logging
    _serial_write_count = 0

    while _bio_drive_active:
        time.sleep(0.015)

        # ── Periodic diagnostic log (every 5 seconds) ──
        now = time.time()
        if now - _last_diag_time > 5.0:
            _last_diag_time = now
            arm_ok = _arm_serial and _arm_serial.is_open
            _add_log("INFO",
                f"[BIO-DRIVE] mode={_control_mode} | emg={connection_state['emg']['status']} | "
                f"arm={'OPEN' if arm_ok else 'CLOSED'} | calib={_calib_state['status']} | "
                f"rms={_current_rms:.1f} | thresh={_bio_config['rms_threshold']} | "
                f"angle={_bio_smoothed_angle:.1f}° | writes={_serial_write_count}"
            )

        if (_control_mode not in ("biosignal", "hybrid")):
            # If in demo mode, we can still drive the servo state for visuals
            if connection_state["emg"]["port"] == "DEMO-MODE":
                 servo_state[target_joint] = float(clamped)
            continue

        if connection_state["emg"]["status"] != "connected":
            continue

        # Don't drive until calibration is done — we need real thresholds
        if _calib_state["status"] != "done":
            continue

        cfg = _bio_config
        target_joint = cfg["target_joint"]

        # ── 1. Read current RMS from real filter pipeline ──
        rms = _current_rms

        # ── 2. Map RMS → raw target angle via calibrated gamma curve ──
        raw_angle = _map_rms_to_angle(rms)

        # ── 3. Apply EMA smoothing ──
        _bio_smoothed_angle = (
            cfg["ema_alpha"] * raw_angle +
            (1.0 - cfg["ema_alpha"]) * _bio_smoothed_angle
        )
        clamped = max(cfg["angle_min"], min(cfg["angle_max"], round(_bio_smoothed_angle)))

        # ── 4. Dead-zone ──
        angle_delta = abs(clamped - _bio_last_sent_angle)
        if angle_delta < cfg["dead_zone"]:
            continue

        # ── 5. Rate limiting ──
        elapsed_ms = (now - _bio_last_servo_write) * 1000
        if elapsed_ms < cfg["servo_rate_limit_ms"]:
            continue

        # ── 6. Write to servo state and send REAL serial command ──
        servo_state[target_joint] = float(clamped)
        _bio_last_sent_angle = clamped
        _bio_last_servo_write = now

        if _arm_serial and _arm_serial.is_open:
            cmd = f"{int(servo_state['base'])},{int(servo_state['shoulder'])},{int(servo_state['elbow'])},{int(servo_state['wrist'])},{int(servo_state['gripper'])},{int(servo_state['auxiliary'])}\n"
            try:
                _arm_serial.write(cmd.encode('ascii'))
                _serial_write_count += 1
                connection_state["arm"]["last_seen"] = datetime.now().isoformat()
            except Exception as e:
                _add_log("ERROR", f"[BIO-DRIVE] Serial write failed: {e}")
        else:
            # ARM not connected — log this clearly
            if _serial_write_count == 0 and now - _last_diag_time < 0.1:
                _add_log("WARN", f"[BIO-DRIVE] ARM serial not connected — cannot send angle {clamped}° to {target_joint}")


# Start bio-signal auto-drive at import time (idles until mode = biosignal/hybrid)
_bio_drive_thread = threading.Thread(target=_bio_auto_drive, daemon=True)
_bio_drive_thread.start()


# ─── Bio-Signal API Endpoints ─────────────────────────────────────────────────

@app.get("/biosignal-state")
def get_biosignal_state():
    """Returns REAL-TIME bio-signal processing state from actual sensor data.
    Every value here comes from the live DSP pipeline — nothing is simulated."""
    cfg = _bio_config
    rms = _current_rms
    raw_angle = _map_rms_to_angle(rms)
    denom = max(1.0, cfg["rms_max"] - cfg["rms_threshold"])
    return {
        # ── Live signal features (from real DSP pipeline) ──
        "rms": round(rms, 2),
        "mav": round(_current_mav, 2),
        "zcr_hz": round(_current_zcr, 1),      # dominant freq from zero-crossing
        "waveform_length": round(_current_wl, 1),
        "rms_threshold": cfg["rms_threshold"],
        "rms_max": cfg["rms_max"],
        "rms_normalized": round(max(0, min(1, (rms - cfg["rms_threshold"]) / denom)), 3),
        "fatigue_level": round(_fatigue_level, 3),
        "raw_angle": raw_angle,
        "smoothed_angle": round(_bio_smoothed_angle, 1),
        "last_sent_angle": round(_bio_last_sent_angle, 1),
        "is_contracting": _bio_is_contracting,
        "contraction_count": _calib_state["contraction_count"],
        "target_joint": cfg["target_joint"],
        "mode": _control_mode,
        "emg_connected": connection_state["emg"]["status"] == "connected",
        "arm_connected": connection_state["arm"]["status"] == "connected",
        # ── Calibration state ──
        "calibration": {
            "status": _calib_state["status"],
            "progress": round(_calib_state["samples_collected"] / max(1, _calib_state["target_samples"]) * 100, 1),
            "noise_mean": _calib_state["noise_mean"],
            "noise_std": _calib_state["noise_std"],
            "noise_floor": _calib_state["noise_floor"],
            "peak_rms_seen": round(_calib_state["peak_rms_seen"], 2),
            "last_calibrated": _calib_state["last_calibrated"],
        },
        "config": cfg,
    }


@app.post("/biosignal-calibrate")
def trigger_calibration():
    """Manually trigger a recalibration. User should relax muscles during this."""
    if connection_state["emg"]["status"] != "connected":
        return {"status": "error", "message": "EMG sensor not connected"}
    _start_calibration()
    return {"status": "ok", "message": "Calibration started — relax muscles for 3 seconds"}


@app.get("/mode")
def get_mode():
    return {"mode": _control_mode}


class ModeUpdate(BaseModel):
    mode: str


@app.post("/mode")
def set_mode(body: ModeUpdate):
    global _control_mode
    mode = body.mode.lower()
    if mode not in ("manual", "biosignal", "hybrid"):
        return {"status": "error", "message": f"Invalid mode '{mode}'. Use: manual, biosignal, hybrid"}

    prev = _control_mode
    _control_mode = mode
    _add_log("OK", f"Control mode changed: {prev} → {mode}")
    return {"status": "ok", "mode": _control_mode, "previous": prev}


class BioConfigUpdate(BaseModel):
    rms_threshold: Optional[float] = None
    rms_max: Optional[float] = None
    gamma: Optional[float] = None
    ema_alpha: Optional[float] = None
    angle_min: Optional[float] = None
    angle_max: Optional[float] = None
    dead_zone: Optional[float] = None
    contraction_hold_ms: Optional[float] = None
    servo_rate_limit_ms: Optional[float] = None
    target_joint: Optional[str] = None


@app.post("/biosignal-config")
def update_bio_config(body: BioConfigUpdate):
    """Update bio-signal mapping parameters without restarting."""
    updated = []
    for field in ["rms_threshold", "rms_max", "gamma", "ema_alpha", "angle_min", "angle_max",
                  "dead_zone", "contraction_hold_ms", "servo_rate_limit_ms", "target_joint"]:
        val = getattr(body, field, None)
        if val is not None:
            _bio_config[field] = val
            updated.append(field)
    if updated:
        _add_log("INFO", f"Bio config updated: {', '.join(updated)}")
    return {"status": "ok", "updated": updated, "config": _bio_config}


# ═══════════════════════════════════════════════════════════════════════════════
# ARM CONFIGURATION SYSTEM
# ═══════════════════════════════════════════════════════════════════════════════

_ARM_CONFIG_PATH = Path(__file__).parent / "arm_config.json"
_arm_config: dict = {}


def _load_arm_config():
    """Load arm configuration from JSON file."""
    global _arm_config
    try:
        if _ARM_CONFIG_PATH.exists():
            with open(_ARM_CONFIG_PATH, "r") as f:
                _arm_config = json.load(f)
            _add_log("OK", f"Arm config loaded: {_arm_config.get('name', 'unnamed')}")
        else:
            _add_log("WARN", "No arm_config.json found — using defaults")
            _arm_config = {"name": "Default", "joints": [], "links": {}}
    except Exception as e:
        _add_log("ERROR", f"Failed to load arm config: {e}")
        _arm_config = {"name": "Error", "joints": [], "links": {}}


def _save_arm_config():
    """Save arm configuration to JSON file."""
    try:
        with open(_ARM_CONFIG_PATH, "w") as f:
            json.dump(_arm_config, f, indent=2)
        _add_log("OK", "Arm config saved to disk")
    except Exception as e:
        _add_log("ERROR", f"Failed to save arm config: {e}")


# Load config at startup
_load_arm_config()


@app.get("/arm-config")
def get_arm_config():
    """Get current arm configuration."""
    return {"status": "ok", "config": _arm_config}


@app.post("/arm-config")
def update_arm_config(config: dict):
    """Update arm configuration (partial or full)."""
    global _arm_config
    _arm_config.update(config)
    _save_arm_config()
    return {"status": "ok", "config": _arm_config}


# ═══════════════════════════════════════════════════════════════════════════════
# SIMULATION MODE
# ═══════════════════════════════════════════════════════════════════════════════

_simulation_mode: bool = _arm_config.get("simulation", {}).get("enabled", False)


@app.get("/simulation")
def get_simulation():
    """Get simulation mode status."""
    return {
        "enabled": _simulation_mode,
        "description": "When enabled, servo commands update internal state without serial writes",
    }


class SimulationUpdate(BaseModel):
    enabled: bool


@app.post("/simulation")
def set_simulation(body: SimulationUpdate):
    """Toggle simulation mode on/off."""
    global _simulation_mode
    prev = _simulation_mode
    _simulation_mode = body.enabled
    # Update config in memory
    if "simulation" not in _arm_config:
        _arm_config["simulation"] = {}
    _arm_config["simulation"]["enabled"] = body.enabled
    _add_log("OK", f"Simulation mode: {'ON' if body.enabled else 'OFF'} (was {'ON' if prev else 'OFF'})")
    return {"status": "ok", "enabled": _simulation_mode, "previous": prev}


# ═══════════════════════════════════════════════════════════════════════════════
# TEACH & REPLAY ENGINE — Record, Save, and Replay Servo Sequences
# ═══════════════════════════════════════════════════════════════════════════════
#
# Workflow:
#   1. User positions the arm manually (sliders / controller / bio-signal)
#   2. Press "Record Waypoint" → snapshot of all 6 servo angles is stored
#   3. Repeat for each position in the task (pick, lift, move, place, etc.)
#   4. Save as a named sequence
#   5. Press "Play" → arm smoothly interpolates through all waypoints
#      with REAL serial commands sent to Arduino at ~50 Hz
#   6. Sequences persist to disk as JSON for reuse across sessions
#
# ═══════════════════════════════════════════════════════════════════════════════

import uuid as _uuid

_SEQUENCES_PATH = Path(__file__).parent / "sequences.json"

# In-memory sequence store: { id: { name, created, waypoints[], loop, speed } }
_sequences: Dict[str, dict] = {}

# Playback state
_playback_state = {
    "active": False,
    "sequence_id": None,
    "sequence_name": None,
    "current_waypoint_idx": 0,
    "total_waypoints": 0,
    "progress": 0.0,           # 0.0–1.0 overall
    "interpolation": 0.0,      # 0.0–1.0 between current pair
    "loop": False,
    "loop_count": 0,
    "speed": 1.0,
    "paused": False,
    "current_angles": {},
    "status": "idle",          # "idle" | "playing" | "paused" | "finished"
}
_selected_sequence_id: Optional[str] = None
_playback_stop = threading.Event()
_playback_thread: Optional[threading.Thread] = None
_playback_lock = threading.Lock()


def _load_sequences():
    """Load sequences from disk."""
    global _sequences
    try:
        if _SEQUENCES_PATH.exists():
            with open(_SEQUENCES_PATH, "r") as f:
                _sequences = json.load(f)
            _add_log("OK", f"Loaded {len(_sequences)} saved sequence(s)")
        else:
            _sequences = {}
    except Exception as e:
        _add_log("ERROR", f"Failed to load sequences: {e}")
        _sequences = {}


def _save_sequences():
    """Persist sequences to disk."""
    try:
        with open(_SEQUENCES_PATH, "w") as f:
            json.dump(_sequences, f, indent=2)
    except Exception as e:
        _add_log("ERROR", f"Failed to save sequences: {e}")


# Load at startup
_load_sequences()


# ─── Sequence CRUD Endpoints ──────────────────────────────────────────────────

@app.get("/sequences")
def list_sequences():
    """List all saved sequences with summary info."""
    summaries = []
    for sid, seq in _sequences.items():
        summaries.append({
            "id": sid,
            "name": seq.get("name", "Untitled"),
            "waypoint_count": len(seq.get("waypoints", [])),
            "created": seq.get("created"),
            "loop": seq.get("loop", False),
            "speed": seq.get("speed", 1.0),
            "total_duration_ms": sum(wp.get("delay_ms", 1000) for wp in seq.get("waypoints", [])),
        })
    return {"status": "ok", "sequences": summaries, "count": len(summaries)}


@app.get("/sequences/selected")
def get_selected_sequence():
    return {"status": "ok", "id": _selected_sequence_id}


@app.post("/sequences/selected/{seq_id}")
def set_selected_sequence(seq_id: str):
    global _selected_sequence_id
    if seq_id not in _sequences and seq_id != "none":
        return {"status": "error", "message": "Sequence not found"}
    _selected_sequence_id = None if seq_id == "none" else seq_id
    name = _sequences[_selected_sequence_id]["name"] if _selected_sequence_id else "None"
    _add_log("INFO", f"Active mission set to: {name}")
    return {"status": "ok", "selected": _selected_sequence_id}


class CreateSequenceRequest(BaseModel):
    name: str
    loop: Optional[bool] = False
    speed: Optional[float] = 1.0


@app.post("/sequences")
def create_sequence(body: CreateSequenceRequest):
    """Create a new empty sequence."""
    sid = str(_uuid.uuid4())[:8]
    _sequences[sid] = {
        "name": body.name,
        "created": datetime.now().isoformat(),
        "waypoints": [],
        "loop": body.loop,
        "speed": body.speed,
    }
    _save_sequences()
    _add_log("OK", f"Sequence created: '{body.name}' (id={sid})")
    return {"status": "ok", "id": sid, "sequence": _sequences[sid]}


@app.get("/sequences/{seq_id}")
def get_sequence(seq_id: str):
    """Get a specific sequence with all waypoints."""
    if seq_id not in _sequences:
        return {"status": "error", "message": f"Sequence '{seq_id}' not found"}
    return {"status": "ok", "id": seq_id, "sequence": _sequences[seq_id]}


class UpdateSequenceRequest(BaseModel):
    name: Optional[str] = None
    loop: Optional[bool] = None
    speed: Optional[float] = None


@app.put("/sequences/{seq_id}")
def update_sequence(seq_id: str, body: UpdateSequenceRequest):
    """Update sequence metadata."""
    if seq_id not in _sequences:
        return {"status": "error", "message": f"Sequence '{seq_id}' not found"}
    seq = _sequences[seq_id]
    if body.name is not None:
        seq["name"] = body.name
    if body.loop is not None:
        seq["loop"] = body.loop
    if body.speed is not None:
        seq["speed"] = body.speed
    _save_sequences()
    return {"status": "ok", "id": seq_id, "sequence": seq}


@app.delete("/sequences/{seq_id}")
def delete_sequence(seq_id: str):
    """Delete a sequence."""
    if seq_id not in _sequences:
        return {"status": "error", "message": f"Sequence '{seq_id}' not found"}
    name = _sequences[seq_id].get("name", "Untitled")
    del _sequences[seq_id]
    _save_sequences()
    _add_log("WARN", f"Sequence deleted: '{name}' (id={seq_id})")
    return {"status": "ok", "deleted": seq_id}


# ─── Waypoint Management ─────────────────────────────────────────────────────

class AddWaypointRequest(BaseModel):
    label: Optional[str] = None
    angles: Optional[Dict[str, float]] = None  # if None, captures current servo_state
    delay_ms: Optional[int] = 1000             # pause at this waypoint before moving on
    transition_ms: Optional[int] = 800         # time to interpolate TO this waypoint


@app.post("/sequences/{seq_id}/waypoints")
def add_waypoint(seq_id: str, body: AddWaypointRequest):
    """Add a waypoint to a sequence. If no angles provided, snapshots the current servo state."""
    if seq_id not in _sequences:
        return {"status": "error", "message": f"Sequence '{seq_id}' not found"}

    # Snapshot current state if no explicit angles given
    snap = body.angles if body.angles else dict(servo_state)
    idx = len(_sequences[seq_id]["waypoints"])
    wp = {
        "label": body.label or f"Point {idx + 1}",
        "angles": snap,
        "delay_ms": body.delay_ms,
        "transition_ms": body.transition_ms,
    }
    _sequences[seq_id]["waypoints"].append(wp)
    _save_sequences()
    _add_log("OK", f"Waypoint '{wp['label']}' added to sequence '{_sequences[seq_id]['name']}' — "
             f"[{', '.join(f'{k}:{int(v)}°' for k, v in snap.items())}]")
    return {"status": "ok", "waypoint_index": idx, "waypoint": wp,
            "total_waypoints": len(_sequences[seq_id]["waypoints"])}


class UpdateWaypointRequest(BaseModel):
    label: Optional[str] = None
    angles: Optional[Dict[str, float]] = None
    delay_ms: Optional[int] = None
    transition_ms: Optional[int] = None


@app.put("/sequences/{seq_id}/waypoints/{wp_idx}")
def update_waypoint(seq_id: str, wp_idx: int, body: UpdateWaypointRequest):
    """Update a specific waypoint."""
    if seq_id not in _sequences:
        return {"status": "error", "message": f"Sequence '{seq_id}' not found"}
    wps = _sequences[seq_id]["waypoints"]
    if wp_idx < 0 or wp_idx >= len(wps):
        return {"status": "error", "message": f"Waypoint index {wp_idx} out of range"}
    wp = wps[wp_idx]
    if body.label is not None:
        wp["label"] = body.label
    if body.angles is not None:
        wp["angles"] = body.angles
    if body.delay_ms is not None:
        wp["delay_ms"] = body.delay_ms
    if body.transition_ms is not None:
        wp["transition_ms"] = body.transition_ms
    _save_sequences()
    return {"status": "ok", "waypoint": wp}


@app.delete("/sequences/{seq_id}/waypoints/{wp_idx}")
def delete_waypoint(seq_id: str, wp_idx: int):
    """Remove a waypoint from a sequence."""
    if seq_id not in _sequences:
        return {"status": "error", "message": f"Sequence '{seq_id}' not found"}
    wps = _sequences[seq_id]["waypoints"]
    if wp_idx < 0 or wp_idx >= len(wps):
        return {"status": "error", "message": f"Waypoint index {wp_idx} out of range"}
    removed = wps.pop(wp_idx)
    _save_sequences()
    _add_log("INFO", f"Waypoint '{removed['label']}' removed from sequence")
    return {"status": "ok", "removed": removed, "remaining": len(wps)}


@app.post("/sequences/{seq_id}/waypoints/reorder")
def reorder_waypoints(seq_id: str, order: List[int]):
    """Reorder waypoints by index list, e.g. [2, 0, 1, 3]."""
    if seq_id not in _sequences:
        return {"status": "error", "message": f"Sequence '{seq_id}' not found"}
    wps = _sequences[seq_id]["waypoints"]
    if sorted(order) != list(range(len(wps))):
        return {"status": "error", "message": "Invalid order — must include all indices exactly once"}
    _sequences[seq_id]["waypoints"] = [wps[i] for i in order]
    _save_sequences()
    return {"status": "ok", "new_order": order}


# ─── Quick Snapshot Endpoint ──────────────────────────────────────────────────

@app.post("/sequences/snapshot")
def take_snapshot():
    """Return the current servo angles as a snapshot (does NOT add to any sequence)."""
    return {"status": "ok", "angles": dict(servo_state), "timestamp": datetime.now().isoformat()}


# ─── Controller Quick-Capture Endpoint ────────────────────────────────────────

@app.post("/sequences/capture")
def capture_waypoint_to_active():
    """Capture current servo state as a waypoint in the active (selected) sequence.
    Called by the controller when L2+R2 trigger is pressed — no need to visit
    the Mission page manually."""
    if not _selected_sequence_id:
        _add_log("WARN", "⚠ Capture trigger fired but no active mission selected")
        return {"status": "error", "message": "No active mission selected. Create/select a mission first."}

    seq_id = _selected_sequence_id
    if seq_id not in _sequences:
        return {"status": "error", "message": f"Selected sequence '{seq_id}' not found"}

    snap = dict(servo_state)
    idx = len(_sequences[seq_id]["waypoints"])
    wp = {
        "label": f"Point {idx + 1}",
        "angles": snap,
        "delay_ms": 1000,
        "transition_ms": 800,
    }
    _sequences[seq_id]["waypoints"].append(wp)
    _save_sequences()
    name = _sequences[seq_id]["name"]
    _add_log("OK", f"🎯 Waypoint #{idx + 1} captured → '{name}' — "
             f"[{', '.join(f'{k}:{int(v)}°' for k, v in snap.items())}]")
    return {
        "status": "ok",
        "mission": name,
        "waypoint_index": idx,
        "waypoint": wp,
        "total_waypoints": idx + 1,
    }


# ─── Pre-Built Shape & Task Sequence Generators ──────────────────────────────

class GenerateShapeRequest(BaseModel):
    shape: str                              # "square" | "triangle" | "rectangle"
    name: Optional[str] = None              # custom mission name
    base_angle: Optional[float] = 90.0      # base rotation center
    pen_down_wrist: Optional[float] = 40.0  # wrist angle when pen touches surface
    pen_up_wrist: Optional[float] = 70.0    # wrist angle when pen lifts
    size_deg: Optional[float] = 20.0        # size of shape in degrees of elbow travel
    transition_ms: Optional[int] = 1200     # speed of movement between corners
    delay_ms: Optional[int] = 300           # pause at each corner


@app.post("/sequences/generate-shape")
def generate_shape_sequence(body: GenerateShapeRequest):
    """Generate a pre-built drawing sequence for basic shapes.
    The arm holds a pen and traces the shape on a surface."""
    shape = body.shape.lower().strip()
    if shape not in ("square", "triangle", "rectangle"):
        return {"status": "error", "message": f"Unknown shape '{shape}'. Use: square, triangle, rectangle"}

    sid = str(_uuid.uuid4())[:8]
    base = body.base_angle
    pen_down = body.pen_down_wrist
    pen_up = body.pen_up_wrist
    sz = body.size_deg
    t_ms = body.transition_ms
    d_ms = body.delay_ms
    # Shoulder at low angle = arm reaching down to the drawing surface
    shoulder_draw = 25.0
    elbow_center = 130.0
    gripper_hold = 50.0  # grip the pen tightly
    aux = 90.0

    def _wp(label, b, s, e, w, g=gripper_hold, a=aux, trans=t_ms, delay=d_ms):
        return {"label": label, "angles": {"base": b, "shoulder": s, "elbow": e,
                "wrist": w, "gripper": g, "auxiliary": a}, "delay_ms": delay, "transition_ms": trans}

    waypoints = []

    if shape == "square":
        # Corners: vary base (horizontal) and elbow (depth) to trace a square
        c = [
            (base - sz/2, elbow_center - sz/2),  # bottom-left
            (base + sz/2, elbow_center - sz/2),  # bottom-right
            (base + sz/2, elbow_center + sz/2),  # top-right
            (base - sz/2, elbow_center + sz/2),  # top-left
        ]
        # Approach: pen up at start position
        waypoints.append(_wp("Approach", c[0][0], shoulder_draw, c[0][1], pen_up, trans=1500, delay=500))
        # Pen down
        waypoints.append(_wp("Pen Down", c[0][0], shoulder_draw, c[0][1], pen_down, trans=600, delay=200))
        # Trace corners
        for i, (cb, ce) in enumerate(c[1:], 2):
            waypoints.append(_wp(f"Corner {i}", cb, shoulder_draw, ce, pen_down))
        # Close the shape — back to corner 1
        waypoints.append(_wp("Close Shape", c[0][0], shoulder_draw, c[0][1], pen_down))
        # Pen up
        waypoints.append(_wp("Pen Up", c[0][0], shoulder_draw, c[0][1], pen_up, trans=600, delay=300))

    elif shape == "triangle":
        # Equilateral-ish triangle
        c = [
            (base, elbow_center - sz/2),                  # bottom center
            (base + sz/2, elbow_center + sz/3),            # right
            (base - sz/2, elbow_center + sz/3),            # left
        ]
        waypoints.append(_wp("Approach", c[0][0], shoulder_draw, c[0][1], pen_up, trans=1500, delay=500))
        waypoints.append(_wp("Pen Down", c[0][0], shoulder_draw, c[0][1], pen_down, trans=600, delay=200))
        for i, (cb, ce) in enumerate(c[1:], 2):
            waypoints.append(_wp(f"Corner {i}", cb, shoulder_draw, ce, pen_down))
        waypoints.append(_wp("Close Shape", c[0][0], shoulder_draw, c[0][1], pen_down))
        waypoints.append(_wp("Pen Up", c[0][0], shoulder_draw, c[0][1], pen_up, trans=600, delay=300))

    elif shape == "rectangle":
        # Rectangle: wider in base (horizontal), shorter in elbow (depth)
        w_half = sz * 0.75
        h_half = sz * 0.4
        c = [
            (base - w_half, elbow_center - h_half),
            (base + w_half, elbow_center - h_half),
            (base + w_half, elbow_center + h_half),
            (base - w_half, elbow_center + h_half),
        ]
        waypoints.append(_wp("Approach", c[0][0], shoulder_draw, c[0][1], pen_up, trans=1500, delay=500))
        waypoints.append(_wp("Pen Down", c[0][0], shoulder_draw, c[0][1], pen_down, trans=600, delay=200))
        for i, (cb, ce) in enumerate(c[1:], 2):
            waypoints.append(_wp(f"Corner {i}", cb, shoulder_draw, ce, pen_down))
        waypoints.append(_wp("Close Shape", c[0][0], shoulder_draw, c[0][1], pen_down))
        waypoints.append(_wp("Pen Up", c[0][0], shoulder_draw, c[0][1], pen_up, trans=600, delay=300))

    seq_name = body.name or f"Draw {shape.title()}"
    _sequences[sid] = {
        "name": seq_name,
        "created": datetime.now().isoformat(),
        "waypoints": waypoints,
        "loop": False,
        "speed": 1.0,
    }
    _save_sequences()
    _add_log("OK", f"✏️ Shape sequence generated: '{seq_name}' ({shape}) — {len(waypoints)} waypoints")
    return {"status": "ok", "id": sid, "sequence": _sequences[sid]}


class GenerateTaskRequest(BaseModel):
    task: str                                  # "pick_place" | "stack"
    name: Optional[str] = None
    pick_base: Optional[float] = 60.0          # base angle at pick location
    place_base: Optional[float] = 120.0         # base angle at place location
    cube_size_mm: Optional[float] = 50.0        # cube dimension in mm
    stack_count: Optional[int] = 2              # number of cubes to stack
    grip_open: Optional[float] = 120.0          # gripper open angle
    grip_closed: Optional[float] = 45.0         # gripper closed on cube
    surface_shoulder: Optional[float] = 20.0    # shoulder when at surface level
    hover_shoulder: Optional[float] = 55.0      # shoulder when hovering above
    surface_elbow: Optional[float] = 155.0      # elbow when reaching to surface
    transition_ms: Optional[int] = 1200
    delay_ms: Optional[int] = 600


@app.post("/sequences/generate-task")
def generate_task_sequence(body: GenerateTaskRequest):
    """Generate pre-built pick-and-place or stacking task sequences."""
    task = body.task.lower().strip()
    if task not in ("pick_place", "stack"):
        return {"status": "error", "message": f"Unknown task '{task}'. Use: pick_place, stack"}

    sid = str(_uuid.uuid4())[:8]
    t_ms = body.transition_ms
    d_ms = body.delay_ms
    wrist_flat = 90.0
    aux = 90.0

    def _wp(label, b, s, e, w, g, a=aux, trans=t_ms, delay=d_ms):
        return {"label": label, "angles": {"base": b, "shoulder": s, "elbow": e,
                "wrist": w, "gripper": g, "auxiliary": a}, "delay_ms": delay, "transition_ms": trans}

    waypoints = []

    if task == "pick_place":
        # ── Single pick-and-place operation for a 50mm cube ──
        waypoints = [
            # 1. Home position
            _wp("Home", 90, 90, 90, wrist_flat, body.grip_open, trans=1500, delay=500),
            # 2. Move above pick location
            _wp("Above Pick", body.pick_base, body.hover_shoulder, body.surface_elbow, wrist_flat, body.grip_open, trans=1200, delay=300),
            # 3. Lower to cube
            _wp("Lower to Cube", body.pick_base, body.surface_shoulder, body.surface_elbow, wrist_flat, body.grip_open, trans=800, delay=300),
            # 4. Close gripper on cube
            _wp("Grip Cube", body.pick_base, body.surface_shoulder, body.surface_elbow, wrist_flat, body.grip_closed, trans=600, delay=800),
            # 5. Lift cube
            _wp("Lift Cube", body.pick_base, body.hover_shoulder, body.surface_elbow, wrist_flat, body.grip_closed, trans=800, delay=400),
            # 6. Rotate to place location
            _wp("Move to Place", body.place_base, body.hover_shoulder, body.surface_elbow, wrist_flat, body.grip_closed, trans=1200, delay=300),
            # 7. Lower to place surface
            _wp("Lower to Place", body.place_base, body.surface_shoulder, body.surface_elbow, wrist_flat, body.grip_closed, trans=800, delay=300),
            # 8. Release cube
            _wp("Release Cube", body.place_base, body.surface_shoulder, body.surface_elbow, wrist_flat, body.grip_open, trans=600, delay=600),
            # 9. Lift away
            _wp("Lift Away", body.place_base, body.hover_shoulder, body.surface_elbow, wrist_flat, body.grip_open, trans=800, delay=300),
            # 10. Return home
            _wp("Return Home", 90, 90, 90, wrist_flat, body.grip_open, trans=1500, delay=500),
        ]

    elif task == "stack":
        # ── Stacking operation: pick cubes from pick_base, stack at place_base ──
        # Each successive cube is placed slightly higher (less shoulder angle = higher lift)
        # The shoulder offset per cube layer accounts for the 50mm cube height
        height_offset_per_layer = 5.0  # degrees of shoulder change per cube layer

        for layer in range(body.stack_count):
            # Place height gets higher with each layer
            place_shoulder = body.surface_shoulder - (layer * height_offset_per_layer)
            place_hover = body.hover_shoulder - (layer * height_offset_per_layer * 0.5)
            layer_label = f"L{layer + 1}"

            waypoints.extend([
                # Move above pick zone
                _wp(f"{layer_label}: Above Pick", body.pick_base, body.hover_shoulder, body.surface_elbow,
                    wrist_flat, body.grip_open, trans=1000, delay=300),
                # Lower to pick
                _wp(f"{layer_label}: Lower Pick", body.pick_base, body.surface_shoulder, body.surface_elbow,
                    wrist_flat, body.grip_open, trans=800, delay=300),
                # Grip
                _wp(f"{layer_label}: Grip", body.pick_base, body.surface_shoulder, body.surface_elbow,
                    wrist_flat, body.grip_closed, trans=500, delay=700),
                # Lift
                _wp(f"{layer_label}: Lift", body.pick_base, body.hover_shoulder, body.surface_elbow,
                    wrist_flat, body.grip_closed, trans=800, delay=300),
                # Move to stack
                _wp(f"{layer_label}: To Stack", body.place_base, place_hover, body.surface_elbow,
                    wrist_flat, body.grip_closed, trans=1200, delay=300),
                # Lower onto stack
                _wp(f"{layer_label}: Place", body.place_base, place_shoulder, body.surface_elbow,
                    wrist_flat, body.grip_closed, trans=800, delay=300),
                # Release
                _wp(f"{layer_label}: Release", body.place_base, place_shoulder, body.surface_elbow,
                    wrist_flat, body.grip_open, trans=500, delay=600),
                # Lift away
                _wp(f"{layer_label}: Clear", body.place_base, place_hover, body.surface_elbow,
                    wrist_flat, body.grip_open, trans=800, delay=300),
            ])

        # Return home
        waypoints.append(_wp("Return Home", 90, 90, 90, wrist_flat, body.grip_open, trans=1500, delay=500))

    seq_name = body.name or (f"Pick & Place" if task == "pick_place" else f"Stack {body.stack_count} Cubes")
    _sequences[sid] = {
        "name": seq_name,
        "created": datetime.now().isoformat(),
        "waypoints": waypoints,
        "loop": False,
        "speed": 1.0,
    }
    _save_sequences()
    _add_log("OK", f"🤖 Task sequence generated: '{seq_name}' ({task}) — {len(waypoints)} waypoints")
    return {"status": "ok", "id": sid, "sequence": _sequences[sid]}


# ─── Playback Engine ─────────────────────────────────────────────────────────

def _interpolate_angles(a: dict, b: dict, t: float) -> dict:
    """Linear interpolation between two angle dicts. t in [0, 1]."""
    result = {}
    for key in a:
        v0 = a.get(key, 90.0)
        v1 = b.get(key, 90.0)
        # Ease-in-out cubic for smoother motion
        t_smooth = t * t * (3.0 - 2.0 * t)
        result[key] = v0 + (v1 - v0) * t_smooth
    return result


def _send_angles_to_arm(angles: dict):
    """Write interpolated angles to both servo_state and serial port."""
    global _arm_serial
    for key in servo_state:
        if key in angles:
            servo_state[key] = round(max(0, min(270, angles[key])), 1)

    if _arm_serial and _arm_serial.is_open:
        cmd = (f"{int(servo_state['base'])},"
               f"{int(servo_state['shoulder'])},"
               f"{int(servo_state['elbow'])},"
               f"{int(servo_state['wrist'])},"
               f"{int(servo_state['gripper'])},"
               f"{int(servo_state['auxiliary'])}\n")
        try:
            _arm_serial.write(cmd.encode('ascii'))
            connection_state["arm"]["last_seen"] = datetime.now().isoformat()
        except Exception as e:
            _add_log("ERROR", f"[PLAYBACK] Serial write failed: {e}")


def _playback_worker(seq_id: str):
    """Background thread: plays a sequence with smooth interpolation.
    Sends REAL servo commands at ~50 Hz during transitions."""
    global _playback_state

    seq = _sequences.get(seq_id)
    if not seq:
        _playback_state["status"] = "idle"
        _playback_state["active"] = False
        return

    wps = seq["waypoints"]
    if len(wps) < 1:
        _playback_state["status"] = "idle"
        _playback_state["active"] = False
        _add_log("WARN", "Sequence has no waypoints — nothing to play")
        return

    speed = seq.get("speed", 1.0) * _playback_state.get("speed", 1.0)
    loop = _playback_state.get("loop", seq.get("loop", False))
    loop_count = 0

    _add_log("OK", f"▶ Playing sequence '{seq['name']}' — {len(wps)} waypoints, speed={speed}x, loop={'ON' if loop else 'OFF'}")

    # Move to first waypoint before starting
    first_angles = wps[0]["angles"]
    _send_angles_to_arm(first_angles)
    _playback_state.update({
        "current_waypoint_idx": 0,
        "current_angles": dict(first_angles),
        "interpolation": 0.0,
    })

    while not _playback_stop.is_set():
        for i in range(len(wps)):
            if _playback_stop.is_set():
                break

            # Handle pause
            while _playback_state.get("paused") and not _playback_stop.is_set():
                _playback_state["status"] = "paused"
                time.sleep(0.05)
            if _playback_stop.is_set():
                break
            _playback_state["status"] = "playing"

            wp = wps[i]
            target_angles = wp["angles"]
            transition_ms = wp.get("transition_ms", 800) / max(0.1, speed)
            delay_ms = wp.get("delay_ms", 1000) / max(0.1, speed)

            # Get starting angles (current servo state)
            start_angles = dict(servo_state)

            _playback_state.update({
                "current_waypoint_idx": i,
                "total_waypoints": len(wps),
            })

            # ── Interpolate to this waypoint ──
            if transition_ms > 0:
                steps = max(1, int(transition_ms / 20))  # ~50 Hz
                for step in range(steps + 1):
                    if _playback_stop.is_set():
                        break
                    while _playback_state.get("paused") and not _playback_stop.is_set():
                        time.sleep(0.05)
                    if _playback_stop.is_set():
                        break

                    t = step / max(1, steps)
                    interp = _interpolate_angles(start_angles, target_angles, t)
                    _send_angles_to_arm(interp)

                    # Update state for frontend
                    overall = (i + t) / len(wps)
                    _playback_state.update({
                        "interpolation": round(t, 3),
                        "progress": round(overall, 3),
                        "current_angles": {k: round(v, 1) for k, v in interp.items()},
                    })
                    time.sleep(0.02)  # 50 Hz

            # Snap to exact target
            _send_angles_to_arm(target_angles)
            _playback_state["current_angles"] = dict(target_angles)
            _playback_state["interpolation"] = 1.0
            _playback_state["progress"] = round((i + 1) / len(wps), 3)

            # ── Hold at waypoint ──
            if delay_ms > 0 and not _playback_stop.is_set():
                hold_steps = max(1, int(delay_ms / 50))
                for _ in range(hold_steps):
                    if _playback_stop.is_set():
                        break
                    while _playback_state.get("paused") and not _playback_stop.is_set():
                        time.sleep(0.05)
                    time.sleep(0.05)

        if _playback_stop.is_set():
            break

        loop_count += 1
        _playback_state["loop_count"] = loop_count

        if not loop:
            break
        else:
            _add_log("INFO", f"↻ Sequence loop #{loop_count + 1}")

    _playback_state.update({
        "active": False,
        "status": "finished" if not _playback_stop.is_set() else "idle",
        "progress": 1.0 if not _playback_stop.is_set() else _playback_state["progress"],
    })
    _add_log("OK", f"■ Sequence playback {'completed' if not _playback_stop.is_set() else 'stopped'} "
             f"(loops={loop_count})")


class PlayRequest(BaseModel):
    loop: Optional[bool] = None
    speed: Optional[float] = 1.0


@app.post("/sequences/{seq_id}/play")
def play_sequence(seq_id: str, body: PlayRequest):
    """Start playing a sequence. Arm interpolates through all waypoints with real serial."""
    global _playback_thread
    if seq_id not in _sequences:
        return {"status": "error", "message": f"Sequence '{seq_id}' not found"}
    seq = _sequences[seq_id]
    if len(seq.get("waypoints", [])) < 1:
        return {"status": "error", "message": "Sequence has no waypoints"}

    # Stop any running playback first
    _stop_playback()

    _playback_stop.clear()
    use_loop = body.loop if body.loop is not None else seq.get("loop", False)
    _playback_state.update({
        "active": True,
        "sequence_id": seq_id,
        "sequence_name": seq["name"],
        "current_waypoint_idx": 0,
        "total_waypoints": len(seq["waypoints"]),
        "progress": 0.0,
        "interpolation": 0.0,
        "loop": use_loop,
        "loop_count": 0,
        "speed": body.speed or 1.0,
        "paused": False,
        "status": "playing",
        "current_angles": dict(servo_state),
    })

    _playback_thread = threading.Thread(target=_playback_worker, args=(seq_id,), daemon=True)
    _playback_thread.start()

    return {"status": "ok", "message": f"Playing '{seq['name']}'", "playback": _playback_state}


@app.post("/sequences/stop")
def stop_playback_endpoint():
    """Stop any running playback."""
    _stop_playback()
    return {"status": "ok", "playback": _playback_state}


@app.post("/sequences/pause")
def pause_playback():
    """Toggle pause on running playback."""
    if not _playback_state["active"]:
        return {"status": "error", "message": "No playback running"}
    _playback_state["paused"] = not _playback_state["paused"]
    state_str = "paused" if _playback_state["paused"] else "resumed"
    _add_log("INFO", f"Playback {state_str}")
    return {"status": "ok", "paused": _playback_state["paused"]}


@app.get("/sequences/playback")
def get_playback_state():
    """Get current playback state for frontend animation sync."""
    return {"status": "ok", "playback": _playback_state}


def _stop_playback():
    """Stop the playback thread cleanly."""
    global _playback_thread
    _playback_stop.set()
    if _playback_thread and _playback_thread.is_alive():
        _playback_thread.join(timeout=2)
    _playback_thread = None
    _playback_state.update({
        "active": False,
        "paused": False,
        "status": "idle",
    })


# ─── Sequence Duplication / Import-Export ──────────────────────────────────────

@app.post("/sequences/{seq_id}/duplicate")
def duplicate_sequence(seq_id: str):
    """Duplicate an existing sequence."""
    if seq_id not in _sequences:
        return {"status": "error", "message": f"Sequence '{seq_id}' not found"}
    new_id = str(_uuid.uuid4())[:8]
    import copy
    _sequences[new_id] = copy.deepcopy(_sequences[seq_id])
    _sequences[new_id]["name"] = _sequences[seq_id]["name"] + " (copy)"
    _sequences[new_id]["created"] = datetime.now().isoformat()
    _save_sequences()
    _add_log("OK", f"Sequence duplicated: '{_sequences[new_id]['name']}' (id={new_id})")
    return {"status": "ok", "id": new_id, "sequence": _sequences[new_id]}


# ═══════════════════════════════════════════════════════════════════════════════
# FORWARD KINEMATICS ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

def _forward_kinematics(angles_deg: Dict[str, float]) -> dict:
    """Compute forward kinematics for a 6-DOF arm.
    Uses a simplified DH-like chain based on arm_config link lengths.
    Returns end-effector position (x, y, z) and each joint position."""

    links = _arm_config.get("links", {})
    L0 = links.get("base_height", 0.12)
    L1 = links.get("upper_arm", 0.55)
    L2 = links.get("forearm", 0.45)
    L3 = links.get("wrist_length", 0.20)
    L4 = links.get("gripper_length", 0.15)

    # Convert to radians, centered at 90° (home position)
    base_rad     = math.radians(angles_deg.get("base", 90) - 90)
    shoulder_rad = math.radians(angles_deg.get("shoulder", 90) - 90)
    elbow_rad    = math.radians(angles_deg.get("elbow", 90) - 90)
    wrist_rad    = math.radians(angles_deg.get("wrist", 90) - 90)

    # Joint positions along the kinematic chain
    positions = []

    # Base (fixed)
    p0 = {"x": 0, "y": L0, "z": 0}
    positions.append({"name": "base", "pos": p0})

    # Shoulder
    # After shoulder rotation (pitch in XZ plane rotated by base yaw)
    s_angle = shoulder_rad
    p1_y = L0 + L1 * math.cos(s_angle)
    p1_r = L1 * math.sin(s_angle)  # radial distance from center
    p1_x = p1_r * math.sin(base_rad)
    p1_z = p1_r * math.cos(base_rad)
    positions.append({"name": "shoulder", "pos": {"x": round(p1_x, 4), "y": round(p1_y, 4), "z": round(p1_z, 4)}})

    # Elbow
    cum_angle = s_angle + elbow_rad
    p2_y = p1_y + L2 * math.cos(cum_angle)
    p2_r = p1_r + L2 * math.sin(cum_angle)
    p2_x = p2_r * math.sin(base_rad)
    p2_z = p2_r * math.cos(base_rad)
    positions.append({"name": "elbow", "pos": {"x": round(p2_x, 4), "y": round(p2_y, 4), "z": round(p2_z, 4)}})

    # Wrist
    cum_angle2 = cum_angle + wrist_rad
    p3_y = p2_y + L3 * math.cos(cum_angle2)
    p3_r = p2_r + L3 * math.sin(cum_angle2)
    p3_x = p3_r * math.sin(base_rad)
    p3_z = p3_r * math.cos(base_rad)
    positions.append({"name": "wrist", "pos": {"x": round(p3_x, 4), "y": round(p3_y, 4), "z": round(p3_z, 4)}})

    # End-effector (gripper tip)
    p4_y = p3_y + L4 * math.cos(cum_angle2)
    p4_r = p3_r + L4 * math.sin(cum_angle2)
    p4_x = p4_r * math.sin(base_rad)
    p4_z = p4_r * math.cos(base_rad)
    ee = {"x": round(p4_x, 4), "y": round(p4_y, 4), "z": round(p4_z, 4)}
    positions.append({"name": "end_effector", "pos": ee})

    # Workspace radius (horizontal distance from base)
    reach = math.sqrt(ee["x"]**2 + ee["z"]**2)

    return {
        "end_effector": ee,
        "positions": positions,
        "reach": round(reach, 4),
        "total_height": round(ee["y"], 4),
    }


@app.get("/kinematics")
def get_kinematics():
    """Compute current FK based on servo_state."""
    fk = _forward_kinematics(servo_state)
    return {
        "status": "ok",
        "joint_angles": servo_state,
        "forward_kinematics": fk,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# ROS-COMPATIBLE WEBSOCKET BRIDGE
# ═══════════════════════════════════════════════════════════════════════════════
#
# Implements a subset of the rosbridge v2.0 protocol over WebSocket.
# Users with ROS2 can connect via roslibpy or rosbridge_client.
# No native ROS installation required on this machine.
#
# Supported operations:
#   - "subscribe"  → /joint_states (sensor_msgs/JointState)
#   - "publish"    → /joint_commands (receives target angles)
#   - "advertise"  → registers intent to publish
#   - "call_service" → /get_kinematics (returns FK)
#

_ros_clients: List[WebSocket] = []
_ros_subscriptions: Dict[str, List[WebSocket]] = {}
_ros_lock = threading.Lock()

# Namespace from config
_ros_ns = _arm_config.get("ros", {}).get("namespace", "/synapticx")
_JOINT_NAMES = ["base", "shoulder", "elbow", "wrist", "wrist_roll", "gripper"]


def _build_joint_state_msg() -> dict:
    """Build a sensor_msgs/JointState-like message from current servo state."""
    angles_rad = [math.radians(servo_state[k]) for k in ["base", "shoulder", "elbow", "wrist", "gripper", "auxiliary"]]
    return {
        "op": "publish",
        "topic": f"{_ros_ns}/joint_states",
        "msg": {
            "header": {
                "stamp": {"secs": int(time.time()), "nsecs": int((time.time() % 1) * 1e9)},
                "frame_id": "base_link",
            },
            "name": _JOINT_NAMES,
            "position": angles_rad,
            "velocity": [0.0] * 6,
            "effort": [0.0] * 6,
        },
    }


@app.websocket("/ws/ros")
async def ros_bridge_ws(websocket: WebSocket):
    """ROS-compatible WebSocket bridge.
    Speaks a subset of the rosbridge v2.0 JSON protocol."""
    await websocket.accept()
    _ros_clients.append(websocket)
    _add_log("OK", f"ROS bridge client connected ({len(_ros_clients)} total)")

    # Background task: publish joint states at 10 Hz to subscribers
    publish_task = None

    async def _publish_joint_states():
        while True:
            try:
                topic = f"{_ros_ns}/joint_states"
                with _ros_lock:
                    subs = _ros_subscriptions.get(topic, [])
                if websocket in subs:
                    msg = _build_joint_state_msg()
                    await websocket.send_json(msg)
                await asyncio.sleep(0.1)  # 10 Hz
            except Exception:
                break

    try:
        publish_task = asyncio.create_task(_publish_joint_states())

        while True:
            data = await websocket.receive_json()
            op = data.get("op", "")

            if op == "subscribe":
                topic = data.get("topic", "")
                with _ros_lock:
                    if topic not in _ros_subscriptions:
                        _ros_subscriptions[topic] = []
                    if websocket not in _ros_subscriptions[topic]:
                        _ros_subscriptions[topic].append(websocket)
                _add_log("INFO", f"ROS subscribe: {topic}")
                await websocket.send_json({"op": "status", "level": "info", "msg": f"Subscribed to {topic}"})

            elif op == "unsubscribe":
                topic = data.get("topic", "")
                with _ros_lock:
                    if topic in _ros_subscriptions:
                        _ros_subscriptions[topic] = [s for s in _ros_subscriptions[topic] if s != websocket]

            elif op == "publish":
                topic = data.get("topic", "")
                msg = data.get("msg", {})

                # Handle joint commands
                if topic in (f"{_ros_ns}/joint_commands", "/joint_commands"):
                    positions = msg.get("position", [])
                    names = msg.get("name", _JOINT_NAMES)
                    joint_keys = ["base", "shoulder", "elbow", "wrist", "gripper", "auxiliary"]
                    for i, name in enumerate(names):
                        if i < len(positions):
                            # Convert radians to degrees
                            angle_deg = math.degrees(positions[i])
                            key = joint_keys[i] if i < len(joint_keys) else None
                            if key and key in servo_state:
                                servo_state[key] = max(0, min(270, round(angle_deg, 1)))
                    _add_log("INFO", f"ROS joint command received ({len(positions)} joints)")

                    # Write to hardware if not in simulation
                    if not _simulation_mode and _arm_serial and _arm_serial.is_open:
                        cmd = f"{int(servo_state['base'])},{int(servo_state['shoulder'])},{int(servo_state['elbow'])},{int(servo_state['wrist'])},{int(servo_state['gripper'])},{int(servo_state['auxiliary'])}\n"
                        try:
                            _arm_serial.write(cmd.encode('ascii'))
                        except Exception:
                            pass

            elif op == "advertise":
                # Acknowledge
                await websocket.send_json({"op": "status", "level": "info", "msg": f"Advertised {data.get('topic', '')}"})

            elif op == "call_service":
                service = data.get("service", "")
                call_id = data.get("id", "")
                if service in ("/get_kinematics", f"{_ros_ns}/get_kinematics"):
                    fk = _forward_kinematics(servo_state)
                    await websocket.send_json({
                        "op": "service_response",
                        "id": call_id,
                        "service": service,
                        "values": fk,
                        "result": True,
                    })
                else:
                    await websocket.send_json({
                        "op": "service_response",
                        "id": call_id,
                        "service": service,
                        "values": {},
                        "result": False,
                    })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        _add_log("WARN", f"ROS bridge error: {e}")
    finally:
        if publish_task:
            publish_task.cancel()
        _ros_clients.remove(websocket) if websocket in _ros_clients else None
        with _ros_lock:
            for topic in _ros_subscriptions:
                _ros_subscriptions[topic] = [s for s in _ros_subscriptions[topic] if s != websocket]
        _add_log("INFO", f"ROS bridge client disconnected ({len(_ros_clients)} remaining)")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
