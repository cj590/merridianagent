import { chromium } from 'playwright';

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless: true });
  }
  return browserInstance;
}

export async function scrapeBernhardt(url, credentials = null) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  });
  const page = await context.newPage();

  try {
    // Login if credentials provided
    if (credentials?.email && credentials?.password) {
      await loginBernhardt(page, credentials);
    }

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for product content to render
    await page.waitForSelector('h1, .product-name, [class*="product"]', { timeout: 15000 });

    // Extract product data
    const data = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };

      const getAttr = (selector, attr) => {
        const el = document.querySelector(selector);
        return el ? el.getAttribute(attr) : null;
      };

      // Product name
      const name = getText('h1') || getText('.product-name') || getText('[class*="productName"]');

      // Style/item number — usually in URL or page metadata
      const urlMatch = window.location.pathname.match(/\/shop\/([A-Z0-9]+)/);
      const vendorItemCode = urlMatch ? urlMatch[1] : null;

      // Description
      const description = getText('[class*="description"]') || getText('[class*="product-detail"]');

      // Dimensions — look for common patterns
      const bodyText = document.body.innerText;
      const dimMatch = bodyText.match(/(\d+(?:\.\d+)?["']?\s*[Ww])\s*[xX×]\s*(\d+(?:\.\d+)?["']?\s*[Dd])\s*[xX×]\s*(\d+(?:\.\d+)?["']?\s*[Hh])/);
      const dimensions = dimMatch ? dimMatch[0] : null;

      // Images
      const images = [];
      document.querySelectorAll('img[src*="media"], img[src*="product"], img[class*="product"]').forEach(img => {
        const src = img.src || img.getAttribute('data-src');
        if (src && !src.includes('icon') && !src.includes('logo') && src.match(/\.(jpg|jpeg|png|webp)/i)) {
          images.push(src);
        }
      });

      // Category from breadcrumbs
      const breadcrumbs = [];
      document.querySelectorAll('[class*="breadcrumb"] a, nav a').forEach(a => {
        breadcrumbs.push(a.textContent.trim());
      });

      return { name, vendorItemCode, description, dimensions, images: [...new Set(images)], breadcrumbs };
    });

    await context.close();

    return {
      vendor: 'Bernhardt',
      vendorItemCode: data.vendorItemCode,
      name: data.name,
      description: data.description,
      category: inferCategory(data.breadcrumbs, url),
      dimensions: { outside: data.dimensions },
      images: data.images.slice(0, 6), // cap at 6
      sourceUrl: url,
    };
  } catch (err) {
    await context.close();
    throw new Error(`Bernhardt scrape failed: ${err.message}`);
  }
}

async function loginBernhardt(page, credentials) {
  try {
    await page.goto('https://www.bernhardt.com/login', { waitUntil: 'networkidle', timeout: 15000 });
    await page.fill('input[type="email"], input[name="email"]', credentials.email);
    await page.fill('input[type="password"], input[name="password"]', credentials.password);
    await page.click('button[type="submit"], input[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
  } catch (err) {
    console.warn('Bernhardt login attempt:', err.message);
  }
}

function inferCategory(breadcrumbs, url) {
  const text = [...breadcrumbs, url].join(' ').toLowerCase();
  if (text.includes('bed')) return 'Beds';
  if (text.includes('sofa') || text.includes('sectional')) return 'Sofas';
  if (text.includes('chair')) return 'Chairs';
  if (text.includes('dining')) return 'Dining';
  if (text.includes('table')) return 'Tables';
  if (text.includes('storage') || text.includes('dresser')) return 'Bedroom Storage';
  return 'Furniture';
}
