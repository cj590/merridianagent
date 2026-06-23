import { scrapeCRLaine } from './crlaine.js';
import { scrapeBernhardt } from './bernhardt.js';

export function detectVendor(url) {
  if (url.includes('crlaine.com')) return 'crlaine';
  if (url.includes('bernhardt.com')) return 'bernhardt';
  // Add more vendors here as we expand
  return 'unknown';
}

export async function scrapeProduct(url, vendorCredentials = {}) {
  const vendor = detectVendor(url);

  switch (vendor) {
    case 'crlaine':
      return await scrapeCRLaine(url);

    case 'bernhardt':
      return await scrapeBernhardt(url, vendorCredentials.bernhardt || null);

    default:
      throw new Error(`Unsupported vendor URL: ${url}. Supported vendors: CR Laine, Bernhardt.`);
  }
}
