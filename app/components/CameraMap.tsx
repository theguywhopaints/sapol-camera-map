'use client';

import {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CameraLocation } from '@/lib/geocoder';
import { haversineKm, circleGeoJSON } from '@/lib/distance';

export interface CameraMapHandle {
  flyToUser: (lat: number, lon: number) => void;
  flyToCamera: (lat: number, lon: number) => void;
}

interface Props {
  locations: CameraLocation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  userLat: number | null;
  userLon: number | null;
  radiusKm: number | null;
}

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const SA_CENTER: [number, number] = [138.6, -34.93];
const SA_ZOOM = 10;

const emptyFC = () => ({
  type: 'FeatureCollection' as const,
  features: [] as maplibregl.GeoJSONFeature[],
});

function popupHTML(loc: CameraLocation, distKm: number | null): string {
  const distLabel = distKm !== null ? `<span style="color:#94a3b8;font-size:11px">${distKm < 10 ? distKm.toFixed(1) : Math.round(distKm)}km away</span>` : '';
  const dateLabel = loc.date
    ? loc.dateEnd
      ? `${loc.date} – ${loc.dateEnd}`
      : loc.date
    : '';
  const typeColor = loc.type === 'metro' ? '#3b82f6' : '#22c55e';
  return `
    <div style="line-height:1.4">
      <div style="font-weight:600;font-size:14px;margin-bottom:2px">${esc(loc.location)}</div>
      <div style="color:#94a3b8;font-size:12px">${esc(loc.suburb)}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap">
        <span style="background:${typeColor}22;color:${typeColor};font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;border:1px solid ${typeColor}44">${loc.type === 'metro' ? 'Metro' : 'Country'}</span>
        ${dateLabel ? `<span style="color:#f59e0b;font-size:11px">${esc(dateLabel)}</span>` : ''}
        ${distLabel}
      </div>
    </div>`;
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CameraMap = forwardRef<CameraMapHandle, Props>(function CameraMap(
  { locations, selectedId, onSelect, userLat, userLon, radiusKm },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleLoadedRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pulseRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);

  // Expose fly-to methods to parent
  useImperativeHandle(ref, () => ({
    flyToUser: (lat, lon) => {
      mapRef.current?.flyTo({ center: [lon, lat], zoom: 13, duration: 900 });
    },
    flyToCamera: (lat, lon) => {
      mapRef.current?.flyTo({ center: [lon, lat], zoom: 15, duration: 700 });
    },
  }));

  // ─── Initialise map ─────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: SA_CENTER,
      zoom: SA_ZOOM,
      attributionControl: false,
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right'
    );
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      styleLoadedRef.current = true;

      // Radius ring layers
      map.addSource('radius-ring', { type: 'geojson', data: emptyFC() });
      map.addLayer({
        id: 'radius-fill',
        type: 'fill',
        source: 'radius-ring',
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.06 },
      });
      map.addLayer({
        id: 'radius-stroke',
        type: 'line',
        source: 'radius-ring',
        paint: { 'line-color': '#3b82f6', 'line-width': 1.5, 'line-dasharray': [5, 3] },
      });

      // Camera circles layer (GeoJSON for dynamic color-coding)
      map.addSource('cameras', {
        type: 'geojson',
        data: emptyFC(),
        generateId: true,
      });
      map.addLayer({
        id: 'cameras-shadow',
        type: 'circle',
        source: 'cameras',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 10, 15, 22],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.18,
          'circle-blur': 1,
        },
      });
      map.addLayer({
        id: 'cameras-circle',
        type: 'circle',
        source: 'cameras',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 15, 14],
          'circle-color': ['get', 'color'],
          'circle-stroke-width': ['case', ['==', ['get', 'id'], selectedId ?? ''], 3, 1.5],
          'circle-stroke-color': '#fff',
          'circle-opacity': ['case', ['get', 'inRadius'], 1, 0.3],
        },
      });

      // Camera label (street name, only at close zoom)
      map.addLayer({
        id: 'cameras-label',
        type: 'symbol',
        source: 'cameras',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'location'],
          'text-size': 11,
          'text-offset': [0, 1.6],
          'text-anchor': 'top',
          'text-max-width': 10,
        },
        paint: {
          'text-color': '#f1f5f9',
          'text-halo-color': '#020617',
          'text-halo-width': 1.5,
          'text-opacity': ['case', ['get', 'inRadius'], 1, 0.3],
        },
      });

      // Cursor change on hover
      map.on('mouseenter', 'cameras-circle', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'cameras-circle', () => {
        map.getCanvas().style.cursor = '';
      });

      // Click camera → select
      map.on('click', 'cameras-circle', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelect(id === selectedId ? null : id);
      });

      // Click blank area → deselect
      map.on('click', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['cameras-circle'] });
        if (!features.length) onSelect(null);
      });
    });

    mapRef.current = map;

    // Create DOM pulse + dot elements (positioned via map project)
    const pulse = document.createElement('div');
    pulse.className = 'user-pulse-ring';
    pulse.style.display = 'none';
    containerRef.current.appendChild(pulse);
    pulseRef.current = pulse;

    const dot = document.createElement('div');
    dot.className = 'user-dot';
    dot.style.display = 'none';
    containerRef.current.appendChild(dot);
    dotRef.current = dot;

    return () => {
      styleLoadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Update camera GeoJSON & radius ring ────────────────────
  const updateSources = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    const features = locations.map((loc) => {
      const distKm =
        userLat !== null && userLon !== null && loc.lat !== null && loc.lon !== null
          ? haversineKm(userLat, userLon, loc.lat!, loc.lon!)
          : null;

      const inRadius =
        radiusKm === null || distKm === null ? true : distKm <= radiusKm;

      let color: string;
      if (distKm === null) color = '#f59e0b';       // amber (no location data)
      else if (distKm < 2) color = '#ef4444';       // red
      else if (distKm < 5) color = '#f97316';       // orange
      else if (distKm < 10) color = '#f59e0b';      // amber
      else color = '#64748b';                        // slate (far)

      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [loc.lon!, loc.lat!] },
        properties: {
          id: loc.id,
          location: loc.location,
          suburb: loc.suburb,
          color,
          inRadius,
          distKm: distKm ?? 9999,
          type: loc.type,
          date: loc.date ?? '',
          dateEnd: loc.dateEnd ?? '',
        },
      };
    });

    (map.getSource('cameras') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features,
    });

    // Update stroke width on selected camera
    map.setPaintProperty('cameras-circle', 'circle-stroke-width', [
      'case',
      ['==', ['get', 'id'], selectedId ?? '____'],
      3,
      1.5,
    ]);

    // Radius ring
    if (userLat !== null && userLon !== null && radiusKm !== null) {
      (map.getSource('radius-ring') as maplibregl.GeoJSONSource).setData(
        circleGeoJSON(userLat, userLon, radiusKm) as Parameters<maplibregl.GeoJSONSource['setData']>[0]
      );
    } else {
      (map.getSource('radius-ring') as maplibregl.GeoJSONSource).setData(emptyFC());
    }
  }, [locations, selectedId, userLat, userLon, radiusKm]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!styleLoadedRef.current) {
      map.once('load', updateSources);
    } else {
      updateSources();
    }
  }, [updateSources]);

  // ─── User location dot + pulse ──────────────────────────────
  const updateUserDot = useCallback(() => {
    const map = mapRef.current;
    if (!map || !pulseRef.current || !dotRef.current) return;

    if (userLat === null || userLon === null) {
      pulseRef.current.style.display = 'none';
      dotRef.current.style.display = 'none';
      return;
    }

    const px = map.project([userLon, userLat]);
    pulseRef.current.style.display = 'block';
    pulseRef.current.style.left = `${px.x}px`;
    pulseRef.current.style.top = `${px.y}px`;
    dotRef.current.style.display = 'block';
    dotRef.current.style.left = `${px.x}px`;
    dotRef.current.style.top = `${px.y}px`;
  }, [userLat, userLon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateUserDot();
    map.on('move', updateUserDot);
    return () => { map.off('move', updateUserDot); };
  }, [updateUserDot]);

  // ─── Popup for selected camera ───────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    popupRef.current?.remove();
    popupRef.current = null;
    if (!map || !selectedId) return;

    const loc = locations.find((l) => l.id === selectedId);
    if (!loc?.lat || !loc?.lon) return;

    const distKm =
      userLat !== null && userLon !== null
        ? haversineKm(userLat, userLon, loc.lat, loc.lon)
        : null;

    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      maxWidth: '260px',
      offset: 16,
    })
      .setLngLat([loc.lon, loc.lat])
      .setHTML(popupHTML(loc, distKm))
      .addTo(map);

    popupRef.current.on('close', () => onSelect(null));
  }, [selectedId, locations, userLat, userLon, onSelect]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* Map attribution already added via control */}
    </div>
  );
});

export default CameraMap;
