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
        padding: '20px'
      }}>
        No speed data available. Select a vehicle with trip history or run simulator to see speed graph.
      </div>
    );
  }

  // Format labels and speed coordinates
  const labels = routePoints.map(p => {
    // Ensure the date string is parsed as UTC if the backend omitted the 'Z'
    const dateStr = p.recorded_at;
    const utcDateStr = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
    const d = new Date(utcDateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });

  const speedData = routePoints.map(p => p.speed_kmph || 0);

  const data = {
    labels,
    datasets: [
      {
        label: 'Speed (km/h)',
        data: speedData,
        fill: true,
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        borderColor: '#6366f1',
        borderWidth: 2,
        pointBackgroundColor: '#06b6d4',
        pointBorderColor: '#ffffff',
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#6366f1',
        pointHoverBorderColor: '#ffffff',
        pointHoverBorderWidth: 2,
        pointRadius: routePoints.length > 50 ? 0 : 2, // hide dots if too dense
        lineTension: 0.3,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false, // Hide label legend to keep it clean
      },
      tooltip: {
        backgroundColor: '#131b2e',
        titleColor: '#f8fafc',
        bodyColor: '#94a3b8',
        borderColor: 'rgba(148, 163, 184, 0.15)',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 6,
        displayColors: false,
        callbacks: {
          label: (context) => `Speed: ${context.parsed.y.toFixed(1)} km/h`
        }
      }
    },
    scales: {
      x: {
        grid: {
          color: 'rgba(148, 163, 184, 0.05)',
        },
        ticks: {
          color: '#64748b',
          font: { size: 10 },
          maxTicksLimit: 8, // Avoid label crowding
        }
      },
      y: {
        min: 0,
        grid: {
          color: 'rgba(148, 163, 184, 0.05)',
        },
        ticks: {
          color: '#64748b',
          font: { size: 10 },
          callback: (value) => `${value} km/h`
        }
      }
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Line data={data} options={options} />
    </div>
  );
}
