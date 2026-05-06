import json
import os

path = r"c:\Users\Shashwat\Desktop\Github Repository\synapticx-6x-main\backend\sequences.json"

if os.path.exists(path):
    with open(path, 'r') as f:
        data = json.load(f)
    
    for seq_id, seq in data.items():
        if "waypoints" in seq:
            for wp in seq["waypoints"]:
                if "angles" in wp:
                    angles = wp["angles"]
                    if "gripper" in angles and "auxiliary" in angles:
                        # Swap gripper and auxiliary
                        # gripper is Wrist Roll, auxiliary is Gripper
                        # In old sequences, 'gripper' had the grip value and 'auxiliary' had 90
                        g_val = angles["gripper"]
                        a_val = angles["auxiliary"]
                        
                        # Clamp g_val to 180 (Wrist Roll max)
                        # Clamp a_val to 80 (Gripper max)
                        # Actually, let's just swap them and then clamp correctly
                        
                        angles["gripper"] = a_val # Wrist Roll gets the old auxiliary (usually 90)
                        angles["auxiliary"] = g_val # Gripper gets the old gripper (the grip value)
                        
                        # Apply new limits
                        angles["gripper"] = max(0, min(180, angles["gripper"]))
                        angles["auxiliary"] = max(0, min(80, angles["auxiliary"]))
                        
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
    print("Successfully updated sequences.json")
else:
    print("sequences.json not found")
