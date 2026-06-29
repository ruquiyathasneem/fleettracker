# Vehicle Tracking System — Full Project Plan (Phone-as-GPS Edition)

## 1. Goal & Scope

Build a complete vehicle tracking system that replicates every feature of the
hardware (Arduino + SIM808) version, but uses a smartphone as the GPS + GSM
unit. This removes hardware cost and wiring risk, and lets you focus effort on
backend, dashboard, and data features — which is also what's gradable/portfolio-worthy.

**Definition of done:** a working web dashboard showing live vehicle position,
journey history with graphs, geofence alerts, SMS location-on-request, and
PDF report export — backed by a phone app/PWA sending real GPS data.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Phone client | PWA (HTML5 Geolocation API) | Fastest to build, no app store, works on any phone |
| Backend | Python + FastAPI (or Flask) | You already know Python from SmartAgri; FastAPI gives free auto-docs + async |
| Database | PostgreSQL | Relational data (vehicles/drivers/trips) fits well; has geo extensions (PostGIS) if you want polygon geofencing later |
| Realtime push | WebSockets (FastAPI native) | Live dashboard updates without polling |
| Web dashboard | React + Vite | Matches your SmartAgri frontend stack, fast dev loop |
| Maps | Leaflet.js + OpenStreetMap | Free, no API key/billing hassles (swap to Google Maps JS API later if you want the exact look) |
| SMS | Twilio (free trial credits) | Simplest SMS in/out integration, well documented |
| PDF reports | ReportLab (Python) or WeasyPrint | Server-side PDF generation with charts |
| Charts (speed graphs) | Chart.js or Recharts | Easy line/speed-over-time graphs |
| Auth | JWT (FastAPI + python-jose) | Standard, lightweight |
| Hosting (demo) | Render / Railway (backend+DB), Vercel/Netlify (frontend) | Free tiers, good enough for a project demo |

---

## 3. System Architecture (see diagram above)

```
Phone (GPS) --HTTPS POST--> Backend API --writes--> PostgreSQL
                                |--serves--> Web Dashboard (WebSocket + REST)
                                |--triggers--> SMS Gateway (Twilio)
                                |--reads DB--> PDF Report Engine
```

The backend is the single source of truth. Geofencing logic and alerting live
there too — every incoming location ping gets checked against the vehicle's
active geofence before being stored.

---

## 4. Database Schema (PostgreSQL)

```sql
-- Core entities
CREATE TABLE drivers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20),
  license_no VARCHAR(50),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE vehicles (
  id SERIAL PRIMARY KEY,
  reg_number VARCHAR(20) UNIQUE NOT NULL,
  model VARCHAR(100),
  driver_id INTEGER REFERENCES drivers(id),
  device_token VARCHAR(64) UNIQUE NOT NULL, -- identifies which phone belongs to which vehicle
  created_at TIMESTAMP DEFAULT now()
);

-- Live + historical location pings
CREATE TABLE location_logs (
  id BIGSERIAL PRIMARY KEY,
  vehicle_id INTEGER REFERENCES vehicles(id),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  speed_kmph FLOAT,
  heading FLOAT,
  recorded_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);
CREATE INDEX idx_location_vehicle_time ON location_logs(vehicle_id, recorded_at);

-- Journeys (derived: a trip = continuous movement between two stop events)
CREATE TABLE trips (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER REFERENCES vehicles(id),
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  start_lat DOUBLE PRECISION,
  start_lng DOUBLE PRECISION,
  end_lat DOUBLE PRECISION,
  end_lng DOUBLE PRECISION,
  distance_km FLOAT,
  avg_speed_kmph FLOAT,
  max_speed_kmph FLOAT
);

-- Geofences
CREATE TABLE geofences (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER REFERENCES vehicles(id),
  name VARCHAR(100),
  center_lat DOUBLE PRECISION,
  center_lng DOUBLE PRECISION,
  radius_m FLOAT, -- simple circular geofence (start here; polygon is a stretch goal)
  active BOOLEAN DEFAULT true
);

CREATE TABLE geofence_events (
  id SERIAL PRIMARY KEY,
  geofence_id INTEGER REFERENCES geofences(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  event_type VARCHAR(10) CHECK (event_type IN ('enter','exit')),
  occurred_at TIMESTAMP DEFAULT now()
);

-- Users (operators who log into the dashboard)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE,
  password_hash VARCHAR(200),
  role VARCHAR(20) DEFAULT 'operator'
);
```

---

## 5. API Design (FastAPI)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/location` | Phone pushes `{device_token, lat, lng, speed, heading, timestamp}` |
| GET | `/api/vehicles` | List all vehicles + last known location |
| GET | `/api/vehicles/{id}/live` | Latest position for one vehicle |
| WS | `/ws/live` | WebSocket — server pushes location updates to all connected dashboards |
| GET | `/api/vehicles/{id}/trips` | List past trips |
| GET | `/api/trips/{id}` | Trip detail: route points, speed graph data, driver info |
| GET | `/api/trips/{id}/report.pdf` | Generate & stream PDF report |
| POST | `/api/geofences` | Create a geofence for a vehicle |
| GET | `/api/geofences/{vehicle_id}` | List geofences |
| POST | `/api/sms/inbound` | Twilio webhook — incoming SMS triggers location lookup + reply |
| POST | `/api/auth/login` | Dashboard login, returns JWT |
| GET | `/api/drivers`, `/api/vehicles` (CRUD) | Manage driver/vehicle records |

**Geofence check logic** (runs inside the `/api/location` handler, before saving):
```python
def check_geofence(vehicle_id, lat, lng):
    for fence in get_active_geofences(vehicle_id):
        dist = haversine(lat, lng, fence.center_lat, fence.center_lng)
        was_inside = get_last_geofence_state(vehicle_id, fence.id)
        is_inside = dist <= fence.radius_m
        if is_inside != was_inside:
            log_geofence_event(fence.id, vehicle_id, "enter" if is_inside else "exit")
            notify(vehicle_id, fence, is_inside)  # push to dashboard + optionally SMS/email
```

---

## 6. Feature → Implementation Map

| # | Feature | How it's built (phone-based) |
|---|---|---|
| 1 | Real-time tracking | Phone PWA `watchPosition()` → POST every 5–10s → WebSocket push to dashboard |
| 2 | Journey history | Query `location_logs` grouped into `trips`; render route as Leaflet polyline + Chart.js speed graph |
| 3 | Report generation | `/report.pdf` endpoint: ReportLab page with trip stats table, static map snapshot, speed chart image |
| 4 | Geofencing | Haversine distance check on every ping (see above); circular fences are the MVP, polygon is a stretch goal |
| 5 | SMS location service | Twilio webhook receives SMS → look up vehicle's last `location_logs` row → reply with `https://maps.google.com/?q=lat,lng` |
| 6 | GPS-based tracking | Native phone GPS via browser Geolocation API (no hardware) |
| 7 | GSM communication | Replaced by phone's mobile data — same HTTPS POST as #1 |
| 8 | Web dashboard | React + Leaflet, multi-vehicle marker view, click vehicle → live popup |
| 9 | Google Maps integration | Leaflet+OSM (free) for MVP; can swap tiles to Google Maps JS API later if needed |
| 10 | Driver/vehicle monitoring | CRUD pages + trip stats per driver (total distance, avg speed, trip count) |
| 11 | Low-cost hardware | N/A — phone replaces Arduino+SIM808 entirely; mention this substitution explicitly in your report/demo |
| 12 | Applications | Same use cases apply — demo with 2-3 simulated "vehicles" (your phone + 1-2 emulated devices using a script that posts fake coordinates) |

---

## 7. Build Order & Timeline (6–7 weeks, part-time)

**Week 1 — Foundation**
- Set up PostgreSQL + FastAPI skeleton, define schema, set up Alembic migrations
- Build `/api/location` POST endpoint, test with Postman/curl
- Build the PWA: a single HTML page with `watchPosition()` that POSTs to your endpoint
- Milestone: your own phone's location is landing in the database every few seconds

**Week 2 — Live dashboard core**
- React app: Leaflet map, marker for each vehicle
- WebSocket endpoint pushing new pings to connected clients
- Vehicle CRUD (add a vehicle, get a `device_token`, paste into the PWA)
- Milestone: open dashboard on laptop, walk around with phone, watch the marker move live

**Week 3 — History & trips**
- Trip-detection logic (a trip starts after movement begins post-idle, ends after N minutes stationary)
- Trip list + detail page: polyline route, Chart.js speed-vs-time graph
- Driver records + linking driver to vehicle
- Milestone: after a walk/drive, a trip appears in history with a route and graph

**Week 4 — Geofencing**
- Geofence CRUD UI (click-to-place circle on the map, set radius)
- Backend enter/exit detection + event log
- Dashboard toast/notification on geofence event (WebSocket push)
- Milestone: leave a defined zone, see an alert appear in real time

**Week 5 — SMS + Reports**
- Twilio account setup, webhook wired to `/api/sms/inbound`
- Reply logic: parse incoming SMS, look up vehicle by sender's registered number or a vehicle-ID keyword, send back Maps link
- PDF report: ReportLab template with trip summary table + embedded chart image + static map image (use a map-snapshot library or just embed the route as an image)
- Milestone: text a keyword to your Twilio number, get a Maps link back; download a PDF for any trip

**Week 6 — Auth, polish, multi-vehicle demo**
- Login page + JWT-protected dashboard routes
- Write a small "fake vehicle" Python script that posts simulated GPS pings along a route (so your demo has 2-3 vehicles, not just one phone)
- UI polish: vehicle list sidebar, status indicators (online/offline based on last-ping time), basic responsive layout
- Milestone: full demo-ready system with multiple vehicles, history, geofence alerts, SMS, and PDF export

**Week 7 — Buffer / report writing**
- Bug fixes, edge cases (lost GPS signal, phone offline, trip-detection tuning)
- Write up the project report — explicitly document the phone-as-GPS/GSM substitution and justify it (cost, reliability, scope) since this differs from the original hardware spec
- Record a demo video as backup in case live demo has network issues

---

## 8. Suggested Folder Structure

```
vehicle-tracker/
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── models.py          # SQLAlchemy models
│   │   ├── schemas.py         # Pydantic schemas
│   │   ├── routers/
│   │   │   ├── location.py
│   │   │   ├── vehicles.py
│   │   │   ├── trips.py
│   │   │   ├── geofences.py
│   │   │   ├── sms.py
│   │   │   └── auth.py
│   │   ├── services/
│   │   │   ├── geofence_check.py
│   │   │   ├── trip_detector.py
│   │   │   └── pdf_report.py
│   │   └── ws_manager.py
│   ├── alembic/               # DB migrations
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/ (Dashboard, TripDetail, Geofences, Login)
│   │   ├── components/ (MapView, SpeedChart, VehicleList)
│   │   └── api/ (axios/fetch wrappers, websocket client)
│   └── package.json
├── phone-client/
│   └── tracker.html           # standalone PWA, just one file
└── scripts/
    └── simulate_vehicle.py    # fake GPS pings for demo
```

---

## 9. Stretch Goals (if time allows)

- Polygon geofences instead of circles (PostGIS `ST_Contains`)
- Push notifications (not just SMS) via Firebase Cloud Messaging
- Driver behavior scoring (harsh braking/acceleration estimated from speed deltas)
- Offline buffering on the phone client (queue pings if no signal, flush when reconnected)
- Convert the PWA into an installable Android app (Capacitor wraps your existing HTML/JS with near-zero rewrite)

---

## 10. Risks & How to Handle Them

| Risk | Mitigation |
|---|---|
| Browser throttles GPS when phone screen is off/tab backgrounded | Use a native Android app (Capacitor or plain Kotlin) with a foreground service for a more reliable demo; PWA is fine for short demos |
| Twilio free trial limits (verified numbers only) | Fine for a demo — verify your own number and 1-2 test numbers |
| GPS drift indoors | Demo outdoors or accept noisy data; mention this as a known GPS limitation in your report |
| Running out of time before deadline | Weeks 1-4 (tracking, dashboard, history, geofencing) are the must-haves; SMS and PDF (week 5) can be trimmed to "SMS only" or "PDF only" if squeezed |
