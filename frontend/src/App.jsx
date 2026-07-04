import React, { useState, useEffect, useRef } from 'react';
import { 
  Truck, MapPin, User, Plus, LogOut, FileText, 
  Navigation, Bell, Wifi, WifiOff, Trash2, Shield, AlertTriangle 
} from 'lucide-react';
import MapView from './components/MapView';
import SpeedChart from './components/SpeedChart';

// Error boundary to prevent entire UI from collapsing on random errors
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: '#f87171', background: '#0f172a', height: '100vh', width: '100vw' }}>
          <h2>UI Crash Detected</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '12px', background: '#1e293b', padding: '10px' }}>
            {this.state.error?.toString()}
          </pre>
          <button onClick={() => window.location.reload()} style={{ padding: '10px', marginTop: '10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '4px' }}>Reload Dashboard</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const WS_BASE  = import.meta.env.VITE_API_BASE
  ? import.meta.env.VITE_API_BASE.replace('https://', 'wss://').replace('http://', 'ws://')
  : 'ws://localhost:8000';

const parseUtcDate = (dateStr) => {
  if (!dateStr) return null;
  // Ensure the date string is parsed as UTC if the backend omitted the 'Z' timezone indicator
  return new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
};

const getRelativeTime = (isoString) => {
  if (!isoString) return 'Offline';
  const diffMs = new Date() - parseUtcDate(isoString);
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return parseUtcDate(isoString).toLocaleDateString();
};

export default function App() {
  // Authentication State
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);

  // Core Data Lists
  const [vehicles, setVehicles] = useState([]);
  const [geofences, setGeofences] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [trips, setTrips] = useState([]);
  
  // Selection States
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [selectedTripId, setSelectedTripId] = useState(null);
  const [activeTripPoints, setActiveTripPoints] = useState([]);

  // Modals Visibility
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showEditVehicleModal, setShowEditVehicleModal] = useState(false);
  const [showGeofenceModal, setShowGeofenceModal] = useState(false);
  const [showGeofenceListModal, setShowGeofenceListModal] = useState(false);

  // New Entity Form Fields
  const [newVehicle, setNewVehicle] = useState({ reg_number: '', model: '', driver_name: '', device_token: '', speed_limit_kmph: 80.0 });
  const [newGeofence, setNewGeofence] = useState({ name: '', center_lat: 0, center_lng: 0, radius_m: 500 });

  // Edit Entity State
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [editVehicleForm, setEditVehicleForm] = useState({ reg_number: '', model: '', driver_name: '', device_token: '', speed_limit_kmph: 80.0 });

  // Trigger UI re-render every 10 seconds to update online/offline relative times
  const [timeTick, setTimeTick] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTimeTick(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  // Keep-alive ping: prevents Render free tier from sleeping (cold starts kill tracker pings)
  useEffect(() => {
    const keepAlive = () => fetch(`${API_BASE}/health`).catch(() => {});
    keepAlive(); // ping immediately on load
    const timer = setInterval(keepAlive, 9 * 60 * 1000); // every 9 minutes
    return () => clearInterval(timer);
  }, []);

  // WebSockets and Toasts
  const [wsConnected, setWsConnected] = useState(false);
  const [toasts, setToasts] = useState([]);
  const wsRef = useRef(null);

  // Helper to add dynamic floating toast notifications
  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 6000);
  };

  // Fetch helper with Authorization headers
  const apiFetch = async (endpoint, options = {}) => {
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers
    };
    const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    if (res.status === 401) {
      handleLogout();
      throw new Error('Unauthorized');
    }
    return res;
  };

  // Fetch initial data once logged in
  useEffect(() => {
    if (!token) return;
    
    const loadData = async () => {
      try {
        // Fetch vehicles (with pre-joined latest coordinates!)
        const vRes = await apiFetch('/api/vehicles');
        const vData = await vRes.json();
        setVehicles(vData);

        // Fetch recent geofence violations
        const eRes = await apiFetch('/api/geofences/events/recent');
        const eData = await eRes.json();
        setRecentEvents(eData);
        
        // Request desktop notification permission on successful login
        if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
          Notification.requestPermission();
        }
      } catch (err) {
        console.error('Failed to load initial metrics', err);
      }
    };
    
    loadData();
    // Poll updates every 15 seconds to ensure sync if websockets drop
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [token]);

  // Auto-select first vehicle on load if none selected
  useEffect(() => {
    if (vehicles.length > 0 && !selectedVehicleId) {
      setSelectedVehicleId(vehicles[0].id);
    }
  }, [vehicles, selectedVehicleId]);

  // Fetch geofences and trips when a vehicle is selected
  useEffect(() => {
    if (!token || !selectedVehicleId) return;

    // Immediately clear path so previous vehicle's route doesn't bleed into new selection
    setActiveTripPoints([]);
    setSelectedTripId(null);

    const loadVehicleSubData = async () => {
      try {
        // Load geofences
        const gRes = await apiFetch(`/api/geofences/vehicle/${selectedVehicleId}`);
        const gData = await gRes.json();
        setGeofences(gData);

        // Load trips
        const tRes = await apiFetch(`/api/vehicles/${selectedVehicleId}/trips`);
        const tData = await tRes.json();
        setTrips(tData);
        
        // Reset selected trip details unless active trip exists
        const activeTrip = tData.find(t => !t.end_time);
        if (activeTrip) {
          setSelectedTripId(activeTrip.id);
        } else if (tData.length > 0) {
          setSelectedTripId(tData[0].id);
        } else {
          setSelectedTripId(null);
          setActiveTripPoints([]);
        }
      } catch (err) {
        console.error(err);
      }
    };

    loadVehicleSubData();
  }, [selectedVehicleId, token]);

  // Fetch trip coordinates when trip selection changes
  useEffect(() => {
    if (!token || !selectedTripId) {
      setActiveTripPoints([]);
      return;
    }

    const loadTripDetails = async () => {
      try {
        const res = await apiFetch(`/api/trips/${selectedTripId}`);
        const data = await res.json();
        console.log('[TRIP] loadTripDetails got', data.route_points?.length, 'points for trip', selectedTripId);
        setActiveTripPoints(data.route_points || []);
      } catch (err) {
        console.error('[TRIP] loadTripDetails error:', err);
      }
    };

    loadTripDetails();
  }, [selectedTripId, token]);

  // Connect WebSockets for Real-time Streaming
  const selectedVehicleIdRef = useRef(selectedVehicleId);
  useEffect(() => {
    selectedVehicleIdRef.current = selectedVehicleId;
  }, [selectedVehicleId]);

  useEffect(() => {
    if (!token) return;

    // Helper to play an audible alert beep
    const playAlertBeep = () => {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.5);
        gain.gain.setValueAtTime(1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      } catch (e) {
        console.error("Audio API error:", e);
      }
    };

    const connectWebSocket = () => {
      const ws = new WebSocket(`${WS_BASE}/ws/live?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onclose = () => {
        setWsConnected(false);
        // Clean up old reference before reconnecting to avoid duplicate handlers
        wsRef.current = null;
        setTimeout(connectWebSocket, 4000);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.event_type === 'location_update') {
          const loc = msg.data;
          console.log('[WS] location_update received:', loc.vehicle_id, 'speed:', loc.speed_kmph, 'selectedVehicle:', selectedVehicleIdRef.current);
          
          // 1. Update matching vehicle coordinates inside list
          setVehicles(prev => prev.map(v => {
            if (v.id === loc.vehicle_id) {
              return {
                ...v,
                latitude: loc.latitude,
                longitude: loc.longitude,
                speed_kmph: loc.speed_kmph,
                heading: loc.heading,
                recorded_at: loc.recorded_at,
                address: loc.address
              };
            }
            return v;
          }));

          // 2. If the updated vehicle is the currently selected one, append point to active polyline
          if (loc.vehicle_id === selectedVehicleIdRef.current) {
            console.log('[WS] Vehicle match! Appending point. speed_kmph=', loc.speed_kmph);
            setActiveTripPoints(prev => {
              // Use a sliding window — keep last 200 points max, no duplicate guard needed
              // since each ping has a unique Date.now() id
              const newPoint = {
                id: Date.now(),
                vehicle_id: loc.vehicle_id,
                latitude: loc.latitude,
                longitude: loc.longitude,
                speed_kmph: loc.speed_kmph,
                heading: loc.heading,
                recorded_at: loc.recorded_at,
                address: loc.address
              };
              return [...prev, newPoint].slice(-200);
            });

            // Refresh trips to show new distance and dynamically add newly started trips
            if (loc.active_trip) {
              setTrips(prev => {
                const exists = prev.find(t => t.id === loc.active_trip.id);
                if (exists) {
                  return prev.map(t => t.id === loc.active_trip.id ? { ...t, ...loc.active_trip } : t);
                }
                return [loc.active_trip, ...prev];
              });
              
              // If no trip is currently selected, auto-select the newly started trip
              setSelectedTripId(prev => prev || loc.active_trip.id);
            }
          }

          // 3. Process any geofence alerts triggered by this telemetry
          if (msg.geofence_events && msg.geofence_events.length > 0) {
            msg.geofence_events.forEach(evt => {
              const action = evt.event_type === 'enter' ? 'entered' : 'exited';
              const alertMsg = `Vehicle ${loc.reg_number} has ${action} geofence "${evt.geofence_name}"!`;
              
              addToast(`⚠️ Alert: ${alertMsg}`, 'warning');
              playAlertBeep();
              
              if ("Notification" in window && Notification.permission === "granted") {
                new Notification("Fleet Tracker Alert", { body: alertMsg, icon: '/favicon.ico' });
              }
              
              // Prepend to recent events feed
              setRecentEvents(prev => [
                {
                  id: evt.id,
                  vehicle_id: evt.vehicle_id,
                  event_type: evt.event_type,
                  occurred_at: evt.occurred_at,
                  geofence: { name: evt.geofence_name }
                },
                ...prev
              ]);
            });
          }

          // 4. Process overspeed alerts
          if (msg.overspeed_event) {
            const evt = msg.overspeed_event;
            addToast(`⚠️ Speed Alert: Vehicle ${loc.reg_number} went ${evt.speed_kmph.toFixed(1)} km/h! (Limit: ${evt.speed_limit_kmph} km/h)`, 'warning');
          }
        }
      };
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token]);

  // Auth Handlers
  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    setAuthError('');
    try {
      const formData = new URLSearchParams();
      formData.append('username', username);
      formData.append('password', password);

      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
      });

      if (!res.ok) {
        throw new Error('Incorrect username or password');
      }

      const data = await res.json();
      localStorage.setItem('token', data.access_token);
      setToken(data.access_token);
      addToast('Logged in successfully', 'success');
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleRegister = async (e) => {
    if (e) e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role: 'operator' })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || 'Failed to create account');
      }

      addToast('Account created successfully! Logging you in...', 'success');
      // Auto login after registration
      await handleLogin();
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setToken('');
    setVehicles([]);
    setGeofences([]);
    setTrips([]);
    setSelectedVehicleId(null);
    setSelectedTripId(null);
  };

  // Entity Creation & Management Handlers
  const handleCreateVehicle = async (e) => {
    e.preventDefault();
    
    // 1. Create a temporary vehicle for optimistic UI update
    const tempId = Date.now();
    const tempVehicle = {
      id: tempId,
      reg_number: newVehicle.reg_number,
      model: newVehicle.model,
      driver_name: newVehicle.driver_name || null,
      device_token: newVehicle.device_token,
      speed_limit_kmph: parseFloat(newVehicle.speed_limit_kmph) || 80.0,
      latitude: null,
      longitude: null,
      speed_kmph: 0,
      heading: 0
    };

    // 2. Apply optimistic update immediately
    setVehicles(prev => [...prev, tempVehicle]);
    setShowVehicleModal(false);
    
    // Store old input state in case we need to revert
    const backupInputState = { ...newVehicle };
    setNewVehicle({ reg_number: '', model: '', driver_name: '', device_token: '', speed_limit_kmph: 80.0 });

    try {
      const payload = {
        reg_number: backupInputState.reg_number,
        model: backupInputState.model,
        device_token: backupInputState.device_token,
        driver_name: backupInputState.driver_name || null,
        speed_limit_kmph: parseFloat(backupInputState.speed_limit_kmph) || 80.0
      };
      
      const res = await apiFetch('/api/vehicles', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      
      if (res.ok) {
        const realVehicle = await res.json();
        // Replace temp vehicle with real vehicle from backend
        setVehicles(prev => prev.map(v => v.id === tempId ? { ...realVehicle, latitude: null, longitude: null, speed_kmph: 0, heading: 0 } : v));
        addToast('Vehicle registered successfully', 'success');
      } else {
        // Revert optimistic update
        setVehicles(prev => prev.filter(v => v.id !== tempId));
        setNewVehicle(backupInputState);
        setShowVehicleModal(true);
        
        let errMessage = 'Error registering vehicle';
        try {
          const err = await res.json();
          errMessage = err.detail || errMessage;
        } catch (parseErr) {
          errMessage = `Server Error: ${res.status} ${res.statusText}`;
        }
        alert(errMessage);
      }
    } catch (e) {
      // Revert optimistic update
      setVehicles(prev => prev.filter(v => v.id !== tempId));
      setNewVehicle(backupInputState);
      setShowVehicleModal(true);
      
      alert(`Network or unexpected error: ${e.message}`);
      console.error(e);
    }
  };

  const handleUpdateVehicle = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        reg_number: editVehicleForm.reg_number,
        model: editVehicleForm.model,
        device_token: editVehicleForm.device_token,
        driver_name: editVehicleForm.driver_name || null,
        speed_limit_kmph: parseFloat(editVehicleForm.speed_limit_kmph) || 80.0
      };
      const res = await apiFetch(`/api/vehicles/${editingVehicle.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const updated = await res.json();
        setVehicles(prev => prev.map(v => v.id === updated.id ? { ...v, ...updated } : v));
        setShowEditVehicleModal(false);
        setEditingVehicle(null);
        addToast('Vehicle updated successfully', 'success');
      } else {
        const error = await res.json();
        alert(error.detail || 'Error updating vehicle');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteVehicle = async (vehicleId) => {
    if (!window.confirm("Are you sure you want to delete this vehicle and all its location logs/trips/geofences?")) {
      return;
    }
    
    // 1. Store vehicle to revert if needed
    const vehicleToDelete = vehicles.find(v => v.id === vehicleId);
    if (!vehicleToDelete) return;
    
    // 2. Apply optimistic update immediately
    setVehicles(prev => prev.filter(v => v.id !== vehicleId));
    
    let previousSelectedVehicle = null;
    if (selectedVehicleId === vehicleId) {
      previousSelectedVehicle = vehicleId;
      setSelectedVehicleId(null);
      setSelectedTripId(null);
    }
    
    try {
      const res = await apiFetch(`/api/vehicles/${vehicleId}`, {
        method: 'DELETE'
      });
      
      if (res.ok) {
        addToast('Vehicle deleted successfully', 'success');
      } else {
        // Revert optimistic update
        setVehicles(prev => [...prev, vehicleToDelete]);
        if (previousSelectedVehicle) {
          setSelectedVehicleId(previousSelectedVehicle);
        }
        
        const err = await res.json();
        alert(err.detail || 'Error deleting vehicle');
      }
    } catch (e) {
      // Revert optimistic update
      setVehicles(prev => [...prev, vehicleToDelete]);
      if (previousSelectedVehicle) {
        setSelectedVehicleId(previousSelectedVehicle);
      }
      console.error(e);
    }
  };

  const handleDeleteGeofence = async (geofenceId) => {
    if (!window.confirm("Are you sure you want to delete this geofence boundary?")) return;
    try {
      const res = await apiFetch(`/api/geofences/${geofenceId}`, { method: 'DELETE' });
      if (res.ok) {
        setGeofences(prev => prev.filter(g => g.id !== geofenceId));
        addToast('Geofence deleted successfully', 'success');
      } else {
        alert('Error deleting geofence');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateGeofence = async (e) => {
    if (e) e.preventDefault();
    try {
      const payload = {
        ...newGeofence,
        vehicle_id: selectedVehicleId
      };
      const res = await apiFetch('/api/geofences', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const g = await res.json();
        setGeofences(prev => [...prev, g]);
        setShowGeofenceModal(false);
        addToast(`Geofence "${newGeofence.name}" saved!`, 'success');
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Callback from Map clicking to place geofence
  const handleMapAddGeofence = (lat, lng) => {
    setNewGeofence(prev => ({
      ...prev,
      name: `Geofence Zone ${geofences.length + 1}`,
      center_lat: parseFloat(lat.toFixed(6)),
      center_lng: parseFloat(lng.toFixed(6))
    }));
    setShowGeofenceModal(true);
  };

  // Render Login Layout
  if (!token) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>FLEET TRACKING</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              {isRegisterMode ? 'Create an operator account' : 'Log in to access your tracking control center'}
            </p>
          </div>
          {authError && (
            <div style={{
              backgroundColor: 'rgba(244, 63, 94, 0.1)',
              border: '1px solid var(--accent-rose)',
              borderRadius: '6px',
              color: 'var(--accent-rose)',
              padding: '10px',
              fontSize: '13px',
              marginBottom: '20px',
              textAlign: 'center'
            }}>
              {authError}
            </div>
          )}
          <form onSubmit={isRegisterMode ? handleRegister : handleLogin}>
            <div className="form-group">
              <label>USERNAME</label>
              <input 
                type="text" 
                className="form-input" 
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                required 
              />
            </div>
            <div className="form-group">
              <label>PASSWORD</label>
              <input 
                type="password" 
                className="form-input" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                required 
              />
            </div>
            <button type="submit" className="btn-primary" style={{ marginTop: '10px' }}>
              {isRegisterMode ? 'CREATE ACCOUNT' : 'SIGN IN'}
            </button>
          </form>
          <div style={{ marginTop: '20px', fontSize: '13px', textAlign: 'center' }}>
            {isRegisterMode ? (
              <span style={{ color: 'var(--text-secondary)' }}>
                Already have an account?{' '}
                <button 
                  onClick={() => { setIsRegisterMode(false); setAuthError(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >
                  Sign In
                </button>
              </span>
            ) : (
              <span style={{ color: 'var(--text-secondary)' }}>
                Don't have an account?{' '}
                <button 
                  onClick={() => { setIsRegisterMode(true); setAuthError(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >
                  Create Account
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Find active vehicle object
  const activeVehicle = vehicles.find(v => v.id === selectedVehicleId);
  const activeTrip = trips.find(t => t.id === selectedTripId);

  // Calculate active vehicle status
  const getVehicleStatus = (v) => {
    if (!v) return 'offline';
    const lastActive = parseUtcDate(v.recorded_at);
    // Reduced timeout to 20s for near-instant offline detection when tracker stops
    const isRecent = lastActive && (new Date() - lastActive) < 20000;
    const speed = v.speed_kmph || 0;
    return isRecent ? (speed > 2.0 ? 'moving' : 'idle') : 'offline';
  };
  const activeVehicleStatus = getVehicleStatus(activeVehicle);

  return (
    <ErrorBoundary>
    <div className="app-layout" style={{ minWidth: 0, minHeight: 0 }}>
      {/* Toast Notification Box */}
      <div className="toast-container">
        {toasts.map(t => (
          <div 
            key={t.id} 
            className="toast"
            style={{ 
              borderColor: t.type === 'warning' ? 'var(--accent-rose)' : t.type === 'success' ? 'var(--accent-emerald)' : 'var(--accent-cyan)' 
            }}
          >
            {t.type === 'warning' ? <AlertTriangle size={16} color="var(--accent-rose)" /> : <Bell size={16} color="var(--accent-cyan)" />}
            <div>{t.message}</div>
          </div>
        ))}
      </div>

      {/* LEFT SIDEBAR: Vehicles & Administration */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="logo">
            <Truck size={22} />
            <span>FLEET</span>TRACKER
          </div>
        </div>

        <div style={{ padding: '16px 16px 8px' }}>
          <button className="nav-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setShowVehicleModal(true)}>
            <Plus size={14} /> Add Vehicle
          </button>
        </div>

        <div className="vehicle-list">
          <div className="section-title" style={{ padding: '0 8px 8px' }}>
            Active Fleet ({vehicles.length})
          </div>
          {vehicles.map(v => {
            const lastActive = parseUtcDate(v.recorded_at);
            // Reduced timeout to 20s
            const isRecent = lastActive && (new Date() - lastActive) < 20000;
            const speed = v.speed_kmph || 0;
            const status = isRecent ? (speed > 2.0 ? 'moving' : 'idle') : 'offline';
            return (
              <div 
                key={v.id} 
                className={`vehicle-card ${selectedVehicleId === v.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedVehicleId(v.id);
                  setSelectedTripId(null);
                }}
              >
                <div className="vehicle-card-header">
                  <div className="vehicle-reg">{v.reg_number}</div>
                  <div className={`status-dot ${status === 'offline' ? 'offline' : 'moving'}`}></div>
                </div>
                <div className="vehicle-meta">
                  <span>{v.model || 'Unknown Model'}</span>
                  <span>{status === 'offline' ? getRelativeTime(v.recorded_at) : `${speed.toFixed(0)} km/h`}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justify: 'center' }}>
              <User size={16} />
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: '500' }}>Operator</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Online</div>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            title="Log Out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>

      {/* RIGHT WORKSPACE: Maps, Charts & Feeds */}
      <div className="main-content">
        <div className="top-nav">
          {/* Row 1: Vehicle Title + Actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ margin: 0 }}>{activeVehicle ? `${activeVehicle.reg_number} Tracker` : 'Fleet Control Panel'}</h2>
              {activeVehicle && (
                <span style={{
                  fontSize: '10px',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontWeight: '600',
                  textTransform: 'uppercase',
                  background: activeVehicleStatus === 'offline' ? 'rgba(148, 163, 184, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                  color: activeVehicleStatus === 'offline' ? '#94a3b8' : '#10b981',
                  border: '1px solid ' + (activeVehicleStatus === 'offline' ? 'rgba(148, 163, 184, 0.3)' : 'rgba(16, 185, 129, 0.3)')
                }}>
                  {activeVehicleStatus === 'offline' ? '● Offline' : '● Online'}
                </span>
              )}
            </div>

            {activeVehicle && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button 
                  className="nav-btn" 
                  onClick={() => {
                    setEditingVehicle(activeVehicle);
                    setEditVehicleForm({
                      reg_number: activeVehicle.reg_number,
                      model: activeVehicle.model || '',
                      device_token: activeVehicle.device_token || '',
                      driver_name: activeVehicle.driver ? activeVehicle.driver.name : '',
                      speed_limit_kmph: activeVehicle.speed_limit_kmph || 80.0
                    });
                    setShowEditVehicleModal(true);
                  }}
                  style={{ padding: '6px 10px', fontSize: '12px' }}
                >
                  Edit Vehicle
                </button>
                <button 
                  style={{
                    background: 'rgba(244, 63, 94, 0.1)',
                    border: '1px solid var(--accent-rose)',
                    color: 'var(--accent-rose)',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '12px'
                  }}
                  onClick={() => handleDeleteVehicle(activeVehicle.id)}
                >
                  <Trash2 size={12} /> Delete
                </button>
                {selectedTripId && (
                  <a 
                    href={`${API_BASE}/api/trips/${selectedTripId}/report.pdf`}
                    target="_blank" 
                    rel="noreferrer" 
                    className="nav-btn"
                    style={{ textDecoration: 'none', padding: '6px 10px', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <FileText size={12} /> Export PDF
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Row 2: Location, Metadata & Trip Selector */}
          {activeVehicle && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              width: '100%', 
              flexWrap: 'wrap', 
              gap: '8px', 
              borderTop: '1px solid rgba(255,255,255,0.05)', 
              paddingTop: '8px',
              marginTop: '4px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {activeVehicle.address && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', maxWidth: '380px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={activeVehicle.address}>
                    📍 {activeVehicle.address}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  <span>•</span>
                  <span>{activeVehicle.driver ? `Driver: ${activeVehicle.driver.name}` : 'No Driver Assigned'}</span>
                  <span>•</span>
                  <span style={{ 
                    fontSize: '11px', 
                    background: 'rgba(239, 68, 68, 0.1)', 
                    border: '1px solid rgba(239, 68, 68, 0.3)', 
                    color: '#f87171', 
                    padding: '2px 6px', 
                    borderRadius: '4px'
                  }}>
                    Limit: {activeVehicle.speed_limit_kmph} km/h
                  </span>
                </div>
              </div>

              {trips.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Trip History:</span>
                  <select 
                    style={{
                      background: 'var(--bg-base)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      outline: 'none',
                      maxWidth: '240px'
                    }}
                    value={selectedTripId || ''}
                    onChange={e => setSelectedTripId(parseInt(e.target.value))}
                  >
                    {trips.map(t => {
                      const start = new Date(t.start_time).toLocaleDateString();
                      const fromLabel = t.start_address
                        ? t.start_address.split(',').slice(0, 2).join(',')
                        : (t.start_lat ? `${t.start_lat.toFixed(4)}, ${t.start_lng.toFixed(4)}` : '?');
                      return (
                        <option key={t.id} value={t.id}>
                          Trip #{t.id} ({start}) · {t.distance_km.toFixed(1)} km · From: {fromLabel}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dynamic Grid Layout */}
        <div className="dashboard-grid">
          {/* Map Section */}
          <div className="map-container">
            <MapView 
              vehicles={vehicles}
              selectedVehicleId={selectedVehicleId}
              activeTripPoints={activeTripPoints}
              geofences={geofences}
              onAddGeofenceClick={handleMapAddGeofence}
              onDeleteGeofence={handleDeleteGeofence}
            />
            {/* Journey Route Address Strip */}
            {activeTrip && (activeTrip.start_address || activeTrip.end_address) && (
              <div style={{
                position: 'absolute',
                bottom: '12px',
                left: '12px',
                right: '12px',
                background: 'rgba(15, 23, 42, 0.92)',
                backdropFilter: 'blur(8px)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '10px 14px',
                display: 'flex',
                gap: '12px',
                alignItems: 'center',
                fontSize: '12px',
                zIndex: 1000,
                pointerEvents: 'none'
              }}>
                <Navigation size={14} color="var(--accent-emerald)" style={{ flexShrink: 0 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                  {activeTrip.start_address && (
                    <div style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--accent-emerald)', fontWeight: '600' }}>FROM </span>
                      {activeTrip.start_address}
                    </div>
                  )}
                  {activeTrip.end_address && (
                    <div style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--accent-rose)', fontWeight: '600' }}>TO &nbsp;&nbsp;&nbsp;</span>
                      {activeTrip.end_address}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Speed Chart */}
          <div className="chart-container">
            <div className="section-title">
              Speed Curve
              {activeTripPoints.length > 0 && (() => {
                const speeds = activeTripPoints.map(p => p.speed_kmph || 0);
                const currentSpd = speeds[speeds.length - 1]; // Latest point
                const maxSpd = Math.max(...speeds);
                const avgSpd = speeds.reduce((a, b) => a + b, 0) / speeds.length;
                return (
                  <span style={{ fontSize: '11px', textTransform: 'none', fontWeight: 'normal' }}>
                    Now: {currentSpd ? currentSpd.toFixed(1) : '0.0'} km/h | Max: {maxSpd ? maxSpd.toFixed(1) : '0.0'} km/h | Avg: {avgSpd ? avgSpd.toFixed(1) : '0.0'} km/h
                  </span>
                );
              })()}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <SpeedChart routePoints={activeTripPoints} />
            </div>
          </div>

          {/* Right side panel for Geofences and Alerts */}
          <div className="alerts-container">
            {/* Recent Geofence Alerts feed */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
              <div className="section-title">
                <span>Security Logs (Geofencing)</span>
                <button 
                  onClick={() => setShowGeofenceListModal(true)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                  title="View Active Boundaries"
                >
                  <MapPin size={16} />
                </button>
              </div>
              <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
              {recentEvents.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', marginTop: '20px' }}>
                  No boundary violations logged.
                </div>
              ) : (
                recentEvents.map(evt => {
                  const timeStr = new Date(evt.occurred_at).toLocaleTimeString();
                  const action = evt.event_type === 'enter' ? 'Entered' : 'Exited';
                  const vName = vehicles.find(v => v.id === evt.vehicle_id)?.reg_number || `Vehicle #${evt.vehicle_id}`;
                  
                  return (
                    <div key={evt.id} className={`alert-item ${evt.event_type}`}>
                      <div style={{ marginTop: '2px' }}>
                        <Shield size={14} color={evt.event_type === 'enter' ? 'var(--accent-emerald)' : 'var(--accent-rose)'} />
                      </div>
                      <div>
                        <div style={{ fontWeight: '500' }}>
                          {vName} {action.toLowerCase()} boundary
                        </div>
                        <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                          Boundary: <b>{evt.geofence?.name || 'Unknown'}</b>
                        </div>
                        <div className="alert-meta">{timeStr}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* MODALS */}
      {/* 1. Add Vehicle Modal */}
      {showVehicleModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Register New Fleet Vehicle</h3>
              <button className="modal-close" onClick={() => setShowVehicleModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreateVehicle}>
              <div className="form-group">
                <label>REGISTRATION NUMBER</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newVehicle.reg_number} 
                  onChange={e => setNewVehicle(prev => ({ ...prev, reg_number: e.target.value.toUpperCase() }))}
                  placeholder="KA-01-ME-1234"
                  required 
                />
              </div>
              <div className="form-group">
                <label>MODEL</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newVehicle.model} 
                  onChange={e => setNewVehicle(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="Tesla Model 3"
                />
              </div>
              <div className="form-group">
                <label>DEVICE TOKEN (identifies tracking device/phone)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newVehicle.device_token} 
                  onChange={e => setNewVehicle(prev => ({ ...prev, device_token: e.target.value }))}
                  placeholder="tracker-device-123"
                  required 
                />
              </div>
              <div className="form-group">
                <label>DRIVER NAME</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newVehicle.driver_name} 
                  onChange={e => setNewVehicle(prev => ({ ...prev, driver_name: e.target.value }))}
                  placeholder="John Doe"
                />
              </div>
              <div className="form-group">
                <label>SPEED LIMIT (KM/H)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={newVehicle.speed_limit_kmph} 
                  onChange={e => setNewVehicle(prev => ({ ...prev, speed_limit_kmph: parseFloat(e.target.value) || 0 }))}
                  placeholder="80"
                  required
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowVehicleModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ width: 'auto' }}>Register Vehicle</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 1b. Edit Vehicle Modal */}
      {showEditVehicleModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Edit Fleet Vehicle</h3>
              <button className="modal-close" onClick={() => { setShowEditVehicleModal(false); setEditingVehicle(null); }}>&times;</button>
            </div>
            <form onSubmit={handleUpdateVehicle}>
              <div className="form-group">
                <label>REGISTRATION NUMBER</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={editVehicleForm.reg_number} 
                  onChange={e => setEditVehicleForm(prev => ({ ...prev, reg_number: e.target.value.toUpperCase() }))}
                  placeholder="KA-01-ME-1234"
                  required 
                />
              </div>
              <div className="form-group">
                <label>MODEL</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={editVehicleForm.model} 
                  onChange={e => setEditVehicleForm(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="Tesla Model 3"
                />
              </div>
              <div className="form-group">
                <label>DEVICE TOKEN (identifies tracking device/phone)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={editVehicleForm.device_token} 
                  onChange={e => setEditVehicleForm(prev => ({ ...prev, device_token: e.target.value }))}
                  placeholder="tracker-device-123"
                  required 
                />
              </div>
              <div className="form-group">
                <label>DRIVER NAME</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={editVehicleForm.driver_name} 
                  onChange={e => setEditVehicleForm(prev => ({ ...prev, driver_name: e.target.value }))}
                  placeholder="John Doe"
                />
              </div>
              <div className="form-group">
                <label>SPEED LIMIT (KM/H)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={editVehicleForm.speed_limit_kmph} 
                  onChange={e => setEditVehicleForm(prev => ({ ...prev, speed_limit_kmph: parseFloat(e.target.value) || 0 }))}
                  placeholder="80"
                  required
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => { setShowEditVehicleModal(false); setEditingVehicle(null); }}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ width: 'auto' }}>Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Add Geofence Modal */}
      {showGeofenceModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Set Circular Geofence Boundary</h3>
              <button className="modal-close" onClick={() => setShowGeofenceModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreateGeofence}>
              <div className="form-group">
                <label>GEOFENCE ZONE NAME</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={newGeofence.name} 
                  onChange={e => setNewGeofence(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Bangalore Office Area"
                  required 
                />
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>CENTER LATITUDE</label>
                  <input 
                    type="number" 
                    step="0.000001"
                    className="form-input" 
                    value={newGeofence.center_lat} 
                    onChange={e => setNewGeofence(prev => ({ ...prev, center_lat: parseFloat(e.target.value) }))}
                    required 
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>CENTER LONGITUDE</label>
                  <input 
                    type="number" 
                    step="0.000001"
                    className="form-input" 
                    value={newGeofence.center_lng} 
                    onChange={e => setNewGeofence(prev => ({ ...prev, center_lng: parseFloat(e.target.value) }))}
                    required 
                  />
                </div>
              </div>
              <div className="form-group">
                <label>RADIUS (METERS)</label>
                <input 
                  type="number" 
                  className="form-input" 
                  value={newGeofence.radius_m} 
                  onChange={e => setNewGeofence(prev => ({ ...prev, radius_m: parseFloat(e.target.value) }))}
                  placeholder="500"
                  required 
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowGeofenceModal(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ width: 'auto' }}>Create Boundary</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 4. Active Boundaries List Modal */}
      {showGeofenceListModal && (
        <div className="modal-overlay" onClick={() => setShowGeofenceListModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '400px' }}>
            <div className="modal-header">
              <h3>Active Boundaries</h3>
              <button className="close-btn" onClick={() => setShowGeofenceListModal(false)}>×</button>
            </div>
            <div style={{ padding: '20px', maxHeight: '400px', overflowY: 'auto' }}>
              {geofences.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', margin: '20px 0' }}>
                  No active boundaries for this vehicle.
                </div>
              ) : (
                geofences.map(gf => (
                  <div key={gf.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
                    <div>
                      <div style={{ fontWeight: '500', color: 'var(--text-primary)' }}>{gf.name}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px' }}>Radius: {gf.radius_m} meters</div>
                    </div>
                    <button 
                      onClick={() => handleDeleteGeofence(gf.id)}
                      style={{ background: 'rgba(244, 63, 94, 0.1)', border: '1px solid rgba(244, 63, 94, 0.3)', color: 'var(--accent-rose)', cursor: 'pointer', padding: '8px', borderRadius: '6px', transition: 'all 0.2s' }}
                      title="Delete Boundary"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setShowGeofenceListModal(false)} style={{ width: '100%' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}
