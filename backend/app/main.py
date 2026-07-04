from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base, SessionLocal
from .routers import auth, location, vehicles, geofences, trips, sms
from .ws_manager import manager
from .models import User, Driver, Vehicle, Geofence
import logging
import os
import asyncio
import httpx
from urllib.parse import unquote
from sqlalchemy import text

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
        # 1. Ensure at least one user exists (required for migrations to satisfy NOT NULL foreign keys)
        if db.query(User).count() == 0:
            logger.info("Seeding default user...")
            admin_user = User(username="admin", password_hash="admin123", role="admin")
            db.add(admin_user)
            db.commit()
            
        default_user = db.query(User).first()
        fallback_owner_id = default_user.id if default_user else 1

        # 2. Run migrations for multi-tenant setup (add owner_id if missing)
        try:
            db.execute(text('ALTER TABLE drivers ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);'))
            db.execute(text(f'UPDATE drivers SET owner_id = {fallback_owner_id} WHERE owner_id IS NULL;'))
            db.execute(text('ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);'))
            db.execute(text(f'UPDATE vehicles SET owner_id = {fallback_owner_id} WHERE owner_id IS NULL;'))
            db.execute(text('ALTER TABLE geofences ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);'))
            db.execute(text(f'UPDATE geofences SET owner_id = {fallback_owner_id} WHERE owner_id IS NULL;'))
            db.execute(text('ALTER TABLE trips ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id);'))
            db.execute(text(f'UPDATE trips SET owner_id = {fallback_owner_id} WHERE owner_id IS NULL;'))
            db.commit()
            logger.info("Successfully applied multi-tenant schema migrations.")
        except Exception as e:
            logger.error(f"Migration error (safe to ignore if using SQLite): {e}")
            db.rollback()

        # Check if drivers exist
        if db.query(Driver).count() == 0:
            logger.info("Seeding default driver...")
            admin = db.query(User).filter(User.username == "admin").first()
            driver = Driver(name="John Doe", phone="+1234567890", license_no="DL-123456789", owner_id=admin.id if admin else 1)
            db.add(driver)
            db.commit()

        # Check if vehicles exist
        if db.query(Vehicle).count() == 0:
            logger.info("Seeding default vehicle...")
            driver = db.query(Driver).first()
            admin = db.query(User).filter(User.username == "admin").first()
            vehicle = Vehicle(
                reg_number="KA-01-MH-5678",
                model="Tesla Model 3",
                driver_id=driver.id if driver else None,
                device_token="tracker-device-123",
                owner_id=admin.id if admin else 1
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

# --- KEEP-ALIVE: ping /health every 14 min to prevent Render free tier from sleeping ---
async def keep_alive():
    """
    Background task: pings this server's own /health endpoint every 14 minutes.
    Render free tier sleeps after 15 minutes of inactivity. This prevents that.
    """
    self_url = os.getenv("RENDER_EXTERNAL_URL", "").rstrip("/")
    if not self_url:
        logger.info("keep_alive: RENDER_EXTERNAL_URL not set, skipping self-ping.")
        return
    await asyncio.sleep(60)  # Wait 1 minute after startup before first ping
    while True:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(f"{self_url}/health")
                logger.info(f"keep_alive: self-ping {r.status_code}")
        except Exception as e:
            logger.warning(f"keep_alive: self-ping failed: {e}")
        await asyncio.sleep(14 * 60)  # every 14 minutes

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(keep_alive())

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

@app.get("/health")
def health_check():
    return {"status": "ok"}

# --- WEBSOCKET ENDPOINT ---

@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket, token: str = None, db: SessionLocal = Depends(SessionLocal)):
    """
    WebSocket endpoint for pushing real-time location logs 
    and geofence alerts directly to frontend dashboard clients.
    """
    if not token:
        await websocket.close(code=1008)
        return
        
    from .routers.auth import verify_token
    # URL-decode the token — Base64 '=' padding gets percent-encoded in WebSocket URLs
    decoded_token = unquote(token)
    payload = verify_token(decoded_token)
    if not payload:
        await websocket.close(code=1008)
        return
        
    user = db.query(User).filter(User.username == payload.get("username")).first()
    if not user:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, user.id)
    logger.info(f"WebSocket client connected for user {user.username}. Active users connected: {len(manager.active_connections)}")
    try:
        while True:
            # We keep connection open and listen for any heartbeat/messages from client
            # (Clients don't need to post location data here, they use the POST /api/location API)
            data = await websocket.receive_text()
            # Respond to client ping to keep connection alive
            await websocket.send_json({"event_type": "pong", "message": "heartbeat ok"})
    except WebSocketDisconnect:
        manager.disconnect(websocket, user.id)
        logger.info(f"WebSocket client disconnected for user {user.username}.")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket, user.id)
