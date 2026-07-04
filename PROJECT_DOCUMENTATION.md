# Real-Time Vehicle Tracking & Fleet Management System
## Comprehensive Project Overview & Technical Documentation

This project is a production-grade, highly optimized fleet tracking and vehicle monitoring system. The system is architected to interface with dedicated GPS tracking hardware (such as custom Arduino + SIM808/SIM900 or commercial GPS trackers) transmitting telemetry securely over HTTPS/OsmAnd. For development, prototyping, and demonstration purposes, standard smartphones are utilized as tracking clients (acting as hardware simulators) to validate the end-to-end data pipeline. Telemetry is securely transmitted over HTTPS and WebSockets to a centralized operations dashboard.

---

## 📖 Table of Contents
1. [System Architecture](#-system-architecture)
2. [Key Features](#-key-features)
3. [Technology Stack](#-technology-stack)
4. [Database Schema](#-database-schema)
5. [API Reference (REST & WebSockets)](#-api-reference-rest--websockets)
6. [Telemetry Ingestion Pipeline](#-telemetry-ingestion-pipeline)
7. [Third-Party Client Integrations (Traccar & GPSLogger)](#-third-party-client-integrations-traccar--gpslogger)
8. [Reliability & Production Optimizations](#-reliability--production-optimizations)
9. [Use Cases & Business Applications](#-use-cases--business-applications)
10. [Local Development & Setup](#-local-development--setup)

---

## 🏗️ System Architecture

The system is built as a decoupled, client-server application optimized for low latency and high availability. It consists of three primary layers:
1. **Edge Tracking Layers (Hardware/Simulator)**: 
   * A progressive web application (PWA) client running in standard mobile browsers acting as a hardware simulator.
   * Third-party native clients (Traccar Client, GPSLogger) acting as background tracking simulators during development.
2. **Central Ingestion & Query API (Backend)**: Built with Python and FastAPI, serving REST endpoints and managing live WebSocket broadcasts.
3. **Operations Dashboard (Frontend)**: A single-page React application rendering real-time maps, metrics, geofence configuration panels, and interactive telemetry charts.

### High-Level Data Flow
```
Tracking Device (GPS Pings / Simulator) --HTTPS POST--> FastAPI Ingestion Router -> SQLAlchemy -> PostgreSQL / SQLite
                                            |
                                            +--> Broadcasting via WS Manager Rooms ---> React Map & Charts
```

---

## 🚀 Key Features

### 1. Live Geolocation Tracking
* **Smart Telemetry Reporting**: Captures coordinates (latitude, longitude), instantaneous hardware speed, bearing/heading, and precision timestamps.
* **Leaflet Map Integration**: Places real-time SVG markers on an OpenStreetMap interface with bearing indicators rotating dynamically to match the vehicle's direction of travel.

### 2. Offline Telemetry Buffering
* **Network-Resilient Logging**: The tracking device (or simulator) stores telemetry records in its local storage when internet coverage is degraded (e.g., inside tunnels or remote areas).
* **Automatic Queue Flushing**: Once internet access is restored, the device flushes queued logs sequentially to prevent missing points, ensuring zero-gap trip history.

### 3. Circular Geofencing & Event Logs
* **Map-to-Database Geofencing**: Operators define circular geofences by clicking on the Leaflet map and specifying a radius in meters.
* **Haversine Math Processor**: Every single incoming ping is checked on the fly against active geofences. Entrance and exit events trigger instant warning toasts and are stored for auditing.

### 4. Custom-Generated PDF Trip Reports
* **On-Demand Generation**: Generates standard letter-sized PDF journey reports.
* **Journey Metrics**: Computes start/end times, total travel time, overall distance in kilometers, max speed, and average moving speed.
* **Vector Data Visualization**: ReportLab builds a visual speed-over-time vector graph directly within the PDF flow without relying on external image generation packages.


---

## 🛠️ Tech Stack

| Layer | Component | Description |
| :--- | :--- | :--- |
| **Backend** | Python 3.10+ | Primary language environment. |
| | FastAPI | Modern, asynchronous, high-performance web framework. |
| | SQLAlchemy | Object Relational Mapper (ORM) configured with declarative models. |
| | psycopg2-binary | PostgreSQL driver for cloud deployment. |
| | httpx / requests | Async and sync HTTP engines for self-pings and reverse geocoding queries. |
| | ReportLab | Programmatic vector drawing and PDF document builder. |
| **Database**| SQLite / PostgreSQL | Relational prototyping database scaling to cloud database providers (e.g. Supabase). |
| **Frontend** | React 18 / Vite | Component-driven frontend built with fast Vite bundling. |
| | Leaflet & React-Leaflet| Interactive mapping framework running OpenStreetMap tiling. |
| | Chart.js & React-Chartjs-2 | Visual speed line-graph plotting with zero-animation overrides. |
| | Lucide React | Clean, scalable vector dashboard iconography. |

---

## 🗄️ Database Schema

The relational schema is structured as follows:

```sql
-- Users (Operators, Administrators)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'operator',
    created_at TIMESTAMP DEFAULT now()
);

-- Drivers
CREATE TABLE drivers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    license_no VARCHAR(50),
    owner_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT now()
);

-- Vehicles
CREATE TABLE vehicles (
    id SERIAL PRIMARY KEY,
    reg_number VARCHAR(20) UNIQUE NOT NULL,
    model VARCHAR(100),
    driver_id INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
    device_token VARCHAR(64) UNIQUE NOT NULL, -- Hardware / client mapping key
    speed_limit_kmph FLOAT DEFAULT 80.0,
    owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    latitude FLOAT,
    longitude FLOAT,
    speed_kmph FLOAT DEFAULT 0.0,
    heading FLOAT DEFAULT 0.0,
    recorded_at TIMESTAMP,
    address VARCHAR(250),
    created_at TIMESTAMP DEFAULT now()
);

-- Location Logs (Raw Telemetry Streams)
CREATE TABLE location_logs (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    speed_kmph FLOAT,
    heading FLOAT,
    recorded_at TIMESTAMP NOT NULL,
    address VARCHAR(250),
    created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX idx_location_vehicle_time ON location_logs(vehicle_id, recorded_at);

-- Trips (Continuous Journey Segments)
CREATE TABLE trips (
    id SERIAL PRIMARY KEY,
    vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP,
    start_lat DOUBLE PRECISION NOT NULL,
    start_lng DOUBLE PRECISION NOT NULL,
    end_lat DOUBLE PRECISION,
    end_lng DOUBLE PRECISION,
    distance_km FLOAT DEFAULT 0.0,
    avg_speed_kmph DEFAULT 0.0,
    max_speed_kmph DEFAULT 0.0,
    start_address VARCHAR(250),
    end_address VARCHAR(250)
);

-- Geofences (Virtual Boundaries)
CREATE TABLE geofences (
    id SERIAL PRIMARY KEY,
    vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    center_lat DOUBLE PRECISION NOT NULL,
    center_lng DOUBLE PRECISION NOT NULL,
    radius_m FLOAT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT now()
);

-- Geofence Events (Boundaries Violations Logging)
CREATE TABLE geofence_events (
    id SERIAL PRIMARY KEY,
    geofence_id INTEGER REFERENCES geofences(id) ON DELETE CASCADE,
    vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
    event_type VARCHAR(10) NOT NULL, -- 'enter' or 'exit'
    occurred_at TIMESTAMP NOT NULL
);

-- Overspeed Events
CREATE TABLE overspeed_events (
    id SERIAL PRIMARY KEY,
    vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
    speed_kmph FLOAT NOT NULL,
    speed_limit_kmph FLOAT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    occurred_at TIMESTAMP NOT NULL,
    address VARCHAR(250)
);
```

---

## 🔌 API Reference (REST & WebSockets)

### 🔑 Authentication (`/api/auth`)
* `POST /api/auth/register`: Create a new operator.
* `POST /api/auth/login`: Authenticate and obtain a Base64 self-signed access token.

### 📡 Telemetry Ingest (`/api/location`)
* `POST /api/location`: Base endpoint for JSON telemetry from the PWA client.
* `GET /api/location/gpslogger`: Specialized ingestion hook for the GPSLogger Android client.
* `GET /api/location/traccar`: Specialized endpoint translating OsmAnd protocols (knots to km/h) for Traccar Client.

### 🚗 Vehicle Management (`/api/vehicles`)
* `GET /api/vehicles`: Retrieves all registered vehicles with nested latest coordinates.
* `POST /api/vehicles`: Register a new vehicle and map it to a tracking device token.
* `PUT /api/vehicles/{id}`: Update vehicle properties (reg number, speed limits).
* `DELETE /api/vehicles/{id}`: Unregister a vehicle and clean up associated historical telemetry.

### 📍 Geofencing System (`/api/geofences`)
* `GET /api/geofences/vehicle/{vehicle_id}`: List all geofences bound to a vehicle.
* `POST /api/geofences`: Create a circular geofence boundary.
* `DELETE /api/geofences/{id}`: Delete a geofence.

### 📊 Trip Histories & PDF Reports (`/api/trips`)
* `GET /api/vehicles/{vehicle_id}/trips`: Query all completed and active trips of a vehicle.
* `GET /api/trips/{id}`: Fetch detailed trip statistics and raw path log arrays.
* `GET /api/trips/{id}/report.pdf`: Streams a compiled journey summary PDF containing a custom ReportLab speed curve chart.

### 🔌 Live Subscription Engine (WebSockets)
* `WS /ws/live?token={url_encoded_token}`: Real-time telemetry connection. Pushes location coordinates, current speed, geofence notifications, and speed warnings.

---

## 🧭 Telemetry Ingestion Pipeline

When a tracking client pings the backend, the location is processed through the following pipeline:

1. **Resolve Vehicle by Device Token**: Map incoming telemetry payload to the registered vehicle database row.
2. **Reverse Geocoding Address Lookup**: Check the local spatial cache first; if missing, perform an async reverse lookup using Nominatim.
3. **Commit Raw Telemetry Log**: Store the timestamped latitude, longitude, heading, and speed value.
4. **Evaluate Overspeed Thresholds**: Match current telemetry speed against vehicle configuration speed limits. If exceeded, save an overspeed event record.
5. **Evaluate Geofence Transitions**: Run Haversine mathematical formulas on all geofences assigned to this vehicle. Generate alerts if entrance or exit events occur.
6. **Increment Active Journey Stats**: Track start conditions, cumulative distances, peak velocity, average speeds, and evaluate trip termination conditions.
7. **Broadcast Live WebSocket Event**: Push the telemetry payload down active user sockets.

---

## 📱 Third-Party Client Integrations (Traccar & GPSLogger)

To bypass web browser limitations where mobile operating systems aggressively suspend inactive apps, you can use specialized, native client tracking applications:

### 1. Traccar Client (iOS & Android)
Uses the popular **OsmAnd Protocol** to send location updates:
* **Server URL**: Configure your app to send to:
  `https://your-backend.onrender.com/api/location/traccar`
* **Device Identifier**: Use the vehicle's unique `Device Token`.
* **Telemetry Conversion**: Traccar reports speed in knots; the backend automatically converts this to km/h (`knots * 1.852`) before storing it.

### 2. GPSLogger (Android)
Configure custom logging parameters:
* **Custom URL**: Configure your app to hit:
  `https://your-backend.onrender.com/api/location/gpslogger?token=YOUR_TOKEN&lat=%LAT&lon=%LON&speed=%SPD&dir=%DIR`
* **Telemetry Conversion**: GPSLogger transmits speed in m/s; the backend converts it to km/h (`m_per_sec * 3.6`).

---

## 🛡️ Reliability & Production Optimizations

To ensure the application runs smoothly on standard hosting services (like Render's free tier), the following optimizations are implemented:

1. **FastAPI WebSockets without Dependency Injection**:
   Using FastAPI `Depends()` inside WebSockets leaves database connections dangling on connection losses, leading to pool exhaustion. The database session is managed manually using context-safe `try/finally` blocks, resolving unexpected socket dropouts.
2. **URL-Encoded WebSocket Tokens**:
   Base64 authentication tokens contain `=` characters which confuse proxy servers (such as Render's Nginx ingress). Tokens are URL-encoded in the React frontend and decoded on connection in the backend, stabilizing handshakes.
3. **Internal Self-Ping Keep-Alive**:
   Render's free instance falls asleep after 15 minutes of quiet time. A background task runs on the server, self-pinging `/health` every 14 minutes to keep the backend awake.
4. **Optimistic UI Updates**:
   To make the web client feel instantaneous, geofence creations and deletions are reflected in the UI immediately. In the background, the HTTP request is executed; if it fails, the frontend rolls back the changes and alerts the operator.
5. **Caching Local Lists**:
   Vehicle lists are cached in `localStorage` on load. When logging in, the UI populates immediately from cache, then runs a silent API fetch in the background.

---

## 📈 Use Cases & Business Applications

* **Fleet Logistics & Delivery Tracking**: Real-time vehicle location matching, route optimization, and delivery status verification.
* **Driver Performance Auditing**: Real-time speeding alerts and geofence exit checks prevent vehicle abuse and keep records for monthly performance audits.
* **Journey Cost Estimations**: Automated trip summaries calculate exact route mileage, helping dispatchers easily calculate fuel expenses and generate PDF trip invoice sheets.
* **Asset Security & Anti-Theft**: Operators configure boundary circles around depot parking lots; any unauthorized entry or exit instantly triggers audible dashboard alarms.

---

## 🚀 Local Development & Setup

### Requirements
* Python 3.10+
* Node.js 18+

### Setup steps:

1. **Clone & Install Backend**:
   ```bash
   cd backend
   python -m venv .venv
   # Windows:
   .venv\Scripts\activate
   # macOS/Linux:
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Launch Backend**:
   ```bash
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

3. **Install & Launch Frontend**:
   ```bash
   cd ../frontend
   npm install
   npm run dev
   ```
   Open your browser at `http://localhost:5173`. Select a vehicle, input its device token in the phone-client (`tracker.html`), and begin real-time testing!
