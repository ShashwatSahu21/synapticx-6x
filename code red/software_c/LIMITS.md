# Application Limits and Constraints

This document lists all limits, constraints, and boundaries in the Robotic Arm Controller application.

## Servo Control Limits

### Angle Range
- **Minimum Angle**: 0 degrees
- **Maximum Angle**: 180 degrees
- **Default Position**: 90 degrees (center)
- **Precision**: 1 degree increments

### Number of Servos
- **Fixed**: 6 servos (Base, Shoulder, Elbow, Wrist Rotation, Wrist Pitch, Gripper)
- **Servo Indexes**: 1-6 (mapped to channels 0-5 on PCA9685)

## Movement Control Limits

### Speed Control
- **Minimum Speed**: 1% (slowest, ~100ms per step)
- **Maximum Speed**: 100% (fastest, ~5ms per step)
- **Default Speed**: 50% (~55ms per step)
- **Speed Range**: 1-100 (slider range)

### Angle Step (Smooth Movement)
- **Minimum Step**: 1 degree
- **Maximum Step**: 10 degrees
- **Default Step**: 1 degree
- **Note**: Smaller steps = smoother but slower movement

### Smooth Movement Delay
- **Minimum Delay**: 5ms per step (at speed 100%)
- **Maximum Delay**: 100ms per step (at speed 1%)
- **Formula**: `delay = 105 - speed` (in milliseconds)

## Serial Communication Limits

### Buffer Sizes
- **Input Buffer**: 4096 bytes (4KB)
- **Output Buffer**: 4096 bytes (4KB)
- **Buffer Clear Threshold**: 100 bytes (when output queue exceeds this, buffer is cleared)

### Timeouts
- **Read Interval Timeout**: 50ms
- **Read Total Timeout Constant**: 50ms
- **Read Total Timeout Multiplier**: 10ms
- **Write Total Timeout Constant**: 200ms
- **Write Total Timeout Multiplier**: 10ms

### Retry Logic
- **Maximum Retries**: 3 attempts per command
- **Retry Delay**: 5-10ms between retries
- **Error Handling**: Retries on transient errors, disconnects on critical errors

### Command Throttling
- **Minimum Time Between Commands**: 20ms
- **Purpose**: Prevents overwhelming the Arduino with too many commands

## String and Buffer Limits

### Command String
- **Maximum Length**: 32 characters
- **Format**: `"index:angle\n"` (e.g., "1:90\n")
- **Typical Length**: 5-6 characters

### Port Name
- **Maximum Length**: 32 characters
- **Format**: "COM1" to "COM256"

### Servo Name
- **Maximum Length**: 32 characters per servo

### Status Messages
- **Maximum Length**: 64-128 characters

## UI Limits

### Window Size
- **Width**: 500 pixels
- **Height**: 520 pixels
- **Resizable**: No (fixed size)

### Slider Controls
- **Range**: 0-180 degrees
- **Tick Frequency**: Every 30 degrees
- **Line Size**: 1 degree (arrow keys)
- **Page Size**: 5 degrees (Page Up/Down)

### Speed Slider
- **Range**: 1-100
- **Tick Frequency**: Every 20 units

## Hardware Constraints

### PCA9685 Driver
- **Channels**: 0-15 (using 0-5 for 6 servos)
- **PWM Frequency**: 60 Hz
- **Pulse Width Range**: 150-600 (corresponds to 0-180 degrees)
  - **150**: ~500µs (0 degrees)
  - **600**: ~2500µs (180 degrees)
  - **375**: ~1500µs (90 degrees, center)

### Arduino Communication
- **Baud Rate**: 9600 (fixed)
- **Data Bits**: 8
- **Stop Bits**: 1
- **Parity**: None
- **Flow Control**: None

## Performance Limits

### Smooth Movement
- **Maximum Steps**: 180 steps (for full 0-180 degree movement with 1-degree steps)
- **Maximum Duration**: ~18 seconds (at speed 1%, 1-degree steps)
- **Minimum Duration**: ~0.9 seconds (at speed 100%, 1-degree steps)

### Command Rate
- **Maximum Commands/Second**: ~50 commands/second (with 20ms throttle)
- **Typical Rate**: 10-20 commands/second (during smooth movement)

## Error Handling Limits

### Connection Monitoring
- **Error Check**: Before every command send
- **Error Types Monitored**: 
  - CE_BREAK, CE_FRAME, CE_IOE, CE_MODE
  - CE_OVERRUN, CE_RXOVER, CE_RXPARITY, CE_TXFULL

### Disconnection Conditions
- Invalid handle errors
- Bad command errors
- Port access failures
- Critical communication errors

## Notes

1. **Angle Step**: Can be adjusted in UI (1-10 degrees), but 1 degree provides smoothest movement
2. **Speed**: Higher speeds may cause servos to overshoot or jitter if they can't keep up
3. **Buffer Sizes**: 4KB buffers should handle extended operation without overflow
4. **Timeouts**: 200ms write timeout allows for slow Arduino responses
5. **Retries**: 3 retries should handle most transient communication errors

## Recommendations

- **For Smooth Movement**: Use speed 30-70%, angle step 1-2 degrees
- **For Fast Movement**: Use speed 80-100%, angle step 3-5 degrees
- **For Precision**: Use speed 20-40%, angle step 1 degree
- **For Stability**: Keep speed below 80% to prevent servo jitter

