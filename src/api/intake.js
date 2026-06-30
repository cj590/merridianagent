import express from 'express';
import { scrapeProduct } from '../scrapers/index.js';
import { createLightspeedProduct } from '../services/lightspeedProduct.js';
import { createShopifyProduct, pushImagesToShopifyProduct } from '../services/shopifyProduct.js';

const router = express.Router();

// POST /api/intake
// Body: { url: string, supplierName?: string, supplierPrice?: number, retailPrice?: number }
router.post('/', async (req, res) => {
  const { url, supplierName, supplierPrice, retailPrice, vendorCredentials } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const results = {
    url,
    steps: [],
    success: false,
  };

  try {
    // Step 1: Scrape
    console.log(`[Intake] Scraping: ${url}`);
    const scraped = await scrapeProduct(url, vendorCredentials || {});
    results.steps.push({ step: 'scrape', status: 'success', data: scraped });
    results.scraped = scraped;

    // Merge in any manual overrides from user
    const productData = {
      ...scraped,
      supplierName: supplierName || scraped.vendor,
      supplierPrice: supplierPrice || null,
      retailPrice: retailPrice || null,
    };

    // Step 2: Create in Lightspeed
    console.log(`[Intake] Creating Lightspeed product: ${scraped.name}`);
    const lsResult = await createLightspeedProduct(productData);
    results.steps.push({ step: 'lightspeed', status: 'success', data: lsResult });
    results.lightspeedProductId = lsResult.lightspeedProductId;

    // Step 3: Create in Shopify + push all images
    console.log(`[Intake] Creating Shopify product: ${scraped.name}`);
    const shopifyProductData = { ...productData, lightspeedSku: lsResult.lightspeedSku };
    const shopifyProduct = await createShopifyProduct(shopifyProductData, lsResult.lightspeedProductId);
    results.shopifyProductId = shopifyProduct.id;

    // Push additional images (beyond first) directly to Shopify
    if (scraped.images?.length > 1) {
      const additionalImages = scraped.images.slice(1);
      const imageResults = await pushImagesToShopifyProduct(shopifyProduct.id, additionalImages);
      results.steps.push({ step: 'shopify_images', status: 'success', data: imageResults });
    }

    results.steps.push({ step: 'shopify', status: 'success', data: { id: shopifyProduct.id } });
    results.success = true;

    return res.json({
      success: true,
      message: `Product "${scraped.name}" created successfully`,
      results,
    });

  } catch (err) {
    console.error('[Intake] Error:', err.message);
    results.steps.push({ step: 'error', status: 'failed', error: err.message });

    return res.status(500).json({
      success: false,
      error: err.message,
      results,
    });
  }
});

// POST /api/intake/batch
// Body: { urls: string[], supplierName?, supplierPrice?, retailPrice? }
router.post('/batch', async (req, res) => {
  const { urls, ...commonData } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'urls array is required' });
  }

  // Process sequentially to avoid rate limiting
  const results = [];
  for (const url of urls) {
    try {
      const singleRes = await processSingleUrl(url, commonData);
      results.push({ url, success: true, ...singleRes });
    } catch (err) {
      results.push({ url, success: false, error: err.message });
    }
  }

  return res.json({ results });
});

async function processSingleUrl(url, commonData) {
  const scraped = await scrapeProduct(url, commonData.vendorCredentials || {});
  const productData = { ...scraped, ...commonData };
  const lsResult = await createLightspeedProduct(productData);
  const shopifyProductData = { ...productData, lightspeedSku: lsResult.lightspeedSku };
  const shopifyProduct = await createShopifyProduct(shopifyProductData, lsResult.lightspeedProductId);

  if (scraped.images?.length > 1) {
    await pushImagesToShopifyProduct(shopifyProduct.id, scraped.images.slice(1));
  }

  return {
    scraped,
    lightspeedProductId: lsResult.lightspeedProductId,
    shopifyProductId: shopifyProduct.id,
  };
}

export default router;
