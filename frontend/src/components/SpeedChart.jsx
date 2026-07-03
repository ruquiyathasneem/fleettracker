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

  // Format labels and speed coordinates to Indian Standard Time
  const labels = routePoints.map(p => {
    // Append 'Z' to ensure it is parsed as UTC if the backend didn't include it
    const dateStr = p.recorded_at.endsWith('Z') ? p.recorded_at : `${p.recorded_at}Z`;
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-IN', { 
      timeZone: 'Asia/Kolkata', 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      hour12: true
    });
  });

  const speedData = routePoints.map(p => p.speed_kmph || 0);

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
          if (!chartArea) return 'rgba(99, 102, 241, 0.1)';
          const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(99, 102, 241, 0.5)');
          gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');
          return gradient;
        },
        borderColor: '#818cf8',
        borderWidth: 3,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: '#818cf8',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#ffffff',
        pointHoverBorderColor: '#6366f1',
        pointHoverBorderWidth: 3,
        pointRadius: 3, // Restore static dots so users can see each individual ping being plotted
        pointHitRadius: 15, // Large invisible hit area for easy hovering
        lineTension: 0.4, // Super smooth bezier curves
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
          color: '#94a3b8',
          font: { size: 11, family: 'Inter, sans-serif' },
          autoSkip: true,
          maxTicksLimit: 6, // Clean spacing, never cluttered
          maxRotation: 0, // Keep them flat and readable
        }
      },
      y: {
        min: 0,
        grid: {
          color: 'rgba(148, 163, 184, 0.05)',
        },
        ticks: {
          color: '#94a3b8',
          font: { size: 11, family: 'Inter, sans-serif' },
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
