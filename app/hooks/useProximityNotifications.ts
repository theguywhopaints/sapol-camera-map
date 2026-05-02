'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { CameraLocation } from '@/lib/geocoder';
import { haversineKm } from '@/lib/distance';

const ALERT_RADIUS_KM = 2;
const COOLDOWN_MS = 10 * 60 * 1000; // don't re-alert same camera within 10 min

async function showNotification(loc: CameraLocation, distKm: number) {
  const distLabel =
    distKm < 1 ? `${Math.round(distKm * 1000)}m` : `${distKm.toFixed(1)}km`;
  const spokenDistLabel =
    distKm < 1 ? `${Math.round(distKm * 1000)} meters` : `${distKm.toFixed(1)} kilometers`;

  const title = 'Speed Camera Ahead';
  const body = `${loc.location}, ${loc.suburb} · ${distLabel} away`;
  const options: NotificationOptions = {
    body,
    tag: `camera-${loc.id}`,   // collapses duplicates
    renotify: false,
    silent: false,
  };

  // 1. Voice Announcement
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    const text = `Speed camera ahead on ${loc.location}, ${spokenDistLabel} away.`;
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }

  // 2. Haptic Feedback
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate([500, 200, 500]);
  }

  try {
    // ServiceWorker notifications work in iOS PWA; fall back to Notification API
    const reg = await navigator.serviceWorker?.ready;
    await reg.showNotification(title, options);
  } catch {
    try {
      // eslint-disable-next-line no-new
      new Notification(title, options);
    } catch {
      // Notifications completely unavailable — silently ignore
    }
  }
}

export type NotifPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function useProximityNotifications(
  locations: CameraLocation[],
  userLat: number | null,
  userLon: number | null
) {
  const [permission, setPermission] = useState<NotifPermission>(() => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  });
  const [enabled, setEnabled] = useState(false);

  // id → timestamp of last notification sent
  const lastNotifiedRef = useRef<Map<string, number>>(new Map());
  // cameras that were in range on the previous position update
  const prevInRangeRef = useRef<Set<string>>(new Set());
  // whether we have a "baseline" snapshot (skip notifications on first scan)
  const baselinedRef = useRef(false);

  // Reset baseline when locations dataset changes (fresh API response)
  useEffect(() => {
    baselinedRef.current = false;
  }, [locations]);

  // Reset baseline when notifications are toggled on
  useEffect(() => {
    if (enabled) baselinedRef.current = false;
    else prevInRangeRef.current = new Set();
  }, [enabled]);

  const requestAndEnable = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') setEnabled(true);
  }, []);

  const toggle = useCallback(async () => {
    // Unlock speech synthesis on user interaction
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance('');
      utterance.volume = 0;
      window.speechSynthesis.speak(utterance);
    }

    if (enabled) {
      setEnabled(false);
      return;
    }
    if (permission === 'granted') {
      setEnabled(true);
    } else if (permission !== 'denied') {
      await requestAndEnable();
    }
    // If 'denied', the button will show a disabled state — do nothing
  }, [enabled, permission, requestAndEnable]);

  useEffect(() => {
    if (!enabled || permission !== 'granted') return;
    if (userLat === null || userLon === null || locations.length === 0) return;

    const now = Date.now();
    const currentInRange = new Set<string>();

    for (const loc of locations) {
      if (loc.lat === null || loc.lon === null) continue;
      const dist = haversineKm(userLat, userLon, loc.lat, loc.lon);
      if (dist <= ALERT_RADIUS_KM) currentInRange.add(loc.id);
    }

    if (!baselinedRef.current) {
      // First scan after enable/data-refresh: record baseline without alerting
      prevInRangeRef.current = currentInRange;
      baselinedRef.current = true;
      return;
    }

    // Notify for cameras that just entered the 2km zone
    for (const id of currentInRange) {
      if (prevInRangeRef.current.has(id)) continue; // was already in range
      const loc = locations.find((l) => l.id === id);
      if (!loc?.lat || !loc?.lon) continue;
      const lastNotified = lastNotifiedRef.current.get(id) ?? 0;
      if (now - lastNotified < COOLDOWN_MS) continue;
      const dist = haversineKm(userLat, userLon, loc.lat, loc.lon);
      showNotification(loc, dist);
      lastNotifiedRef.current.set(id, now);
    }

    prevInRangeRef.current = currentInRange;
  }, [userLat, userLon, locations, enabled, permission]);

  return { permission, enabled, toggle };
}
