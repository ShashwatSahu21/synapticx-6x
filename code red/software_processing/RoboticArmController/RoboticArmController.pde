/**
 * Robotic Arm Controller - Processing Sketch
 * Controls 6-DOF robotic arm via serial communication
 * 
 * Instructions:
 * 1. Install Processing from processing.org
 * 2. Install "Serial" library (Sketch > Import Library > Serial)
 * 3. Connect Arduino and select COM port from dropdown
 * 4. Click "Connect" and use sliders to control servos
 */

import processing.serial.*;

Serial arduinoPort;
String[] portList;
int selectedPortIndex = 0;
boolean isConnected = false;

// Servo names and indexes
String[] servoNames = {"Base", "Shoulder", "Elbow", "Wrist Rot", "Wrist Pitch", "Gripper"};
int[] servoIndexes = {1, 2, 3, 4, 5, 6};
int[] servoAngles = {90, 90, 90, 90, 90, 90}; // Current angles (0-180)

// UI elements
int sliderX = 50;
int sliderY = 100;
int sliderWidth = 400;
int sliderHeight = 20;
int sliderSpacing = 60;

PFont font;
int connectButtonX = 250;
int connectButtonY = 50;
int connectButtonW = 100;
int connectButtonH = 30;

int refreshButtonX = 360;
int refreshButtonY = 50;
int refreshButtonW = 80;
int refreshButtonH = 30;

int centerButtonX = 50;
int centerButtonY = 500;
int centerButtonW = 120;
int centerButtonH = 30;

int sendAllButtonX = 180;
int sendAllButtonY = 500;
int sendAllButtonW = 120;
int sendAllButtonH = 30;

boolean[] sliderActive = new boolean[6];
int activeSlider = -1;

void setup() {
  size(550, 550);
  font = createFont("Arial", 14);
  textFont(font);
  
  scanPorts();
}

void draw() {
  background(240);
  
  // Title
  fill(0);
  textSize(20);
  textAlign(CENTER);
  text("6-DOF Robotic Arm Controller", width/2, 30);
  textSize(12);
  
  // Connection status
  fill(isConnected ? color(0, 150, 0) : color(200, 0, 0));
  textAlign(LEFT);
  text("Status: " + (isConnected ? "Connected" : "Disconnected"), 50, 85);
  
  // Port selection
  fill(0);
  text("COM Port:", 50, 65);
  if (portList != null && portList.length > 0) {
    text(portList[selectedPortIndex], 120, 65);
  } else {
    text("No ports found", 120, 65);
  }
  
  // Buttons
  drawButton(connectButtonX, connectButtonY, connectButtonW, connectButtonH, 
             isConnected ? "Disconnect" : "Connect", color(100, 150, 255));
  drawButton(refreshButtonX, refreshButtonY, refreshButtonW, refreshButtonH, 
             "Refresh", color(150, 150, 150));
  drawButton(centerButtonX, centerButtonY, centerButtonW, centerButtonH, 
             "Center All", color(100, 200, 100));
  drawButton(sendAllButtonX, sendAllButtonY, sendAllButtonW, sendAllButtonH, 
             "Send All", color(200, 150, 100));
  
  // Servo sliders
  for (int i = 0; i < 6; i++) {
    int y = sliderY + i * sliderSpacing;
    
    // Servo name and angle
    fill(0);
    textAlign(LEFT);
    text(servoNames[i] + " (Servo " + servoIndexes[i] + "):", sliderX, y - 5);
    textAlign(RIGHT);
    text(servoAngles[i] + "°", sliderX + sliderWidth + 50, y - 5);
    
    // Slider track
    fill(200);
    rect(sliderX, y, sliderWidth, sliderHeight);
    
    // Slider handle
    float handleX = sliderX + map(servoAngles[i], 0, 180, 0, sliderWidth);
    fill(100, 150, 255);
    rect(handleX - 5, y - 2, 10, sliderHeight + 4);
    
    // Angle markers
    fill(150);
    textAlign(CENTER);
    text("0", sliderX, y + 35);
    text("90", sliderX + sliderWidth/2, y + 35);
    text("180", sliderX + sliderWidth, y + 35);
  }
  
  // Instructions
  fill(100);
  textAlign(LEFT);
  textSize(10);
  text("Click and drag sliders to control servos", 50, height - 30);
  text("Format: index:angle (e.g., 1:90)", 50, height - 15);
}

void drawButton(int x, int y, int w, int h, String label, color c) {
  fill(c);
  rect(x, y, w, h);
  fill(255);
  textAlign(CENTER, CENTER);
  text(label, x + w/2, y + h/2);
}

void mousePressed() {
  // Check connect button
  if (mouseX >= connectButtonX && mouseX <= connectButtonX + connectButtonW &&
      mouseY >= connectButtonY && mouseY <= connectButtonY + connectButtonH) {
    toggleConnection();
    return;
  }
  
  // Check refresh button
  if (mouseX >= refreshButtonX && mouseX <= refreshButtonX + refreshButtonW &&
      mouseY >= refreshButtonY && mouseY <= refreshButtonY + refreshButtonH) {
    scanPorts();
    return;
  }
  
  // Check center all button
  if (mouseX >= centerButtonX && mouseX <= centerButtonX + centerButtonW &&
      mouseY >= centerButtonY && mouseY <= centerButtonY + centerButtonH) {
    centerAll();
    return;
  }
  
  // Check send all button
  if (mouseX >= sendAllButtonX && mouseX <= sendAllButtonX + sendAllButtonW &&
      mouseY >= sendAllButtonY && mouseY <= sendAllButtonY + sendAllButtonH) {
    sendAllServos();
    return;
  }
  
  // Check sliders
  for (int i = 0; i < 6; i++) {
    int y = sliderY + i * sliderSpacing;
    if (mouseX >= sliderX && mouseX <= sliderX + sliderWidth &&
        mouseY >= y && mouseY <= y + sliderHeight) {
      activeSlider = i;
      updateSlider(i);
      break;
    }
  }
}

void mouseDragged() {
  if (activeSlider >= 0) {
    updateSlider(activeSlider);
  }
}

void mouseReleased() {
  activeSlider = -1;
}

void updateSlider(int index) {
  int y = sliderY + index * sliderSpacing;
  int newAngle = (int)map(constrain(mouseX, sliderX, sliderX + sliderWidth), 
                         sliderX, sliderX + sliderWidth, 0, 180);
  servoAngles[index] = newAngle;
  
  // Send command immediately
  if (isConnected) {
    sendCommand(servoIndexes[index], newAngle);
  }
}

void scanPorts() {
  portList = Serial.list();
  if (portList.length > 0) {
    selectedPortIndex = 0;
  }
}

void toggleConnection() {
  if (isConnected) {
    disconnect();
  } else {
    connect();
  }
}

void connect() {
  if (portList == null || portList.length == 0) {
    println("No COM ports available");
    return;
  }
  
  try {
    arduinoPort = new Serial(this, portList[selectedPortIndex], 9600);
    delay(2000); // Wait for Arduino to reset
    isConnected = true;
    println("Connected to " + portList[selectedPortIndex]);
    
    // Send all current positions
    sendAllServos();
  } catch (Exception e) {
    println("Connection failed: " + e.getMessage());
    isConnected = false;
  }
}

void disconnect() {
  if (arduinoPort != null) {
    arduinoPort.stop();
    arduinoPort = null;
  }
  isConnected = false;
  println("Disconnected");
}

void sendCommand(int servoIndex, int angle) {
  if (!isConnected || arduinoPort == null) {
    return;
  }
  
  // Clamp angle
  angle = constrain(angle, 0, 180);
  
  // Send command: "index:angle\n"
  String command = servoIndex + ":" + angle + "\n";
  arduinoPort.write(command);
  println("Sent: " + command.trim());
}

void sendAllServos() {
  if (!isConnected) {
    return;
  }
  
  for (int i = 0; i < 6; i++) {
    sendCommand(servoIndexes[i], servoAngles[i]);
    delay(50); // Small delay between commands
  }
}

void centerAll() {
  for (int i = 0; i < 6; i++) {
    servoAngles[i] = 90;
  }
  
  if (isConnected) {
    sendAllServos();
  }
}

void keyPressed() {
  // Manual command input (for future enhancement)
  // You can type commands like "1:90" and press Enter
  if (key == ENTER || key == RETURN) {
    // Process manual command if implemented
  }
}

