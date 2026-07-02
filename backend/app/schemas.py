from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List

# --- DRIVER SCHEMAS ---
class DriverBase(BaseModel):
    name: str
    phone: Optional[str] = None
    license_no: Optional[str] = None

class DriverCreate(DriverBase):
    pass

class DriverResponse(DriverBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

# --- VEHICLE SCHEMAS ---
class VehicleBase(BaseModel):
    reg_number: str
    model: Optional[str] = None
    driver_id: Optional[int] = None
    device_token: str
    speed_limit_kmph: Optional[float] = 80.0

class VehicleCreate(VehicleBase):
    driver_name: Optional[str] = None

class VehicleResponse(VehicleBase):
    id: int
    created_at: datetime
    driver: Optional[DriverResponse] = None

    class Config:
        from_attributes = True

# --- LOCATION INGESTION / LOG SCHEMAS ---
class LocationLogCreate(BaseModel):
    device_token: str
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    speed_kmph: Optional[float] = 0.0
    heading: Optional[float] = 0.0
    recorded_at: Optional[datetime] = None  # defaults to server time if not provided
    address: Optional[str] = None

class LocationLogResponse(BaseModel):
    id: int
    vehicle_id: int
    latitude: float
    longitude: float
    speed_kmph: Optional[float]
    heading: Optional[float]
    recorded_at: datetime
    address: Optional[str] = None

    class Config:
        from_attributes = True

# --- GEOFENCE SCHEMAS ---
class GeofenceBase(BaseModel):
    name: str
    center_lat: float
    center_lng: float
    radius_m: float
    active: Optional[bool] = True

class GeofenceCreate(GeofenceBase):
    vehicle_id: int

class GeofenceResponse(GeofenceBase):
    id: int
    vehicle_id: int

    class Config:
        from_attributes = True


class GeofenceEventResponse(BaseModel):
    id: int
    geofence_id: int
    vehicle_id: int
    event_type: str
    occurred_at: datetime
    geofence: Optional[GeofenceResponse] = None

    class Config:
        from_attributes = True


class OverspeedEventResponse(BaseModel):
    id: int
    vehicle_id: int
    speed_kmph: float
    speed_limit_kmph: float
    latitude: float
    longitude: float
    occurred_at: datetime
    address: Optional[str] = None

    class Config:
        from_attributes = True


# --- TRIP SCHEMAS ---
class TripResponse(BaseModel):
    id: int
    vehicle_id: int
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    start_lat: Optional[float] = None
    start_lng: Optional[float] = None
    end_lat: Optional[float] = None
    end_lng: Optional[float] = None
    distance_km: float
    avg_speed_kmph: float
    max_speed_kmph: float
    start_address: Optional[str] = None
    end_address: Optional[str] = None

    class Config:
        from_attributes = True


# Extended trip representation with route coordinates
class TripDetailResponse(TripResponse):
    route_points: List[LocationLogResponse] = []
    vehicle: Optional[VehicleResponse] = None

# --- USER & AUTH SCHEMAS ---
class UserBase(BaseModel):
    username: str

class UserCreate(UserBase):
    password: str
    role: Optional[str] = "operator"

class UserResponse(BaseModel):
    id: int
    username: str
    role: str

    class Config:
        from_attributes = True
        orm_mode = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    username: Optional[str] = None
