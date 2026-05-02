import { readFileSync } from 'fs';
import { join } from 'path';
import type { CameraLocation } from '@/lib/geocoder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CameraData {
  locations: CameraLocation[];
  lastUpdated: string;
}

const DATA_FILE = join(process.cwd(), 'data', 'cameras.json');

function readDataFile(): CameraData | null {
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf-8')) as CameraData;
  } catch {
    return null;
  }
}

// In-process cache so repeated calls within the same serverless instance are fast
let memCache: (CameraData & { cachedAt: number }) | null = null;
const MEM_TTL_MS = 5 * 60 * 1000;

export async function GET() {
  // Serve from in-memory cache if fresh
  if (memCache && Date.now() - memCache.cachedAt < MEM_TTL_MS) {
    const { cachedAt, ...data } = memCache;
    return Response.json({ ...data, cached: true });
  }

  // Try the pre-built file (written by GitHub Actions, bundled by outputFileTracingIncludes)
  const fileData = readDataFile();

  if (fileData && fileData.locations.length > 0) {
    memCache = { ...fileData, cachedAt: Date.now() };
    return Response.json({ ...fileData, cached: false });
  }

  // On Vercel, no live scraping — data must come from the file
  if (process.env.VERCEL) {
    return Response.json(
      {
        error: 'Camera data is not yet available. The scheduled scrape may still be pending.',
        hint: 'Try again in a few minutes — data is refreshed automatically every 4 hours.',
      },
      { status: 503 }
    );
  }

  // Local dev fallback: run the live scraper
  try {
    const { scrapeCameraLocations } = await import('@/lib/scraper');
    const { geocodeLocations } = await import('@/lib/geocoder');

    const raw = await scrapeCameraLocations();
    if (raw.length === 0) {
      return Response.json(
        { error: 'No camera locations found on the SAPOL page.' },
        { status: 502 }
      );
    }

    const locations = await geocodeLocations(raw);
    const result: CameraData = { locations, lastUpdated: new Date().toISOString() };
    memCache = { ...result, cachedAt: Date.now() };
    return Response.json({ ...result, cached: false });
  } catch (err) {
    console.error('[cameras API]', err);
    return Response.json(
      { error: 'Failed to fetch camera locations', details: String(err) },
      { status: 500 }
    );
  }
}
