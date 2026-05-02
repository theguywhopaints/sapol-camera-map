import { scrapeCameraLocations } from '@/lib/scraper';
import { geocodeLocations, type CameraLocation } from '@/lib/geocoder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CacheEntry {
  data: { locations: CameraLocation[]; lastUpdated: string };
  timestamp: number;
}

// In-process cache valid for 30 minutes
let cache: CacheEntry | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function GET() {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return Response.json({ ...cache.data, cached: true });
  }

  try {
    const rawLocations = await scrapeCameraLocations();

    if (rawLocations.length === 0) {
      return Response.json(
        {
          error: 'No camera locations found on the SAPOL page.',
          hint: 'The page structure may have changed or the site is temporarily unavailable.',
        },
        { status: 502 }
      );
    }

    const locations = await geocodeLocations(rawLocations);

    const result = {
      locations,
      lastUpdated: new Date().toISOString(),
      cached: false,
    };

    cache = { data: result, timestamp: Date.now() };
    return Response.json(result);
  } catch (err) {
    console.error('[cameras API]', err);
    return Response.json(
      { error: 'Failed to fetch camera locations', details: String(err) },
      { status: 500 }
    );
  }
}
