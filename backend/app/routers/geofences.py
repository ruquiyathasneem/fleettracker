from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models import Geofence, GeofenceEvent, Vehicle
from ..schemas import GeofenceCreate, GeofenceResponse, GeofenceEventResponse
from .auth import get_current_user

router = APIRouter(
    prefix="/api/geofences",
    tags=["Geofences"]
)

@router.post("", response_model=GeofenceResponse, status_code=status.HTTP_201_CREATED)
def create_geofence(payload: GeofenceCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    vehicle = db.query(Vehicle).filter(Vehicle.id == payload.vehicle_id, Vehicle.owner_id == current_user.id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
        
    db_fence = Geofence(
        vehicle_id=payload.vehicle_id,
        name=payload.name,
        center_lat=payload.center_lat,
        center_lng=payload.center_lng,
        radius_m=payload.radius_m,
        active=payload.active
    )
    db.add(db_fence)
    db.commit()
    db.refresh(db_fence)
    return db_fence

@router.get("/vehicle/{vehicle_id}", response_model=List[GeofenceResponse])
def get_vehicle_geofences(vehicle_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    vehicle = db.query(Vehicle).filter(Vehicle.id == vehicle_id, Vehicle.owner_id == current_user.id).first()
    if not vehicle:
        return []
    return db.query(Geofence).filter(Geofence.vehicle_id == vehicle_id).all()

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_geofence(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    fence = db.query(Geofence).join(Vehicle).filter(Geofence.id == id, Vehicle.owner_id == current_user.id).first()
    if not fence:
        raise HTTPException(status_code=404, detail="Geofence not found")
    db.delete(fence)
    db.commit()
    return {"message": "Geofence deleted successfully"}

@router.get("/events/recent", response_model=List[GeofenceEventResponse])
def get_recent_geofence_events(limit: int = 20, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """
    Returns the latest geofence entry/exit violations.
    """
    return db.query(GeofenceEvent).join(Vehicle).filter(Vehicle.owner_id == current_user.id).order_by(GeofenceEvent.occurred_at.desc()).limit(limit).all()
