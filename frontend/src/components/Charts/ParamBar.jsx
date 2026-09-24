import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js';
import { useTheme } from '../../context/ThemeContext';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

export default function ParamBar({ sites }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const ink = isDark ? '#e8eeef' : '#0d1b1e';
  const surface = isDark ? '#131a1c' : '#ffffff';
  const grid = isDark ? '#223032' : '#e8edee';
  const tickColor = isDark ? '#7b8a8d' : '#98a5a8';

  const counts = {};
  (sites || []).forEach((s) => {
    (s.params || []).forEach((p) => {
      if (['yellow', 'orange', 'red', 'purple'].includes(p.signal)) {
        counts[p.key] = (counts[p.key] || 0) + 1;
      }
    });
  });

  const keys = Object.keys(counts);

  if (!keys.length) {
    return (
      <div className="empty">
        No active exceedances. All parameters within limits.
      </div>
    );
  }

  const palette = isDark
    ? ['#2dd4bf', '#22d3ee', '#a78bfa', '#fbbf24', '#fb923c', '#f87171']
    : ['#0f766e', '#0891b2', '#7c3aed', '#d97706', '#ea580c', '#dc2626'];

  const data = {
    labels: keys,
    datasets: [
      {
        data: keys.map((k) => counts[k]),
        backgroundColor: keys.map((_, i) => palette[i % palette.length]),
        borderRadius: 6,
        barThickness: 26,
      },
    ],
  };

  const options = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: surface,
        titleColor: ink,
        bodyColor: ink,
        borderColor: isDark ? '#223032' : '#dde3e4',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        titleFont: { size: 12, weight: '600' },
        bodyFont: { size: 12 },
        displayColors: false,
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: { color: grid, drawBorder: false },
        ticks: { color: tickColor, font: { size: 11 }, precision: 0 },
      },
      y: {
        grid: { display: false },
        ticks: { color: tickColor, font: { size: 11, weight: '500' } },
      },
    },
  };

  return (
    <div className="chart-wrap chart-md">
      <Bar data={data} options={options} />
    </div>
  );
}