# Robotic Arm Controller - Python GUI

A simple, user-friendly GUI application to control your 6-DOF robotic arm via serial communication.

## Features

- **6 Servo Controls**: Individual sliders for each servo (Base, Shoulder, Elbow, Wrist Rotation, Wrist Pitch, Gripper)
- **Real-time Control**: Move sliders to control servos in real-time
- **Auto-connect**: Automatically detects available COM ports
- **Manual Commands**: Send commands directly using `index:angle` format
- **Quick Actions**: Center all servos or set home position with one click
- **Visual Feedback**: Shows current angle for each servo

## Requirements

- Python 3.6 or higher
- pyserial library

## Installation

1. Install Python 3.6+ from [python.org](https://www.python.org/downloads/)

2. Install required library:
```bash
pip install -r requirements.txt
```

Or directly:
```bash
pip install pyserial
```

## Usage

1. Connect your Arduino to your computer via USB

2. Upload the firmware (`firmware/firmware/firmware.ino`) to your Arduino

3. Run the controller:
```bash
python robotic_arm_controller.py
```

4. Select your COM port from the dropdown (click "Refresh" if needed)

5. Click "Connect"

6. Use the sliders to control each servo, or type commands manually

## Command Format

The software uses the same protocol as your firmware:
- Format: `index:angle`
- Example: `1:90` moves servo 1 to 90 degrees
- Servo indexes: 1-6
- Angle range: 0-180 degrees

## Troubleshooting

- **COM port not showing**: Click "Refresh" or check Device Manager
- **Connection fails**: Make sure Arduino is connected and no other program is using the port (close Serial Monitor)
- **Servos not moving**: Check that firmware is uploaded and COM port is correct
- **Permission errors (Linux/Mac)**: You may need to add your user to the dialout group:
  ```bash
  sudo usermod -a -G dialout $USER
  ```
  Then log out and back in.

## Customization

You can easily modify the code to:
- Change default positions
- Add preset positions
- Save/load configurations
- Add inverse kinematics
- Record and playback movements

