# Troubleshooting Guide - Bot Not Moving

## Issues Found and Fixed:

### 1. **Slider Commands Not Sending During Drag**
   - **Problem**: When smooth movement was enabled, commands were only sent when the slider was released, not while dragging
   - **Fix**: Now commands are sent during drag (TB_THUMBTRACK) even with smooth movement enabled

### 2. **Command Throttling Too Aggressive**
   - **Problem**: 20ms throttle was too slow for responsive control
   - **Fix**: Reduced to 10ms for more responsive updates

### 3. **Connection Initialization**
   - **Problem**: Arduino startup messages might interfere with first commands
   - **Fix**: Added buffer clearing after connection and before sending initial positions

## How to Test:

1. **Check Connection**:
   - Make sure the COM port is correct
   - Status should show "Connected to COMx" in green
   - If not connected, disconnect and reconnect

2. **Test Manual Commands**:
   - Try typing `1:90` in the manual command box and click Send
   - Check Arduino Serial Monitor - you should see "Processing command: '1:90'"
   - If you see this, the communication is working

3. **Test Sliders**:
   - Move a slider - the bot should move immediately
   - If smooth movement is ON, it will move smoothly
   - If smooth movement is OFF, it will move directly

4. **Check Serial Monitor**:
   - Open Arduino Serial Monitor at 9600 baud
   - You should see:
     - "RoboticArm2024 Ready" on startup
     - "[RX] 0x..." messages when commands are received
     - "Processing command: 'X:Y'" when commands are processed
     - "OK" after each command

## Common Issues:

### Bot Still Not Moving?

1. **Check Hardware**:
   - Is the PCA9685 connected to Arduino (SDA, SCL, VCC, GND)?
   - Are servos connected to PCA9685 channels 0-5?
   - Is power supply adequate for all servos?

2. **Check Firmware**:
   - Is the correct firmware uploaded? (firmware.ino or firmware_smooth.ino)
   - Does Serial Monitor show "RoboticArm2024 Ready"?
   - Are there any error messages?

3. **Check Software**:
   - Is the correct COM port selected?
   - Does the status show "Connected"?
   - Try the "Center All" button - all servos should move to 90 degrees

4. **Test Direct Serial**:
   - Open Serial Monitor
   - Type `1:90` and press Enter
   - The first servo should move
   - If this works, the problem is in the GUI software
   - If this doesn't work, the problem is in the firmware or hardware

## Debug Steps:

1. **Enable Serial Monitor** on Arduino IDE (9600 baud)
2. **Move a slider** in the GUI
3. **Watch Serial Monitor** - you should see:
   - `[RX] 0x31 0x3A 0x39 0x30 0x0A` (for "1:90\n")
   - `Processing command: '1:90'`
   - `OK`

If you see the RX messages but no "Processing command", the firmware isn't parsing correctly.
If you don't see RX messages, the GUI isn't sending commands.

## Quick Fixes:

- **If nothing happens**: Uncheck "Smooth Movement" checkbox and try again
- **If commands are slow**: Reduce the speed slider
- **If connection drops**: Disconnect and reconnect
- **If servos jitter**: Increase the command throttle time

