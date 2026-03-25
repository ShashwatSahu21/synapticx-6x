/*
  SynapticX 6X — Unified Firmware (PCA9685 Version)
  Optimized for low latency.
  
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
#define SERVOMIN  150 
#define SERVOMAX  600 

const int emgPin = A0;

// Config for non-blocking timing
unsigned long lastSampleTime = 0;
const unsigned long sampleInterval = 2000; // 2000 microseconds = 2ms (500Hz)

// Buffer for incoming serial data
const byte numChars = 64;
char receivedChars[numChars];
boolean newData = false;

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
}

void loop() {
  // 1. Read incoming serial non-blocking
  recvWithEndMarker();
  
  // 2. Process incoming commands without blocking the loop
  if (newData) {
    parseServoCommand();
    newData = false;
  }
  
  // 3. Read and Send EMG non-blocking at fixed interval
  unsigned long currentMicros = micros();
  // We use subtraction here to handle millis/micros rollover perfectly
  if (currentMicros - lastSampleTime >= sampleInterval) {
    lastSampleTime = currentMicros;
    int emgRaw = analogRead(emgPin);
    Serial.println(emgRaw);
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
  
  strtokIndx = strtok(receivedChars, ","); // First parsing
  while (strtokIndx != NULL && servoIdx < 6) {
    int angle = atoi(strtokIndx); // fast ASCII to INT conversion
    angle = constrain(angle, 0, 180);
    
    int pulse = map(angle, 0, 180, SERVOMIN, SERVOMAX);
    pwm.setPWM(servoIdx, 0, pulse);
    
    servoIdx++;
    strtokIndx = strtok(NULL, ","); // Continue parsing
  }
}
