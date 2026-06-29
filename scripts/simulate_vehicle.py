import time
import requests
from datetime import datetime, timezone
import math

API_URL = "http://localhost:8000/api/location"
DEVICE_TOKEN = "tracker-device-123"

# Center of geofence is 12.9716, 77.5946 (radius 500m)
# Let's generate a path that starts inside, goes outside, and returns inside
# 1 degree of lat ~ 111,000 meters. 
# 0.001 degrees ~ 111 meters.
# Geofence boundary is ~0.0045 degrees away.
ROUTE_POINTS = [
    # (latitude, longitude, speed_kmph, heading_degrees, sleep_seconds_after)
    # Start: Stationary inside geofence
    (12.9716, 77.5946, 0.0, 0.0, 3),
    (12.9716, 77.5946, 0.0, 0.0, 3),
    
    # Start moving North-East (still inside geofence)
    (12.9725, 77.5955, 15.0, 45.0, 3),
    (12.9735, 77.5965, 30.0, 45.0, 3),
    (12.9745, 77.5975, 45.0, 45.0, 3), # Distance is approx 460m (very close to boundary)
    
    # Cross boundary -> Outside geofence
    (12.9755, 77.5985, 55.0, 45.0, 3), # ~610m outside
    (12.9765, 77.5995, 65.0, 45.0, 3), # ~760m outside
    (12.9775, 77.6005, 75.0, 45.0, 3), # ~910m outside
    
    # Speeding along the road
    (12.9785, 77.6015, 82.0, 45.0, 3),
    (12.9790, 77.6025, 80.0, 60.0, 3),
    (12.9785, 77.6035, 70.0, 120.0, 3), # Turn south-east
    (12.9770, 77.6040, 50.0, 160.0, 3),
    
    # Loop back towards center
    (12.9750, 77.6025, 45.0, 225.0, 3),
    (12.9735, 77.6005, 40.0, 225.0, 3), # Distance ~680m (still outside)
    
    # Re-enter geofence
    (12.9725, 77.5975, 25.0, 225.0, 3), # Distance ~330m (inside!)
    (12.9718, 77.5955, 10.0, 225.0, 3), # Distance ~100m (inside!)
    
    # Stop & End Trip
    (12.9716, 77.5946, 0.0, 0.0, 3),
    (12.9716, 77.5946, 0.0, 0.0, 3),
    (12.9716, 77.5946, 0.0, 0.0, 1),
]

def run_simulation():
    print("========================================")
    print("   VEHICLE TRACKING SYSTEM SIMULATOR    ")
    print("========================================")
    print(f"Target API: {API_URL}")
    print(f"Device Token: {DEVICE_TOKEN}")
    print(f"Simulating {len(ROUTE_POINTS)} GPS waypoints...")
    print("Press Ctrl+C to terminate early.\n")
    
    for i, (lat, lng, speed, heading, delay) in enumerate(ROUTE_POINTS):
        payload = {
            "device_token": DEVICE_TOKEN,
            "latitude": lat,
            "longitude": lng,
            "speed_kmph": speed,
            "heading": heading,
            "recorded_at": datetime.now(timezone.utc).isoformat()
        }
        
        try:
            print(f"[{i+1}/{len(ROUTE_POINTS)}] Sending location: lat={lat:.5f}, lng={lng:.5f}, speed={speed:.1f} km/h...", end="")
            response = requests.post(API_URL, json=payload, timeout=5)
            
            if response.status_code == 201:
                print(" OK")
            else:
                print(f" FAILED (Status: {response.status_code})")
                print(response.text)
        except requests.exceptions.RequestException as e:
            print(" ERROR - Server unreachable")
            print(f"  Detail: {e}")
            
        time.sleep(delay)
        
    print("\nSimulation complete. Trip finished!")

if __name__ == "__main__":
    run_simulation()
