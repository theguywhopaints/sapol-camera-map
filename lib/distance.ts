export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(km: number): string {
  if (km < 0.1) return `${Math.round(km * 1000)}m`;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

export function circleGeoJSON(
  lat: number,
  lon: number,
  radiusKm: number,
  steps = 64
): { type: 'Feature'; geometry: { type: 'Polygon'; coordinates: [number, number][][] }; properties: Record<string, never> } {
  const R = 6371;
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dLat = (radiusKm / R) * (180 / Math.PI) * Math.cos(angle);
    const dLon =
      ((radiusKm / R) * (180 / Math.PI) * Math.sin(angle)) /
      Math.cos((lat * Math.PI) / 180);
    coords.push([lon + dLon, lat + dLat]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  };
}

// Compass bearing in degrees (0 = north, clockwise)
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// True when camera is within 110° forward cone of the user's heading
export function isCameraAhead(
  userHeading: number | null,
  cameraLat: number,
  cameraLon: number,
  userLat: number,
  userLon: number
): boolean {
  if (userHeading === null) return true; // no heading → don't filter
  const camBearing = bearingDeg(userLat, userLon, cameraLat, cameraLon);
  const diff = Math.abs(((camBearing - userHeading + 540) % 360) - 180);
  return diff < 110;
}

// Returns a human label + unicode arrow for the camera direction relative to user heading
export function relativeDirection(
  userHeading: number | null,
  userLat: number,
  userLon: number,
  camLat: number,
  camLon: number,
): { label: string; arrow: string } {
  if (userHeading === null) return { label: 'NEARBY', arrow: '●' };
  const bearing = bearingDeg(userLat, userLon, camLat, camLon);
  const diff = ((bearing - userHeading + 540) % 360) - 180; // −180..+180
  const abs = Math.abs(diff);
  if (abs < 25)  return { label: 'AHEAD',        arrow: '↑' };
  if (abs < 70)  return diff < 0 ? { label: 'AHEAD LEFT',  arrow: '↖' } : { label: 'AHEAD RIGHT',  arrow: '↗' };
  if (abs < 115) return diff < 0 ? { label: 'LEFT',        arrow: '←' } : { label: 'RIGHT',         arrow: '→' };
  if (abs < 155) return diff < 0 ? { label: 'BEHIND LEFT', arrow: '↙' } : { label: 'BEHIND RIGHT',  arrow: '↘' };
  return { label: 'BEHIND', arrow: '↓' };
}

export function markerColor(distKm: number): string {
  if (distKm < 2) return '#ef4444';   // red
  if (distKm < 5) return '#f97316';   // orange
  if (distKm < 10) return '#f59e0b';  // amber
  return '#94a3b8';                    // slate (far/no location)
}
