// Client-side only: reverse geocode + road name matching via Nominatim

interface CacheEntry {
  road: string | null;
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;          // re-use cached result for 1 min at same position
const BUCKET_DEG = 0.001;       // ~111m grid — positions within same cell share cache

function bucket(lat: number, lon: number): string {
  return `${Math.round(lat / BUCKET_DEG)},${Math.round(lon / BUCKET_DEG)}`;
}

// Speed limit lookup by camera position — cached indefinitely (road limits don't change)
const speedLimitCache = new Map<string, string | null>();

export async function getSpeedLimit(lat: number, lon: number): Promise<string | null> {
  const key = bucket(lat, lon);
  if (speedLimitCache.has(key)) return speedLimitCache.get(key) ?? null;
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&extratags=1`,
      { headers: { 'User-Agent': 'sapol-camera-map/1.0' } }
    );
    const data = await r.json() as { extratags?: { maxspeed?: string } };
    const raw = data.extratags?.maxspeed ?? null;
    // Normalise "60 km/h" → "60", "110" → "110"
    const val = raw ? raw.replace(/\s*(km\/h|mph)\s*/i, '').trim() : null;
    speedLimitCache.set(key, val);
    return val;
  } catch {
    speedLimitCache.set(key, null);
    return null;
  }
}

export async function getRoadName(lat: number, lon: number): Promise<string | null> {
  const key = bucket(lat, lon);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.road;

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&format=json&zoom=16`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SAPOL-Camera-Map/1.0 (personal safety tool)',
        'Accept-Language': 'en',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Nominatim address fields in order of preference
    const road: string | null =
      data?.address?.road ??
      data?.address?.pedestrian ??
      data?.address?.cycleway ??
      data?.address?.path ??
      null;
    cache.set(key, { road, ts: Date.now() });
    return road;
  } catch {
    cache.set(key, { road: null, ts: Date.now() });
    return null;
  }
}

// Expand SA road abbreviations to full words for fuzzy matching
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/\brd\b/g, 'road')
    .replace(/\bst\b/g, 'street')
    .replace(/\bave\b/g, 'avenue')
    .replace(/\bhwy\b/g, 'highway')
    .replace(/\bfwy\b/g, 'freeway')
    .replace(/\bbvd\b/g, 'boulevard')
    .replace(/\btce\b/g, 'terrace')
    .replace(/\bpde\b/g, 'parade')
    .replace(/\bdr\b/g, 'drive')
    .replace(/\bcr\b/g, 'crescent')
    .replace(/\bct\b/g, 'court')
    .replace(/\bpl\b/g, 'place')
    .replace(/\bgr\b/g, 'grove')
    .replace(/\bexp\b/g, 'expressway')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns true if the camera street name is plausibly the road the user is on
export function isSameRoad(userRoad: string, cameraStreet: string): boolean {
  const a = normalise(userRoad);
  const b = normalise(cameraStreet);
  if (!a || !b) return false;
  // exact, or one is a prefix of the other (handles "Main North Road" vs "Main North Rd")
  return a === b || a.startsWith(b) || b.startsWith(a);
}
