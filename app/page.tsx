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
import { useProximityNotifications } from './hooks/useProximityNotifications';
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

const RADIUS_OPTIONS: (number | null)[] = [1, 2, 5, 10, 20, null];
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

// Camera icon SVG for list items
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
  return (
    <div
      className="w-3 h-3 rounded-full shrink-0 ring-2 ring-black/30"
      style={{ background: color }}
    />
  );
}

export default function Home() {
  const [data, setData] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [radius, setRadius] = useState<number | null>(5);
  const [snap, setSnap] = useState<SnapState>('half');

  const geo = useGeolocation();
  const mapRef = useRef<CameraMapHandle>(null) as RefObject<CameraMapHandle>;
  const notif = useProximityNotifications(
    data?.locations ?? [],
    geo.location?.lat ?? null,
    geo.location?.lon ?? null
  );

  // ─── Fetch camera data ──────────────────────────────────────
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

  // ─── Auto-request location on first load ────────────────────
  useEffect(() => {
    geo.request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Available dates ─────────────────────────────────────────
  const availableDates = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    data.locations.forEach((l) => {
      if (l.date && l.date.length <= 12) seen.add(l.date);
    });
    return Array.from(seen).sort((a, b) => {
      const da = parseSaDate(a), db = parseSaDate(b);
      return (da?.getTime() ?? 0) - (db?.getTime() ?? 0);
    });
  }, [data]);

  // Auto-set date to today
  useEffect(() => {
    if (!data || dateFilter !== 'all') return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = availableDates.find((d) => parseSaDate(d)?.toDateString() === today.toDateString());
    if (todayStr) setDateFilter(todayStr);
  }, [data, availableDates, dateFilter]);

  // ─── Filter locations ─────────────────────────────────────────
  const filteredByDate = useMemo(() => {
    if (!data) return [];
    const all = data.locations.filter((l) => l.lat !== null && l.lon !== null);
    if (dateFilter === 'all') return all;
    return all.filter((l) => l.date === dateFilter || (l.dateEnd && l.type === 'country'));
  }, [data, dateFilter]);

  const withDistance = useMemo(() => {
    return filteredByDate.map((l) => ({
      ...l,
      distKm:
        geo.location && l.lat !== null && l.lon !== null
          ? haversineKm(geo.location.lat, geo.location.lon, l.lat!, l.lon!)
          : null,
    }));
  }, [filteredByDate, geo.location]);

  const displayLocations = useMemo(() => {
    const filtered =
      radius !== null && geo.location
        ? withDistance.filter((l) => l.distKm !== null && l.distKm <= radius)
        : withDistance;
    return [...filtered].sort((a, b) =>
      a.distKm !== null && b.distKm !== null ? a.distKm - b.distKm : 0
    );
  }, [withDistance, radius, geo.location]);

  const nearbyCount = displayLocations.length;

  // ─── Fly to selected ──────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return;
    const loc = displayLocations.find((l) => l.id === selectedId);
    if (loc?.lat && loc?.lon) {
      mapRef.current?.flyToCamera(loc.lat, loc.lon);
    }
  }, [selectedId, displayLocations]);

  // ─── Marker color helper ──────────────────────────────────────
  function dotColor(distKm: number | null): string {
    if (distKm === null) return '#f59e0b';
    if (distKm < 2) return '#ef4444';
    if (distKm < 5) return '#f97316';
    if (distKm < 10) return '#f59e0b';
    return '#64748b';
  }

  return (
    <div className="fixed inset-0 bg-slate-950">
      {/* ── Full-screen map ─────────────────────────────────── */}
      <div className="absolute inset-0">
        <CameraMap
          ref={mapRef}
          locations={withDistance}
          selectedId={selectedId}
          onSelect={setSelectedId}
          userLat={geo.location?.lat ?? null}
          userLon={geo.location?.lon ?? null}
          radiusKm={radius}
        />
      </div>

      {/* ── Floating top bar ────────────────────────────────── */}
      <div
        className="absolute top-0 inset-x-0 z-30 pointer-events-none"
        style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}
      >
        <div className="mx-3 pointer-events-auto">
          <div className="flex items-center gap-2 bg-slate-900/85 backdrop-blur-xl rounded-2xl px-3 py-2.5 border border-slate-700/40 shadow-xl">
            {/* Count badge */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-sm font-semibold text-white">
                {loading && !data ? '…' : nearbyCount}
              </span>
              <span className="text-xs text-slate-400 hidden sm:block">
                camera{nearbyCount !== 1 ? 's' : ''}
                {radius && geo.location ? ` within ${radius}km` : ''}
              </span>
            </div>

            {/* Date selector */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="flex-1 min-w-0 bg-slate-800/80 border border-slate-600/50 text-slate-200 text-xs rounded-xl px-2.5 py-1.5 appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-400/50"
            >
              <option value="all">All dates</option>
              {availableDates.map((d) => (
                <option key={d} value={d}>{fmtDate(d)}</option>
              ))}
            </select>

            {/* Notifications */}
            {notif.permission !== 'unsupported' && (
              <button
                onClick={notif.toggle}
                disabled={notif.permission === 'denied'}
                title={
                  notif.permission === 'denied'
                    ? 'Notifications blocked — enable in browser settings'
                    : notif.enabled
                    ? 'Notifications on — tap to disable'
                    : 'Enable 2km camera alerts'
                }
                className={[
                  'shrink-0 w-8 h-8 rounded-xl border flex items-center justify-center transition-colors',
                  notif.enabled
                    ? 'bg-amber-500/20 border-amber-400/50 text-amber-400 hover:bg-amber-500/30'
                    : notif.permission === 'denied'
                    ? 'bg-slate-800/80 border-slate-600/50 text-slate-600 cursor-not-allowed'
                    : 'bg-slate-800/80 border-slate-600/50 text-slate-300 hover:text-white hover:bg-slate-700',
                ].join(' ')}
                aria-label={notif.enabled ? 'Disable notifications' : 'Enable notifications'}
              >
                {notif.enabled ? (
                  /* Bell with dot (active) */
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="18" cy="5" r="3" fill="#f59e0b" />
                  </svg>
                ) : (
                  /* Bell off */
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            )}

            {/* Refresh */}
            <button
              onClick={fetchLocations}
              disabled={loading}
              className="shrink-0 w-8 h-8 rounded-xl bg-slate-800/80 border border-slate-600/50 flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
              aria-label="Refresh"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                className={loading ? 'animate-spin' : ''}
              >
                <path
                  d="M12.5 7A5.5 5.5 0 1 1 7 1.5M7 1.5L9.5 4M7 1.5L4.5 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Locate-me FAB ────────────────────────────────────── */}
      <button
        onClick={() => {
          if (geo.location) {
            mapRef.current?.flyToUser(geo.location.lat, geo.location.lon);
          } else {
            geo.request();
          }
        }}
        className="absolute right-3 z-30 w-12 h-12 rounded-2xl bg-slate-900/90 backdrop-blur-lg border border-slate-700/50 shadow-xl flex items-center justify-center text-white hover:bg-slate-800 active:scale-95 transition-all"
        style={{ bottom: 'calc(108px + env(safe-area-inset-bottom))' }}
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

      {/* ── Location error toast ─────────────────────────────── */}
      {geo.error && (
        <div className="absolute left-3 right-3 z-30 pointer-events-none" style={{ bottom: 'calc(108px + env(safe-area-inset-bottom) + 56px)' }}>
          <div className="bg-red-950/90 backdrop-blur border border-red-800/60 rounded-2xl px-4 py-3 text-xs text-red-300">
            {geo.error}
          </div>
        </div>
      )}

      {/* ── Fetch error toast ────────────────────────────────── */}
      {fetchError && (
        <div className="absolute top-20 left-3 right-3 z-30">
          <div className="bg-red-950/90 backdrop-blur border border-red-800/60 rounded-2xl px-4 py-3 text-xs text-red-300">
            {fetchError}
          </div>
        </div>
      )}

      {/* ── Initial loading overlay ──────────────────────────── */}
      {loading && !data && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm">
          <div className="w-12 h-12 rounded-full border-2 border-amber-400/30 border-t-amber-400 animate-spin mb-4" />
          <p className="text-sm font-medium text-white">Fetching camera locations…</p>
          <p className="text-xs text-slate-500 mt-1">This may take ~30 seconds on first load</p>
        </div>
      )}

      {/* ── Bottom sheet ─────────────────────────────────────── */}
      <BottomSheet snapState={snap} onSnapChange={setSnap}>
        {/* ── Summary row ── */}
        <div className="px-4 pb-3 flex items-center justify-between shrink-0">
          <div>
            <p className="text-sm font-semibold text-white">
              {nearbyCount} {nearbyCount === 1 ? 'camera' : 'cameras'}
              {geo.location && radius ? ` within ${radius}km` : ''}
            </p>
            {data?.lastUpdated && (
              <p className="text-xs text-slate-500 mt-0.5">
                Updated {new Date(data.lastUpdated).toLocaleTimeString('en-AU', { timeStyle: 'short' })}
                {data.cached ? ' · cached' : ''}
              </p>
            )}
          </div>
          {!geo.location && (
            <button
              onClick={geo.request}
              className="text-xs text-blue-400 font-medium hover:text-blue-300 transition-colors"
            >
              Enable location
            </button>
          )}
        </div>

        {/* ── Radius pills ── */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar shrink-0">
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r ?? 'all'}
              onClick={() => setRadius(r)}
              className={[
                'shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150',
                radius === r
                  ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/40'
                  : 'bg-slate-800 border-slate-700/50 text-slate-300 hover:bg-slate-700',
              ].join(' ')}
            >
              {r !== null ? `${r}km` : 'All'}
            </button>
          ))}
        </div>

        {/* ── Divider ── */}
        <div className="h-px bg-slate-800/80 mx-4 mb-1 shrink-0" />

        {/* ── Camera list ── */}
        {displayLocations.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-6">
            <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center mb-3">
              <CameraIcon color="#475569" />
            </div>
            <p className="text-sm text-slate-400 font-medium">No cameras found</p>
            <p className="text-xs text-slate-600 mt-1">
              {radius && geo.location
                ? `No cameras within ${radius}km. Try a larger radius.`
                : 'Try selecting a different date or enabling location.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-800/60">
            {displayLocations.map((loc) => {
              const isSelected = loc.id === selectedId;
              const color = dotColor(loc.distKm);

              return (
                <li key={loc.id}>
                  <button
                    onClick={() => {
                      setSelectedId(isSelected ? null : loc.id);
                      if (!isSelected) setSnap('peek');
                    }}
                    className={[
                      'w-full text-left px-4 py-3 flex items-start gap-3 transition-colors',
                      isSelected
                        ? 'bg-slate-800/70 border-l-2 border-amber-400 pl-[14px]'
                        : 'hover:bg-slate-800/40 active:bg-slate-800/70',
                    ].join(' ')}
                  >
                    {/* Color dot */}
                    <div className="mt-1">
                      <MarkerDot color={color} />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold text-white truncate leading-snug">
                          {loc.location}
                        </p>
                        {loc.distKm !== null && (
                          <span className="text-xs font-medium shrink-0" style={{ color }}>
                            {formatDistance(loc.distKm)}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{loc.suburb}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            loc.type === 'metro'
                              ? 'bg-blue-950/60 text-blue-300 border border-blue-800/40'
                              : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
                          }`}
                        >
                          {loc.type === 'metro' ? 'Metro' : 'Country'}
                        </span>
                        {loc.date && (
                          <span className="text-[10px] text-amber-500/80">
                            {fmtDate(loc.date)}
                            {loc.dateEnd ? ` – ${fmtDate(loc.dateEnd)}` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Bottom safe area spacer */}
        <div style={{ height: 'env(safe-area-inset-bottom)', minHeight: 8 }} />
      </BottomSheet>
    </div>
  );
}
