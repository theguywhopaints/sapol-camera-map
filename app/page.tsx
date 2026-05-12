'use client';

import dynamic from 'next/dynamic';
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type RefObject,
} from 'react';
import type { CameraLocation } from '@/lib/geocoder';
import { useGeolocation } from './hooks/useGeolocation';
import { useProximityAlerts, ALERT_DISTANCES, type AlertDistance } from './hooks/useProximityAlerts';
import { haversineKm, formatDistance } from '@/lib/distance';
import { BottomSheet, type SnapState } from './components/BottomSheet';
import type { CameraMapHandle } from './components/CameraMap';

const CameraMap = dynamic(() => import('./components/CameraMap'), { ssr: false });

interface ApiResult {
  locations: CameraLocation[];
  lastUpdated: string;
  cached: boolean;
  error?: string;
}

const MAP_RADIUS_OPTIONS: (number | null)[] = [1, 2, 5, 10, 20, null];
const REFRESH_MS = 30 * 60 * 1000;

function parseSaDate(s?: string): Date | null {
  if (!s || s.length > 12) return null;
  const [d, m, y] = s.split('/');
  return d && m && y ? new Date(+y, +m - 1, +d) : null;
}
function fmtDate(s?: string): string {
  const d = parseSaDate(s);
  if (!d) return s ?? '';
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtAlertDist(d: AlertDistance): string {
  return d < 1 ? `${d * 1000}m` : `${d}km`;
}

function CameraIcon({ color = '#f59e0b' }: { color?: string }) {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none">
      <rect x="0.5" y="2.5" width="15" height="11" rx="2" stroke={color} strokeWidth="1.2" />
      <circle cx="8" cy="8" r="3" stroke={color} strokeWidth="1.2" />
      <rect x="5" y="0.5" width="4" height="3" rx="1" fill={color} />
    </svg>
  );
}

function MarkerDot({ color }: { color: string }) {
  return <div className="w-3 h-3 rounded-full shrink-0 ring-2 ring-black/30" style={{ background: color }} />;
}

export default function Home() {
  const [data, setData] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [mapRadius, setMapRadius] = useState<number | null>(5);
  const [snap, setSnap] = useState<SnapState>('half');
  const [navMode, setNavMode] = useState(false);

  const geo = useGeolocation();
  const mapRef = useRef<CameraMapHandle>(null) as RefObject<CameraMapHandle>;

  // ─── Dates + filter (must come before alerts hook) ───────────
  const availableDates = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    data.locations.forEach((l) => { if (l.date && l.date.length <= 12) seen.add(l.date); });
    return Array.from(seen).sort((a, b) => (parseSaDate(a)?.getTime() ?? 0) - (parseSaDate(b)?.getTime() ?? 0));
  }, [data]);

  useEffect(() => {
    if (!data || dateFilter !== 'all') return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = availableDates.find((d) => parseSaDate(d)?.toDateString() === today.toDateString());
    if (todayStr) setDateFilter(todayStr);
  }, [data, availableDates, dateFilter]);

  const filteredByDate = useMemo(() => {
    if (!data) return [];
    const all = data.locations.filter((l) => l.lat !== null && l.lon !== null);
    if (dateFilter === 'all') return all;
    return all.filter((l) => l.date === dateFilter || (l.dateEnd && l.type === 'country'));
  }, [data, dateFilter]);

  const alerts = useProximityAlerts(
    filteredByDate,
    geo.location?.lat ?? null,
    geo.location?.lon ?? null,
    geo.location?.heading ?? null,
  );

  // ─── Fetch ────────────────────────────────────────────────────
  const fetchLocations = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/cameras');
      const json: ApiResult = await res.json();
      if (!res.ok) setFetchError((json as { error?: string }).error ?? 'Error');
      else setData(json);
    } catch (e) {
      setFetchError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
    const t = setInterval(fetchLocations, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchLocations]);

  useEffect(() => {
    geo.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withDistance = useMemo(() => filteredByDate.map((l) => ({
    ...l,
    distKm: geo.location && l.lat !== null && l.lon !== null
      ? haversineKm(geo.location.lat, geo.location.lon, l.lat!, l.lon!)
      : null,
  })), [filteredByDate, geo.location]);

  const displayLocations = useMemo(() => {
    const filtered = mapRadius !== null && geo.location
      ? withDistance.filter((l) => l.distKm !== null && l.distKm <= mapRadius)
      : withDistance;
    return [...filtered].sort((a, b) =>
      a.distKm !== null && b.distKm !== null ? a.distKm - b.distKm : 0
    );
  }, [withDistance, mapRadius, geo.location]);

  const nearbyCount = displayLocations.length;

  useEffect(() => {
    if (!selectedId) return;
    const loc = displayLocations.find((l) => l.id === selectedId);
    if (loc?.lat && loc?.lon) mapRef.current?.flyToCamera(loc.lat, loc.lon);
  }, [selectedId, displayLocations]);

  // ─── Speed (m/s → km/h) ───────────────────────────────────────
  const speedKmh = geo.location?.speed != null ? Math.round(geo.location.speed * 3.6) : null;

  // ─── Alert state ──────────────────────────────────────────────
  const alertCamera = alerts.activeAlert;
  const alertDist = alertCamera?.distKm ?? null;
  const alertIsClose = alertDist !== null && alertDist < 0.5;

  function dotColor(distKm: number | null): string {
    if (distKm === null) return '#f59e0b';
    if (distKm < 2) return '#ef4444';
    if (distKm < 5) return '#f97316';
    if (distKm < 10) return '#f59e0b';
    return '#64748b';
  }

  return (
    <div className="fixed inset-0 bg-slate-950">
      {/* ── Map ──────────────────────────────────────────────── */}
      <div className="absolute inset-0">
        <CameraMap
          ref={mapRef}
          locations={withDistance}
          selectedId={selectedId}
          onSelect={setSelectedId}
          userLat={geo.location?.lat ?? null}
          userLon={geo.location?.lon ?? null}
          userHeading={geo.location?.heading ?? null}
          radiusKm={mapRadius}
          navMode={navMode}
          alertCameraId={alertCamera?.camera.id ?? null}
        />
      </div>

      {/* ── Top bar ─────────────────────────────────────────── */}
      <div
        className="absolute top-0 inset-x-0 z-30 pointer-events-none"
        style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}
      >
        <div className="mx-3 pointer-events-auto">
          <div className="flex items-center gap-2 bg-slate-900/85 backdrop-blur-xl rounded-2xl px-3 py-2.5 border border-slate-700/40 shadow-xl">
            {/* Count badge */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`w-2 h-2 rounded-full animate-pulse ${alertCamera ? 'bg-red-400' : 'bg-amber-400'}`} />
              <span className="text-sm font-semibold text-white">{loading && !data ? '…' : nearbyCount}</span>
              <span className="text-xs text-slate-400 hidden sm:block">
                camera{nearbyCount !== 1 ? 's' : ''}{mapRadius && geo.location ? ` within ${mapRadius}km` : ''}
              </span>
            </div>

            {/* Date selector */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="flex-1 min-w-0 bg-slate-800/80 border border-slate-600/50 text-slate-200 text-xs rounded-xl px-2.5 py-1.5 appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-400/50"
            >
              <option value="all">All dates</option>
              {availableDates.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
            </select>

            {/* Speed badge (nav mode only) */}
            {navMode && speedKmh !== null && (
              <div className="shrink-0 min-w-[40px] h-8 rounded-xl bg-slate-800/80 border border-slate-600/50 flex items-center justify-center px-1.5">
                <span className="text-xs font-bold text-white tabular-nums">{speedKmh}</span>
                <span className="text-[9px] text-slate-400 ml-0.5 leading-none">km/h</span>
              </div>
            )}

            {/* Refresh */}
            <button
              onClick={fetchLocations}
              disabled={loading}
              className="shrink-0 w-8 h-8 rounded-xl bg-slate-800/80 border border-slate-600/50 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
              aria-label="Refresh"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={loading ? 'animate-spin' : ''}>
                <path d="M12.5 7A5.5 5.5 0 1 1 7 1.5M7 1.5L9.5 4M7 1.5L4.5 4"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* ══ Waze-style alert banner ══ */}
        {alertCamera && (
          <div className="mx-3 mt-2 pointer-events-auto alert-slide-in">
            <div className={`rounded-2xl px-4 py-3 flex items-center gap-3 border shadow-2xl backdrop-blur-xl transition-colors duration-500 ${
              alertIsClose
                ? 'bg-red-950/97 border-red-500/70'
                : 'bg-amber-950/97 border-amber-500/60'
            }`}>
              {/* Pulsing warning icon */}
              <div className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${
                alertIsClose ? 'bg-red-500/25 ring-1 ring-red-400/50' : 'bg-amber-500/20 ring-1 ring-amber-400/40'
              } ${alertIsClose ? 'animate-pulse' : ''}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                    stroke={alertIsClose ? '#f87171' : '#fbbf24'}
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                    fill={alertIsClose ? '#f8717118' : '#fbbf2418'} />
                  <line x1="12" y1="9" x2="12" y2="13" stroke={alertIsClose ? '#f87171' : '#fbbf24'} strokeWidth="2" strokeLinecap="round" />
                  <line x1="12" y1="17" x2="12.01" y2="17" stroke={alertIsClose ? '#f87171' : '#fbbf24'} strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className={`text-xs font-bold uppercase tracking-wider ${alertIsClose ? 'text-red-400' : 'text-amber-400'}`}>
                    Speed Camera{alertCamera.onSameRoad ? ' · Same Road' : ''}
                  </p>
                  {/* Distance countdown — large and prominent */}
                  <p className={`text-2xl font-black tabular-nums leading-none ${alertIsClose ? 'text-red-300' : 'text-amber-300'}`}>
                    {formatDistance(alertCamera.distKm)}
                  </p>
                </div>
                <p className="text-sm font-medium text-white mt-0.5 truncate">
                  {alertCamera.camera.location}
                  <span className="text-slate-400 font-normal">, {alertCamera.camera.suburb}</span>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Nav mode FAB ───────────────────────────────────────── */}
      <div
        className="absolute right-3 z-30 flex flex-col gap-2"
        style={{ bottom: 'calc(168px + env(safe-area-inset-bottom))' }}
      >
        {/* Nav toggle */}
        <button
          onClick={() => {
            const next = !navMode;
            setNavMode(next);
            if (next && geo.location) {
              // Let the map useEffect handle the fly-to
            } else {
              mapRef.current?.resetNorth();
            }
          }}
          title={navMode ? 'Exit navigation mode' : 'Navigation mode — heading-up, auto-follow'}
          className={`w-12 h-12 rounded-2xl border shadow-xl flex items-center justify-center transition-all active:scale-95 ${
            navMode
              ? 'bg-blue-600/90 border-blue-400/60 text-white backdrop-blur-lg'
              : 'bg-slate-900/90 border-slate-700/50 text-slate-300 backdrop-blur-lg hover:bg-slate-800'
          }`}
          aria-label={navMode ? 'Exit navigation' : 'Start navigation'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <polygon
              points="12,2 19,21 12,17 5,21"
              stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
              fill={navMode ? 'currentColor' : 'none'}
            />
          </svg>
        </button>

        {/* Locate me */}
        <button
          onClick={() => {
            if (geo.location) mapRef.current?.flyToUser(geo.location.lat, geo.location.lon);
            else geo.request();
          }}
          className="w-12 h-12 rounded-2xl bg-slate-900/90 backdrop-blur-lg border border-slate-700/50 shadow-xl flex items-center justify-center text-white hover:bg-slate-800 active:scale-95 transition-all"
          aria-label="Locate me"
        >
          {geo.loading ? (
            <svg className="animate-spin" width="18" height="18" viewBox="0 0 18 18">
              <circle cx="9" cy="9" r="7" stroke="#3b82f6" strokeWidth="2" fill="none" strokeDasharray="32" strokeDashoffset="12" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke={geo.location ? '#3b82f6' : '#94a3b8'} strokeWidth="2" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke={geo.location ? '#3b82f6' : '#94a3b8'} strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>

      {/* ── Toasts ─────────────────────────────────────────────── */}
      {geo.error && (
        <div className="absolute left-3 right-3 z-30 pointer-events-none"
          style={{ bottom: 'calc(108px + env(safe-area-inset-bottom) + 56px)' }}>
          <div className="bg-red-950/90 backdrop-blur border border-red-800/60 rounded-2xl px-4 py-3 text-xs text-red-300">
            {geo.error}
          </div>
        </div>
      )}
      {fetchError && (
        <div className="absolute top-20 left-3 right-3 z-30">
          <div className="bg-red-950/90 backdrop-blur border border-red-800/60 rounded-2xl px-4 py-3 text-xs text-red-300">
            {fetchError}
          </div>
        </div>
      )}

      {/* ── Loading overlay ──────────────────────────────────── */}
      {loading && !data && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm">
          <div className="w-12 h-12 rounded-full border-2 border-amber-400/30 border-t-amber-400 animate-spin mb-4" />
          <p className="text-sm font-medium text-white">Fetching camera locations…</p>
          <p className="text-xs text-slate-500 mt-1">Loading from the latest scrape</p>
        </div>
      )}

      {/* ── Bottom sheet ─────────────────────────────────────── */}
      <BottomSheet snapState={snap} onSnapChange={setSnap}>

        {/* ══ Alert toggle — always visible in peek ══ */}
        <div className="px-4 pb-3 shrink-0">
          <button
            onClick={alerts.toggle}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all duration-200 ${
              alerts.enabled
                ? 'bg-green-950/70 border-green-600/50 active:bg-green-900/70'
                : 'bg-slate-800/60 border-slate-700/50 active:bg-slate-700/60'
            }`}
            aria-pressed={alerts.enabled}
          >
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
              alerts.enabled ? 'bg-green-500/20 ring-1 ring-green-500/30' : 'bg-slate-700/50'
            }`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
                  stroke={alerts.enabled ? '#22c55e' : '#64748b'}
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0"
                  stroke={alerts.enabled ? '#22c55e' : '#64748b'}
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {alerts.enabled && <circle cx="18" cy="5" r="3.5" fill="#22c55e" />}
              </svg>
            </div>
            <div className="flex-1 text-left">
              <p className={`text-sm font-semibold ${alerts.enabled ? 'text-green-300' : 'text-white'}`}>
                Speed Camera Alerts
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {alerts.notifPermission === 'denied'
                  ? 'Notifications blocked — alerts still beep + speak'
                  : alerts.enabled
                  ? `Beep · Voice · Push within ${fmtAlertDist(alerts.alertDist)}`
                  : 'Tap to enable beep, voice & push alerts'}
              </p>
            </div>
            <div className={`w-12 h-7 rounded-full relative shrink-0 transition-all duration-200 ${alerts.enabled ? 'bg-green-500' : 'bg-slate-700'}`}>
              <div className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all duration-200 ${alerts.enabled ? 'left-6' : 'left-1'}`} />
            </div>
          </button>

          {alerts.enabled && (
            <div className="flex gap-2 mt-2">
              {ALERT_DISTANCES.map((d) => (
                <button
                  key={d}
                  onClick={() => alerts.setAlertDist(d)}
                  className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition-all duration-150 ${
                    alerts.alertDist === d
                      ? 'bg-green-600 border-green-500 text-white shadow-sm shadow-green-900/40'
                      : 'bg-slate-800 border-slate-700/50 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {fmtAlertDist(d)}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-px bg-slate-800/80 mx-4 mb-3 shrink-0" />

        {/* ══ Summary + map filter ══ */}
        <div className="px-4 pb-2 flex items-center justify-between shrink-0">
          <div>
            <p className="text-sm font-semibold text-white">
              {nearbyCount} {nearbyCount === 1 ? 'camera' : 'cameras'}
              {geo.location && mapRadius ? ` within ${mapRadius}km` : ''}
            </p>
            {data?.lastUpdated && (
              <p className="text-xs text-slate-500 mt-0.5">
                Updated {new Date(data.lastUpdated).toLocaleTimeString('en-AU', { timeStyle: 'short' })}
              </p>
            )}
          </div>
          {!geo.location && (
            <button onClick={geo.request} className="text-xs text-blue-400 font-medium hover:text-blue-300 transition-colors">
              Enable location
            </button>
          )}
        </div>

        <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar shrink-0">
          {MAP_RADIUS_OPTIONS.map((r) => (
            <button
              key={r ?? 'all'}
              onClick={() => setMapRadius(r)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150 ${
                mapRadius === r
                  ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/40'
                  : 'bg-slate-800 border-slate-700/50 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {r !== null ? `${r}km` : 'All'}
            </button>
          ))}
        </div>

        <div className="h-px bg-slate-800/80 mx-4 mb-1 shrink-0" />

        {/* ══ Camera list ══ */}
        {displayLocations.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mb-3">
              <CameraIcon color="#475569" />
            </div>
            <p className="text-sm text-slate-400 font-medium">No cameras found</p>
            <p className="text-xs text-slate-600 mt-1">
              {mapRadius && geo.location
                ? `No cameras within ${mapRadius}km. Try a larger radius.`
                : 'Try selecting a different date or enabling location.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {displayLocations.map((loc) => {
              const isSelected = loc.id === selectedId;
              const isAlerting = alertCamera?.camera.id === loc.id;
              const color = dotColor(loc.distKm);
              return (
                <li key={loc.id}>
                  <button
                    onClick={() => { setSelectedId(isSelected ? null : loc.id); if (!isSelected) setSnap('peek'); }}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                      isAlerting
                        ? 'bg-red-950/40 border-l-2 border-red-400 pl-[14px]'
                        : isSelected
                        ? 'bg-slate-800/70 border-l-2 border-amber-400 pl-[14px]'
                        : 'hover:bg-slate-800/40 active:bg-slate-800/70'
                    }`}
                  >
                    <div className="mt-1"><MarkerDot color={isAlerting ? '#ef4444' : color} /></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold text-white truncate leading-snug">{loc.location}</p>
                        {loc.distKm !== null && (
                          <span className="text-xs font-medium shrink-0" style={{ color: isAlerting ? '#ef4444' : color }}>
                            {formatDistance(loc.distKm)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{loc.suburb}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          loc.type === 'metro'
                            ? 'bg-blue-950/60 text-blue-300 border border-blue-800/40'
                            : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
                        }`}>
                          {loc.type === 'metro' ? 'Metro' : 'Country'}
                        </span>
                        {loc.date && (
                          <span className="text-[10px] text-amber-500/80">
                            {fmtDate(loc.date)}{loc.dateEnd ? ` – ${fmtDate(loc.dateEnd)}` : ''}
                          </span>
                        )}
                        {isAlerting && (
                          <span className="text-[10px] font-bold text-red-400 animate-pulse">⚠ In range</span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div style={{ height: 'env(safe-area-inset-bottom)', minHeight: 8 }} />
      </BottomSheet>
    </div>
  );
}
