"""
SynapticX 6X — Backend
Real serial streaming from BioAmp EXG Pill (one EMG channel) + Arduino ARM control.
No simulated data anywhere.
"""

import threading
import time
import math
from collections import deque
from datetime import datetime
from typing import Dict, List, Optional
from pydantic import BaseModel

from fastapi import FastAPI
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

    err = _try_open_port(port, baud)
    if err:
        connection_state[node].update({"status": "error", "port": None, "error": err})
        _add_log("ERROR", f"{connection_state[node]['device']}: {port} — {err}")
        return {"status": "error", "message": err, "connections": connection_state}

    connection_state[node].update({
        "status": "connected", "baud": baud,
        "last_seen": datetime.now().isoformat(), "error": None,
    })
    label = connection_state[node]["device"]
    _add_log("OK", f"{label} connected on {port} @ {baud} baud")

    # If this is the EMG node, start the serial reader thread
    if node == "emg":
        _start_emg_reader(port, baud)
    elif node == "arm":
        global _arm_serial
        try:
            if _arm_serial:
                _arm_serial.close()
            _arm_serial = serial.Serial(port, baud, timeout=1, dsrdtr=True)
        except Exception as e:
            _add_log("ERROR", f"Failed to hold arm serial connection: {e}")

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
    for name, angle in body.angles.items():
        if name in servo_state:
            clamped = max(0.0, min(180.0, angle))
            servo_state[name] = clamped
            updated.append(name)
            _add_log("INFO", f"Servo '{name}' → {clamped:.1f}°")

    # Send data to Arduino
    global _arm_serial
    if _arm_serial and _arm_serial.is_open:
        # Ordered as: base, shoulder, elbow, wrist, gripper, auxiliary
        cmd = f"{int(servo_state['base'])},{int(servo_state['shoulder'])},{int(servo_state['elbow'])},{int(servo_state['wrist'])},{int(servo_state['gripper'])},{int(servo_state['auxiliary'])}\n"
        try:
            _arm_serial.write(cmd.encode('ascii'))
        except Exception as e:
            _add_log("ERROR", f"Failed to write to ARM: {e}")

    return {"status": "ok", "updated": updated, "servo_state": servo_state}


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
