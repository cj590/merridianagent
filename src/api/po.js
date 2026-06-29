import express from 'express';
import axios from 'axios';
import { getLightspeedToken } from '../services/lightspeedAuth.js';

const router = express.Router();

async function lsRequest(method, endpoint, data = null) {
  const token = (await getLightspeedToken()).replace(/^["']|["']$/g, '').trim();
  const prefix = (process.env.LIGHTSPEED_STORE_PREFIX || '').replace(/^["']|["']$/g, '').trim();
  const baseURL = `https://${prefix}.retail.lightspeed.app/api`;
  const fullUrl = `${baseURL}/${endpoint}`;

  const config = {
    method,
    url: fullUrl,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  if (data) config.data = data;

  try {
    const response = await axios(config);
    return response.data;
  } catch (err) {
    console.error(`[PO] Error ${err.response?.status} on ${method} ${fullUrl}:`, err.response?.data);
    throw new Error(`Lightspeed API error: ${JSON.stringify(err.response?.data) || err.message}`);
  }
}

// GET /api/po/suppliers — fetch all suppliers from Lightspeed
router.get('/suppliers', async (req, res) => {
  try {
    const result = await lsRequest('GET', '2.0/suppliers?page_size=200');
    const suppliers = (result.data || []).map(s => ({ id: s.id, name: s.name }));
    suppliers.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, suppliers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/po/outlets — fetch all outlets from Lightspeed
router.get('/outlets', async (req, res) => {
  try {
    const result = await lsRequest('GET', '2.0/outlets?page_size=50');
    const outlets = (result.data || []).map(o => ({ id: o.id, name: o.name }));
    res.json({ success: true, outlets });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Simple in-memory cache for products
let productCache = [];
let productCacheTime = 0;
let productFetchPromise = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchAllProducts() {
  const now = Date.now();
  if (productCache.length > 0 && now - productCacheTime < CACHE_TTL) {
    return productCache;
  }

  // Prevent concurrent fetches — return same promise if already in progress
  if (productFetchPromise) return productFetchPromise;

  productFetchPromise = (async () => {
    let allProducts = [];
    let offset = 0;
    const pageSize = 250;

    while (offset <= 5000) {
      console.log(`[Products] Fetching offset=${offset}...`);
      const result = await lsRequest('GET', `2.0/products?page_size=${pageSize}&offset=${offset}`);
      const data = result.data || [];
      allProducts = allProducts.concat(data);
      console.log(`[Products] Got ${data.length}, total so far: ${allProducts.length}`);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    console.log(`[Products] Done. Total raw: ${allProducts.length}`);

    const seen = new Set();
    const unique = allProducts
      .filter(p => {
        // Only keep parent products (no variant_parent_id) and skip duplicates
        if (!p.name) return false;
        if (p.variant_parent_id) return false;
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      })
      .map(p => ({ id: p.id, name: p.name, sku: p.source_variant_id || '' }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    console.log(`[Products] Unique: ${unique.length}`);
    productCache = unique;
    productCacheTime = Date.now();
    productFetchPromise = null;
    return unique;
  })();

  return productFetchPromise;
}

// GET /api/po/products?search=xxx — search products via Lightspeed directly
router.get('/products', async (req, res) => {
  try {
    const search = (req.query.search || '').toLowerCase().trim();
    const all = await fetchAllProducts();

    const filtered = search
      ? all.filter(p => p.name?.toLowerCase().includes(search))
      : all;

    res.json({ success: true, products: filtered, total: all.length });
  } catch (err) {
    console.error('[PO Products]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/po — create a purchase order in Lightspeed
router.post('/', async (req, res) => {
  const { supplierId, outletIds, outletId, lineItems, name } = req.body;
  const outlets = outletIds || (outletId ? [outletId] : []);

  if (!supplierId || !outlets.length || !lineItems?.length) {
    return res.status(400).json({ error: 'supplierId, outletIds, and lineItems are required' });
  }

  try {
    // Create one consignment with outlet_ids array
    const consignment = await lsRequest('POST', '2.0/consignments', {
      name: name || `PO - ${new Date().toLocaleDateString()}`,
      supplier_id: supplierId,
      outlet_id: outlets[0], // primary outlet
      outlet_ids: outlets,   // all outlets
      type: 'SUPPLIER',
      status: 'OPEN',
    });

    const consignmentId = Array.isArray(consignment.data)
      ? consignment.data[0]
      : consignment.data?.id;

    if (!consignmentId) throw new Error('No consignment ID returned');
    console.log(`[PO] Consignment created: ${consignmentId}`);

    // Add line items
    const lineResults = [];
    for (const item of lineItems) {
      try {
        await lsRequest('POST', `2.0/consignments/${consignmentId}/products`, {
          product_id: item.productId,
          count: parseInt(item.qty) || 1,
          cost: item.cost ? String(item.cost) : '0',
          status: 'PENDING',
        });
        lineResults.push({ name: item.name, success: true });
      } catch (err) {
        lineResults.push({ name: item.name, success: false, error: err.message });
      }
    }

    const poUrl = `https://merridian.retail.lightspeed.app/inventory/purchase-order/${consignmentId}/edit`;

    res.json({
      success: true,
      consignmentId,
      poUrl,
      lineResults,
      message: `Purchase order created with ${lineResults.filter(r => r.success).length} of ${lineItems.length} items`,
    });

  } catch (err) {
    console.error('[PO] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
