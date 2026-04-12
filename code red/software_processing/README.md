# Robotic Arm Controller - Processing Version

A Processing-based GUI application to control your 6-DOF robotic arm.

## Requirements

- Processing 3.0 or higher (download from [processing.org](https://processing.org/download/))
- Serial library (usually included with Processing)

## Installation

1. Download and install Processing from [processing.org](https://processing.org/download/)

2. Open Processing and verify the Serial library is available:
   - Go to `Sketch > Import Library > Serial`
   - If not available, go to `Sketch > Import Library > Add Library` and search for "Serial"

3. Open the sketch:
   - In Processing, go to `File > Open`
   - Navigate to `RoboticArmController` folder
   - Open `RoboticArmController.pde`

## Usage

1. Connect your Arduino to your computer via USB

2. Upload the firmware (`firmware/firmware/firmware.ino`) to your Arduino

3. Run the Processing sketch (click the Play button)

4. Click "Refresh" to scan for COM ports

5. Select your COM port (it will show in the top-left)

6. Click "Connect"

7. Use the sliders to control each servo:
   - Click and drag the slider handles
   - Servos move in real-time as you drag

8. Use buttons:
   - **Center All**: Sets all servos to 90 degrees
   - **Send All**: Resends current positions to all servos

## Features

- **6 Servo Controls**: Visual sliders for each servo
- **Real-time Control**: Immediate response when dragging sliders
- **Auto-detection**: Scans for available COM ports
- **Visual Feedback**: Shows current angle for each servo
- **Quick Actions**: Center all servos with one click

## Troubleshooting

- **No COM ports found**: Click "Refresh" or check Device Manager
- **Connection fails**: Make sure Arduino is connected and no other program is using the port
- **Servos not moving**: Verify firmware is uploaded and correct COM port is selected
- **Library errors**: Make sure Serial library is installed (usually comes with Processing)

## Customization

You can modify the code to:
- Change default positions
- Add preset positions
- Adjust slider ranges
- Add inverse kinematics
- Change colors and layout

## Notes

- The Processing version is similar to the original software but simpler and more customizable
- Both Python and Processing versions use the same communication protocol
- Choose the one you're more comfortable with!

