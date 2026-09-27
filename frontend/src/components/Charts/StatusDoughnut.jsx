import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { useTheme } from '../../context/ThemeContext';

ChartJS.register(ArcElement, Tooltip, Legend);

export default function StatusDoughnut({ k }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const ink = isDark ? '#e8eeef' : '#0d1b1e';
  const surface = isDark ? '#131a1c' : '#ffffff';

  const total = (k.green || 0) + (k.yellow || 0) +
                ((k.red || 0) + (k.orange || 0) + (k.purple || 0)) +
                ((k.grey || 0) + (k.delay || 0));

  const data = {
    labels: ['Compliant', 'Warning', 'Exceedance', 'Offline'],
    datasets: [
      {
        data: [
          k.green || 0,
          k.yellow || 0,
          (k.red || 0) + (k.orange || 0) + (k.purple || 0),
          (k.grey || 0) + (k.delay || 0),
        ],
        backgroundColor: [
          isDark ? '#10b981' : '#059669',
          isDark ? '#f59e0b' : '#d97706',
          isDark ? '#f87171' : '#dc2626',
          isDark ? '#94a3b8' : '#64748b',
        ],
        borderWidth: 2,
        borderColor: surface,
        hoverOffset: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '72%',
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
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
        boxPadding: 6,
      },
    },
  };

  return (
    <div className="chart-wrap chart-md" style={{ position: 'relative' }}>
      <Doughnut data={data} options={options} />
      {/* Center label */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 28,
            fontWeight: 600,
            color: 'var(--ink)',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {total}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginTop: 4,
            fontWeight: 500,
          }}
        >
          Sites
        </div>
      </div>
    </div>
  );
}