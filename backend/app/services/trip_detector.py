from sqlalchemy.orm import Session
from ..models import Trip, LocationLog
from .geofence_check import haversine_distance
from datetime import datetime, timedelta

def process_location_for_trip(db: Session, vehicle_id: int, lat: float, lng: float, speed_kmph: float, recorded_at: datetime, address: str = None) -> Trip:
    """
    Analyzes incoming location logs in real time to start, update, or end trips.
    The address parameter is a human-readable reverse-geocoded location string.
    Returns the active or newly created/modified Trip.
    """
    # 1. Find if there is an active trip (end_time is Null)
    active_trip = db.query(Trip).filter(
        Trip.vehicle_id == vehicle_id,
        Trip.end_time == None
    ).first()

    # If speed is None, treat it as 0.0
    speed = speed_kmph if speed_kmph is not None else 0.0

    # 2. If no active trip, see if we should start one (speed > 0.0 km/h since frontend filters drift)
    if not active_trip:
        if speed > 0.0:
            new_trip = Trip(
                vehicle_id=vehicle_id,
                start_time=recorded_at,
                start_lat=lat,
                start_lng=lng,
                distance_km=0.0,
                max_speed_kmph=speed,
                avg_speed_kmph=speed,
                start_address=address  # Store human-readable start location
            )
            db.add(new_trip)
            db.commit()
            db.refresh(new_trip)
            return new_trip
        return None

    # 3. If there is an active trip, update its stats or check if it should end
    # Get the last location log BEFORE the current one to calculate incremental distance
    last_log = db.query(LocationLog).filter(
        LocationLog.vehicle_id == vehicle_id,
        LocationLog.recorded_at < recorded_at
    ).order_by(LocationLog.recorded_at.desc()).first()

    # Calculate time delta
    time_delta_seconds = 0
    if last_log:
        time_delta_seconds = (recorded_at - last_log.recorded_at).total_seconds()

    # Trip stopping conditions:
    # If the vehicle has been stationary or no pings received for more than 5 minutes (300 seconds)
    # We close the trip. For demonstration/simulation, we can also close if speed is 0 and time delta > 60 seconds.
    # Let's check: if speed is 0 and time since last active movement is > 120 seconds, we end the trip.
    # To keep it robust, we'll check if the current speed is 0 and the last log speed was also 0, 
    # and they have been at 0 speed for more than 2 minutes.
    is_stationary = (speed < 2.0)
    
    if is_stationary and last_log and last_log.speed_kmph is not None and last_log.speed_kmph < 2.0:
        time_stationary = (recorded_at - last_log.recorded_at).total_seconds()
        # If stationary for more than 2 minutes, end the trip
        if time_stationary >= 120:
            active_trip.end_time = recorded_at
            active_trip.end_lat = lat
            active_trip.end_lng = lng
            active_trip.end_address = address  # Store human-readable end location
            db.commit()
            db.refresh(active_trip)
            return active_trip

    # If not ending, we update the active trip's path statistics
    if last_log:
        # Distance increment in km (haversine returns meters)
        distance_increment = haversine_distance(
            last_log.latitude, last_log.longitude, lat, lng
        ) / 1000.0
        
        # Prevent adding noise if the vehicle is stationary (GPS drift)
        if speed > 2.0 or distance_increment > 0.01:
            active_trip.distance_km += distance_increment

    # Update max speed
    if speed > active_trip.max_speed_kmph:
        active_trip.max_speed_kmph = speed

    # Update average speed. Retrieve all logs in this trip to compute average speed
    # A simple estimate is: distance / total hours, or averaging speed logs.
    # Averaging speed logs is safer when start_time == end_time or time delta is small.
    trip_logs_count = db.query(LocationLog).filter(
        LocationLog.vehicle_id == vehicle_id,
        LocationLog.recorded_at >= active_trip.start_time,
        LocationLog.recorded_at <= recorded_at
    ).count()

    if trip_logs_count > 0:
        # Sum of speed / count
        # In a real system, we'd do an average query.
        from sqlalchemy import func
        avg_speed = db.query(func.avg(LocationLog.speed_kmph)).filter(
            LocationLog.vehicle_id == vehicle_id,
            LocationLog.recorded_at >= active_trip.start_time,
            LocationLog.recorded_at <= recorded_at
        ).scalar()
        active_trip.avg_speed_kmph = float(avg_speed) if avg_speed is not None else speed
    else:
        active_trip.avg_speed_kmph = (active_trip.avg_speed_kmph + speed) / 2.0

    db.commit()
    db.refresh(active_trip)
    return active_trip
