#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();

// Pulse bounds for your servos on the PCA9685 (adjust if required)
const uint16_t SERVO_MIN = 150;  // ~500 µs
const uint16_t SERVO_MAX = 600;  // ~2500 µs

const uint8_t CHANNEL_BASE       = 0; // Servo 1
const uint8_t CHANNEL_SHOULDER   = 1; // Servo 2
const uint8_t CHANNEL_ELBOW      = 2; // Servo 3
const uint8_t CHANNEL_WRIST_ROT  = 3; // Servo 4
const uint8_t CHANNEL_WRIST_PITCH= 4; // Servo 5
const uint8_t CHANNEL_GRIPPER    = 5; // Servo 6
const uint8_t CHANNEL_GRIPPER_MIRROR = 6; // Optional mirrored linkage

inline int clampAngle(int angle) {
  if (angle < 0)   return 0;
  if (angle > 180) return 180;
  return angle;
}

void writeServo(uint8_t channel, int angleDeg) {
  angleDeg = clampAngle(angleDeg);
  uint16_t pulse = map(angleDeg, 0, 180, SERVO_MIN, SERVO_MAX);
  pwm.setPWM(channel, 0, pulse);
}

void setup() {
  Serial.begin(9600); // Initialize serial communication
  // Don't wait for Serial on non-native USB boards (Arduino Uno, etc.)
  // This would block forever on boards without native USB
  // while (!Serial) { /* wait for native USB boards */ }

  pwm.begin();
  pwm.setPWMFreq(60); // Standard servo frequency (50-60Hz)

  // Move everything to neutral at power-up
  writeServo(CHANNEL_BASE,        90);
  writeServo(CHANNEL_SHOULDER,    90);
  writeServo(CHANNEL_ELBOW,       90);
  writeServo(CHANNEL_WRIST_ROT,   90);
  writeServo(CHANNEL_WRIST_PITCH, 90);
  writeServo(CHANNEL_GRIPPER,     90);
  writeServo(CHANNEL_GRIPPER_MIRROR, 90);

  Serial.println(F("Ready: send commands in the form '<index>:<angle>' (e.g., 1:90)"));
  Serial.println(F("RoboticArm2024 Ready"));
  delay(100); // Give software time to detect
}

void handleCommand(const String& input) {
  String trimmed = input;
  trimmed.trim();
  if (trimmed.length() == 0) {
    return;
  }

  Serial.print(F("Processing command: '"));
  Serial.print(trimmed);
  Serial.println(F("'"));

  int separator = trimmed.indexOf(':');
  if (separator < 0) {
    Serial.println(F("Invalid format. Use '<index>:<angle>'"));
    return;
  }

  int servoIndex = trimmed.substring(0, separator).toInt(); // Get the servo index
  int servoValue = trimmed.substring(separator + 1).toInt(); // Get the servo value
  servoValue = clampAngle(servoValue);

  switch (servoIndex) {
    case 1:
      writeServo(CHANNEL_BASE, servoValue);
      break;
    case 2:
      writeServo(CHANNEL_SHOULDER, servoValue);
      break;
    case 3:
      writeServo(CHANNEL_ELBOW, servoValue);
      break;
    case 4:
      writeServo(CHANNEL_WRIST_ROT, servoValue);
      break;
    case 5:
      writeServo(CHANNEL_WRIST_PITCH, servoValue);
      writeServo(CHANNEL_GRIPPER_MIRROR, 180 - servoValue);
      break;
    case 6:
      writeServo(CHANNEL_GRIPPER, servoValue);
      break;
    default:
      Serial.println(F("Invalid servo index (use 1-6)."));
      break;
  }
}

void loop() {
  static String buffer;
  static unsigned long lastByteTime = 0;
  const unsigned long TIMEOUT_MS = 100; // If no data for 100ms, process buffer

  while (Serial.available() > 0) {
    char c = Serial.read();
    lastByteTime = millis();
    
    // Enhanced debugging: show raw bytes
    Serial.print(F("[RX] 0x"));
    if ((uint8_t)c < 0x10) Serial.print('0');
    Serial.print((uint8_t)c, HEX);
    Serial.print(F(" ("));
    if (isPrintable(c) && c != '\n' && c != '\r') {
      Serial.print(c);
    } else if (c == '\n') {
      Serial.print(F("\\n"));
    } else if (c == '\r') {
      Serial.print(F("\\r"));
    } else {
      Serial.print(F("?"));
    }
    Serial.println(F(")"));

    if (c == '\n' || c == '\r') {
      if (buffer.length() > 0) {
        handleCommand(buffer);
        // Send acknowledgment back (some software expects this)
        Serial.println(F("OK"));
        buffer = "";
      }
    } else {
      buffer += c;
      // Avoid runaway buffer
      if (buffer.length() > 64) {
        Serial.println(F("ERROR: Buffer overflow"));
        buffer = "";
      }
    }
  }

  // Process buffer if timeout (in case software doesn't send newlines)
  if (buffer.length() > 0 && (millis() - lastByteTime > TIMEOUT_MS)) {
    Serial.println(F("[TIMEOUT] Processing incomplete buffer:"));
    Serial.print(F("Buffer content: '"));
    Serial.print(buffer);
    Serial.println(F("'"));
    handleCommand(buffer);
    Serial.println(F("OK"));
    buffer = "";
  }
}
