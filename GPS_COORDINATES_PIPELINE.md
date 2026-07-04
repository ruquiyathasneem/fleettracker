# GPS Coordinates Transmission Pipeline
## Code Snippets & Technical Walkthrough

This document outlines the core code snippets that handle capturing, sharing, and receiving GPS coordinate telemetry within the fleet tracking application.

---

## 📱 1. Client-Side: Capturing & Sharing GPS Coordinates
The edge tracking client (PWA) queries the device's native GPS hardware using the web browser's **HTML5 Geolocation API**. It captures latitude, longitude, heading, and speed, and sends a secure HTTP `POST` request to the backend.

### Code Snippet (from [tracker.html](file:///c:/Users/nettu/Downloads/Ruquiya%20project/phone-client/tracker.html))
```javascript
// Step A: Capture GPS data from device hardware sensors
try {
  var pos = await new Promise(function(resolve, reject) {
    var highAccuracy = document.getElementById('accuracyMode').value === 'high';
    navigator.geolocation.getCurrentPosition(resolve, reject, { 
      enableHighAccuracy: highAccuracy, 
      timeout: 6000, 
      maximumAge: 0 
    });
  });
  onPositionUpdate(pos);
} catch (err) {
  console.error("GPS Capture Error:", err.message);
}

// Step B: Build telemetry payload and dispatch via POST
var c = lastPosition.coords;
var token = document.getElementById('deviceToken').value.trim();
var apiUrl = document.getElementById('apiUrl').value.trim();

var payload = {
  device_token: token,
  latitude: c.latitude,
  longitude: c.longitude,
  speed_kmph: parseFloat(speedKmh.toFixed(2)),
  heading: c.heading ? parseFloat(c.heading.toFixed(1)) : 0,
  recorded_at: new Date().toISOString(),
  address: lastAddress || null
};

// Dispatch coordinates to backend API
var resp = await fetch(apiUrl + '/api/location', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
```

---

## ⚙️ 2. Server-Side: Receiving & Processing GPS Coordinates
The FastAPI backend exposes an endpoint at `POST /api/location` that validates the device token, resolves addresses using reverse geocoding cache, checks rules (overspeed, geofence breaches), persists the log, updates active trip meters, and broadcasts live coordinates to dashboard clients over WebSockets.

### Code Snippet (from [location.py](file:///c:/Users/nettu/Downloads/Ruquiya%20project/backend/app/routers/location.py))
```python
@router.post("", response_model=LocationLogResponse, status_code=status.HTTP_201_CREATED)
async def post_location(payload: LocationLogCreate, db: Session = Depends(get_db)):
    """
    Ingests location telemetry from tracking hardware/device.
    """
    # 1. Identify vehicle by device_token
    vehicle = db.query(Vehicle).filter(Vehicle.device_token == payload.device_token).first()
    if not vehicle:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Vehicle not found for device token: {payload.device_token}"
        )
    
    # 2. Setup timestamp
    recorded_time = payload.recorded_at if payload.recorded_at else datetime.utcnow()
    if recorded_time.tzinfo is not None:
        recorded_time = recorded_time.replace(tzinfo=None)
        
    # 3. Resolve human-readable address (with Nominatim caching)
    address = payload.address
    if not address:
        cached = GEOCODE_CACHE.get(vehicle.id)
        if cached:
            c_lat, c_lng, c_addr = cached
            dist_delta = math.sqrt((payload.latitude - c_lat)**2 + (payload.longitude - c_lng)**2)
            if dist_delta < 0.0005:  # ~50-60 meters
                address = c_addr
                
        if not address:
            address = await asyncio.to_thread(reverse_geocode, payload.latitude, payload.longitude)
            GEOCODE_CACHE[vehicle.id] = (payload.latitude, payload.longitude, address)
    
    # 4. Create LocationLog and commit to database
    db_log = LocationLog(
        vehicle_id=vehicle.id,
        latitude=payload.latitude,
        longitude=payload.longitude,
        speed_kmph=payload.speed_kmph,
        heading=payload.heading,
        recorded_at=recorded_time,
        address=address
    )
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    
    # 5. Check for speed limit violation (OverspeedEvent logging)
    overspeed_event = None
    if payload.speed_kmph and vehicle.speed_limit_kmph and payload.speed_kmph > vehicle.speed_limit_kmph:
        db_alert = OverspeedEvent(
            vehicle_id=vehicle.id,
            speed_kmph=payload.speed_kmph,
            speed_limit_kmph=vehicle.speed_limit_kmph,
            latitude=payload.latitude,
            longitude=payload.longitude,
            occurred_at=recorded_time,
            address=address
        )
        db.add(db_alert)
        db.commit()
        db.refresh(db_alert)
    
    # 6. Evaluate Geofence Transitions & Trip Statistics
    geofence_events = check_geofences_for_location(db, vehicle.id, payload.latitude, payload.longitude)
    active_trip = process_location_for_trip(
        db, vehicle.id, payload.latitude, payload.longitude, payload.speed_kmph, recorded_time, address
    )
    
    # 7. Broadcast live telemetry update over WebSockets
    ws_payload = {
        "event_type": "location_update",
        "data": {
            "id": db_log.id,
            "vehicle_id": vehicle.id,
            "reg_number": vehicle.reg_number,
            "latitude": db_log.latitude,
            "longitude": db_log.longitude,
            "speed_kmph": db_log.speed_kmph,
            "heading": db_log.heading,
            "recorded_at": db_log.recorded_at.isoformat(),
            "address": db_log.address
        }
    }
    await manager.broadcast_to_user(ws_payload, vehicle.owner_id)
    
    return db_log
```
