import requests
import json

BASE_URL = "http://localhost:8000"

def test_gen():
    try:
        # Generate Pick & Place
        resp = requests.post(f"{BASE_URL}/sequences/generate-task", json={
            "task": "pick_place",
            "pick_base": 60,
            "place_base": 120
        })
        data = resp.json()
        if data.get("status") == "ok":
            seq = data["sequence"]
            print(f"Generated sequence: {seq['name']}")
            # Check a waypoint
            for wp in seq["waypoints"]:
                if wp["label"] == "Grip Cube":
                    print(f"Grip Cube Angles: {wp['angles']}")
        else:
            print(f"Error: {data}")
    except Exception as e:
        print(f"Failed to connect: {e}")

if __name__ == "__main__":
    test_gen()
