# Robotic Arm Software Analysis

## Software Overview

The control software is a **Processing-based Java application** that communicates with the Arduino via serial port.

### Key Components:
- **Main Application**: `RoboticArm2024PROCESSING_English_.exe` / `RoboticArm2024PROCESSING_English_.jar`
- **Serial Library**: `jssc.jar` (Java Simple Serial Connector)
- **GUI Libraries**: 
  - `controlP5.jar` - GUI controls
  - `G4P.jar` - GUI elements
  - `core.jar` - Processing core
- **Graphics**: JOGL (Java OpenGL) libraries for 3D visualization

## Expected Communication Protocol (Based on Original Firmware)

### Command Format:
```
<servo_index>:<angle_value>\n
```

**Examples:**
- `1:90` - Move servo 1 to 90 degrees
- `2:120` - Move servo 2 to 120 degrees
- `5:45` - Move servo 5 to 45 degrees (also moves servo 6 to 135°)

### Protocol Details:
- **Baud Rate**: 9600
- **Terminator**: Newline (`\n`) or Carriage Return + Newline (`\r\n`)
- **Servo Indexes**: 1-6 (mapped to servos 0-5 in code)
- **Angle Range**: 0-180 degrees
- **Command Structure**: `index:angle` format

### Servo Mapping (Original Firmware):
- Index 1 → Servo 0 (Base)
- Index 2 → Servo 1 (Shoulder)
- Index 3 → Servo 2 (Elbow)
- Index 4 → Servo 3 (Wrist Rotation)
- Index 5 → Servo 4 (Wrist Pitch) + Servo 6 (Mirrored, 180-angle)
- Index 6 → Servo 5 (Gripper)

## Potential Issues & What to Check

### 1. **Serial Port Connection**
- Software may auto-detect COM port or require manual selection
- Check if software shows available COM ports
- Verify Arduino is connected and recognized by Windows

### 2. **Handshake/Initialization**
- Software might expect a startup message or acknowledgment
- Original firmware didn't send anything on startup (just listened)
- Some software expects "Ready" or similar message

### 3. **Command Format Variations**
The software might send:
- `1:90\n` (newline only)
- `1:90\r\n` (CR+LF)
- `1,90\n` (comma instead of colon)
- `1 90\n` (space instead of colon)
- Binary format (unlikely but possible)

### 4. **Response Expectations**
- Software might expect acknowledgment after each command
- Some control software wait for "OK" or similar response
- No response might cause software to timeout or disconnect

### 5. **Multiple Commands**
- Software might send multiple commands in one packet
- Format might be: `1:90,2:120,3:45\n`
- Or: `1:90\n2:120\n3:45\n`

### 6. **Baud Rate Mismatch**
- Verify software uses 9600 baud
- Some software allow baud rate selection in settings

## Current Firmware Status

The modified firmware (`firmware/firmware/firmware.ino`) currently:
- ✅ Uses PCA9685 driver (compatible with your hardware)
- ✅ Expects `index:angle` format
- ✅ Handles both `\n` and `\r\n` terminators
- ✅ Sends "OK" acknowledgment after each command
- ✅ Has detailed debugging output showing every received byte
- ✅ Includes timeout handling for commands without newlines
- ✅ Sends startup message: "RoboticArm2024 Ready"

## Next Steps for Debugging

1. **Run the software with Serial Monitor open** to see what it actually sends
2. **Check the Serial Monitor output** when you try to control from software:
   - Look for `[RX]` lines showing received bytes
   - Note the exact format of commands
   - Check if commands are being received at all

3. **Common Issues to Verify**:
   - Is the COM port correct in the software?
   - Is the baud rate 9600?
   - Are commands being sent? (check `[RX]` debug output)
   - What format are the commands? (hex dump will show this)

4. **If no data is received**:
   - Software might not be connecting to the port
   - Port might be locked by Serial Monitor (close it)
   - Software might be looking for a different device name

5. **If data is received but format is different**:
   - Note the exact format from debug output
   - Firmware can be modified to match the actual protocol

## Expected Serial Monitor Output

When software sends a command, you should see:
```
[RX] 0x31 ('1')
[RX] 0x3A (':')
[RX] 0x39 ('9')
[RX] 0x30 ('0')
[RX] 0x0A (\n)
Processing command: '1:90'
OK
```

This will help identify:
- Exact byte sequence
- Delimiter used (`:` vs `,` vs space)
- Terminator used (`\n` vs `\r\n`)
- Any special characters or binary data

