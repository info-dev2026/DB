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

function makeTileLayer(theme) {
  const url =
    theme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  const attribution =
    theme === 'dark'
      ? '© OpenStreetMap · © CARTO'
      : '© OpenStreetMap';

  return L.tileLayer(url, { maxZoom: 18, attribution });
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
    tileRef.current = makeTileLayer(theme).addTo(map);

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

    return () => {
      aliveRef.current = false;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);

      const m = instanceRef.current;
      instanceRef.current = null;
      markersRef.current = {};
      tileRef.current = null;

      if (m) {
        try { m.off(); } catch {}
        try { m.remove(); } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Swap tile layer when theme changes */
  useEffect(() => {
    const map = instanceRef.current;
    if (!map || !aliveRef.current) return;

    if (tileRef.current) {
      try { map.removeLayer(tileRef.current); } catch {}
      tileRef.current = null;
    }
    tileRef.current = makeTileLayer(theme).addTo(map);
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

      if (existing) {
        try {
          existing.setStyle({ fillColor: col });
          existing.setPopupContent(popupHtml(s, col));
        } catch {}
      } else {
        const mk = L.circleMarker([s.lat, s.lng], {
          radius: 9,
          fillColor: col,
          color: theme === 'dark' ? '#131a1c' : '#ffffff',
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