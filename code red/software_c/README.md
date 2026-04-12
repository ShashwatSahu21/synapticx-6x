# Robotic Arm Controller - C Version

A native Windows C application to control your 6-DOF robotic arm via serial communication.

## Features

- **Native Windows Application**: Fast and responsive
- **6 Servo Controls**: Individual sliders for each servo
- **Real-time Control**: Move sliders to control servos instantly
- **Auto Port Detection**: Scans for available COM ports
- **Manual Commands**: Send commands directly using `index:angle` format
- **No Dependencies**: Standalone executable

## Compilation

### Option 1: Using MinGW (Recommended)

1. Install MinGW-w64 from [mingw-w64.org](https://www.mingw-w64.org/downloads/)

2. Open Command Prompt or PowerShell in this directory

3. Compile:
```bash
gcc -o robotic_arm_controller.exe robotic_arm_controller.c -lgdi32 -luser32 -lcomdlg32 -lcomctl32
```

### Option 2: Using Makefile

If you have `make` installed:
```bash
make
```

### Option 3: Using Visual Studio

1. Create a new Win32 Console Application project
2. Add `robotic_arm_controller.c` to the project
3. Link against: `gdi32.lib user32.lib comdlg32.lib comctl32.lib`
4. Change subsystem to Windows (not Console)
5. Build the project

## Usage

1. Connect your Arduino to your computer via USB

2. Upload the firmware (`firmware/firmware/firmware.ino`) to your Arduino

3. Run `robotic_arm_controller.exe`

4. Select your COM port from the dropdown

5. Click "Connect"

6. Use the sliders to control each servo

## Command Format

- Format: `index:angle`
- Example: `1:90` moves servo 1 to 90 degrees
- Servo indexes: 1-6
- Angle range: 0-180 degrees

## Advantages over Python Version

- **Faster**: Native compiled code, no interpreter overhead
- **More Responsive**: Direct Windows API calls
- **Smaller**: Single executable file, no dependencies
- **Stable**: No Python interpreter issues or freezing
- **Efficient**: Better memory management and threading

## Troubleshooting

- **Compilation errors**: Make sure you have MinGW installed and in your PATH
- **COM port not showing**: Click "Refresh" or check Device Manager
- **Connection fails**: Make sure Arduino is connected and no other program is using the port
- **Servos not moving**: Check that firmware is uploaded and COM port is correct

## Technical Details

- Uses Win32 API for GUI and serial communication
- Command throttling to prevent overwhelming Arduino (50ms minimum between commands)
- Automatic buffer management
- Proper serial port configuration (9600 baud, 8N1)
- Thread-safe command sending

## Building from Source

The application uses standard Windows APIs:
- `CreateFile` for serial port access
- `WriteFile` for sending commands
- Win32 controls (Trackbar, Button, ComboBox, Edit, Static)
- Common Controls library for sliders

No external libraries required beyond Windows SDK.

