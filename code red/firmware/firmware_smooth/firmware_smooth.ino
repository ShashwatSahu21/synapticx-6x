/*
 * Smooth Robotic Arm Controller - Arduino Uno/ESP32/ESP8266 Compatible
 * Implements trajectory planning with acceleration/deceleration curves
 * Similar to industrial robots (ABB-style smooth motion)
 * 
 * Compatible with:
 * - Arduino Uno/Nano (ATmega328P)
 * - ESP32
 * - ESP8266
 */

#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

// Board detection
#if defined(ESP32) || defined(ESP8266)
  #define IS_ESP_BOARD true
  #define SERIAL_BAUD 115200
  #define UPDATE_RATE_MS 20  // 50Hz for ESP (faster)
#else
  #define IS_ESP_BOARD false
  #define SERIAL_BAUD 9600   // Lower baud for Arduino Uno
  #define UPDATE_RATE_MS 30  // ~33Hz for Arduino Uno (slightly slower but still smooth)
#endif

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();

// Pulse bounds for servos on PCA9685
const uint16_t SERVO_MIN = 150;
const uint16_t SERVO_MAX = 600;

// Servo channel mapping
const uint8_t CHANNEL_BASE       = 0;
const uint8_t CHANNEL_SHOULDER   = 1;
const uint8_t CHANNEL_ELBOW      = 2;
const uint8_t CHANNEL_WRIST_ROT  = 3;
const uint8_t CHANNEL_WRIST_PITCH= 4;
const uint8_t CHANNEL_GRIPPER    = 5;
const uint8_t CHANNEL_GRIPPER_MIRROR = 6;

// Motion planning parameters
const float MAX_ACCELERATION = 50.0;  // degrees per second squared
const float MAX_VELOCITY = 90.0;      // degrees per second
const float MIN_VELOCITY = 5.0;       // minimum velocity to prevent stalling
// UPDATE_RATE_MS is defined above based on board type

// Current and target positions (in degrees)
float currentPos[6] = {90, 90, 90, 90, 90, 90};
float targetPos[6] = {90, 90, 90, 90, 90, 90};
float currentVel[6] = {0, 0, 0, 0, 0, 0};

// Motion state
bool isMoving = false;
unsigned long lastUpdateTime = 0;

// Trajectory planning structure
struct Trajectory {
    float startPos;
    float endPos;
    float distance;
    float maxVel;
    float accel;
    float decel;
    float accelTime;
    float constTime;
    float decelTime;
    float totalTime;
    bool active;
};

Trajectory trajectories[6];

// Helper function: clamp angle
inline float clampAngle(float angle) {
    if (angle < 0) return 0;
    if (angle > 180) return 180;
    return angle;
}

// Helper function: convert angle to pulse width
uint16_t angleToPulse(float angle) {
    angle = clampAngle(angle);
    return map((int)angle, 0, 180, SERVO_MIN, SERVO_MAX);
}

// Write servo position
void writeServo(uint8_t channel, float angleDeg) {
    uint16_t pulse = angleToPulse(angleDeg);
    pwm.setPWM(channel, 0, pulse);
}

// Calculate trajectory for smooth motion (trapezoidal velocity profile)
void calculateTrajectory(int servoIdx, float startPos, float endPos) {
    Trajectory& traj = trajectories[servoIdx];
    
    traj.startPos = startPos;
    traj.endPos = endPos;
    traj.distance = abs(endPos - startPos);
    
    if (traj.distance < 0.1) {
        traj.active = false;
        return;
    }
    
    // Calculate maximum velocity for this move (proportional to distance)
    // Longer moves can use higher velocity
    float distanceFactor = min(traj.distance / 90.0, 1.0);  // Normalize to 90 degrees
    traj.maxVel = MIN_VELOCITY + (MAX_VELOCITY - MIN_VELOCITY) * distanceFactor;
    
    // Acceleration and deceleration
    traj.accel = MAX_ACCELERATION;
    traj.decel = MAX_ACCELERATION;
    
    // Calculate times for trapezoidal profile
    // Time to accelerate to max velocity
    traj.accelTime = traj.maxVel / traj.accel;
    
    // Distance covered during acceleration
    float accelDist = 0.5 * traj.accel * traj.accelTime * traj.accelTime;
    
    // Distance covered during deceleration (same as acceleration)
    float decelDist = accelDist;
    
    // Check if we reach max velocity or use triangular profile
    if (accelDist + decelDist >= traj.distance) {
        // Triangular profile (no constant velocity phase)
        // Solve: distance = 0.5 * accel * t^2 + 0.5 * decel * t^2
        // Since accel = decel, distance = accel * t^2
        float totalTime = sqrt(traj.distance / traj.accel);
        traj.accelTime = totalTime / 2.0;
        traj.decelTime = totalTime / 2.0;
        traj.constTime = 0;
        traj.maxVel = traj.accel * traj.accelTime;  // Actual max velocity reached
    } else {
        // Trapezoidal profile (has constant velocity phase)
        float constDist = traj.distance - accelDist - decelDist;
        traj.constTime = constDist / traj.maxVel;
        traj.decelTime = traj.accelTime;
    }
    
    traj.totalTime = traj.accelTime + traj.constTime + traj.decelTime;
    traj.active = true;
}

// Update motion for one servo using trajectory
void updateMotion(int servoIdx, float deltaTime) {
    if (!trajectories[servoIdx].active) {
        currentVel[servoIdx] = 0;
        return;
    }
    
    Trajectory& traj = trajectories[servoIdx];
    static float elapsedTime[6] = {0, 0, 0, 0, 0, 0};
    
    elapsedTime[servoIdx] += deltaTime;
    
    if (elapsedTime[servoIdx] >= traj.totalTime) {
        // Motion complete
        currentPos[servoIdx] = traj.endPos;
        currentVel[servoIdx] = 0;
        trajectories[servoIdx].active = false;
        elapsedTime[servoIdx] = 0;
        return;
    }
    
    float t = elapsedTime[servoIdx];
    float velocity;
    float position;
    
    if (t < traj.accelTime) {
        // Acceleration phase
        velocity = traj.accel * t;
        position = traj.startPos + 0.5 * traj.accel * t * t * 
                   (traj.endPos > traj.startPos ? 1.0 : -1.0);
    } else if (t < traj.accelTime + traj.constTime) {
        // Constant velocity phase
        velocity = traj.maxVel;
        float accelDist = 0.5 * traj.accel * traj.accelTime * traj.accelTime;
        float constDist = velocity * (t - traj.accelTime);
        position = traj.startPos + (accelDist + constDist) * 
                   (traj.endPos > traj.startPos ? 1.0 : -1.0);
    } else {
        // Deceleration phase
        float tDecel = t - traj.accelTime - traj.constTime;
        velocity = traj.maxVel - traj.decel * tDecel;
        float accelDist = 0.5 * traj.accel * traj.accelTime * traj.accelTime;
        float constDist = traj.maxVel * traj.constTime;
        float decelDist = traj.maxVel * tDecel - 0.5 * traj.decel * tDecel * tDecel;
        position = traj.startPos + (accelDist + constDist + decelDist) * 
                   (traj.endPos > traj.startPos ? 1.0 : -1.0);
    }
    
    currentPos[servoIdx] = clampAngle(position);
    currentVel[servoIdx] = velocity;
}

// Move all servos to target positions smoothly
void moveToTargets(float targets[6]) {
    for (int i = 0; i < 6; i++) {
        targetPos[i] = clampAngle(targets[i]);
        calculateTrajectory(i, currentPos[i], targetPos[i]);
    }
    isMoving = true;
}

// Move single servo smoothly
void moveServo(int servoIdx, float targetAngle) {
    targetPos[servoIdx] = clampAngle(targetAngle);
    calculateTrajectory(servoIdx, currentPos[servoIdx], targetPos[servoIdx]);
    isMoving = true;
}

// Check if any servo is still moving
bool isAnyMoving() {
    for (int i = 0; i < 6; i++) {
        if (trajectories[i].active) return true;
    }
    return false;
}

void setup() {
    Serial.begin(SERIAL_BAUD);
    #if IS_ESP_BOARD
        while (!Serial) { delay(10); }  // ESP boards need this
    #else
        delay(1000);  // Arduino Uno - give serial time to initialize
    #endif
    
    Wire.begin();
    pwm.begin();
    pwm.setPWMFreq(60);
    
    // Initialize all servos to center position
    for (int i = 0; i < 6; i++) {
        writeServo(i, 90);
        currentPos[i] = 90;
        targetPos[i] = 90;
    }
    writeServo(CHANNEL_GRIPPER_MIRROR, 90);
    
    Serial.println(F("Smooth Robotic Arm Controller Ready"));
    Serial.println(F("Commands: <index>:<angle> or <index1>:<angle1>,<index2>:<angle2>,..."));
    Serial.println(F("Example: 1:90,2:120,3:45"));
    
    lastUpdateTime = millis();
}

void loop() {
    // Handle serial commands
    if (Serial.available() > 0) {
        String input = Serial.readStringUntil('\n');
        input.trim();
        
        if (input.length() > 0) {
            // Check if multiple commands (comma-separated)
            if (input.indexOf(',') >= 0) {
                // Multiple servos - synchronized movement
                int startIdx = 0;
                float targets[6];
                bool hasTargets[6] = {false, false, false, false, false, false};
                
                // Copy current positions as defaults
                for (int i = 0; i < 6; i++) {
                    targets[i] = currentPos[i];
                }
                
                // Parse comma-separated commands
                while (startIdx < input.length()) {
                    int commaIdx = input.indexOf(',', startIdx);
                    String cmd;
                    if (commaIdx < 0) {
                        cmd = input.substring(startIdx);
                        startIdx = input.length();
                    } else {
                        cmd = input.substring(startIdx, commaIdx);
                        startIdx = commaIdx + 1;
                    }
                    
                    int colonIdx = cmd.indexOf(':');
                    if (colonIdx > 0) {
                        int servoIdx = cmd.substring(0, colonIdx).toInt() - 1;
                        float angle = cmd.substring(colonIdx + 1).toFloat();
                        
                        if (servoIdx >= 0 && servoIdx < 6) {
                            targets[servoIdx] = clampAngle(angle);
                            hasTargets[servoIdx] = true;
                        }
                    }
                }
                
                // Move all servos synchronously
                moveToTargets(targets);
                Serial.println(F("OK"));
            } else {
                // Single servo command
                int colonIdx = input.indexOf(':');
                if (colonIdx > 0) {
                    int servoIdx = input.substring(0, colonIdx).toInt() - 1;
                    float angle = input.substring(colonIdx + 1).toFloat();
                    
                    if (servoIdx >= 0 && servoIdx < 6) {
                        moveServo(servoIdx, angle);
                        Serial.println(F("OK"));
                    } else {
                        Serial.println(F("ERROR: Invalid servo index"));
                    }
                } else {
                    Serial.println(F("ERROR: Invalid format"));
                }
            }
        }
    }
    
    // Update motion at fixed rate (50Hz = 20ms)
    unsigned long currentTime = millis();
    float deltaTime = (currentTime - lastUpdateTime) / 1000.0;  // Convert to seconds
    
    if (deltaTime >= (UPDATE_RATE_MS / 1000.0)) {
        // Update all servos
        for (int i = 0; i < 6; i++) {
            updateMotion(i, deltaTime);
            writeServo(i, currentPos[i]);
        }
        
        // Update mirrored gripper if servo 5 is moving
        if (trajectories[4].active) {
            writeServo(CHANNEL_GRIPPER_MIRROR, 180 - currentPos[4]);
        }
        
        lastUpdateTime = currentTime;
        isMoving = isAnyMoving();
    }
    
    // Small delay - shorter for ESP, longer for Arduino Uno
    #if IS_ESP_BOARD
        delay(1);
    #else
        delay(2);  // Arduino Uno needs slightly more delay
    #endif
}

