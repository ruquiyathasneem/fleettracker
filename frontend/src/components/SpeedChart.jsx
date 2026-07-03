import React, { useRef } from 'react';
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
import zoomPlugin from 'chartjs-plugin-zoom';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  zoomPlugin
);

export default function SpeedChart({ routePoints = [] }) {
  const chartRef = useRef(null);

  const handleResetZoom = () => {
    if (chartRef.current) {
      chartRef.current.resetZoom();
    }
  };

  // If no data, render an empty chart state to maintain UI structure
  const safeRoutePoints = routePoints && routePoints.length > 0 ? routePoints : [];

  const labels = safeRoutePoints.length > 0 
    ? safeRoutePoints.map(p => {
        if (!p.recorded_at) return '';
        const dateStr = String(p.recorded_at);
        const utcDateStr = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
        const d = new Date(utcDateStr);
        return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      })
    : ['No Data'];

  const speedData = safeRoutePoints.length > 0 
    ? safeRoutePoints.map(p => p.speed_kmph || 0)
    : [0];

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
        pointRadius: 0, // hide dots to look like a clean stock chart
        pointHitRadius: 10, // still allow hovering to see tooltips easily
        tension: 0, // 0 tension makes it point-to-point linear like a stock chart
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
      },
      zoom: {
        pan: {
          enabled: true,
          mode: 'x', // Allow panning horizontally
        },
        zoom: {
          wheel: {
            enabled: true,
          },
          pinch: {
            enabled: true,
          },
          mode: 'x', // Allow zooming horizontally like Google Finance
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
      {safeRoutePoints.length > 0 && (
        <button 
          onClick={handleResetZoom}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: 'rgba(99, 102, 241, 0.2)',
            color: '#818cf8',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            padding: '4px 10px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: '600',
            cursor: 'pointer',
            zIndex: 10,
            transition: 'background 0.2s'
          }}
          onMouseOver={e => e.target.style.background = 'rgba(99, 102, 241, 0.4)'}
          onMouseOut={e => e.target.style.background = 'rgba(99, 102, 241, 0.2)'}
        >
          Reset Zoom
        </button>
      )}
      <Line ref={chartRef} data={data} options={options} />
    </div>
  );
}
