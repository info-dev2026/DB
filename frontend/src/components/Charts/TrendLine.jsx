import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { useTheme } from '../../context/ThemeContext';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

export default function TrendLine({ site }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  if (!site || !site.params?.length) {
    return <div className="empty">No parameters configured.</div>;
  }

  const ink = isDark ? '#e8eeef' : '#0d1b1e';
  const inkSoft = isDark ? '#7b8a8d' : '#6b7a7d';
  const surface = isDark ? '#131a1c' : '#ffffff';
  const grid = isDark ? '#223032' : '#e8edee';

  const palette = isDark
    ? ['#2dd4bf', '#22d3ee', '#a78bfa', '#fbbf24', '#fb923c', '#f87171', '#94a3b8']
    : ['#0f766e', '#0891b2', '#7c3aed', '#d97706', '#ea580c', '#dc2626', '#64748b'];

  const ref = site.params[0];
  const labels = ref.history.map((_, i) => {
    const minsAgo = (ref.history.length - 1 - i) * 15;
    return `-${minsAgo}m`;
  });

  const data = {
    labels,
    datasets: site.params.map((p, i) => ({
      label: p.name || p.key,
      data: p.history,
      borderColor: palette[i % palette.length],
      borderWidth: 1.8,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: palette[i % palette.length],
      pointHoverBorderColor: surface,
      pointHoverBorderWidth: 2,
      tension: 0.35,
      fill: false,
    })),
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        align: 'start',
        labels: {
          color: inkSoft,
          boxWidth: 8,
          boxHeight: 8,
          padding: 14,
          font: { size: 11, weight: '500' },
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: {
        backgroundColor: surface,
        titleColor: ink,
        bodyColor: ink,
        borderColor: isDark ? '#223032' : '#dde3e4',
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        titleFont: { size: 12, weight: '600', family: 'JetBrains Mono' },
        bodyFont: { size: 12, family: 'JetBrains Mono' },
        boxWidth: 8,
        boxHeight: 8,
        boxPadding: 6,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: grid, drawBorder: false },
        ticks: {
          color: inkSoft,
          font: { size: 11, family: 'JetBrains Mono' },
          maxTicksLimit: 6,
        },
      },
      x: {
        grid: { display: false },
        ticks: {
          color: inkSoft,
          font: { size: 10, family: 'JetBrains Mono' },
          maxTicksLimit: 8,
        },
      },
    },
  };

  return (
    <div className="chart-wrap chart-lg">
      <Line data={data} options={options} />
    </div>
  );
}