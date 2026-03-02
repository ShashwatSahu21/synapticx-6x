"""
SynapticX 6X — Backend
Real serial streaming from BioAmp EXG Pill (one EMG channel) + Arduino ARM control.
No simulated data anywhere.
"""

import threading
import time
from collections import deque
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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
        "device": "Arduino ARM", "baud": 9600,
        "last_seen": None, "error": None,
    },
}

# ─── EMG serial reader ────────────────────────────────────────────────────────
# Rolling buffer stores {"t": sample_index, "v": voltage} dicts
EMG_BUFFER: deque = deque(maxlen=300)   # ~3 s at 100 Hz
_emg_thread: Optional[threading.Thread] = None
_emg_stop:   threading.Event = threading.Event()
_emg_lock:   threading.Lock  = threading.Lock()
_sample_idx: int = 0


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

    while not stop_event.is_set():
        try:
            raw_line = ser.readline()
            if not raw_line:
                continue                        # timeout — no data yet
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line:
                continue

            # ── Parse the sample ─────────────────────────────────────────────
            # The BioAmp EXG Pill sketch may send:
            #   • A single integer ADC value — most common
            #   • A float already scaled in mV
            #   • CSV "timestamp,value" — take the last column
            # Adjust the parsing below to match your sketch.
            try:
                parts = line.split(",")
                raw = float(parts[-1])
            except ValueError:
                continue                        # skip unparseable lines

            # Optional: convert raw ADC → centred voltage
            # If your sketch already outputs mV, comment out this line:
            voltage = (raw / 1023.0) * 5.0 - 2.5   # 10-bit, 5 V supply

            with _emg_lock:
                EMG_BUFFER.append({"t": _sample_idx, "v": round(voltage, 4)})
                _sample_idx += 1

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
    _stop_emg_reader()                      # stop any existing thread
    _emg_stop = threading.Event()
    _sample_idx = 0
    with _emg_lock:
        EMG_BUFFER.clear()
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
    return [
        {"port": p.device, "description": p.description, "hwid": p.hwid}
        for p in list_ports.comports()
    ]

def _try_open_port(port: str, baud: int) -> Optional[str]:
    """Open and immediately close the port — just verifying it's accessible."""
    if not SERIAL_AVAILABLE:
        return "pyserial not installed — run: pip install pyserial"
    try:
        s = serial.Serial(port, baud, timeout=1)
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
        # 2) Port exists but can't be opened (another process grabbed it or device changed)
        err = _try_open_port(port, state["baud"])
        if err:
            if node == "emg":
                _stop_emg_reader()
            connection_state[node].update({
                "status": "error", "port": None, "error": err
            })
            _add_log("ERROR", f"{state['device']} health-check failed on {port}: {err}")


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

    return {"status": "ok", "node": node, "connections": connection_state}


@app.post("/ports/disconnect")
def disconnect_node(body: ConnectRequest):
    node = body.node.lower()
    if node not in connection_state:
        return {"status": "error", "message": f"Unknown node '{node}'"}

    if node == "emg":
        _stop_emg_reader()

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
