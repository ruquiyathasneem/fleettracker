from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime
import asyncio
import requests
from ..database import get_db
from ..models import Vehicle, LocationLog
from ..schemas import LocationLogCreate, LocationLogResponse
from ..services.geofence_check import check_geofences_for_location
from ..services.trip_detector import process_location_for_trip
from ..ws_manager import manager

router = APIRouter(
    prefix="/api/location",
    tags=["Location Ingest"]
)

def reverse_geocode(lat: float, lng: float) -> str:
    """
    Fetch address description from Nominatim (OpenStreetMap) API.
    This is a blocking I/O call — always invoke via asyncio.to_thread in async handlers.
    """
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&zoom=18"
        headers = {"User-Agent": "VehicleTrackingSystem/1.0 (Ruquiya Project; contact: developer@example.com)"}
        response = requests.get(url, headers=headers, timeout=3)
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
        
    # 3. Resolve human-readable address (non-blocking via thread pool)
    address = payload.address
    if not address:
        address = await asyncio.to_thread(reverse_geocode, payload.latitude, payload.longitude)
    
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
        "geofence_events": geofence_events
    }
    
    await manager.broadcast(ws_payload)
    
    return db_log

