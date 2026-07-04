# Project Summary & Technical Overview

## 1. Project Overview
This project is a software-based Real-Time Vehicle Tracking and Fleet Management System designed for fleet operators and dispatcher monitoring. The system is architected to interface with dedicated GPS tracking hardware (such as custom Arduino + SIM808/SIM900 or commercial GPS trackers) transmitting telemetry securely over HTTPS/OsmAnd. For development, prototyping, and demonstration purposes, standard smartphones are utilized as tracking clients (acting as hardware simulators) to validate the end-to-end data pipeline. The main objective of the system is to capture real-time GPS telemetry from tracking devices, persist this coordinate history in a database, detect trips and geofence boundary crossings on the fly, and display this data live on an interactive operations dashboard. It also aims to provide dispatchers with downloadable journey reports.

---

## 2. Key Features
* **Live Geolocation Map**: Displays active vehicle positions, speed, and heading indicators on an interactive map.
* **Speed Limit & Overspeed Alerts**: Compares vehicle speeds against custom speed limits and triggers real-time visual alerts on the dashboard if exceeded.
* **Geofence Boundary Controls**: Allows operators to create custom circular zones on the map and logs entrance or exit events.
* **Offline Telemetry Queue**: Temporarily buffers GPS logs in the tracking device's local storage during network dropouts and flushes them when connection returns.
* **Programmatic PDF Journey Reports**: Generates print-ready PDFs summarizing trip durations, distances, speeds, and speed curve charts.
* **Third-Party Tracker & Simulator Compatibility**: Supports integration with native background tracking apps like Traccar Client and GPSLogger acting as hardware simulators during testing.

---

## 3. System Workflow
* **Device Registration**: The operator logs into the dashboard, registers a new vehicle, assigns it a driver, and obtains a unique tracking device token.
* **Tracker Setup**: The operator enters this device token into the tracking device (or mobile simulation client like Traccar Client) and activates tracking.
* **Telemetry Generation**: The tracking device gathers GPS coordinate data, heading, and speed from its hardware sensors every 5 seconds.
* **Network Transmission**: The tracking device sends this data to the backend REST API via HTTP request. If the device loses internet, it queues the telemetry in local storage and flushes it chronologically when the internet reconnects.
* **Backend Processing**: The backend receives the telemetry, translates coordinates to a street address using Nominatim, checks if the speed limit is exceeded, computes whether the coordinates are inside any geofences, and stores the details in the database. It also updates trip metrics, starting a new trip if the vehicle moves, and closing it when the vehicle stops for more than 2 minutes.
* **Real-time Broadcast**: The backend broadcasts the updated coordinates and triggered alerts to the dashboard over WebSockets.
* **Dashboard Visualization**: The dashboard receives the WebSockets message, immediately updates the vehicle's marker on the map, updates the speed curve chart, and displays alert notifications for geofence breaches or overspeed warnings.
* **Auditing and Reporting**: The operator selects a historical trip from the dashboard sidebar, reviews the path, and requests a PDF report, which the server generates programmatically.

---

## 4. Technology Stack
* **Frontend**: React, Vite, Leaflet, Chart.js, Tailwind-inspired CSS.
* **Backend**: Python, FastAPI, SQLAlchemy.
* **Database**: SQLite (local development), PostgreSQL (production).
* **Authentication**: JWT-based Base64 self-signed tokens.
* **Storage**: Local device storage (for offline queueing).
* **AI/ML**: None (Not Applicable).
* **Deployment**: Render (backend application & database), Vercel (frontend client).
* **Other Tools**: ReportLab (PDF Generation), Git.

---

## 5. APIs and External Services Used
* **Nominatim OpenStreetMap API**: Used for reverse geocoding to convert GPS coordinates to physical street addresses in the backend location router.
* **OpenStreetMap Tile Servers**: Used for rendering map layout graphics on the Leaflet-based map interface.

---

## 6. Project Architecture
* The system uses a decoupled client-server architecture with three main blocks: the tracking device (or simulator), the backend API, and the dashboard.
* **The Tracking Device** acts as the data generator, capturing coordinates from the sensors and pushing them to the backend API.
* **The FastAPI Backend** acts as the central processor and database communicator. It ingests the telemetry, checks geofences, manages active trips, saves logs to the database, and broadcasts live updates to the WebSocket server.
* **The React Dashboard** is the visualization layer. It establishes a WebSocket connection with the backend to receive live updates, rendering them on an interactive map and a real-time speed curve graph.

---

## 7. Folder Structure
* `backend/app/routers`: Contains API endpoints grouped by feature (Authentication, Locations, Vehicles, Geofences, Trips).
* `backend/app/services`: Implements processing engines (PDF generation, trip detection, geofence validations).
* `frontend/src/components`: UI components like Leaflet map interfaces and speed curves.
* `frontend/src/App.jsx`: Main React entry point handling state, WebSocket subscriptions, and layout routing.
* `phone-client`: Lightweight tracking simulator files (HTML geolocation, network badges, and service worker caching) representing the hardware client.

---

## 8. Data Flow
1. **Input**: GPS coordinates generated on the tracking device (or simulation client).
2. **Ingestion**: Telemetry HTTP request sent to backend API endpoints.
3. **Analysis**: Coordinates parsed, checked against geofences/speed limits, and resolved to street addresses.
4. **Storage**: Committed to location log and trip tables in the relational database.
5. **Push**: Pushed from the server to connected dashboard sessions via WebSocket.
6. **Output**: Live map updates, visual speed curve graph updates, and alarm popups displayed on the operator's browser.

---

## 9. User Journey
* **Login/Register**: Operator logs in or creates an account.
* **Vehicle/Driver Registration**: Operator registers a new vehicle, adds a driver, and configures speed thresholds.
* **Start Tracking**: The tracking device (or simulator app) is configured with the vehicle token and activated.
* **Live Monitoring**: Operator watches the vehicle move on the map and sees the speed graph update in real-time.
* **Boundary Violation**: Vehicle enters a forbidden geofence zone, triggering an immediate alert on the operator's dashboard.
* **Reporting**: Operator clicks on a finished trip, reviews trip stats, and downloads a PDF summary report.

---

## 10. Future Improvements
* PostGIS integration for complex polygonal geofences.
* Native mobile app wrapper (Capacitor/React Native) for permanent background tracking services.
* Fuel level and engine OBD-II sensor diagnostics integration.
