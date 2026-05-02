import { chromium } from 'playwright-core';
import * as cheerio from 'cheerio';

const IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
);

async function getExecutablePath(): Promise<string> {
  if (IS_SERVERLESS) {
    const chromiumPkg = await import('@sparticuz/chromium');
    return chromiumPkg.default.executablePath();
  }
  return (
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    '/Users/arun/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  );
}

async function getLaunchArgs(): Promise<string[]> {
  if (IS_SERVERLESS) {
    const chromiumPkg = await import('@sparticuz/chromium');
    return chromiumPkg.default.args;
  }
  return ['--no-sandbox', '--disable-setuid-sandbox'];
}

const SAPOL_URL =
  'https://www.police.sa.gov.au/your-safety/road-safety/traffic-camera-locations/mobile-camera-container';

export interface CameraLocationRaw {
  location: string;
  suburb: string;
  date?: string;
  dateEnd?: string;
  type: 'metro' | 'country';
}

export async function scrapeCameraLocations(): Promise<CameraLocationRaw[]> {
  const [executablePath, args] = await Promise.all([getExecutablePath(), getLaunchArgs()]);
  const browser = await chromium.launch({ executablePath, headless: true, args });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-AU',
      extraHTTPHeaders: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-AU,en;q=0.9',
        Referer: 'https://www.police.sa.gov.au/',
      },
    });
    const page = await context.newPage();
    await page.goto(SAPOL_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);

    const html = await page.content();
    return parseLocations(html);
  } finally {
    await browser.close();
  }
}

function parseLocations(html: string): CameraLocationRaw[] {
  const $ = cheerio.load(html);
  const locations: CameraLocationRaw[] = [];

  // Metro locations: each .accordion header is followed by a .container (not .country)
  // with li.showlist items that have data-value="DD/MM/YYYY"
  $('div.accordion').each((_, header) => {
    const dateText = $(header).text().replace(/\s+/g, ' ').trim();
    const container = $(header).next('.container');
    if (!container.length) return;
    // Skip the country section (handled separately below)
    if (container.hasClass('country')) return;

    container.find('li.showlist').each((_, li) => {
      const raw = $(li).text().trim();
      const date = $(li).attr('data-value') || dateText;

      // Format is "STREET NAME, SUBURB NAME" (all caps)
      const commaIdx = raw.lastIndexOf(', ');
      if (commaIdx === -1) return;

      const street = titleCase(raw.substring(0, commaIdx).trim());
      const suburb = titleCase(raw.substring(commaIdx + 2).trim());

      if (street && suburb) {
        locations.push({ location: street, suburb, date, type: 'metro' });
      }
    });
  });

  // Country locations: a .container.country div containing li.showlist with datestart/dateend
  $('.container.country li.showlist').each((_, li) => {
    const raw = $(li).text().trim();
    const dateStart = $(li).attr('datestart');
    const dateEnd = $(li).attr('dateend');

    const commaIdx = raw.lastIndexOf(', ');
    if (commaIdx === -1) return;

    const street = titleCase(raw.substring(0, commaIdx).trim());
    const suburb = titleCase(raw.substring(commaIdx + 2).trim());

    if (street && suburb) {
      locations.push({ location: street, suburb, date: dateStart, dateEnd, type: 'country' });
    }
  });

  return locations;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    // Fix common SA abbreviations back to uppercase
    .replace(/\bHwy\b/g, 'Hwy')
    .replace(/\bRd\b/g, 'Rd')
    .replace(/\bSt\b/g, 'St')
    .replace(/\bAve\b/g, 'Ave')
    .replace(/\bBvd\b/g, 'Bvd')
    .replace(/\bTce\b/g, 'Tce')
    .replace(/\bPde\b/g, 'Pde')
    .replace(/\bDr\b/g, 'Dr')
    .replace(/\bCr\b/g, 'Cr')
    .replace(/\bCt\b/g, 'Ct')
    .replace(/\bPl\b/g, 'Pl')
    .replace(/\bGr\b/g, 'Gr')
    .replace(/\bExp\b/g, 'Exp')
    .replace(/\bO'[a-z]/g, (m) => m.toUpperCase());
}
