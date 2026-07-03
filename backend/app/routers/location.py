from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime
import asyncio
import math
import requests
from ..database import get_db
from ..models import Vehicle, LocationLog, OverspeedEvent
from ..schemas import LocationLogCreate, LocationLogResponse
from ..services.geofence_check import check_geofences_for_location
from ..services.trip_detector import process_location_for_trip
from ..ws_manager import manager

router = APIRouter(
    prefix="/api/location",
    tags=["Location Ingest"]
)

# In-memory geocoding cache to protect Nominatim API from rate limiting and timeouts
# Structure: { vehicle_id: (latitude, longitude, resolved_address) }
GEOCODE_CACHE = {}

def reverse_geocode(lat: float, lng: float) -> str:
    """
    Fetch address description from Nominatim (OpenStreetMap) API.
    This is a blocking I/O call — always invoke via asyncio.to_thread in async handlers.
    """
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&zoom=18"
        headers = {"User-Agent": "VehicleTrackingSystem/1.0 (Ruquiya Project; contact: developer@example.com)"}
        response = requests.get(url, headers=headers, timeout=2.5)
        if response.status_code == 200:
            data = response.json()
            # Nominatim returns full address in 'display_name'
            return data.get("display_name", "")
    except Exception as e:
        print("Geocoding Error:", e)
    return f"Location coordinates ({lat:.5f}, {lng:.5f})"

@router.post("", response_model=LocationLogResponse, status_code=status.HTTP_201_CREATED)
async def post_location(payload: LocationLogCreate, db: Session = Depends(get_db)):
    """
    Ingests location telemetry from tracking hardware/device.
    Performs geofence evaluations, increments active trips, 
    resolves street address, and broadcasts updates via WebSockets.
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
        
    # 3. Resolve human-readable address (with caching to avoid I/O bottlenecks)
    address = payload.address
    if not address:
        cached = GEOCODE_CACHE.get(vehicle.id)
        if cached:
            c_lat, c_lng, c_addr = cached
            # Approximate distance delta (~0.0005 degrees is roughly 50-60 meters)
            dist_delta = math.sqrt((payload.latitude - c_lat)**2 + (payload.longitude - c_lng)**2)
            if dist_delta < 0.0005:
                address = c_addr
                
        if not address:
            address = await asyncio.to_thread(reverse_geocode, payload.latitude, payload.longitude)
            # Update cache
            GEOCODE_CACHE[vehicle.id] = (payload.latitude, payload.longitude, address)
    else:
        # If client sent an address, update the cache
        GEOCODE_CACHE[vehicle.id] = (payload.latitude, payload.longitude, address)
    
    # 4. Create LocationLog
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
    
    # Check for overspeeding
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
        
        overspeed_event = {
            "id": db_alert.id,
            "speed_kmph": db_alert.speed_kmph,
            "speed_limit_kmph": db_alert.speed_limit_kmph,
            "latitude": db_alert.latitude,
            "longitude": db_alert.longitude,
            "occurred_at": db_alert.occurred_at.isoformat(),
            "address": db_alert.address
        }
    
    # 5. Check Geofences
    geofence_events = check_geofences_for_location(db, vehicle.id, payload.latitude, payload.longitude)
    
    # 6. Process Trip updates — pass the resolved address for start/end geocoding
    active_trip = process_location_for_trip(
        db, vehicle.id, payload.latitude, payload.longitude, payload.speed_kmph, recorded_time, address
    )
    
    # 7. Broadcast via WebSockets
    ws_payload = {
        "event_type": "location_update",
        "data": {
            "vehicle_id": vehicle.id,
            "reg_number": vehicle.reg_number,
            "model": vehicle.model,
            "latitude": payload.latitude,
            "longitude": payload.longitude,
            "speed_kmph": payload.speed_kmph,
            "heading": payload.heading,
            "recorded_at": recorded_time.isoformat(),
            "address": address,
            "active_trip": {
                "id": active_trip.id,
                "distance_km": active_trip.distance_km,
                "avg_speed_kmph": active_trip.avg_speed_kmph,
                "max_speed_kmph": active_trip.max_speed_kmph
            } if active_trip else None
        },
        "geofence_events": geofence_events,
        "overspeed_event": overspeed_event
    }
    
    await manager.broadcast(ws_payload)
    
    return db_log

@router.get("/gpslogger", status_code=status.HTTP_200_OK)
async def gpslogger_ingest(
    token: str, 
    lat: float, 
    lon: float, 
    speed: float = 0.0, 
    dir: float = 0.0, 
    db: Session = Depends(get_db)
):
    """
    Endpoint for third-party background trackers like GPSLogger.
    GPSLogger Custom URL format:
    https://fleettracker-backend.onrender.com/api/location/gpslogger?token=YOUR_TOKEN&lat=%LAT&lon=%LON&speed=%SPD&dir=%DIR
    """
    # GPSLogger %SPD is in m/s, convert to km/h
    speed_kmph = float(speed) * 3.6 if speed else 0.0

    payload = LocationLogCreate(
        device_token=token,
        latitude=lat,
        longitude=lon,
        speed_kmph=speed_kmph,
        heading=dir
    )
    
    # Reuse the core POST logic for ingestion
    try:
        await post_location(payload, db)
        return {"status": "success"}
    except HTTPException as e:
        return {"status": "error", "detail": e.detail}
