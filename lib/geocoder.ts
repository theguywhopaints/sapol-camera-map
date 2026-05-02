import * as fs from 'fs';
import * as path from 'path';
import type { CameraLocationRaw } from './scraper';

const CACHE_FILE = path.join(process.cwd(), '.geocache.json');

interface GeoCoord {
  lat: number;
  lon: number;
  displayName?: string;
}

interface GeoCache {
  [key: string]: GeoCoord | null;
}

export interface CameraLocation extends CameraLocationRaw {
  lat: number | null;
  lon: number | null;
  displayName?: string;
  id: string;
  dateEnd?: string;
}

function loadCache(): GeoCache {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCache(cache: GeoCache): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // non-fatal
  }
}

async function geocodeOne(query: string): Promise<GeoCoord | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', `${query}, South Australia, Australia`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'au');
  url.searchParams.set('addressdetails', '0');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'SAPOL-Camera-Map/1.0 (personal safety tool)',
        'Accept-Language': 'en',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.length) return null;
    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    };
  } catch {
    return null;
  }
}

export async function geocodeLocations(
  rawLocations: CameraLocationRaw[]
): Promise<CameraLocation[]> {
  const cache = loadCache();
  const results: CameraLocation[] = [];

  for (let i = 0; i < rawLocations.length; i++) {
    const raw = rawLocations[i];
    // Build a meaningful search query
    const query =
      raw.suburb && raw.suburb !== raw.location
        ? `${raw.location}, ${raw.suburb}`
        : raw.location;

    let coords: GeoCoord | null | undefined = cache[query];

    if (coords === undefined) {
      // Not in cache — rate-limit to 1 req/sec per Nominatim policy
      if (i > 0) await new Promise((r) => setTimeout(r, 1100));
      coords = await geocodeOne(query);
      cache[query] = coords ?? null;
      saveCache(cache);
    }

    results.push({
      ...raw,
      id: `cam-${i}`,
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
      displayName: coords?.displayName,
    });
  }

  return results;
}
