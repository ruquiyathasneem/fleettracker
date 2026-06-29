import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Use Supabase PostgreSQL URL from environment, fall back to local SQLite for development
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./vehicle_tracker.db")

# SQLite needs connect_args={check_same_thread: False} for multithreaded FastAPI/WebSocket use
if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL, connect_args={"check_same_thread": False}
    )
else:
    # PostgreSQL (Supabase) — pool_pre_ping keeps connections alive across idle periods
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
