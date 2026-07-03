from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from ..models import Vehicle, Driver, LocationLog
from ..schemas import VehicleCreate, VehicleResponse, DriverCreate, DriverResponse, LocationLogResponse
from .auth import get_current_user

router = APIRouter(
    prefix="/api",
    tags=["Vehicles & Drivers"]
)

# --- DRIVER ENDPOINTS ---

@router.post("/drivers", response_model=DriverResponse, status_code=status.HTTP_201_CREATED)
def create_driver(driver: DriverCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    db_driver = Driver(name=driver.name, phone=driver.phone, license_no=driver.license_no)
    db.add(db_driver)
    db.commit()
    db.refresh(db_driver)
    return db_driver

@router.get("/drivers", response_model=List[DriverResponse])
def get_drivers(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    return db.query(Driver).all()

@router.delete("/drivers/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_driver(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    driver = db.query(Driver).filter(Driver.id == id).first()
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")
    db.delete(driver)
    db.commit()
    return {"message": "Driver deleted successfully"}


# --- VEHICLE ENDPOINTS ---

@router.post("/vehicles", response_model=VehicleResponse, status_code=status.HTTP_201_CREATED)
def create_vehicle(vehicle: VehicleCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    # Check if reg_number already exists
    existing = db.query(Vehicle).filter(Vehicle.reg_number == vehicle.reg_number).first()
    if existing:
        raise HTTPException(status_code=400, detail="Vehicle with this registration number already exists")
    
    # Check device_token unique
    existing_token = db.query(Vehicle).filter(Vehicle.device_token == vehicle.device_token).first()
    if existing_token:
        raise HTTPException(status_code=400, detail="Device token already assigned to another vehicle")
        
    driver_id = vehicle.driver_id
    if vehicle.driver_name:
        db_driver = Driver(name=vehicle.driver_name)
        db.add(db_driver)
        db.commit()
        db.refresh(db_driver)
        driver_id = db_driver.id

    db_vehicle = Vehicle(
        reg_number=vehicle.reg_number,
        model=vehicle.model,
        driver_id=driver_id,
        device_token=vehicle.device_token,
        speed_limit_kmph=vehicle.speed_limit_kmph
    )
    db.add(db_vehicle)
    db.commit()
    db.refresh(db_vehicle)
    return db_vehicle

@router.get("/vehicles", response_model=List[VehicleResponse])
def get_vehicles(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    vehicles = db.query(Vehicle).all()
    for v in vehicles:
        last_log = db.query(LocationLog).filter(LocationLog.vehicle_id == v.id).order_by(LocationLog.recorded_at.desc()).first()
        if last_log:
            v.latitude = last_log.latitude
            v.longitude = last_log.longitude
            v.speed_kmph = last_log.speed_kmph
            v.heading = last_log.heading
            v.recorded_at = last_log.recorded_at
            v.address = last_log.address
    return vehicles

@router.put("/vehicles/{id}", response_model=VehicleResponse)
def update_vehicle(id: int, vehicle: VehicleCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    db_vehicle = db.query(Vehicle).filter(Vehicle.id == id).first()
    if not db_vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
        
    # Check if reg_number already exists on another vehicle
    if vehicle.reg_number != db_vehicle.reg_number:
        existing = db.query(Vehicle).filter(Vehicle.reg_number == vehicle.reg_number).first()
        if existing:
            raise HTTPException(status_code=400, detail="Vehicle with this registration number already exists")
            
    # Check if device_token already exists on another vehicle
    if vehicle.device_token != db_vehicle.device_token:
        existing_token = db.query(Vehicle).filter(Vehicle.device_token == vehicle.device_token).first()
        if existing_token:
            raise HTTPException(status_code=400, detail="Device token already assigned to another vehicle")
            
    # Handle driver name updates
    if vehicle.driver_name:
        if db_vehicle.driver:
            db_vehicle.driver.name = vehicle.driver_name
        else:
            db_driver = Driver(name=vehicle.driver_name)
            db.add(db_driver)
            db.commit()
            db.refresh(db_driver)
            db_vehicle.driver_id = db_driver.id
    else:
        # Clear driver if it was set
        if db_vehicle.driver:
            old_driver = db_vehicle.driver
            db_vehicle.driver_id = None
            db.delete(old_driver)
            
    db_vehicle.reg_number = vehicle.reg_number
    db_vehicle.model = vehicle.model
    db_vehicle.device_token = vehicle.device_token
    db_vehicle.speed_limit_kmph = vehicle.speed_limit_kmph
    
    db.commit()
    db.refresh(db_vehicle)
    return db_vehicle

@router.get("/vehicles/{id}/live", response_model=Optional[LocationLogResponse])
def get_vehicle_live_location(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    """
    Returns the latest known GPS location log for a vehicle.
    """
    vehicle = db.query(Vehicle).filter(Vehicle.id == id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
        
    last_log = db.query(LocationLog).filter(
        LocationLog.vehicle_id == vehicle.id
    ).order_by(LocationLog.recorded_at.desc()).first()
    
    return last_log

@router.delete("/vehicles/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    vehicle = db.query(Vehicle).filter(Vehicle.id == id).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    driver = vehicle.driver
    db.delete(vehicle)
    if driver:
        db.delete(driver)
    db.commit()
    return {"message": "Vehicle deleted successfully"}
