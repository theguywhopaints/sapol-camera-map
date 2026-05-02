import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium', 'cheerio'],
  outputFileTracingIncludes: {
    '/api/cameras': ['./data/**'],
  },
};

export default nextConfig;
