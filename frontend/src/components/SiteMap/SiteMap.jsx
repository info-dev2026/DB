import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { HEX, SIG_LABEL } from '../../utils/cpcb';
import { useTheme } from '../../context/ThemeContext';

/* Fix Leaflet default marker icons (react-scripts bundling) */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function makeTileLayer() {
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap contributors',
  });
}

function popupHtml(s, col) {
  return `
    <div class="map-pop">
      <b>${s.name}</b>
      <div class="mp-row">${s.id} · ${s.sector || '—'}</div>
      <div class="mp-row">${s.loc || '—'} · ${s.spcb || '—'}</div>
      <span class="mp-badge" style="background:${col}">${SIG_LABEL[s.signal] || ''}</span>
    </div>`;
}

export default function SiteMap({ sites = [], height = 420, onSelect }) {
  const { theme } = useTheme();
  const mapRef = useRef(null);
  const instanceRef = useRef(null);
  const markersRef = useRef({});
  const tileRef = useRef(null);
  const aliveRef = useRef(true);

  /* Init map once */
  useEffect(() => {
    aliveRef.current = true;
    const container = mapRef.current;
    if (!container || instanceRef.current) return;

    const map = L.map(container, {
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true,
    }).setView([28.7, 77.3], 7);

    instanceRef.current = map;
    tileRef.current = makeTileLayer().addTo(map);

    /* Safe invalidate — only if still alive and map has a container */
    const safeInvalidate = () => {
      if (!aliveRef.current) return;
      const m = instanceRef.current;
      if (!m || !m._container) return;
      try { m.invalidateSize(); } catch {}
    };

    /* Multiple attempts to catch layout reflow */
    const t1 = setTimeout(safeInvalidate, 50);
    const t2 = setTimeout(safeInvalidate, 250);
    const t3 = setTimeout(safeInvalidate, 800);

    const handleResize = () => safeInvalidate();
    window.addEventListener('resize', handleResize);

    return () => {
      aliveRef.current = false;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('resize', handleResize);

      const m = instanceRef.current;
      instanceRef.current = null;
      markersRef.current = {};
      tileRef.current = null;

      if (m) {
        try { m.off(); } catch {}
        try { m.remove(); } catch {}
      }
    };
  }, []);

  /* Invalidate and refresh on theme change */
  useEffect(() => {
    const map = instanceRef.current;
    if (!map || !aliveRef.current) return;
    try { map.invalidateSize(); } catch {}
  }, [theme]);

  /* Update markers */
  useEffect(() => {
    const map = instanceRef.current;
    if (!map || !aliveRef.current) return;

    /* Remove stale markers */
    Object.entries(markersRef.current).forEach(([id, mk]) => {
      if (!sites.find((s) => s.id === id)) {
        try { map.removeLayer(mk); } catch {}
        delete markersRef.current[id];
      }
    });

    const pts = [];

    sites.forEach((s) => {
      const col = HEX[s.signal] || HEX.grey;
      const existing = markersRef.current[s.id];
      const strokeColor = theme === 'dark' ? '#111719' : '#ffffff';

      if (existing) {
        try {
          existing.setStyle({ fillColor: col, color: strokeColor });
          existing.setPopupContent(popupHtml(s, col));
        } catch {}
      } else {
        const mk = L.circleMarker([s.lat, s.lng], {
          radius: 9,
          fillColor: col,
          color: strokeColor,
          weight: 2,
          fillOpacity: 0.95,
        });

        mk.bindPopup(popupHtml(s, col), {
          closeButton: false,
          offset: [0, -2],
          className: 'sz-popup',
        });

        mk.on('click', () => {
          setTimeout(() => {
            if (aliveRef.current && onSelect) onSelect(s);
          }, 300);
        });

        try {
          mk.addTo(map);
          markersRef.current[s.id] = mk;
        } catch {}
      }

      pts.push([s.lat, s.lng]);
    });

    if (pts.length && !map._fitted) {
      try {
        map.fitBounds(pts, { padding: [40, 40], maxZoom: 9 });
        map._fitted = true;
      } catch {}
    }
  }, [sites, onSelect, theme]);

  return (
    <div
      ref={mapRef}
      id="siteMap"
      style={{
        height,
        width: '100%',
        borderRadius: '0 0 var(--r-xl) var(--r-xl)',
        zIndex: 1,
      }}
    />
  );
}