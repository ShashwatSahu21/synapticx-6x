/* Single-channel test: PCA9685 Channel 3 */

#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver();

#define SERVO_MIN 150
#define SERVO_MAX 600
const uint16_t SERVO_CENTER = (SERVO_MIN + SERVO_MAX) / 2;
const uint8_t CHANNEL = 3;

void setup() {
  Serial.begin(9600);
  while (!Serial) {}
  pwm.begin();
  pwm.setPWMFreq(60);

  Serial.println(F("Channel 3 test: center -> MIN -> MAX -> center (loop)"));
}

void loop() {
  pwm.setPWM(CHANNEL, 0, SERVO_CENTER); delay(700);
  pwm.setPWM(CHANNEL, 0, SERVO_MIN);    delay(700);
  pwm.setPWM(CHANNEL, 0, SERVO_MAX);    delay(700);
  pwm.setPWM(CHANNEL, 0, SERVO_CENTER); delay(700);
}

