import axios from 'axios';
import * as cheerio from 'cheerio';

export async function scrapeUniversal(url) {
  // Fetch the page
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(response.data);

  // Remove script/style tags to clean up text
  $('script, style, nav, footer, header').remove();

  // Get page text (trimmed)
  const pageText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);

  // Get all images
  const images = [];
  $('img').each((i, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
    if (!src) return;
    const abs = src.startsWith('http') ? src : new URL(src, url).href;
    // Filter out small UI images (icons, logos etc)
    if (abs.match(/\.(jpg|jpeg|png|webp)/i) && !abs.match(/icon|logo|sprite|banner|arrow|chevron|svg/i)) {
      images.push(abs);
    }
  });

  // Extract vendor name from domain
  const domain = new URL(url).hostname.replace('www.', '');
  const vendorName = domain.split('.')[0].replace(/([a-z])([A-Z])/g, '$1 $2');

  // Use Claude API to extract product details from page text
  const prompt = `Extract product information from this furniture/home decor product page text. Return ONLY a JSON object with these fields:
- name: product name (string)
- vendorItemCode: SKU or item/model number (string)  
- description: product description (string, 1-3 sentences max)
- category: one of: Sofas, Chairs, Tables, Lighting, Mirrors, Rugs, Accessories, Art, Bedding, Storage, Outdoor, Dining (string)
- dimensions: { outside, inside, seatHeight, armHeight } (strings, null if not found)
- weight: shipping weight if mentioned (string, null if not found)

Page URL: ${url}
Page text: ${pageText}

Return ONLY the JSON object, no other text.`;

  const apiResponse = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  }, {
    headers: { 'Content-Type': 'application/json' },
  });

  let extracted;
  try {
    const text = apiResponse.data.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    extracted = JSON.parse(clean);
  } catch (err) {
    throw new Error(`Failed to parse product details from page: ${err.message}`);
  }

  return {
    vendor: vendorName.charAt(0).toUpperCase() + vendorName.slice(1),
    vendorItemCode: extracted.vendorItemCode || '',
    name: extracted.name || 'Unknown Product',
    description: extracted.description || '',
    category: extracted.category || 'Accessories',
    dimensions: extracted.dimensions || {},
    weight: extracted.weight || null,
    images: images.slice(0, 6),
    sourceUrl: url,
  };
}
