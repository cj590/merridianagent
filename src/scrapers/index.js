import { scrapeCRLaine } from './crlaine.js';
import { scrapeBernhardt } from './bernhardt.js';
import { scrapeUniversal } from './universal.js';

export function detectVendor(url) {
  if (url.includes('crlaine.com')) return 'crlaine';
  if (url.includes('bernhardt.com')) return 'bernhardt';
  return 'universal';
}

export async function scrapeProduct(url, vendorCredentials = {}) {
  const vendor = detectVendor(url);

  switch (vendor) {
    case 'crlaine':
      return await scrapeCRLaine(url);

    case 'bernhardt':
      return await scrapeBernhardt(url, vendorCredentials.bernhardt || null);

    default:
      // Universal AI-powered scraper for all other vendors
      return await scrapeUniversal(url);
  }
}
