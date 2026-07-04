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
      }}>
        Waiting for GPS data...
      </div>
    );
  }

  // Sliding window: last 60 pings (~5 minutes at 5s intervals)
  const displayPoints = routePoints.slice(-60);

  const formatTime = (isoString) => {
    const dateStr = isoString.endsWith('Z') ? isoString : `${isoString}Z`;
    return new Date(dateStr).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  const labels = displayPoints.map(p => formatTime(p.recorded_at));
  const speedData = displayPoints.map(p => typeof p.speed_kmph === 'number' ? p.speed_kmph : 0);

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
          if (!chartArea) return 'rgba(99, 102, 241, 0.15)';
          const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
          gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');
          return gradient;
        },
        borderColor: '#818cf8',
        borderWidth: 2,
        pointRadius: 0,       // No dots — clean smooth line
        pointHoverRadius: 4,  // Dot appears on hover only
        tension: 0.4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,         // Instant update — no lag on new pings
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        titleColor: '#f8fafc',
        bodyColor: '#e2e8f0',
        borderColor: 'rgba(99, 102, 241, 0.4)',
        borderWidth: 1,
        padding: 10,
        displayColors: false,
        callbacks: {
          label: (context) => `${context.parsed.y.toFixed(1)} km/h`
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: '#64748b',
          font: { size: 10 },
          maxTicksLimit: 6,
          maxRotation: 0,
        }
      },
      y: {
        beginAtZero: true,
        suggestedMax: 20,
        grid: {
          color: 'rgba(148, 163, 184, 0.08)',
        },
        ticks: {
          color: '#64748b',
          font: { size: 10 },
          callback: (v) => `${v} km/h`
        }
      }
    }
  };

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Line data={data} options={options} />
    </div>
  );
}
