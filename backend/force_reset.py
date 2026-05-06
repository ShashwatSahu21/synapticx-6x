import os
import signal
import subprocess
import time

# Kill any running python processes (backend)
try:
    os.system("taskkill /F /IM python.exe /T")
except:
    pass

time.sleep(2)

# Wipe sequences.json
path = r"c:\Users\Shashwat\Desktop\Github Repository\synapticx-6x-main\backend\sequences.json"
if os.path.exists(path):
    with open(path, 'w') as f:
        f.write("{}")
    print(f"Wiped {path}")

# Start the server again
subprocess.Popen(["python", "backend/main.py"], cwd=r"c:\Users\Shashwat\Desktop\Github Repository\synapticx-6x-main")
print("Started backend server")
