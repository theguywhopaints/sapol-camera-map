'use client';

import { useState, useCallback, useRef } from 'react';

export interface UserLocation {
  lat: number;
  lon: number;
  accuracy: number;
  heading: number | null; // degrees clockwise from north; null when stationary
  speed: number | null;   // m/s; null when unavailable
}

interface GeoState {
  location: UserLocation | null;
  error: string | null;
  loading: boolean;
}

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({
    location: null,
    error: null,
    loading: false,
  });
  const watchId = useRef<number | null>(null);

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState((s) => ({ ...s, error: 'Geolocation is not supported on this device' }));
      return;
    }
    setState({ location: null, error: null, loading: true });

    // Clear any existing watch
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
    }

    // Use watchPosition so the dot tracks movement
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setState({
          location: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
          },
          error: null,
          loading: false,
        });
      },
      (err) => {
        setState((s) => ({
          ...s,
          loading: false,
          error:
            err.code === 1
              ? 'Location permission denied. Enable in Settings > Safari > Location.'
              : err.message,
        }));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }, []);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation?.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  return { ...state, request, stop };
}
