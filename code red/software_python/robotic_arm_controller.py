#!/usr/bin/env python3
"""
Robotic Arm Controller - Python GUI Application
Controls 6-DOF robotic arm via serial communication with Arduino
"""

import tkinter as tk
from tkinter import ttk, messagebox
import serial
import serial.tools.list_ports
import threading
import time

class RoboticArmController:
    def __init__(self, root):
        self.root = root
        self.root.title("6-DOF Robotic Arm Controller")
        self.root.geometry("600x700")
        
        self.serial_connection = None
        self.is_connected = False
        self.auto_update = True
        self.last_command_time = 0
        self.command_throttle_ms = 50  # Minimum time between commands (ms)
        
        # Servo names and their indexes
        self.servos = [
            ("Base", 1),
            ("Shoulder", 2),
            ("Elbow", 3),
            ("Wrist Rotation", 4),
            ("Wrist Pitch", 5),
            ("Gripper", 6)
        ]
        
        # Current angle values (0-180)
        self.angles = [90] * 6
        
        self.create_widgets()
        self.scan_ports()
        
    def create_widgets(self):
        # Connection frame
        conn_frame = ttk.LabelFrame(self.root, text="Connection", padding=10)
        conn_frame.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Label(conn_frame, text="COM Port:").grid(row=0, column=0, padx=5, pady=5)
        self.port_var = tk.StringVar()
        self.port_combo = ttk.Combobox(conn_frame, textvariable=self.port_var, width=20, state="readonly")
        self.port_combo.grid(row=0, column=1, padx=5, pady=5)
        
        self.refresh_btn = ttk.Button(conn_frame, text="Refresh", command=self.scan_ports)
        self.refresh_btn.grid(row=0, column=2, padx=5, pady=5)
        
        self.connect_btn = ttk.Button(conn_frame, text="Connect", command=self.toggle_connection)
        self.connect_btn.grid(row=0, column=3, padx=5, pady=5)
        
        self.status_label = ttk.Label(conn_frame, text="Disconnected", foreground="red")
        self.status_label.grid(row=1, column=0, columnspan=4, pady=5)
        
        # Control frame
        control_frame = ttk.LabelFrame(self.root, text="Servo Control", padding=10)
        control_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)
        
        # Create sliders for each servo
        self.sliders = []
        self.angle_labels = []
        self.value_labels = []
        
        for i, (name, index) in enumerate(self.servos):
            # Servo name and current value
            label_frame = ttk.Frame(control_frame)
            label_frame.pack(fill=tk.X, pady=5)
            
            name_label = ttk.Label(label_frame, text=f"{name} (Servo {index}):", width=18)
            name_label.pack(side=tk.LEFT, padx=5)
            
            value_label = ttk.Label(label_frame, text="90°", width=8)
            value_label.pack(side=tk.LEFT, padx=5)
            self.value_labels.append(value_label)
            
            # Slider - use default parameter to properly capture loop variable
            def make_slider_callback(idx):
                return lambda val: self.on_slider_change(idx, val)
            
            slider = ttk.Scale(control_frame, from_=0, to=180, orient=tk.HORIZONTAL, 
                              length=400, command=make_slider_callback(i))
            slider.set(90)
            slider.pack(fill=tk.X, padx=10, pady=2)
            self.sliders.append(slider)
            
            # Angle display
            angle_label = ttk.Label(control_frame, text="Angle: 90°", font=("Arial", 9))
            angle_label.pack(anchor=tk.W, padx=20)
            self.angle_labels.append(angle_label)
        
        # Control buttons frame
        btn_frame = ttk.Frame(self.root, padding=10)
        btn_frame.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Button(btn_frame, text="Center All (90°)", command=self.center_all).pack(side=tk.LEFT, padx=5)
        ttk.Button(btn_frame, text="Home Position", command=self.home_position).pack(side=tk.LEFT, padx=5)
        ttk.Button(btn_frame, text="Send All", command=self.send_all_servos).pack(side=tk.LEFT, padx=5)
        
        # Manual command frame
        manual_frame = ttk.LabelFrame(self.root, text="Manual Command", padding=10)
        manual_frame.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Label(manual_frame, text="Format: index:angle (e.g., 1:90)").pack(anchor=tk.W)
        cmd_frame = ttk.Frame(manual_frame)
        cmd_frame.pack(fill=tk.X, pady=5)
        
        self.cmd_entry = ttk.Entry(cmd_frame, width=20)
        self.cmd_entry.pack(side=tk.LEFT, padx=5)
        self.cmd_entry.bind('<Return>', lambda e: self.send_manual_command())
        
        ttk.Button(cmd_frame, text="Send", command=self.send_manual_command).pack(side=tk.LEFT, padx=5)
        
    def scan_ports(self):
        """Scan for available COM ports"""
        ports = [port.device for port in serial.tools.list_ports.comports()]
        self.port_combo['values'] = ports
        if ports:
            self.port_combo.current(0)
    
    def toggle_connection(self):
        """Connect or disconnect from serial port"""
        if not self.is_connected:
            self.connect()
        else:
            self.disconnect()
    
    def connect(self):
        """Connect to Arduino via serial"""
        port = self.port_var.get()
        if not port:
            messagebox.showerror("Error", "Please select a COM port")
            return
        
        try:
            self.serial_connection = serial.Serial(
                port=port,
                baudrate=9600,
                timeout=1,
                write_timeout=None  # No write timeout - just send and continue
            )
            time.sleep(2)  # Wait for Arduino to reset
            self.is_connected = True
            self.status_label.config(text=f"Connected to {port}", foreground="green")
            self.connect_btn.config(text="Disconnect")
            self.port_combo.config(state="disabled")
            self.refresh_btn.config(state="disabled")
            
            # Clear any pending data
            self.serial_connection.reset_input_buffer()
            self.serial_connection.reset_output_buffer()
            
            # Wait a bit more for Arduino to be ready
            time.sleep(0.5)
            
            # Send all current positions on connect
            self.send_all_servos()
            
        except serial.SerialException as e:
            messagebox.showerror("Connection Error", f"Failed to connect:\n{str(e)}")
            self.is_connected = False
    
    def disconnect(self):
        """Disconnect from serial port"""
        if self.serial_connection:
            try:
                self.serial_connection.close()
            except:
                pass
            self.serial_connection = None
        
        self.is_connected = False
        self.status_label.config(text="Disconnected", foreground="red")
        self.connect_btn.config(text="Connect")
        self.port_combo.config(state="readonly")
        self.refresh_btn.config(state="normal")
    
    def send_command(self, servo_index, angle, force=False):
        """Send a single servo command"""
        if not self.is_connected or not self.serial_connection:
            return False
        
        # Check if serial port is still open
        if not self.serial_connection.is_open:
            self.is_connected = False
            self.status_label.config(text="Connection lost", foreground="red")
            return False
        
        # Throttle commands to avoid overwhelming the Arduino
        current_time = time.time() * 1000  # Convert to milliseconds
        if not force and (current_time - self.last_command_time) < self.command_throttle_ms:
            return False  # Skip this command, too soon since last one
        
        try:
            # Clamp angle to valid range
            angle = max(0, min(180, int(angle)))
            command = f"{servo_index}:{angle}\n"
            bytes_written = self.serial_connection.write(command.encode('utf-8'))
            self.serial_connection.flush()  # Ensure data is sent immediately
            self.last_command_time = current_time
            return bytes_written > 0
        except serial.SerialException as e:
            print(f"Serial error: {e}")
            self.disconnect()
            messagebox.showerror("Connection Error", "Serial connection lost. Please reconnect.")
            return False
        except Exception as e:
            print(f"Error sending command: {e}")
            return False
    
    def on_slider_change(self, servo_idx, value):
        """Handle slider value change"""
        # Safety check
        if servo_idx < 0 or servo_idx >= len(self.servos):
            return
        
        angle = int(float(value))
        self.angles[servo_idx] = angle
        
        # Update labels safely
        if servo_idx < len(self.angle_labels):
            self.angle_labels[servo_idx].config(text=f"Angle: {angle}°")
        if servo_idx < len(self.value_labels):
            self.value_labels[servo_idx].config(text=f"{angle}°")
        
        # Auto-send if connected
        if self.is_connected and self.auto_update:
            servo_index = self.servos[servo_idx][1]
            self.send_command(servo_index, angle)
    
    def center_all(self):
        """Center all servos to 90 degrees"""
        for i, slider in enumerate(self.sliders):
            slider.set(90)
            self.angles[i] = 90
            self.angle_labels[i].config(text="Angle: 90°")
            self.value_labels[i].config(text="90°")
        
        if self.is_connected:
            self.send_all_servos()
    
    def home_position(self):
        """Set to home position (all 90 degrees)"""
        self.center_all()
    
    def send_all_servos(self):
        """Send current position of all servos"""
        if not self.is_connected:
            return
        
        for i, (name, index) in enumerate(self.servos):
            self.send_command(index, self.angles[i], force=True)  # Force send all
            time.sleep(0.1)  # Small delay between commands
    
    def send_manual_command(self):
        """Send a manual command from the entry field"""
        if not self.is_connected:
            messagebox.showwarning("Not Connected", "Please connect to Arduino first")
            return
        
        cmd = self.cmd_entry.get().strip()
        if not cmd:
            return
        
        try:
            if ':' in cmd:
                parts = cmd.split(':')
                servo_idx = int(parts[0])
                angle = int(parts[1])
                
                if 1 <= servo_idx <= 6:
                    # Update corresponding slider
                    servo_list_idx = servo_idx - 1
                    self.sliders[servo_list_idx].set(angle)
                    self.angles[servo_list_idx] = angle
                    self.angle_labels[servo_list_idx].config(text=f"Angle: {angle}°")
                    self.value_labels[servo_list_idx].config(text=f"{angle}°")
                    
                    # Send command (force to bypass throttle)
                    self.send_command(servo_idx, angle, force=True)
                    self.cmd_entry.delete(0, tk.END)
                else:
                    messagebox.showerror("Error", "Servo index must be 1-6")
            else:
                messagebox.showerror("Error", "Invalid format. Use 'index:angle' (e.g., 1:90)")
        except ValueError:
            messagebox.showerror("Error", "Invalid command format. Use 'index:angle' (e.g., 1:90)")
    
    def on_closing(self):
        """Handle window closing"""
        self.disconnect()
        self.root.destroy()

def main():
    root = tk.Tk()
    app = RoboticArmController(root)
    root.protocol("WM_DELETE_WINDOW", app.on_closing)
    root.mainloop()

if __name__ == "__main__":
    main()

