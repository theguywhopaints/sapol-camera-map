import { execSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join } from 'path';

const dataFile = join(process.cwd(), 'data', 'cameras.json');

// Skip if data is less than 2 hours old (avoids double-scraping during local vercel --prod)
if (existsSync(dataFile)) {
  const ageMs = Date.now() - statSync(dataFile).mtimeMs;
  if (ageMs < 2 * 60 * 60 * 1000) {
    console.log(`data/cameras.json is fresh (${Math.round(ageMs / 60000)}min old) — skipping scrape`);
    process.exit(0);
  }
}

// On Linux (Vercel build container), install Playwright + system deps first
if (process.platform === 'linux') {
  console.log('Linux build environment — installing Playwright Chromium...');
  try {
    execSync('npx playwright install chromium --with-deps', { stdio: 'inherit' });
  } catch {
    console.error('Playwright install failed — will try scraping anyway');
  }
}

try {
  execSync('npx tsx scripts/scrape-and-save.ts', { stdio: 'inherit' });
} catch {
  if (!existsSync(dataFile)) {
    console.error('Scrape failed and no existing data/cameras.json — aborting build');
    process.exit(1);
  }
  console.warn('Scrape failed — deploying with existing data/cameras.json');
}
