/*
  SynapticX 6X — Mechanical Control Firmware (PCA9685 Version)
  Optimized for low latency mechanical input. Bio-signals removed for now.

  Connections:
  - PCA9685 Servo Driver:
    - SDA -> A4
    - SCL -> A5
    - VCC -> 5V
    - GND -> GND

  Baud rate: 115200
  Requires "Adafruit PWM Servo Driver Library" in Arduino IDE.

  SERVO RANGE: 0–270°
  Uses extended PWM pulse widths for 270° servos (e.g. DS3218, MG996R 270°).
  Includes torque-safe rate limiting to prevent motor damage.
*/

#include <Adafruit_PWMServoDriver.h>
#include <Wire.h>

// --- Config ---
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();

// Servo pulse mapping (50Hz) - Calibrated for 270° servo range
// Standard 180° servo: 0.5ms–2.4ms → 125–500 ticks at 50Hz
// Extended 270° servo: 0.5ms–2.5ms → 102–512 ticks at 50Hz
// These values should be fine-tuned per your exact servo model.
#define SERVOMIN  102   // ~0.5ms  = 0°
#define SERVOMAX  512   // ~2.5ms  = 270°
#define SERVO_MAX_ANGLE 270

// Torque protection: max degrees the servo can move per update cycle
// At ~50Hz update rate, this limits speed to ~250°/s — safe for most servos
#define MAX_STEP_PER_CYCLE 5

// Buffer for incoming serial data
const byte numChars = 64;
char receivedChars[numChars];
boolean newData = false;

// Current actual servo positions (for rate limiting)
int currentAngles[6] = {135, 135, 135, 135, 135, 135}; // Start at center (270/2)
int targetAngles[6]  = {135, 135, 135, 135, 135, 135};

void setup() {
  Serial.begin(115200);

  // Initialize PCA9685
  pwm.begin();
  pwm.setPWMFreq(50);    // Standard servos run at 50Hz
  Wire.setClock(400000); // 400kHz Fast I2C to reduce latency!

  // Set all to 135 degrees (center of 0–270 range) initially
  for (int i = 0; i < 6; i++) {
    int pulse = map(135, 0, SERVO_MAX_ANGLE, SERVOMIN, SERVOMAX);
    pwm.setPWM(i, 0, pulse);
  }
}

void loop() {
  // 1. Read incoming serial non-blocking
  recvWithEndMarker();

  // 2. Process incoming commands without blocking the loop
  if (newData) {
    parseServoCommand();
    newData = false;
  }

  // 3. Smoothly move servos toward target (torque-safe rate limiting)
  moveServosSmooth();
}

// Low latency serial receiver
void recvWithEndMarker() {
  static byte ndx = 0;
  char endMarker = '\n';
  char rc;

  // While data is available, read it. Keeps the buffer empty and responsive.
  while (Serial.available() > 0 && newData == false) {
    rc = Serial.read();

    if (rc != endMarker) {
      if (rc != '\r') { // Ignore carriage return if present
        receivedChars[ndx] = rc;
        ndx++;
        if (ndx >= numChars) {
          ndx = numChars - 1; // Prevent overflow
        }
      }
    } else {
      receivedChars[ndx] = '\0'; // terminate the C-string
      ndx = 0;
      newData = true;
    }
  }
}

// Fast string parsing
void parseServoCommand() {
  // Expect format: "90,90,90,90,90,90"
  char *strtokIndx;
  int servoIdx = 0;
  int tempAngles[6];

  strtokIndx = strtok(receivedChars, ","); // First parsing
  while (strtokIndx != NULL && servoIdx < 6) {
    tempAngles[servoIdx] = atoi(strtokIndx); // fast ASCII to INT conversion
    servoIdx++;
    strtokIndx = strtok(NULL, ","); // Continue parsing
  }

  // Only execute if we successfully read exactly 6 values!
  // This prevents random jumps or shuddering from dropped serial bytes
  if (servoIdx == 6) {
    for (int i = 0; i < 6; i++) {
      targetAngles[i] = constrain(tempAngles[i], 0, SERVO_MAX_ANGLE);
    }
  }
}

// Torque-safe smooth movement: moves servos incrementally toward their targets.
// This prevents sudden large jumps that could strip gears, stall motors,
// or cause brown-outs from excessive current draw.
void moveServosSmooth() {
  for (int i = 0; i < 6; i++) {
    if (currentAngles[i] != targetAngles[i]) {
      int diff = targetAngles[i] - currentAngles[i];

      // Clamp step size for torque protection
      if (abs(diff) > MAX_STEP_PER_CYCLE) {
        diff = (diff > 0) ? MAX_STEP_PER_CYCLE : -MAX_STEP_PER_CYCLE;
      }

      currentAngles[i] += diff;
      currentAngles[i] = constrain(currentAngles[i], 0, SERVO_MAX_ANGLE);

      int pulse = map(currentAngles[i], 0, SERVO_MAX_ANGLE, SERVOMIN, SERVOMAX);
      pwm.setPWM(i, 0, pulse);
    }
  }
}
