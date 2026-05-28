'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { CameraLocation } from '@/lib/geocoder';
import { haversineKm } from '@/lib/distance';
import { isCameraAhead } from '@/lib/distance';
import { playAlert, playUrgentAlert, unlockAudio } from '@/lib/audio';
import { speak, unlockSpeech, spokenDistance, cancelSpeech } from '@/lib/speech';
import { getRoadName, isSameRoad } from '@/lib/reverseGeocode';

export const ALERT_DISTANCES = [0.5, 1, 2] as const;
export type AlertDistance = (typeof ALERT_DISTANCES)[number];

export interface ActiveAlert {
  camera: CameraLocation;
  distKm: number;
  onSameRoad: boolean;
}

export type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

const LS_ENABLED  = 'sapol-alerts-on';
const LS_DISTANCE = 'sapol-alert-dist';
const BEEP_COOLDOWN_MS = 10 * 60 * 1000;
const MIN_GEOCODE_MOVE_KM  = 0.15;
const MIN_GEOCODE_INTERVAL = 15_000;

// Voice thresholds fired per approach at [alertDist, alertDist/2, 200m]
function voiceThresholds(alertDist: AlertDistance): number[] {
  const mid = alertDist / 2;
  const ts: number[] = [alertDist];
  if (mid >= 0.25) ts.push(parseFloat(mid.toFixed(1)));
  if (0.2 < alertDist) ts.push(0.2);
  return ts;
}

function voiceText(loc: CameraLocation, distKm: number, isFirst: boolean): string {
  const dist = spokenDistance(distKm);
  if (dist === 'ahead') return `Speed camera ahead on ${loc.location}`;
  if (isFirst) return `Speed camera in ${dist}, ${loc.location}, ${loc.suburb}`;
  return `Speed camera in ${dist}`;
}

async function pushNotification(loc: CameraLocation, distKm: number, onSameRoad: boolean, urgent: boolean) {
  const dist = distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)}km`;
  const title = urgent ? '🚨 Speed Camera — Very Close!' : '⚠️ Speed Camera Ahead';
  const body = onSameRoad
    ? `${loc.location}, ${loc.suburb} — ${dist} ahead on your road`
    : `${loc.location}, ${loc.suburb} — ${dist} away`;
  const tag = `cam-${loc.id}`;
  try {
    // Prefer SW message channel — works even when tab is backgrounded/hidden
    const reg = await navigator.serviceWorker?.ready;
    reg.active?.postMessage({ type: 'CAMERA_ALERT', title, body, tag, urgent });
  } catch {
    // Fallback: direct Notification API (foreground only)
    try {
      new Notification(title, { body, tag });
    } catch { /* unavailable */ }
  }
}

export function useProximityAlerts(
  locations: CameraLocation[],
  userLat: number | null,
  userLon: number | null,
  userHeading: number | null
) {
  // ── Persisted state ────────────────────────────────────────────
  const [enabled, _setEnabled] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(LS_ENABLED) === 'true';
  });

  const [alertDist, _setAlertDist] = useState<AlertDistance>(() => {
    if (typeof localStorage === 'undefined') return 1;
    const v = parseFloat(localStorage.getItem(LS_DISTANCE) ?? '');
    return (ALERT_DISTANCES as readonly number[]).includes(v) ? (v as AlertDistance) : 1;
  });

  const [notifPermission, setNotifPermission] = useState<NotifPermission>(() => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission as NotifPermission;
  });

  const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);

  // ── Tracking refs ──────────────────────────────────────────────
  const beepCooldownRef  = useRef<Map<string, number>>(new Map());
  const prevInRangeRef   = useRef<Set<string>>(new Set());
  const baselinedRef     = useRef(false);
  const spokenRef        = useRef<Map<string, Set<number>>>(new Map()); // id → spoken thresholds
  const userRoadRef      = useRef<string | null>(null);
  const geocodePosRef    = useRef<{ lat: number; lon: number } | null>(null);
  const geocodeTimeRef   = useRef<number>(0);
  const geocodeInFlight  = useRef(false);

  // ── Persisted setters ──────────────────────────────────────────
  const setEnabled = useCallback((val: boolean) => {
    _setEnabled(val);
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_ENABLED, String(val));
    if (!val) {
      setActiveAlert(null);
      prevInRangeRef.current = new Set();
      spokenRef.current = new Map();
      cancelSpeech();
    }
    baselinedRef.current = false;
  }, []);

  const setAlertDist = useCallback((d: AlertDistance) => {
    _setAlertDist(d);
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_DISTANCE, String(d));
    baselinedRef.current = false;
    spokenRef.current = new Map();
  }, []);

  // ── Notification permission ────────────────────────────────────
  const requestNotifPermission = useCallback(async (): Promise<NotifPermission> => {
    if (typeof Notification === 'undefined') return 'unsupported';
    const r = (await Notification.requestPermission()) as NotifPermission;
    setNotifPermission(r);
    return r;
  }, []);

  // ── Toggle ─────────────────────────────────────────────────────
  const toggle = useCallback(async () => {
    unlockAudio();
    unlockSpeech(); // must be called in user-gesture tick for iOS
    if (enabled) { setEnabled(false); return; }
    if (notifPermission === 'default') await requestNotifPermission();
    setEnabled(true);
  }, [enabled, notifPermission, setEnabled, requestNotifPermission]);

  // ── Reset baseline when location data refreshes ────────────────
  useEffect(() => {
    baselinedRef.current = false;
    spokenRef.current = new Map();
  }, [locations]);

  // ── Reverse-geocode user road (rate-limited) ───────────────────
  useEffect(() => {
    if (!enabled || userLat === null || userLon === null) return;
    if (geocodeInFlight.current) return;
    const now = Date.now();
    if (now - geocodeTimeRef.current < MIN_GEOCODE_INTERVAL) return;
    const last = geocodePosRef.current;
    if (last && haversineKm(last.lat, last.lon, userLat, userLon) < MIN_GEOCODE_MOVE_KM) return;

    geocodeInFlight.current = true;
    geocodePosRef.current = { lat: userLat, lon: userLon };
    geocodeTimeRef.current = now;
    getRoadName(userLat, userLon).then((road) => {
      userRoadRef.current = road;
      geocodeInFlight.current = false;
    });
  }, [enabled, userLat, userLon]);

  // ── Main proximity + voice check ──────────────────────────────
  useEffect(() => {
    if (!enabled || userLat === null || userLon === null || !locations.length) {
      if (!enabled) setActiveAlert(null);
      return;
    }

    const now = Date.now();
    const thresholds = voiceThresholds(alertDist);
    const inRange = new Set<string>();
    let nearest: ActiveAlert | null = null;
    let nearestDist = Infinity;

    for (const loc of locations) {
      if (loc.lat === null || loc.lon === null) continue;
      const d = haversineKm(userLat, userLon, loc.lat, loc.lon);

      // Heading filter: skip cameras behind the user
      if (!isCameraAhead(userHeading, loc.lat, loc.lon, userLat, userLon)) continue;

      // Track nearest camera within alert zone for the banner
      if (d <= alertDist) {
        inRange.add(loc.id);
        const onSameRoad = userRoadRef.current ? isSameRoad(userRoadRef.current, loc.location) : false;
        if (d < nearestDist) { nearestDist = d; nearest = { camera: loc, distKm: d, onSameRoad }; }
      }

      // Progressive voice + beep: check every threshold, not just on entry
      if (d <= alertDist) {
        const spoken = spokenRef.current.get(loc.id) ?? new Set<number>();
        for (const t of thresholds) {
          if (d <= t && !spoken.has(t)) {
            const isFirst = !spoken.size;
            speak(voiceText(loc, d, isFirst));
            if (d <= 0.5) playUrgentAlert(); else playAlert();
            spoken.add(t);
            spokenRef.current.set(loc.id, spoken);
            break; // fire only the largest un-spoken threshold per update
          }
        }
      } else if (d > alertDist * 1.3) {
        // Camera passed or moved away — reset so it can announce again next approach
        spokenRef.current.delete(loc.id);
      }
    }

    setActiveAlert(nearest);

    // First run after enable/data-refresh: establish baseline silently
    if (!baselinedRef.current) {
      prevInRangeRef.current = inRange;
      baselinedRef.current = true;
      return;
    }

    // Beep + haptic + notification for cameras that just entered the zone
    for (const id of inRange) {
      if (prevInRangeRef.current.has(id)) continue;
      const last = beepCooldownRef.current.get(id) ?? 0;
      if (now - last < BEEP_COOLDOWN_MS) continue;

      const loc = locations.find((l) => l.id === id)!;
      const d   = haversineKm(userLat, userLon, loc.lat!, loc.lon!);
      const onSameRoad = userRoadRef.current ? isSameRoad(userRoadRef.current, loc.location) : false;

      const urgent = d <= 0.5;
      if (urgent) playUrgentAlert(); else playAlert();
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(urgent
          ? [500, 100, 500, 100, 500, 100, 800]
          : [300, 150, 300, 150, 500]);
      }
      if (notifPermission === 'granted') pushNotification(loc, d, onSameRoad, urgent);
      beepCooldownRef.current.set(id, now);
    }

    prevInRangeRef.current = inRange;
  }, [userLat, userLon, userHeading, locations, enabled, alertDist, notifPermission]);

  return { enabled, toggle, alertDist, setAlertDist, notifPermission, activeAlert };
}
