from fastapi import APIRouter, Depends, Form, Response, status
from sqlalchemy.orm import Session
from ..database import get_db
from ..models import Vehicle, LocationLog
import re

router = APIRouter(
    prefix="/api/sms",
    tags=["SMS Location Service"]
)

@router.post("/inbound")
def inbound_sms(
    Body: str = Form(...),
    From: str = Form(...),
    db: Session = Depends(get_db)
):
    """
    Twilio Webhook: Receives incoming SMS requests, parses vehicle registration query,
    retrieves the last known GPS coordinates, and replies with a Google Maps link.
    """
    body_text = Body.strip().upper()
    
    # Simple regex to search for keywords like "LOCATE REG_NO" or just "REG_NO"
    # Matches "LOCATE ABC-1234" or "ABC-123" or similar formats.
    match = re.search(r'(?:LOCATE\s+)?([A-Z0-9\-]+)', body_text)
    
    response_msg = ""
    
    if not match:
        response_msg = "Welcome to GPS Tracker. Reply with 'LOCATE <reg_number>' (e.g. LOCATE ABC-1234) to query a vehicle's current position."
    else:
        query_reg = match.group(1)
        # Find vehicle
        vehicle = db.query(Vehicle).filter(
            (Vehicle.reg_number.ilike(query_reg)) | 
            (Vehicle.reg_number.ilike(f"%{query_reg}%"))
        ).first()
        
        if not vehicle:
            # Let's list available vehicles if they put a typo
            vehicles = db.query(Vehicle).limit(3).all()
            reg_list = ", ".join([v.reg_number for v in vehicles])
            response_msg = f"Vehicle '{query_reg}' not found. Available vehicles: {reg_list if reg_list else 'None'}"
        else:
            # Get last known location log
            last_log = db.query(LocationLog).filter(
                LocationLog.vehicle_id == vehicle.id
            ).order_by(LocationLog.recorded_at.desc()).first()
            
            if not last_log:
                response_msg = f"Vehicle {vehicle.reg_number} is registered, but has no GPS tracking logs recorded yet."
            else:
                lat = last_log.latitude
                lng = last_log.longitude
                speed = last_log.speed_kmph if last_log.speed_kmph is not None else 0.0
                recorded_time = last_log.recorded_at.strftime("%H:%M:%S on %Y-%m-%d")
                
                maps_link = f"https://maps.google.com/?q={lat},{lng}"
                response_msg = f"Vehicle {vehicle.reg_number} location: {maps_link}. Speed: {speed:.1f} km/h. Recorded at {recorded_time}."
                
    # Generate TwiML XML response
    twiml_response = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>{response_msg}</Message>
</Response>"""
    
    return Response(content=twiml_response, media_type="application/xml")
