/*servo motor driver board control
  Home Page
*/

#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver srituhobby = Adafruit_PWMServoDriver();

// PCA9685 pulse bounds for typical hobby servos (adjust if needed)
#define servoMIN 150
#define servoMAX 600

// Wiggle around center to safely identify channels without hitting hard stops
const uint16_t centerPulse = (servoMIN + servoMAX) / 2;   // ~375 with defaults
const uint16_t wiggleDelta = 80;                          // small, safe motion
const uint16_t lowPulse = centerPulse - wiggleDelta;      // e.g. ~295
const uint16_t highPulse = centerPulse + wiggleDelta;     // e.g. ~455

const uint8_t firstChannel = 0;
const uint8_t lastChannel = 15; // PCA9685 supports 16 channels [0..15]

void printIntro() {
  Serial.println();
  Serial.println(F("=== PCA9685 Servo Channel Identifier ==="));
  Serial.println(F("This will wiggle each channel one-by-one so you can see"));
  Serial.println(F("which servo responds. Note the mapping as you go."));
  Serial.println();
  Serial.println(F("Instructions:"));
  Serial.println(F("1) Open Serial Monitor at 9600 baud."));
  Serial.println(F("2) For each channel, the servo (if connected) will wiggle."));
  Serial.println(F("3) Press Enter to advance to the next channel, or type 'q' then Enter to quit."));
  Serial.println();
}

// Wait for user to press Enter or 'q' to quit; returns true to continue, false to quit
bool waitForUserAdvance() {
  Serial.println(F("Press Enter to test next channel (or type 'q' then Enter to quit)."));
  while (true) {
    if (Serial.available() > 0) {
      int c = Serial.read();
      if (c == '\n' || c == '\r') {
        return true;  // continue
      }
      if (c == 'q' || c == 'Q') {
        // consume any remaining newline
        delay(10);
        while (Serial.available()) { Serial.read(); }
        return false; // quit
      }
      // consume rest of line to wait for newline
      while (Serial.available()) {
        int d = Serial.read();
        if (d == '\n' || d == '\r') break;
      }
      return true;
    }
  }
}

void wiggleChannel(uint8_t ch) {
  // Move to center first
  srituhobby.setPWM(ch, 0, centerPulse);
  delay(400);

  // Wiggle a few times
  for (uint8_t i = 0; i < 3; i++) {
    srituhobby.setPWM(ch, 0, highPulse);
    delay(350);
    srituhobby.setPWM(ch, 0, lowPulse);
    delay(350);
  }

  // Return to center
  srituhobby.setPWM(ch, 0, centerPulse);
  delay(300);
}

// Helper: set all channels in [first..last] to a given pulse
void setAll(uint8_t first, uint8_t last, uint16_t pulse) {
  for (uint8_t ch = first; ch <= last; ch++) {
    srituhobby.setPWM(ch, 0, pulse);
    delay(50);
  }
}

void setup() {
  Serial.begin(9600);
  while (!Serial) { /* wait for native USB boards */ }

  srituhobby.begin();
  srituhobby.setPWMFreq(60); // 50-60Hz typical for servos

  // Move all servos to "zero" (center) position first.
  // Adjust the channel range [0..5] if your servos are on different channels.
  const uint8_t activeFirst = 0;
  const uint8_t activeLast = 5; // 6-DOF default
  Serial.println(F("Centering all servos..."));
  setAll(activeFirst, activeLast, centerPulse);
  Serial.println(F("All servos centered to neutral."));

  // Move to extreme positions
  Serial.println(F("Moving all servos to MIN..."));
  setAll(activeFirst, activeLast, servoMIN);
  delay(1000);

  Serial.println(F("Moving all servos to MAX..."));
  setAll(activeFirst, activeLast, servoMAX);
  delay(1000);

  // Optional: return to center after testing extremes
  Serial.println(F("Returning all servos to center..."));
  setAll(activeFirst, activeLast, centerPulse);
  Serial.println(F("Extreme position test complete."));
}

void loop() {
  // Idle
}