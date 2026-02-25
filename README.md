# SynapticX 6X — Neural Augmented Robotic Arm Interface

> A real-time EMG signal tracking and robotic arm control interface powered by BioAmp EXG Pill and Arduino.

---

## 🎥 Demo

<!-- Add your demo video here -->
> **Replace the placeholder below with a real screenshot or GIF of your dashboard**

![Dashboard Preview](media/dashboard.png)

---

## 📹 Working Arm in Action

<!-- Drop your videos/images into the media/ folder and link them here -->

| Description | Media |
|-------------|-------|
| Full arm demo | ![Arm Demo](media/arm_demo.gif) |
| EMG signal tracking | ![EMG Signal](media/emg_signal.png) |
| Servo calibration | ![Servo Control](media/servo_control.png) |

> 📂 **To add your own media:** Place images/videos in the `media/` folder at the root of this repo, then update the table above.

---

## 🧠 What is This?

SynapticX 6X is a full-stack interface for:
- **Reading real-time EMG (electromyography) signals** from the [BioAmp EXG Pill](https://github.com/upsidedownlabs/BioAmp-EXG-Pill) sensor
- **Manually controlling a 6-DOF robotic arm** with servo sliders
- **Tracking hardware connections** (COM port detection, connect/disconnect per device)
- **Visualising live frequency content** of the EMG signal captured over serial

---

## 🛠️ Hardware Required

| Component | Purpose |
|-----------|---------|
| [BioAmp EXG Pill](https://github.com/upsidedownlabs/BioAmp-EXG-Pill) | EMG signal acquisition |
| Arduino Uno / Nano | Serial output + servo control |
| 6× Servo motors (e.g. SG90 / MG996R) | Robotic arm DOFs |
| USB cables | PC ↔ Arduino communication |
| 3D printed / physical arm frame | Mechanical structure |

---

## 🖥️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + Tailwind CSS + Recharts |
| Backend  | Python FastAPI + pyserial |
| Serial   | pyserial (real COM port access) |
| State    | In-memory (no database) |

---

## 📂 Project Structure

```
synapticx-6x/
├── backend/
│   ├── main.py              # FastAPI server — serial reader, servo API, COM port management
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ConnectionPanel.jsx   # COM port manager (EMG + Arduino)
│   │   │   ├── NeuralGraph.jsx       # Live EMG waveform graph
│   │   │   ├── ServoControl.jsx      # 6-DOF manual servo sliders
│   │   │   ├── SystemStatus.jsx      # Hardware status + real latency
│   │   │   ├── SystemLogs.jsx        # Real-time telemetry log panel
│   │   │   ├── Diagnostics.jsx       # Hardware diagnostics page
│   │   │   └── Config.jsx            # Serial + ADC configuration page
│   │   ├── api.js                    # All backend API calls
│   │   └── App.jsx                   # Root layout + navigation
│   ├── package.json
│   └── tailwind.config.js
└── media/                     # ← Put your screenshots and videos here
```

---

## 🚀 Getting Started

### 1. Install backend dependencies
```bash
cd backend
pip install -r requirements.txt
```

### 2. Start the backend
```bash
uvicorn main:app --reload --port 8000
```

### 3. Install frontend dependencies
```bash
cd frontend
npm install
```

### 4. Start the frontend
```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## 🔌 Connecting Hardware

1. Plug in your **BioAmp EXG Pill** (via Arduino) and **Arduino ARM** via USB
2. Open the **Connection Manager** panel at the top of the Dashboard
3. Click **Refresh Ports** to scan for available COM ports
4. Select the correct port for each device and click **Connect**
5. The EMG graph will start showing a live waveform once data flows in

> ⚠️ The backend actually opens the serial port to verify the connection — selecting a port with nothing connected will show **Error**, not a fake "Connected" state.

---

## ⚙️ Configuration

Go to the **Config** tab to set:
- **Baud rates** for BioAmp EXG Pill and Arduino ARM
- **ADC board preset** (Arduino Uno 10-bit 5V, ESP32 12-bit 3.3V, etc.)
- **Voltage conversion formula** (auto-updated based on your settings)
- **Buffer size** (how many samples are kept in memory)

---

## 📡 Arduino Sketch (BioAmp EXG Pill)

Your Arduino sketch should print one ADC reading per line at the configured baud rate:

```cpp
void setup() {
  Serial.begin(115200);
}

void loop() {
  int val = analogRead(A0);   // BioAmp EXG Pill connected to A0
  Serial.println(val);
  delayMicroseconds(1000);    // ~1000 Hz sample rate (adjust as needed)
}
```

The backend converts raw ADC → voltage automatically:
```
V = (raw / 1023) × 5.0V − 2.5V
```
Change the formula in `backend/main.py` if your sketch outputs different data.

---

## 📸 Adding Your Own Media

1. Create a `media/` folder in the repo root
2. Add your screenshots, GIFs, and videos there
3. Update the **Working Arm in Action** table at the top of this README

```
media/
├── dashboard.png       ← Screenshot of the web dashboard
├── arm_demo.gif        ← GIF of the arm moving
├── emg_signal.png      ← Screenshot of live EMG waveform
└── servo_control.png   ← Screenshot of servo panel
```

For videos too large for GitHub, upload to YouTube and embed the thumbnail:
```markdown
[![Watch Demo](media/thumbnail.png)](https://youtu.be/YOUR_VIDEO_ID)
```

---

## 🧩 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/ports` | List all detected COM ports |
| `POST` | `/ports/connect` | Connect a node (emg/arm) to a port |
| `POST` | `/ports/disconnect` | Disconnect a node |
| `GET`  | `/neural-data` | Live EMG buffer from BioAmp |
| `GET`  | `/system-status` | Active servos + connection state |
| `POST` | `/servo/update` | Update one or more servo angles |
| `GET`  | `/logs` | Last 50 system log entries |

---

## 📄 License

MIT — free to use, modify and share.

---

## 👤 Author

**Shashwat Sahu** — [@ShashwatSahu21](https://github.com/ShashwatSahu21)
