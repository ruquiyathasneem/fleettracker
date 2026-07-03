import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

export default function MapView({ 
  vehicles, 
  selectedVehicleId, 
  activeTripPoints = [], 
  geofences = [], 
  onAddGeofenceClick 
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  
  // References to keep track of layer objects so we can add/remove them dynamically
  const markersRef = useRef({});
  const geofencesRef = useRef({});
  const routePolylineRef = useRef(null);
  
  const hasFittedRef = useRef(false);

  // Reset fits bounds tracker when selected vehicle changes
  useEffect(() => {
    hasFittedRef.current = false;
  }, [selectedVehicleId]);

  // 1. Initialize Leaflet Map (CartoDB Dark Matter theme)
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Default view centered on Bangalore coordinates
    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      fadeAnimation: true
    }).setView([12.9716, 77.5946], 13);
    
    mapRef.current = map;

    // Use CartoDB Dark Matter tile layer to match our premium dark theme
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
    }).addTo(map);

    // Event listener for double clicking/clicking to place a geofence
    map.on('click', (e) => {
      if (onAddGeofenceClick) {
        onAddGeofenceClick(e.latlng.lat, e.latlng.lng);
      }
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // 2. Render / Update Vehicle Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove markers for vehicles no longer present or not selected
    const selectedIds = selectedVehicleId ? [selectedVehicleId.toString()] : vehicles.map(v => v.id.toString());
    Object.keys(markersRef.current).forEach(id => {
      if (!selectedIds.includes(id)) {
        map.removeLayer(markersRef.current[id]);
        delete markersRef.current[id];
      }
    });

    // Draw or update active vehicles
    vehicles.forEach(vehicle => {
      // Only show the selected vehicle if one is selected
      if (selectedVehicleId && vehicle.id !== selectedVehicleId) return;
      
      if (!vehicle.latitude || !vehicle.longitude) return;

      const position = [vehicle.latitude, vehicle.longitude];
      const isSelected = vehicle.id === selectedVehicleId;
      const speed = vehicle.speed_kmph || 0;
      const status = speed > 2.0 ? 'moving' : 'stationary';
      
      // Select indicator color
      const markerColor = status === 'moving' ? '#10b981' : '#06b6d4';
      
      // Define a premium SVG custom marker with a arrow representing heading
      const customIcon = L.divIcon({
        className: 'custom-vehicle-marker',
        html: `
          <div style="position: relative; display: flex; align-items: center; justify-content: center;">
            <!-- Outer pulse glow for moving vehicle -->
            ${status === 'moving' ? `
              <div style="
                position: absolute; 
                width: 28px; 
                height: 28px; 
                border-radius: 50%; 
                background: ${markerColor}; 
                opacity: 0.3; 
                animation: pulse 1.8s infinite;
              "></div>
            ` : ''}
            <!-- Main marker body -->
            <div style="
              width: 18px; 
              height: 18px; 
              border-radius: 50%; 
              background: ${isSelected ? '#6366f1' : markerColor}; 
              border: 2px solid #ffffff; 
              display: flex; 
              align-items: center; 
              justify-content: center;
              box-shadow: 0 0 10px rgba(0,0,0,0.5);
              transition: transform 0.3s ease;
              transform: rotate(${vehicle.heading || 0}deg);
            ">
              <!-- Heading arrow direction -->
              <div style="
                width: 0; 
                height: 0; 
                border-left: 3px solid transparent;
                border-right: 3px solid transparent;
                border-bottom: 6px solid #ffffff;
                margin-top: -4px;
              "></div>
            </div>
          </div>
        `,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      if (markersRef.current[vehicle.id]) {
        // Update existing marker position & icon
        const marker = markersRef.current[vehicle.id];
        marker.setLatLng(position);
        marker.setIcon(customIcon);
        
        // Update popup info
        marker.getPopup().setContent(`
          <div style="color: #f8fafc; font-family: Inter, sans-serif; font-size: 13px; max-width: 250px;">
            <b style="font-size: 14px; font-family: Outfit;">${vehicle.reg_number}</b><br/>
            Model: ${vehicle.model || 'N/A'}<br/>
            Speed: ${speed.toFixed(1)} km/h<br/>
            Heading: ${Math.round(vehicle.heading || 0)}°<br/>
            ${vehicle.address ? `<span style="color: #94a3b8; display: block; margin: 4px 0;">Address: ${vehicle.address}</span>` : ''}
            Status: <span style="color: ${status === 'moving' ? '#10b981' : '#06b6d4'}; font-weight: bold;">${status.toUpperCase()}</span>
          </div>
        `);
      } else {
        // Create new marker
        const marker = L.marker(position, { icon: customIcon }).addTo(map);
        marker.bindPopup(`
          <div style="color: #f8fafc; font-family: Inter, sans-serif; font-size: 13px; max-width: 250px;">
            <b style="font-size: 14px; font-family: Outfit;">${vehicle.reg_number}</b><br/>
            Model: ${vehicle.model || 'N/A'}<br/>
            Speed: ${speed.toFixed(1)} km/h<br/>
            Heading: ${Math.round(vehicle.heading || 0)}°<br/>
            ${vehicle.address ? `<span style="color: #94a3b8; display: block; margin: 4px 0;">Address: ${vehicle.address}</span>` : ''}
            Status: <span style="color: ${status === 'moving' ? '#10b981' : '#06b6d4'}; font-weight: bold;">${status.toUpperCase()}</span>
          </div>
        `);
        
        markersRef.current[vehicle.id] = marker;
      }

      // Automatically center map on selected vehicle
      if (isSelected) {
        map.panTo(position);
      }
    });

  }, [vehicles, selectedVehicleId]);

  // 3. Render / Update Geofence Circles
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing geofences
    Object.keys(geofencesRef.current).forEach(id => {
      map.removeLayer(geofencesRef.current[id]);
      delete geofencesRef.current[id];
    });

    // Draw active geofences
    geofences.forEach(fence => {
      const circle = L.circle([fence.center_lat, fence.center_lng], {
        radius: fence.radius_m,
        color: '#f59e0b', // Amber outline
        fillColor: '#f59e0b',
        fillOpacity: 0.08,
        weight: 1.5,
        dashArray: '5, 5'
      }).addTo(map);

      circle.bindTooltip(`Geofence: ${fence.name}`, { permanent: false, sticky: true });
      geofencesRef.current[fence.id] = circle;
    });

  }, [geofences]);

  // 4. Render Trip Path Route Polyline
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old route path
    if (routePolylineRef.current) {
      map.removeLayer(routePolylineRef.current);
      routePolylineRef.current = null;
    }

    if (activeTripPoints && activeTripPoints.length > 0) {
      const latlngs = activeTripPoints.map(p => [p.latitude, p.longitude]);
      
      // Draw new polyline with indigo glow
      const polyline = L.polyline(latlngs, {
        color: '#6366f1',
        weight: 4,
        opacity: 0.8
      }).addTo(map);

      routePolylineRef.current = polyline;

      // Fit map view bounds around the route path only once per trip to avoid constant zoom jumping
      if (!hasFittedRef.current || activeTripPoints.length <= 1) {
        try {
          map.fitBounds(polyline.getBounds(), { padding: [30, 30] });
          hasFittedRef.current = true;
        } catch (e) {
          // Fallback if coordinates are singular
        }
      }
    } else {
      hasFittedRef.current = false;
    }
  }, [activeTripPoints]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Map Element */}
      <div 
        ref={mapContainerRef} 
        style={{ width: '100%', height: '100%', outline: 'none' }} 
      />
      {/* Map Floating UI hint */}
      <div style={{
        position: 'absolute',
        bottom: '10px',
        left: '10px',
        zIndex: 1000,
        backgroundColor: 'rgba(11, 15, 25, 0.8)',
        border: '1px solid rgba(148, 163, 184, 0.2)',
        borderRadius: '6px',
        padding: '6px 10px',
        fontSize: '11px',
        color: '#94a3b8',
        pointerEvents: 'none',
        fontFamily: 'Inter'
      }}>
        💡 Click on map to place a Circular Geofence
      </div>
      
      {/* Dynamic pulse CSS injection */}
      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.8); opacity: 0.5; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
