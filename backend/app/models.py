from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, BigInteger
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base

class Driver(Base):
    __tablename__ = "drivers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    phone = Column(String(20))
    license_no = Column(String(50))
    created_at = Column(DateTime, default=func.now())

    vehicles = relationship("Vehicle", back_populates="driver")


class Vehicle(Base):
    __tablename__ = "vehicles"

    id = Column(Integer, primary_key=True, index=True)
    reg_number = Column(String(20), unique=True, nullable=False, index=True)
    model = Column(String(100))
    driver_id = Column(Integer, ForeignKey("drivers.id"), nullable=True)
    device_token = Column(String(64), unique=True, nullable=False, index=True)
    speed_limit_kmph = Column(Float, default=80.0, nullable=False)
    created_at = Column(DateTime, default=func.now())

    driver = relationship("Driver", back_populates="vehicles")
    location_logs = relationship("LocationLog", back_populates="vehicle", cascade="all, delete-orphan")
    trips = relationship("Trip", back_populates="vehicle", cascade="all, delete-orphan")
    geofences = relationship("Geofence", back_populates="vehicle", cascade="all, delete-orphan")


class LocationLog(Base):
    __tablename__ = "location_logs"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    speed_kmph = Column(Float)
    heading = Column(Float)
    recorded_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=func.now())
    address = Column(String(250), nullable=True)

    vehicle = relationship("Vehicle", back_populates="location_logs")


class Trip(Base):
    __tablename__ = "trips"

    id = Column(Integer, primary_key=True, index=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    start_time = Column(DateTime)
    end_time = Column(DateTime)
    start_lat = Column(Float)
    start_lng = Column(Float)
    end_lat = Column(Float)
    end_lng = Column(Float)
    distance_km = Column(Float, default=0.0)
    avg_speed_kmph = Column(Float, default=0.0)
    max_speed_kmph = Column(Float, default=0.0)
    # Human-readable addresses resolved via reverse geocoding
    start_address = Column(String(350), nullable=True)
    end_address = Column(String(350), nullable=True)

    vehicle = relationship("Vehicle", back_populates="trips")


class Geofence(Base):
    __tablename__ = "geofences"

    id = Column(Integer, primary_key=True, index=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    name = Column(String(100), nullable=False)
    center_lat = Column(Float, nullable=False)
    center_lng = Column(Float, nullable=False)
    radius_m = Column(Float, nullable=False) # circular radius in meters
    active = Column(Boolean, default=True)

    vehicle = relationship("Vehicle", back_populates="geofences")
    events = relationship("GeofenceEvent", back_populates="geofence", cascade="all, delete-orphan")


class GeofenceEvent(Base):
    __tablename__ = "geofence_events"

    id = Column(Integer, primary_key=True, index=True)
    geofence_id = Column(Integer, ForeignKey("geofences.id"), nullable=False)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    event_type = Column(String(10)) # 'enter' or 'exit'
    occurred_at = Column(DateTime, default=func.now())

    geofence = relationship("Geofence", back_populates="events")
    vehicle = relationship("Vehicle")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    password_hash = Column(String(200), nullable=False)
    role = Column(String(20), default="operator")


class OverspeedEvent(Base):
    __tablename__ = "overspeed_events"

    id = Column(Integer, primary_key=True, index=True)
    vehicle_id = Column(Integer, ForeignKey("vehicles.id"), nullable=False)
    speed_kmph = Column(Float, nullable=False)
    speed_limit_kmph = Column(Float, nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    occurred_at = Column(DateTime, nullable=False)
    address = Column(String(250), nullable=True)

    vehicle = relationship("Vehicle")
