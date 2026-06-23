import axios from 'axios';
import * as cheerio from 'cheerio';

export async function scrapeCRLaine(url) {
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  const $ = cheerio.load(response.data);

  // Extract style number from URL or heading
  const heading = $('h2').first().text().trim();
  // e.g. "Abingdon 3750-22B"
  const headingParts = heading.split(' ');
  const styleName = headingParts[0]; // "Abingdon"
  const styleNumber = headingParts[1]; // "3750-22B"

  // Extract dimensions block
  const bodyText = $('body').text();

  const outside = extractDimension(bodyText, 'OUTSIDE:');
  const inside = extractDimension(bodyText, 'INSIDE:');
  const seat = extractDimension(bodyText, 'Seat:');
  const arm = extractDimension(bodyText, 'Arm:');
  const weight = extractAfterLabel(bodyText, 'Weight:');
  const description = extractAfterLabel(bodyText, 'Description:');
  const category = extractCategory($);

  // Extract images
  const images = [];

  // Primary large image
  const primaryImg = $('img[src*="/products/xlarge/"]').first().attr('src');
  if (primaryImg) {
    images.push(absoluteUrl(primaryImg));
  }

  // Alt images from thumbnails (derive xlarge URLs)
  $('img[src*="/products/thumbnails/"]').each((i, el) => {
    const thumb = $(el).attr('src');
    if (thumb && thumb.includes('_alt')) {
      const large = thumb
        .replace('/thumbnails/', '/xlarge/')
        .replace(/\.(jpg|png)$/, '.jpg');
      images.push(absoluteUrl(large));
    }
  });

  // High-res download link
  const hiresLink = $('a[href*="/downloadit/"]').attr('href');
  const hiresUrl = hiresLink ? absoluteUrl(hiresLink) : null;

  return {
    vendor: 'CR Laine',
    vendorItemCode: styleNumber,
    name: styleName,
    description: description || `${styleName} ${styleNumber}`,
    category,
    dimensions: {
      outside: outside || null,
      inside: inside || null,
      seatHeight: seat || null,
      armHeight: arm || null,
    },
    weight: weight || null,
    images: [...new Set(images)], // dedupe
    hiresImageUrl: hiresUrl,
    sourceUrl: url,
  };
}

function extractDimension(text, label) {
  const regex = new RegExp(label + '\\s*([\\d\\.W x XDHwdh×"]+)', 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function extractAfterLabel(text, label) {
  const idx = text.indexOf(label);
  if (idx === -1) return null;
  const after = text.slice(idx + label.length, idx + label.length + 100).trim();
  const firstLine = after.split('\n')[0].trim();
  return firstLine || null;
}

function extractCategory($) {
  // Breadcrumb: "Products > Sofas"
  const breadcrumb = $('body').text();
  const categories = ['Sofas', 'Chairs', 'Sectionals', 'Ottomans', 'Loveseats', 'Beds', 'Dining'];
  for (const cat of categories) {
    if (breadcrumb.includes(cat)) return cat;
  }
  return 'Furniture';
}

function absoluteUrl(url) {
  if (url.startsWith('http')) return url;
  return `https://www.crlaine.com${url}`;
}
