from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base, SessionLocal
from .routers import auth, location, vehicles, geofences, trips, sms
from .ws_manager import manager
from .models import User, Driver, Vehicle, Geofence
import logging
import os

# Initialize logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create Database tables automatically (simplifies setup)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Vehicle Tracking System API",
    description="Real-Time tracking, geofencing, trips, SMS location and PDF reports API.",
    version="1.0.0"
)

# Set up CORS middleware
# Allow dynamic frontend URL from environment variables
origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
]
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if not frontend_url else origins,
    allow_credentials=True if frontend_url else False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Seed Database with default mock data if empty
def seed_database():
    db = SessionLocal()
    try:
        # Check if users exist
        if db.query(User).count() == 0:
            logger.info("Seeding default user...")
            admin_user = User(username="admin", password_hash="admin123", role="admin")
            db.add(admin_user)
            db.commit()

        # Check if drivers exist
        if db.query(Driver).count() == 0:
            logger.info("Seeding default driver...")
            driver = Driver(name="John Doe", phone="+1234567890", license_no="DL-123456789")
            db.add(driver)
            db.commit()

        # Check if vehicles exist
        if db.query(Vehicle).count() == 0:
            logger.info("Seeding default vehicle...")
            driver = db.query(Driver).first()
            vehicle = Vehicle(
                reg_number="KA-01-MH-5678",
                model="Tesla Model 3",
                driver_id=driver.id if driver else None,
                device_token="tracker-device-123"
            )
            db.add(vehicle)
            db.commit()
            
            # Seed default geofence centered on coordinate 12.9716, 77.5946 (Bangalore)
            # radius 500 meters
            geofence = Geofence(
                vehicle_id=vehicle.id,
                name="Bangalore Office Area",
                center_lat=12.9716,
                center_lng=77.5946,
                radius_m=500.0,
                active=True
            )
            db.add(geofence)
            db.commit()
            logger.info("Database seeded successfully!")
    except Exception as e:
        logger.error(f"Error seeding database: {e}")
        db.rollback()
    finally:
        db.close()

from fastapi.staticfiles import StaticFiles
import os

# Mount the static phone tracker files
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(os.path.dirname(current_dir))
phone_client_dir = os.path.join(project_root, "phone-client")
print(f"MOUNTING TRACKER CLIENT DIR AT: {phone_client_dir}", flush=True)
app.mount("/tracker-client", StaticFiles(directory=phone_client_dir), name="tracker-client")

seed_database()

# Register routers
app.include_router(auth.router)
app.include_router(location.router)
app.include_router(vehicles.router)
app.include_router(geofences.router)
app.include_router(trips.router)
app.include_router(sms.router)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Vehicle Tracking System",
        "docs_url": "/docs"
    }

# --- WEBSOCKET ENDPOINT ---

@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for pushing real-time location logs 
    and geofence alerts directly to frontend dashboard clients.
    """
    await manager.connect(websocket)
    logger.info(f"WebSocket client connected. Active connections: {len(manager.active_connections)}")
    try:
        while True:
            # We keep connection open and listen for any heartbeat/messages from client
            # (Clients don't need to post location data here, they use the POST /api/location API)
            data = await websocket.receive_text()
            # Respond to client ping to keep connection alive
            await websocket.send_json({"event_type": "pong", "message": "heartbeat ok"})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info(f"WebSocket client disconnected. Active connections: {len(manager.active_connections)}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)
