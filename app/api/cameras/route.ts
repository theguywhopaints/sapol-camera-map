import { readFileSync } from 'fs';
import { join } from 'path';
import type { CameraLocation } from '@/lib/geocoder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CameraData {
  locations: CameraLocation[];
  lastUpdated: string;
}

// In-process cache (5 min TTL)
let memCache: (CameraData & { cachedAt: number }) | null = null;
const MEM_TTL_MS = 5 * 60 * 1000;

async function fromSupabase(): Promise<CameraData | null> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(url, key);

    const { data, error } = await supabase
      .from('cameras')
      .select('*')
      .order('scraped_at', { ascending: false });

    if (error || !data?.length) return null;

    const lastUpdated = data[0].scraped_at as string;

    const locations: CameraLocation[] = data.map((row) => ({
      id: row.id as string,
      location: row.location as string,
      suburb: row.suburb as string,
      type: row.type as 'metro' | 'country',
      lat: row.lat as number | null,
      lon: row.lon as number | null,
      date: row.date as string | undefined,
      dateEnd: row.date_end as string | undefined,
    }));

    return { locations, lastUpdated };
  } catch {
    return null;
  }
}

function fromFile(): CameraData | null {
  try {
    const raw = readFileSync(join(process.cwd(), 'data', 'cameras.json'), 'utf-8');
    return JSON.parse(raw) as CameraData;
  } catch {
    return null;
  }
}

export async function GET() {
  if (memCache && Date.now() - memCache.cachedAt < MEM_TTL_MS) {
    const { cachedAt, ...data } = memCache;
    return Response.json({ ...data, cached: true });
  }

  // Try Supabase first, fall back to bundled JSON file
  const result = (await fromSupabase()) ?? fromFile();

  if (!result || result.locations.length === 0) {
    return Response.json(
      { error: 'Camera data unavailable. The scheduled scrape may still be pending.' },
      { status: 503 }
    );
  }

  memCache = { ...result, cachedAt: Date.now() };
  return Response.json({ ...result, cached: false });
}
