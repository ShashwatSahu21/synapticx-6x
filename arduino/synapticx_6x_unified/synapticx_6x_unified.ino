
#include <Adafruit_PWMServoDriver.h>
#include <Wire.h>

// --- Config ---
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();

// Servo pulse mapping (50Hz) - Calibrated for SG90/MG996R true 180 deg motion
#define SERVOMIN 125 // Approx 0.6ms
#define SERVOMAX 500 // Approx 2.4ms

// Buffer for incoming serial data
const byte numChars = 64;
char receivedChars[numChars];
boolean newData = false;

void setup() {
  Serial.begin(115200);

  // Initialize PCA9685
  pwm.begin();
  pwm.setPWMFreq(50);    // Standard servos run at 50Hz
  Wire.setClock(400000); // 400kHz Fast I2C to reduce latency!

  // Set all to 90 degrees initially (channels 0-5)
  for (int i = 0; i < 6; i++) {
    int pulse = map(90, 0, 180, SERVOMIN, SERVOMAX);
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
      int angle = constrain(tempAngles[i], 0, 180);
      int pulse = map(angle, 0, 180, SERVOMIN, SERVOMAX);
      pwm.setPWM(i, 0, pulse);
    }
  }
}
