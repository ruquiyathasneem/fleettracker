# Real-Time Vehicle Tracking & Fleet Management System

A production-ready fleet tracking and vehicle monitoring system. This project replaces expensive hardware GPS/GSM tracking units (like Arduino + SIM808) by using any standard smartphone as the tracking device, communicating location coordinates securely over standard HTTPS and WebSockets.

---

## 🚀 Key Features

### 📡 1. Live Geolocation Tracking
* **Smartphone Tracker Client (PWA)**: Reads native GPS hardware via the HTML5 Geolocation API, reporting latitude, longitude, heading, and speed.
* **WebSocket Synced Dashboard**: The React desktop dashboard centers and tracks vehicles in real time on a Leaflet map.

### 📶 2. Offline Telemetry Buffering (Robust Tracking)
* If the smartphone enters a tunnel or loses network connectivity, location logs are queued locally in the browser's `localStorage` (up to 1000 logs).
* Once internet access is restored, the phone client automatically flushes buffered coordinates sequentially to the server, preventing route gaps.

### 🚨 3. Configurable Speed Limits & Overspeeding Alerts
* Enforce unique speed limits per vehicle (configurable from the dashboard).
* Telemetry exceeding the limit triggers real-time overspeed warning popups on the dashboard and logs violation events.

### ⚠️ 4. Circular Geofencing & Event Logs
* Operators can click directly on the map to define circular geofences (custom radius in meters).
* Entering or exiting a zone triggers instant websocket notification toasts on the dashboard and logs geofence violations.

### 📊 5. Automated PDF Performance Reports
* Generates premium PDF reports for any trip.
* Includes journey summary statistics (max/avg speed, total distance, durations), origin/destination addresses, sampled log tables, and custom-drawn vector charts plotting speed over time.

---

## 🛠️ Tech Stack

* **Backend**: Python 3.10+, FastAPI (Asynchronous web framework), SQLAlchemy (ORM).
* **Database**: SQLite (Development) / PostgreSQL / Supabase (Production).
* **Frontend**: React, Vite, Leaflet (OpenStreetMap), Tailwind-inspired custom CSS.
* **Real-time Engine**: WebSockets.
* **Report Engine**: ReportLab (PDF Generation).

---

## 💻 Local Setup & Run

### 1. Run the Backend (Python)
Ensure python is installed, then navigate to `backend`, set up a virtual environment, and launch:
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 2. Run the Frontend (React/Vite)
Navigate to `frontend`, install dependencies, and launch:
```bash
cd frontend
npm install
npm run dev
```

---

## ☁️ Cloud Deployment Configuration
This project includes pre-configured deployment settings:
* **Render**: Configured via [render.yaml](./render.yaml) for a 1-click Python backend and database build.
* **Vercel**: Fully ready for Vite React project build using standard frontend settings.
