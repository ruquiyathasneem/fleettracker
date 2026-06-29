import math
from sqlalchemy.orm import Session
from ..models import Geofence, GeofenceEvent, Vehicle
from datetime import datetime

def haversine_distance(lat1, lon1, lat2, lon2) -> float:
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees) in meters.
    """
    # Earth radius in meters
    R = 6371000.0
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    
    a = (math.sin(dphi / 2.0) ** 2 + 
         math.cos(phi1) * math.cos(phi2) * 
         math.sin(dlam / 2.0) ** 2)
    
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    
    return R * c

def check_geofences_for_location(db: Session, vehicle_id: int, lat: float, lng: float) -> list:
    """
    Checks all active geofences for a vehicle against its new coordinates.
    Creates enter/exit events and returns a list of new events triggered.
    """
    active_fences = db.query(Geofence).filter(
        Geofence.vehicle_id == vehicle_id,
        Geofence.active == True
    ).all()
    
    triggered_events = []
    
    for fence in active_fences:
        dist = haversine_distance(lat, lng, fence.center_lat, fence.center_lng)
        is_currently_inside = dist <= fence.radius_m
        
        # Get the most recent geofence event to check the previous state
        last_event = db.query(GeofenceEvent).filter(
            GeofenceEvent.geofence_id == fence.id,
            GeofenceEvent.vehicle_id == vehicle_id
        ).order_by(GeofenceEvent.occurred_at.desc()).first()
        
        was_inside = False
        if last_event:
            was_inside = (last_event.event_type == "enter")
        else:
            # If no event exists, assume they were outside if they are currently inside (so we trigger an enter event)
            # or vice-versa, to establish baseline
            was_inside = not is_currently_inside
            
        # Detect transition
        if is_currently_inside != was_inside:
            event_type = "enter" if is_currently_inside else "exit"
            
            new_event = GeofenceEvent(
                geofence_id=fence.id,
                vehicle_id=vehicle_id,
                event_type=event_type,
                occurred_at=datetime.utcnow()
            )
            db.add(new_event)
            db.commit()
            db.refresh(new_event)
            
            triggered_events.append({
                "id": new_event.id,
                "geofence_id": fence.id,
                "geofence_name": fence.name,
                "vehicle_id": vehicle_id,
                "event_type": event_type,
                "occurred_at": new_event.occurred_at.isoformat()
            })
            
    return triggered_events
