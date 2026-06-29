import axios from 'axios';
import * as cheerio from 'cheerio';

export async function scrapeUniversal(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(response.data);

  // ── Name ──────────────────────────────────────────────────────────────────
  // Try common product name selectors in order of specificity
  const name =
    $('h1').first().text().trim() ||
    $('[class*="product-title"]').first().text().trim() ||
    $('[class*="product-name"]').first().text().trim() ||
    $('[class*="product_title"]').first().text().trim() ||
    $('title').text().split('|')[0].split('-')[0].trim() ||
    'Unknown Product';

  // ── SKU / Item code ────────────────────────────────────────────────────────
  const bodyText = $('body').text();
  let vendorItemCode =
    $('[class*="sku"]').first().text().replace(/sku|item|#|:/gi, '').trim() ||
    $('[class*="model"]').first().text().replace(/model|#|:/gi, '').trim() ||
    $('[class*="part"]').first().text().replace(/part|#|:/gi, '').trim() ||
    '';

  // Try to find SKU pattern in text (e.g. "SKU: ABC123", "Item: L4658T")
  if (!vendorItemCode) {
    const skuMatch = bodyText.match(/(?:sku|item #?|model #?|part #?|style #?)[:\s]+([A-Z0-9\-]+)/i);
    if (skuMatch) vendorItemCode = skuMatch[1].trim();
  }

  // ── Description ───────────────────────────────────────────────────────────
  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('[class*="product-description"]').first().text().trim() ||
    $('[class*="product_description"]').first().text().trim() ||
    $('[class*="description"]').first().text().trim().slice(0, 500) ||
    '';

  // ── Category ──────────────────────────────────────────────────────────────
  const pageContent = bodyText.toLowerCase();
  const categoryMap = [
    ['sofa', 'Sofas'], ['sectional', 'Sofas'], ['loveseat', 'Sofas'],
    ['chair', 'Chairs'], ['ottoman', 'Chairs'], ['recliner', 'Chairs'],
    ['table lamp', 'Lighting'], ['floor lamp', 'Lighting'], ['pendant', 'Lighting'], ['chandelier', 'Lighting'], ['sconce', 'Lighting'],
    ['dining table', 'Tables'], ['coffee table', 'Tables'], ['end table', 'Tables'], ['console', 'Tables'], ['desk', 'Tables'],
    ['mirror', 'Mirrors'],
    ['rug', 'Rugs'], ['carpet', 'Rugs'],
    ['bed', 'Bedding'], ['pillow', 'Bedding'], ['throw', 'Bedding'],
    ['art', 'Art'], ['print', 'Art'], ['canvas', 'Art'],
    ['cabinet', 'Storage'], ['bookcase', 'Storage'], ['shelf', 'Storage'], ['dresser', 'Storage'],
    ['outdoor', 'Outdoor'], ['patio', 'Outdoor'],
    ['dining', 'Dining'],
  ];
  let category = 'Accessories';
  for (const [keyword, cat] of categoryMap) {
    if (pageContent.includes(keyword)) { category = cat; break; }
  }

  // ── Dimensions ────────────────────────────────────────────────────────────
  const dimMatch = bodyText.match(/(\d+[\d\s"'x×.]+(?:W|H|D|L|wide|high|deep|tall)[^.]*)/i);
  const dimensions = {
    outside: dimMatch ? dimMatch[1].trim() : null,
    inside: null,
    seatHeight: null,
    armHeight: null,
  };

  // ── Images ────────────────────────────────────────────────────────────────
  const images = [];
  const seen = new Set();

  $('img').each((i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original');
    if (!src) return;
    const abs = src.startsWith('http') ? src : (() => { try { return new URL(src, url).href; } catch { return null; } })();
    if (!abs) return;
    if (seen.has(abs)) return;
    if (!abs.match(/\.(jpg|jpeg|png|webp)/i)) return;
    if (abs.match(/icon|logo|sprite|banner|arrow|chevron|placeholder|blank/i)) return;
    seen.add(abs);
    images.push(abs);
  });

  // Also check og:image
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage && !seen.has(ogImage)) images.unshift(ogImage);

  // ── Vendor name from domain ────────────────────────────────────────────────
  const domain = new URL(url).hostname.replace('www.', '');
  const domainName = domain.split('.')[0];
  const vendor = domainName.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());

  return {
    vendor,
    vendorItemCode: vendorItemCode || '',
    name: name.split('\n')[0].trim(),
    description: description.split('\n')[0].trim().slice(0, 500),
    category,
    dimensions,
    weight: null,
    images: images.slice(0, 6),
    sourceUrl: url,
  };
}
