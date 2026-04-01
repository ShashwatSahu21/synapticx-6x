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
    "wrist": 90.0, "gripper": 90.0, "auxiliary": 90.0,
}

# ─── Connection state ─────────────────────────────────────────────────────────

connection_state: Dict[str, dict] = {
    "emg": {
        "port": None, "status": "disconnected",
        "device": "BioAmp EXG Pill", "baud": 115200,
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

# ─── Bio-Signal Engine (NEW — does NOT modify existing code) ─────────────────

# Control mode: "manual" | "biosignal" | "hybrid"
_control_mode: str = "manual"

# RMS sliding window — stores recent rectified, filtered samples for RMS calc
_RMS_WINDOW_SIZE = 200   # ~20 ms at 10 kHz
_rms_window: deque = deque(maxlen=_RMS_WINDOW_SIZE)
_current_rms: float = 0.0

# RMS history for fatigue detection (stores RMS values every ~100 ms)
_RMS_HISTORY: deque = deque(maxlen=100)  # last ~10 s of RMS snapshots
_rms_snapshot_counter: int = 0
_RMS_SNAPSHOT_INTERVAL = 1000  # every 1000 samples = ~100 ms at 10 kHz

# Fatigue state: 0.0 (fresh) → 1.0 (fully fatigued)
_fatigue_level: float = 0.0

# Bio-signal → angle mapping config
_bio_config = {
    "rms_threshold": 30.0,    # min RMS to start mapping (noise floor)
    "rms_max": 300.0,         # RMS at full contraction
    "gamma": 2.0,             # response curve exponent (>1 = less sensitive near threshold)
    "ema_alpha": 0.15,        # smoothing factor (lower = smoother)
    "target_joint": "auxiliary",  # physical gripper on channel 5
    "angle_min": 0.0,
    "angle_max": 180.0,
}
_bio_smoothed_angle: float = 90.0
_bio_drive_active: bool = False


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

                # ── Bio-Signal RMS computation (inline, uses existing filtered value) ──
                _rms_window.append(abs(y))  # rectified filtered signal
                if len(_rms_window) >= _RMS_WINDOW_SIZE:
                    global _current_rms, _rms_snapshot_counter, _fatigue_level
                    _current_rms = math.sqrt(sum(s * s for s in _rms_window) / len(_rms_window))

                    # Periodic RMS snapshot for fatigue tracking
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
                                _fatigue_level = min(1.0, drop * 2.0)  # scale to 0-1
                            else:
                                _fatigue_level = 0.0

                # 4. LOG RAW & FILTERED DATA TO FILE LIVE
                if _sample_idx % 10 == 0:  # Log every 10th sample to save disk IO
                    with open("bioamp_data.log", "a") as f:
                        f.write(f"Sample: {_sample_idx} | Raw: {raw_float:>8.2f} | Filtered: {out10:>5} | Temp-Voltage: {round(voltage, 4)}mV\n")

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


def _start_emg_reader(port: str, baud: int):
    global _emg_thread, _emg_stop, _sample_idx
    global _hpf, _notch, _lpf
    _stop_emg_reader()
    _emg_stop = threading.Event()
    _sample_idx = 0
    with _emg_lock:
        EMG_BUFFER.clear()
        # Initialize filters
        _hpf = design_hpf(FS, 70.0)
        _notch = design_notch(FS, 50.0) # 50Hz mains hum (use 60.0 for US)
        _lpf = design_lpf(FS, 2500.0)

    _emg_thread = threading.Thread(
        target=_emg_reader, args=(port, baud, _emg_stop), daemon=True
    )
    _emg_thread.start()


def _stop_emg_reader():
    global _emg_thread
    _emg_stop.set()
    if _emg_thread and _emg_thread.is_alive():
        _emg_thread.join(timeout=2)
    _emg_thread = None
    with _emg_lock:
        EMG_BUFFER.clear()

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
    
    ports = []
    for p in list_ports.comports():
        # Hide standard Bluetooth links
        if p.description and "Bluetooth" in p.description:
            continue
        if p.hwid and "BTHENUM" in p.hwid:
            continue
            
        desc = (p.description or "").upper()
        hwid = (p.hwid or "").upper()
        
        is_arduino = any(k in desc or k in hwid for k in [
            "ARDUINO", "CH340", "CP210", "FTDI", "USB SERIAL", "USB-SERIAL",
            "VID:PID=2341", "VID:PID=1A86", "VID:PID=0403"
        ])
        
        ports.append({
            "port": p.device,
            "description": p.description,
            "hwid": p.hwid,
            "is_arduino": is_arduino
        })
        
    return ports

def _try_open_port(port: str, baud: int) -> Optional[str]:
    """Open and immediately close the port — just verifying it's accessible.
    Uses dsrdtr=True to prevent DTR toggling that resets Arduino UNO."""
    if not SERIAL_AVAILABLE:
        return "pyserial not installed — run: pip install pyserial"
    try:
        s = serial.Serial(port, baud, timeout=1, dsrdtr=True)
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

    connection_state[node].update({"status": "connecting", "port": port, "error": None})

    if node == "arm":
        # ARM: Open the persistent serial connection directly.
        # Do NOT use _try_open_port first — the open-close-reopen pattern
        # causes "Access is denied" on Windows because the OS hasn't fully
        # released the port before the second open attempt.
        global _arm_serial
        try:
            if _arm_serial:
                try:
                    _arm_serial.close()
                except Exception:
                    pass
                _arm_serial = None
            _arm_serial = serial.Serial(port, baud, timeout=1, dsrdtr=True)
            connection_state[node].update({
                "status": "connected", "baud": baud,
                "last_seen": datetime.now().isoformat(), "error": None,
            })
            _add_log("OK", f"{connection_state[node]['device']} connected on {port} @ {baud} baud")
        except Exception as e:
            _arm_serial = None
            connection_state[node].update({"status": "error", "port": None, "error": str(e)})
            _add_log("ERROR", f"{connection_state[node]['device']}: {port} — {e}")
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
            clamped = max(0.0, min(180.0, angle))
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
            _arm_serial.write(cmd.encode('ascii'))
            serial_sent = True
            connection_state["arm"]["last_seen"] = datetime.now().isoformat()
        except Exception as e:
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


# ─── Bio-Signal Engine: Auto-Drive Thread & Endpoints ─────────────────────────

def _map_rms_to_angle(rms: float) -> float:
    """Map RMS value to servo angle using power-curve (gamma) mapping.
    Reuses the existing bio config thresholds."""
    cfg = _bio_config
    # Normalize RMS to 0-1 range
    normalized = (rms - cfg["rms_threshold"]) / (cfg["rms_max"] - cfg["rms_threshold"])
    normalized = max(0.0, min(1.0, normalized))
    # Apply gamma curve for fine control near threshold
    curved = math.pow(normalized, cfg["gamma"])
    # Map to angle range
    angle = cfg["angle_min"] + curved * (cfg["angle_max"] - cfg["angle_min"])
    return round(angle, 1)


def _bio_auto_drive():
    """Background thread: when mode is 'biosignal' or 'hybrid',
    continuously maps EMG RMS → joint6 angle and writes to servo.
    Runs at ~50 Hz (20 ms cycle). Does NOT interfere with manual/controller."""
    global _bio_smoothed_angle, _bio_drive_active
    _bio_drive_active = True
    _add_log("OK", "Bio-signal auto-drive thread started")

    while _bio_drive_active:
        time.sleep(0.020)  # 50 Hz

        if _control_mode not in ("biosignal", "hybrid"):
            continue  # idle — other modes own the joint

        if connection_state["emg"]["status"] != "connected":
            continue  # no EMG data

        cfg = _bio_config
        target_joint = cfg["target_joint"]

        # Get current RMS (thread-safe read — float assignment is atomic in CPython)
        rms = _current_rms

        # Map RMS → raw target angle
        raw_angle = _map_rms_to_angle(rms)

        # Apply EMA smoothing
        _bio_smoothed_angle = (
            cfg["ema_alpha"] * raw_angle +
            (1.0 - cfg["ema_alpha"]) * _bio_smoothed_angle
        )
        clamped = max(cfg["angle_min"], min(cfg["angle_max"], round(_bio_smoothed_angle)))

        # Write to servo state (only the target joint)
        servo_state[target_joint] = float(clamped)

        # Send to Arduino if connected
        if _arm_serial and _arm_serial.is_open:
            cmd = f"{int(servo_state['base'])},{int(servo_state['shoulder'])},{int(servo_state['elbow'])},{int(servo_state['wrist'])},{int(servo_state['gripper'])},{int(servo_state['auxiliary'])}\n"
            try:
                _arm_serial.write(cmd.encode('ascii'))
                connection_state["arm"]["last_seen"] = datetime.now().isoformat()
            except Exception:
                pass  # watchdog will catch dead connections


# Start bio-signal auto-drive at import time (idles when mode is manual)
_bio_drive_thread = threading.Thread(target=_bio_auto_drive, daemon=True)
_bio_drive_thread.start()


# ─── Bio-Signal API Endpoints ─────────────────────────────────────────────────

@app.get("/biosignal-state")
def get_biosignal_state():
    """Returns real-time bio-signal processing state for the frontend panel."""
    cfg = _bio_config
    rms = _current_rms
    raw_angle = _map_rms_to_angle(rms)
    return {
        "rms": round(rms, 2),
        "rms_threshold": cfg["rms_threshold"],
        "rms_max": cfg["rms_max"],
        "rms_normalized": round(max(0, min(1, (rms - cfg["rms_threshold"]) / max(1, cfg["rms_max"] - cfg["rms_threshold"]))), 3),
        "fatigue_level": round(_fatigue_level, 3),
        "raw_angle": raw_angle,
        "smoothed_angle": round(_bio_smoothed_angle, 1),
        "target_joint": cfg["target_joint"],
        "mode": _control_mode,
        "emg_connected": connection_state["emg"]["status"] == "connected",
        "config": cfg,
    }


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


@app.post("/biosignal-config")
def update_bio_config(body: BioConfigUpdate):
    """Update bio-signal mapping parameters without restarting."""
    updated = []
    for field in ["rms_threshold", "rms_max", "gamma", "ema_alpha", "angle_min", "angle_max"]:
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
                                servo_state[key] = max(0, min(180, round(angle_deg, 1)))
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

