/*
  SynapticX 6X — Unified Firmware (PCA9685 Version)
  
  Connections:
  - BioAmp EXG Pill (EMG) -> A0
  - PCA9685 Servo Driver:
    - SDA -> A4
    - SCL -> A5
    - VCC -> 5V
    - GND -> GND
  
  Baud rate: 115200
  Requires "Adafruit PWM Servo Driver Library" in Arduino IDE.
*/

#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

// --- Config ---
Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();

// Servo pulse mapping (50Hz)
// Standard 0-180 servos usually take 150 to 600 pulse length on PCA9685
#define SERVOMIN  150 
#define SERVOMAX  600 

const int emgPin = A0;

// --- State ---
String inputString = "";
bool stringComplete = false;

void setup() {
  Serial.begin(115200);
  
  // Initialize PCA9685
  pwm.begin();
  pwm.setPWMFreq(50); // Standard servos run at 50Hz
  
  // Set all to 90 degrees initially (channels 0-5)
  for (int i=0; i<6; i++) {
    int pulse = map(90, 0, 180, SERVOMIN, SERVOMAX);
    pwm.setPWM(i, 0, pulse);
  }
  
  inputString.reserve(100);
}

void loop() {
  // 1. Read and Send EMG (BioAmp EXG)
  int emgRaw = analogRead(emgPin);
  Serial.println(emgRaw);
  
  // 2. Process incoming commands
  if (stringComplete) {
    parseServoCommand(inputString);
    inputString = "";
    stringComplete = false;
  }
  
  delay(2); // ~500Hz sampling loop
}

void serialEvent() {
  while (Serial.available()) {
    char inChar = (char)Serial.read();
    inputString += inChar;
    if (inChar == '\n') {
      stringComplete = true;
    }
  }
}

void parseServoCommand(String cmd) {
  int lastIndex = 0;
  int servoIdx = 0;
  
  for (int i = 0; i < cmd.length(); i++) {
    if (cmd[i] == ',' || cmd[i] == '\n') {
      String valStr = cmd.substring(lastIndex, i);
      int angle = valStr.toInt();
      
      if (servoIdx < 6) {
        angle = constrain(angle, 0, 180);
        int pulse = map(angle, 0, 180, SERVOMIN, SERVOMAX);
        pwm.setPWM(servoIdx, 0, pulse);
        servoIdx++;
      }
      lastIndex = i + 1;
    }
  }
}
