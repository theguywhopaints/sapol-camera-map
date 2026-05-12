import { createClient } from '@supabase/supabase-js';
import { scrapeCameraLocations } from '../lib/scraper';
import { geocodeLocations } from '../lib/geocoder';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('Scraping SAPOL camera locations…');
  const raw = await scrapeCameraLocations();
  console.log(`Found ${raw.length} raw locations`);

  if (raw.length === 0) {
    console.error('No locations scraped — SAPOL page may have changed structure');
    process.exit(1);
  }

  console.log('Geocoding…');
  const locations = await geocodeLocations(raw);
  console.log(`Geocoded ${locations.length} locations`);

  const scrapedAt = new Date().toISOString();

  const rows = locations.map((loc) => ({
    id: loc.id,
    location: loc.location,
    suburb: loc.suburb,
    type: loc.type,
    lat: loc.lat,
    lon: loc.lon,
    date: loc.date ?? null,
    date_end: loc.dateEnd ?? null,
    scraped_at: scrapedAt,
  }));

  console.log(`Upserting ${rows.length} rows into Supabase…`);

  // Upsert in batches of 100
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('cameras')
      .upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error(`Batch ${i / BATCH + 1} failed:`, error.message);
      process.exit(1);
    }
  }

  // Delete rows from previous scrapes (stale cameras no longer on the SAPOL page)
  const { error: deleteError } = await supabase
    .from('cameras')
    .delete()
    .lt('scraped_at', scrapedAt);
  if (deleteError) {
    console.warn('Could not delete stale rows:', deleteError.message);
  }

  console.log(`Done — ${rows.length} cameras saved to Supabase at ${scrapedAt}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
