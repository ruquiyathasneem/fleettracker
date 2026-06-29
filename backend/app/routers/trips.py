from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models import Trip, LocationLog, Vehicle, Driver
from ..schemas import TripResponse, TripDetailResponse
from ..services.pdf_report import generate_trip_pdf
from .auth import get_current_user

router = APIRouter(
    prefix="/api",
    tags=["Trips & History"]
)

@router.get("/vehicles/{vehicle_id}/trips", response_model=List[TripResponse])
def get_vehicle_trips(vehicle_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """
    Returns list of all trips (completed and active) for a vehicle.
    """
    return db.query(Trip).filter(Trip.vehicle_id == vehicle_id).order_by(Trip.start_time.desc()).all()

@router.get("/trips/{id}", response_model=TripDetailResponse)
def get_trip_details(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """
    Returns detailed trip metrics along with the GPS path logs recorded during that trip.
    """
    trip = db.query(Trip).filter(Trip.id == id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
        
    # Get all logs for this vehicle during the trip window
    query = db.query(LocationLog).filter(
        LocationLog.vehicle_id == trip.vehicle_id,
        LocationLog.recorded_at >= trip.start_time
    )
    
    if trip.end_time:
        query = query.filter(LocationLog.recorded_at <= trip.end_time)
        
    route_points = query.order_by(LocationLog.recorded_at.asc()).all()
    
    # Query vehicle details
    vehicle = db.query(Vehicle).filter(Vehicle.id == trip.vehicle_id).first()
    
    return {
        "id": trip.id,
        "vehicle_id": trip.vehicle_id,
        "start_time": trip.start_time,
        "end_time": trip.end_time,
        "start_lat": trip.start_lat,
        "start_lng": trip.start_lng,
        "end_lat": trip.end_lat,
        "end_lng": trip.end_lng,
        "distance_km": trip.distance_km,
        "avg_speed_kmph": trip.avg_speed_kmph,
        "max_speed_kmph": trip.max_speed_kmph,
        "route_points": route_points,
        "vehicle": vehicle
    }

@router.get("/trips/{id}/report.pdf")
def get_trip_report_pdf(id: int, db: Session = Depends(get_db)):
    """
    Generates and streams a professional PDF report for a vehicle trip.
    Accessible without JWT so it can easily be shared, printed, or downloaded via link.
    """
    trip = db.query(Trip).filter(Trip.id == id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
        
    # Get all route points
    query = db.query(LocationLog).filter(
        LocationLog.vehicle_id == trip.vehicle_id,
        LocationLog.recorded_at >= trip.start_time
    )
    if trip.end_time:
        query = query.filter(LocationLog.recorded_at <= trip.end_time)
        
    route_points = query.order_by(LocationLog.recorded_at.asc()).all()
    
    # Get vehicle and driver details
    vehicle = db.query(Vehicle).filter(Vehicle.id == trip.vehicle_id).first()
    driver_name = "Unassigned"
    reg_number = "Unknown"
    
    if vehicle:
        reg_number = vehicle.reg_number
        if vehicle.driver:
            driver_name = vehicle.driver.name
            
    # Generate PDF
    pdf_buffer = generate_trip_pdf(trip, route_points, driver_name, reg_number)
    
    filename = f"trip_report_{reg_number}_{trip.id}.pdf"
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename={filename}"
        }
    )
