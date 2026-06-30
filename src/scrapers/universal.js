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

  // Strip scripts, styles, nav, footer, header BEFORE extracting any text
  $('script, style, noscript, nav, footer, header, iframe').remove();

  // ── Name ──────────────────────────────────────────────────────────────────
  const name =
    $('h1').first().text().trim() ||
    $('[class*="product-title"]').first().text().trim() ||
    $('[class*="product-name"]').first().text().trim() ||
    $('[class*="product_title"]').first().text().trim() ||
    $('title').text().split('|')[0].split('-')[0].trim() ||
    'Unknown Product';

  // ── SKU / Item code ────────────────────────────────────────────────────────
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  let vendorItemCode =
    $('[class*="sku"]').first().text().replace(/sku|item|#|:/gi, '').trim() ||
    $('[class*="model-number"]').first().text().replace(/model|#|:/gi, '').trim() ||
    '';

  // Try to find SKU pattern in text (e.g. "SKU: ABC123", "Item: L4658T")
  if (!vendorItemCode || vendorItemCode.length < 2) {
    const skuMatch = bodyText.match(/(?:sku|item #?|model #?|part #?|style #?)[:\s]+([A-Z0-9\-]{3,})/i);
    vendorItemCode = skuMatch ? skuMatch[1].trim() : '';
  }

  // ── Description ───────────────────────────────────────────────────────────
  let description = $('meta[name="description"]').attr('content')?.trim() || '';
  if (!description) {
    const descEl = $('[class*="product-description"], [class*="product_description"]').first();
    description = descEl.text().replace(/\s+/g, ' ').trim();
  }
  // Clean up any leftover code/script remnants that slipped through
  description = description
    .replace(/\{[^}]*\}/g, '') // strip {} code blocks
    .replace(/\/\/.*$/gm, '')  // strip // comments
    .replace(/function\s*\([^)]*\)\s*=>/g, '') // strip arrow function syntax
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

  // ── Category ──────────────────────────────────────────────────────────────
  // Only search the name + description, not the whole page (avoids nav/breadcrumb false positives)
  const categoryText = (name + ' ' + description).toLowerCase();
  const categoryMap = [
    ['table lamp', 'Lighting'], ['floor lamp', 'Lighting'], ['pendant', 'Lighting'], ['chandelier', 'Lighting'], ['sconce', 'Lighting'], ['lamp', 'Lighting'],
    ['sofa', 'Sofas'], ['sectional', 'Sofas'], ['loveseat', 'Sofas'],
    ['chair', 'Chairs'], ['ottoman', 'Chairs'], ['recliner', 'Chairs'],
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
    if (categoryText.includes(keyword)) { category = cat; break; }
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

  // Check og:image first but only if it looks like a product image
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage && !ogImage.match(/logo|og-image|og_image|social|share|default|site/i)) {
    const abs = ogImage.startsWith('http') ? ogImage : (() => { try { return new URL(ogImage, url).href; } catch { return null; } })();
    if (abs) { seen.add(abs); images.push(abs); }
  }

  $('img').each((i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || $(el).attr('data-original');
    if (!src) return;
    const abs = src.startsWith('http') ? src : (() => { try { return new URL(src, url).href; } catch { return null; } })();
    if (!abs) return;
    if (seen.has(abs)) return;
    if (!abs.match(/\.(jpg|jpeg|png|webp)/i)) return;
    if (abs.match(/icon|logo|sprite|banner|arrow|chevron|placeholder|blank|social|share/i)) return;
    // Prefer larger images — skip tiny thumbnails by checking URL hints
    const width = parseInt($(el).attr('width') || '0');
    const height = parseInt($(el).attr('height') || '0');
    if ((width && width < 100) || (height && height < 100)) return;
    seen.add(abs);
    images.push(abs);
  });

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
