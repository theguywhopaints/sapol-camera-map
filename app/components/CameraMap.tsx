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
  resetNorth: () => void;
}

interface Props {
  locations: CameraLocation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  userLat: number | null;
  userLon: number | null;
  userHeading: number | null;
  radiusKm: number | null;
  navMode: boolean;
  alertCameraId: string | null;
}

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const SA_CENTER: [number, number] = [138.6, -34.93];
const SA_ZOOM = 10;
const NAV_ZOOM = 16;
const NAV_PITCH = 30;

const emptyFC = () => ({
  type: 'FeatureCollection' as const,
  features: [] as maplibregl.GeoJSONFeature[],
});

function popupHTML(loc: CameraLocation, distKm: number | null): string {
  const distLabel = distKm !== null
    ? `<span style="color:#94a3b8;font-size:11px">${distKm < 10 ? distKm.toFixed(1) : Math.round(distKm)}km away</span>`
    : '';
  const dateLabel = loc.date ? (loc.dateEnd ? `${loc.date} – ${loc.dateEnd}` : loc.date) : '';
  const typeColor = loc.type === 'metro' ? '#3b82f6' : '#22c55e';
  return `
    <div style="line-height:1.4">
      <div style="font-weight:600;font-size:14px;margin-bottom:2px">${esc(loc.location)}</div>
      <div style="color:#94a3b8;font-size:12px">${esc(loc.suburb)}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:6px;flex-wrap:wrap">
        <span style="background:${typeColor}22;color:${typeColor};font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;border:1px solid ${typeColor}44">
          ${loc.type === 'metro' ? 'Metro' : 'Country'}
        </span>
        ${dateLabel ? `<span style="color:#f59e0b;font-size:11px">${esc(dateLabel)}</span>` : ''}
        ${distLabel}
      </div>
    </div>`;
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Draw a camera icon onto a canvas (white on transparent for SDF tinting)
function buildCameraIconCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d')!;
  const cx = size / 2;

  // Camera body
  const bx = size * 0.2, by = size * 0.38, bw = size * 0.6, bh = size * 0.44;
  c.fillStyle = 'white';
  c.beginPath();
  c.moveTo(bx + 4, by);
  c.lineTo(bx + bw - 4, by);
  c.arcTo(bx + bw, by, bx + bw, by + 4, 4);
  c.lineTo(bx + bw, by + bh - 4);
  c.arcTo(bx + bw, by + bh, bx + bw - 4, by + bh, 4);
  c.lineTo(bx + 4, by + bh);
  c.arcTo(bx, by + bh, bx, by + bh - 4, 4);
  c.lineTo(bx, by + 4);
  c.arcTo(bx, by, bx + 4, by, 4);
  c.closePath();
  c.fill();

  // Lens hole (cut out)
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  c.arc(cx, by + bh * 0.55, size * 0.14, 0, Math.PI * 2);
  c.fill();
  c.globalCompositeOperation = 'source-over';

  // Lens ring
  c.strokeStyle = 'white';
  c.lineWidth = size * 0.065;
  c.beginPath();
  c.arc(cx, by + bh * 0.55, size * 0.14, 0, Math.PI * 2);
  c.stroke();

  // Viewfinder bump on top
  c.fillStyle = 'white';
  c.fillRect(cx - size * 0.12, by - size * 0.12, size * 0.24, size * 0.14);

  return canvas;
}

const CameraMap = forwardRef<CameraMapHandle, Props>(function CameraMap(
  { locations, selectedId, onSelect, userLat, userLon, userHeading, radiusKm, navMode, alertCameraId },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleLoadedRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pulseRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const iconsReadyRef = useRef(false);

  useImperativeHandle(ref, () => ({
    flyToUser: (lat, lon) => {
      mapRef.current?.flyTo({ center: [lon, lat], zoom: 13, pitch: 0, bearing: 0, duration: 900 });
    },
    flyToCamera: (lat, lon) => {
      mapRef.current?.flyTo({ center: [lon, lat], zoom: 15, pitch: 0, bearing: 0, duration: 700 });
    },
    resetNorth: () => {
      mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 500 });
    },
  }));

  // ─── Initialise map ──────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: SA_CENTER,
      zoom: SA_ZOOM,
      attributionControl: false,
      pitchWithRotate: true,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    map.on('load', () => {
      styleLoadedRef.current = true;

      // Register camera icon (SDF — can be tinted via icon-color)
      const iconCanvas = buildCameraIconCanvas(48);
      const imageData = iconCanvas.getContext('2d')!.getImageData(0, 0, iconCanvas.width, iconCanvas.height);
      map.addImage('camera-icon', { width: iconCanvas.width, height: iconCanvas.height, data: new Uint8Array(imageData.data.buffer) }, { sdf: true });
      iconsReadyRef.current = true;

      // Radius ring
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

      // Camera markers
      map.addSource('cameras', { type: 'geojson', data: emptyFC(), generateId: true });

      // Outer glow
      map.addLayer({
        id: 'cameras-glow',
        type: 'circle',
        source: 'cameras',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 14, 16, 30],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.14,
          'circle-blur': 1.2,
        },
      });

      // Camera icon (SDF, tinted by distance color)
      map.addLayer({
        id: 'cameras-icon',
        type: 'symbol',
        source: 'cameras',
        layout: {
          'icon-image': 'camera-icon',
          'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.38, 16, 0.72],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': ['get', 'color'],
          'icon-halo-color': ['case', ['==', ['get', 'id'], selectedId ?? '____'], '#fff', 'rgba(2,6,23,0.75)'],
          'icon-halo-width': ['case', ['==', ['get', 'id'], selectedId ?? '____'], 2, 1.5],
          'icon-opacity': ['case', ['get', 'inRadius'], 1, 0.3],
        },
      });

      // Street label at close zoom
      map.addLayer({
        id: 'cameras-label',
        type: 'symbol',
        source: 'cameras',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'location'],
          'text-size': 11,
          'text-offset': [0, 1.8],
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

      map.on('mouseenter', 'cameras-icon', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'cameras-icon', () => { map.getCanvas().style.cursor = ''; });

      map.on('click', 'cameras-icon', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelect(id === selectedId ? null : id);
      });

      map.on('click', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['cameras-icon'] });
        if (!features.length) onSelect(null);
      });
    });

    mapRef.current = map;

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
      iconsReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Navigation mode: auto-follow + heading-up ───────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!navMode) {
      map.easeTo({ bearing: 0, pitch: 0, duration: 600 });
      return;
    }
    if (userLat === null || userLon === null) return;

    map.easeTo({
      center: [userLon, userLat],
      bearing: userHeading ?? map.getBearing(),
      pitch: NAV_PITCH,
      zoom: Math.max(map.getZoom(), NAV_ZOOM),
      duration: 800,
    });
  }, [navMode, userLat, userLon, userHeading]);

  // ─── Update GeoJSON + radius ring ────────────────────────────
  const updateSources = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;

    const features = locations.map((loc) => {
      const distKm =
        userLat !== null && userLon !== null && loc.lat !== null && loc.lon !== null
          ? haversineKm(userLat, userLon, loc.lat!, loc.lon!)
          : null;
      const inRadius = radiusKm === null || distKm === null ? true : distKm <= radiusKm;
      const isAlerting = loc.id === alertCameraId;

      let color: string;
      if (isAlerting)           color = '#ef4444';
      else if (distKm === null) color = '#f59e0b';
      else if (distKm < 2)      color = '#ef4444';
      else if (distKm < 5)      color = '#f97316';
      else if (distKm < 10)     color = '#f59e0b';
      else                      color = '#64748b';

      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [loc.lon!, loc.lat!] },
        properties: {
          id: loc.id, location: loc.location, suburb: loc.suburb,
          color, inRadius, distKm: distKm ?? 9999,
          type: loc.type, date: loc.date ?? '', dateEnd: loc.dateEnd ?? '',
        },
      };
    });

    (map.getSource('cameras') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features });

    // Update icon halo for selected camera
    map.setPaintProperty('cameras-icon', 'icon-halo-color', [
      'case', ['==', ['get', 'id'], selectedId ?? '____'], '#ffffff', 'rgba(2,6,23,0.75)',
    ]);
    map.setPaintProperty('cameras-icon', 'icon-halo-width', [
      'case', ['==', ['get', 'id'], selectedId ?? '____'], 2.5, 1.5,
    ]);

    if (userLat !== null && userLon !== null && radiusKm !== null) {
      (map.getSource('radius-ring') as maplibregl.GeoJSONSource).setData(
        circleGeoJSON(userLat, userLon, radiusKm) as Parameters<maplibregl.GeoJSONSource['setData']>[0]
      );
    } else {
      (map.getSource('radius-ring') as maplibregl.GeoJSONSource).setData(emptyFC());
    }
  }, [locations, selectedId, userLat, userLon, radiusKm, alertCameraId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!styleLoadedRef.current) map.once('load', updateSources);
    else updateSources();
  }, [updateSources]);

  // ─── User location dot ────────────────────────────────────────
  const updateUserDot = useCallback(() => {
    const map = mapRef.current;
    if (!map || !pulseRef.current || !dotRef.current) return;
    if (userLat === null || userLon === null) {
      pulseRef.current.style.display = 'none';
      dotRef.current.style.display = 'none';
      return;
    }
    const px = map.project([userLon, userLat]);
    pulseRef.current.style.cssText += `display:block;left:${px.x}px;top:${px.y}px`;
    dotRef.current.style.cssText += `display:block;left:${px.x}px;top:${px.y}px`;
  }, [userLat, userLon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateUserDot();
    map.on('move', updateUserDot);
    return () => { map.off('move', updateUserDot); };
  }, [updateUserDot]);

  // ─── Popup for selected camera ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    popupRef.current?.remove();
    popupRef.current = null;
    if (!map || !selectedId) return;
    const loc = locations.find((l) => l.id === selectedId);
    if (!loc?.lat || !loc?.lon) return;
    const distKm = userLat !== null && userLon !== null
      ? haversineKm(userLat, userLon, loc.lat, loc.lon) : null;
    popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '260px', offset: 16 })
      .setLngLat([loc.lon, loc.lat])
      .setHTML(popupHTML(loc, distKm))
      .addTo(map);
    popupRef.current.on('close', () => onSelect(null));
  }, [selectedId, locations, userLat, userLon, onSelect]);

  return (
    <div ref={containerRef} className="w-full h-full relative" />
  );
});

export default CameraMap;
