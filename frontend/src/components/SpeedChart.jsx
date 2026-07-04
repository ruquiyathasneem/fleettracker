import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function SpeedChart({ routePoints = [] }) {
  if (!routePoints || routePoints.length === 0) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#64748b',
        fontSize: '13px',
        textAlign: 'center',
        padding: '20px',
        backgroundColor: 'rgba(15, 23, 42, 0.4)',
        borderRadius: '8px'
      }}>
        Waiting for vehicle telemetry...
      </div>
    );
  }

  // Create a 5-minute sliding window (max 60 points at 5s intervals)
  const displayPoints = routePoints.slice(-60);
  const latestPoint = displayPoints[displayPoints.length - 1];

  // Helper to safely format time to IST
  const formatTime = (isoString) => {
    const dateStr = isoString.endsWith('Z') ? isoString : `${isoString}Z`;
    return new Date(dateStr).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  };

  const labels = displayPoints.map(p => formatTime(p.recorded_at));
  const speedData = displayPoints.map(p => p.speed_kmph || 0);

  const data = {
    labels,
    datasets: [
      {
        label: 'Speed (km/h)',
        data: speedData,
        fill: true,
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;
          if (!chartArea) return 'rgba(99, 102, 241, 0.2)';
          const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(99, 102, 241, 0.5)'); // Indigo
          gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');
          return gradient;
        },
        borderColor: '#818cf8',
        borderWidth: 3,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#818cf8',
        pointBorderWidth: 2,
        pointRadius: 3, // Always visible dots to prove data exists
        pointHoverRadius: 7,
        pointHitRadius: 15,
        lineTension: 0.4, // Smooth curves
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 400,
      easing: 'easeOutQuart'
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        borderColor: 'rgba(99, 102, 241, 0.3)',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          label: (context) => `${context.parsed.y.toFixed(1)} km/h`
        }
      }
    },
    scales: {
      x: {
        grid: { display: false }, // Clean X axis
        ticks: {
          color: '#64748b',
          font: { size: 11, family: 'Inter, sans-serif' },
          autoSkip: true,
          maxTicksLimit: 6, // Keep it uncluttered
          maxRotation: 0,
        }
      },
      y: {
        beginAtZero: true,
        suggestedMax: 20, // Prevents 10km/h walk from touching the ceiling
        grid: {
          color: 'rgba(148, 163, 184, 0.1)',
          drawBorder: false,
        },
        ticks: {
          color: '#64748b',
          font: { size: 11, family: 'Inter, sans-serif' },
          callback: (value) => `${value} km/h`
        }
      }
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Real-time HUD (Heads Up Display) */}
      <div style={{ 
        position: 'absolute', 
        top: 10, 
        right: 15, 
        zIndex: 10, 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'flex-end',
        pointerEvents: 'none' 
      }}>
        <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#818cf8', textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
          {(latestPoint.speed_kmph || 0).toFixed(1)} <span style={{ fontSize: '14px', color: '#94a3b8', fontWeight: 'normal' }}>km/h</span>
        </div>
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px', backgroundColor: 'rgba(15,23,42,0.6)', padding: '2px 6px', borderRadius: '4px' }}>
          Updated: {formatTime(latestPoint.recorded_at)}
        </div>
      </div>

      {/* Chart Canvas */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
