import { scrapeCameraLocations } from '../lib/scraper';
import { geocodeLocations } from '../lib/geocoder';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

async function main() {
  console.log('Scraping SAPOL camera locations…');
  const raw = await scrapeCameraLocations();
  console.log(`Found ${raw.length} camera locations`);

  if (raw.length === 0) {
    console.error('No locations found — SAPOL page may have changed structure');
    process.exit(1);
  }

  const locations = await geocodeLocations(raw);
  console.log(`Geocoded ${locations.length} locations`);

  const dataDir = join(process.cwd(), 'data');
  mkdirSync(dataDir, { recursive: true });

  const output = {
    locations,
    lastUpdated: new Date().toISOString(),
  };

  writeFileSync(join(dataDir, 'cameras.json'), JSON.stringify(output, null, 2));
  console.log('Saved → data/cameras.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
