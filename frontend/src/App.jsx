import React, { useState, useEffect, useRef } from 'react';
import { 
  Truck, MapPin, User, Plus, LogOut, FileText, 
  Navigation, Bell, Wifi, WifiOff, Trash2, Shield, AlertTriangle 
} from 'lucide-react';
import MapView from './components/MapView';
import SpeedChart from './components/SpeedChart';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
const WS_BASE  = import.meta.env.VITE_API_BASE
  ? import.meta.env.VITE_API_BASE.replace('https://', 'wss://').replace('http://', 'ws://')
  : 'ws://localhost:8000';

const getRelativeTime = (isoString) => {
  if (!isoString) return 'Offline';
  const diffMs = new Date() - new Date(isoString);
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Online';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(isoString).toLocaleDateString();
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
        // Fetch vehicles
        const vRes = await apiFetch('/api/vehicles');
        const vData = await vRes.json();
        
        // Fetch latest coordinates for each vehicle
        const vehiclesWithLocations = await Promise.all(vData.map(async (v) => {
          try {
            const locRes = await apiFetch(`/api/vehicles/${v.id}/live`);
            const locData = await locRes.json();
            if (locData) {
              return { ...v, latitude: locData.latitude, longitude: locData.longitude, speed_kmph: locData.speed_kmph, heading: locData.heading, recorded_at: locData.recorded_at, address: locData.address };
            }
          } catch (e) {}
          return { ...v, latitude: null, longitude: null, speed_kmph: 0, heading: 0, address: null };
        }));
        
        setVehicles(vehiclesWithLocations);

        // Fetch recent geofence violations
        const eRes = await apiFetch('/api/geofences/events/recent');
        const eData = await eRes.json();
        setRecentEvents(eData);
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
        setActiveTripPoints(data.route_points || []);
      } catch (err) {
        console.error(err);
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

    const connectWebSocket = () => {
      const ws = new WebSocket(`${WS_BASE}/ws/live`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onclose = () => {
        setWsConnected(false);
        // Attempt reconnection after 4 seconds
        setTimeout(connectWebSocket, 4000);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.event_type === 'location_update') {
          const loc = msg.data;
          
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
            setActiveTripPoints(prev => {
              // Ensure no duplicate timestamps
              if (prev.some(p => p.recorded_at === loc.recorded_at)) return prev;
              return [...prev, {
                id: Date.now(),
                vehicle_id: loc.vehicle_id,
                latitude: loc.latitude,
                longitude: loc.longitude,
                speed_kmph: loc.speed_kmph,
                heading: loc.heading,
                recorded_at: loc.recorded_at,
                address: loc.address
              }];
            });

            // Refresh trips to show new distance
            if (loc.active_trip) {
              setTrips(prev => prev.map(t => {
                if (t.id === loc.active_trip.id) {
                  return { ...t, ...loc.active_trip };
                }
                return t;
              }));
            }
          }

          // 3. Process any geofence alerts triggered by this telemetry
          if (msg.geofence_events && msg.geofence_events.length > 0) {
            msg.geofence_events.forEach(evt => {
              const action = evt.event_type === 'enter' ? 'entered' : 'exited';
              addToast(`⚠️ Alert: Vehicle ${loc.reg_number} has ${action} geofence "${evt.geofence_name}"!`, 'warning');
              
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
    try {
      const payload = {
        reg_number: newVehicle.reg_number,
        model: newVehicle.model,
        device_token: newVehicle.device_token,
        driver_name: newVehicle.driver_name || null,
        speed_limit_kmph: parseFloat(newVehicle.speed_limit_kmph) || 80.0
      };
      const res = await apiFetch('/api/vehicles', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const v = await res.json();
        setVehicles(prev => [...prev, { ...v, latitude: null, longitude: null, speed_kmph: 0, heading: 0 }]);
        setShowVehicleModal(false);
        setNewVehicle({ reg_number: '', model: '', driver_name: '', device_token: '', speed_limit_kmph: 80.0 });
        addToast('Vehicle registered successfully', 'success');
      } else {
        const error = await res.json();
        alert(error.detail || 'Error registering vehicle');
      }
    } catch (e) {
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
    try {
      const res = await apiFetch(`/api/vehicles/${vehicleId}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        setVehicles(prev => prev.filter(v => v.id !== vehicleId));
        if (selectedVehicleId === vehicleId) {
          setSelectedVehicleId(null);
          setSelectedTripId(null);
        }
        addToast('Vehicle deleted successfully', 'success');
      } else {
        alert('Error deleting vehicle');
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
                placeholder={isRegisterMode ? "Choose a username" : "admin"}
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
                placeholder={isRegisterMode ? "Choose a password" : "admin123"}
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
          {!isRegisterMode && (
            <div style={{ marginTop: '20px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
              💡 Hint: use default username <b>admin</b> & password <b>admin123</b>
            </div>
          )}
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
    const lastActive = v.recorded_at ? new Date(v.recorded_at) : null;
    const isRecent = lastActive && (new Date() - lastActive) < 60000;
    const speed = v.speed_kmph || 0;
    return isRecent ? (speed > 2.0 ? 'moving' : 'idle') : 'offline';
  };
  const activeVehicleStatus = getVehicleStatus(activeVehicle);

  return (
    <div className="app-layout">
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
            const lastActive = v.recorded_at ? new Date(v.recorded_at) : null;
            const isRecent = lastActive && (new Date() - lastActive) < 60000;
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
                  <div className={`status-dot ${status}`}></div>
                </div>
                <div className="vehicle-meta">
                  <span>{v.model || 'Unknown Model'}</span>
                  <span>{status === 'offline' ? getRelativeTime(v.recorded_at) : `${speed.toFixed(0)} km/h`}</span>
                </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ margin: 0 }}>{activeVehicle ? `${activeVehicle.reg_number} Tracker` : 'Fleet Control Panel'}</h2>
                {activeVehicle && (
                  <span style={{
                    fontSize: '10px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    background: activeVehicleStatus === 'moving' ? 'rgba(16, 185, 129, 0.12)' : activeVehicleStatus === 'idle' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(148, 163, 184, 0.12)',
                    color: activeVehicleStatus === 'moving' ? '#10b981' : activeVehicleStatus === 'idle' ? '#f59e0b' : '#94a3b8',
                    border: '1px solid ' + (activeVehicleStatus === 'moving' ? 'rgba(16, 185, 129, 0.3)' : activeVehicleStatus === 'idle' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(148, 163, 184, 0.3)')
                  }}>
                    {activeVehicleStatus === 'moving' ? '● Online (Moving)' : activeVehicleStatus === 'idle' ? '● Online (Idle)' : '● Offline'}
                  </span>
                )}
              </div>
              {activeVehicle && activeVehicle.address && (
                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', maxWidth: '350px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📍 {activeVehicle.address}
                </div>
              )}
            </div>
          </div>

          <div className="nav-actions">
            {/* Displaying active trip details */}
            {activeVehicle && (
              <>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {activeVehicle.driver ? `Driver: ${activeVehicle.driver.name}` : 'No Driver Assigned'}
                </div>
                <div style={{ 
                  fontSize: '11px', 
                  background: 'rgba(239, 68, 68, 0.1)', 
                  border: '1px solid rgba(239, 68, 68, 0.3)', 
                  color: '#f87171', 
                  padding: '3px 8px', 
                  borderRadius: '4px',
                  marginRight: '8px',
                  display: 'inline-flex',
                  alignItems: 'center'
                }}>
                  Limit: {activeVehicle.speed_limit_kmph} km/h
                </div>
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
              </>
            )}

            {/* Trip list selector */}
            {trips.length > 0 && (
              <select 
                style={{
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  outline: 'none',
                  maxWidth: '280px'
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
            )}

            {/* Generate PDF Report Button */}
            {selectedTripId && (
              <a 
                href={`${API_BASE}/api/trips/${selectedTripId}/report.pdf`}
                target="_blank" 
                rel="noreferrer" 
                className="nav-btn"
                style={{ textDecoration: 'none' }}
              >
                <FileText size={14} /> Export PDF Report
              </a>
            )}
          </div>
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
              {activeTrip && (
                <span style={{ fontSize: '11px', textTransform: 'none', fontWeight: 'normal' }}>
                  Max: {activeTrip.max_speed_kmph.toFixed(1)} km/h | Avg: {activeTrip.avg_speed_kmph.toFixed(1)} km/h
                </span>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <SpeedChart routePoints={activeTripPoints} />
            </div>
          </div>

          {/* Recent Geofence Alerts feed */}
          <div className="alerts-container">
            <div className="section-title">
              Security Logs (Geofencing)
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {recentEvents.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', marginTop: '20px' }}>
                  No boundary violations logged.
                </div>
              ) : (
                recentEvents.map(evt => {
                  const timeStr = new Date(evt.occurred_at).toLocaleTimeString();
                  const action = evt.event_type === 'enter' ? 'entered' : 'exited';
                  
                  return (
                    <div key={evt.id} className={`alert-item ${evt.event_type}`}>
                      <div style={{ marginTop: '2px' }}>
                        <Shield size={14} color={evt.event_type === 'enter' ? 'var(--accent-emerald)' : 'var(--accent-rose)'} />
                      </div>
                      <div>
                        <div style={{ fontWeight: '500' }}>
                          Geofence {action}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                          Vehicle crossed <b>{evt.geofence?.name || 'Boundary'}</b>.
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
    </div>
  );
}
