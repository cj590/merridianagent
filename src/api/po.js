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

// GET /api/po/products?search=xxx — search products via Shopify (faster name search)
router.get('/products', async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    const SHOPIFY_STORE = (process.env.SHOPIFY_STORE || '').replace(/^["']|["']$/g, '').trim();
    const SHOPIFY_ACCESS_TOKEN = (process.env.SHOPIFY_ACCESS_TOKEN || '').replace(/^["']|["']$/g, '').trim();

    const url = search
      ? `https://${SHOPIFY_STORE}/admin/api/2024-10/products.json?title=${encodeURIComponent(search)}&limit=20&fields=id,title,variants`
      : `https://${SHOPIFY_STORE}/admin/api/2024-10/products.json?limit=50&fields=id,title,variants&order=title asc`;

    const response = await axios.get(url, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN }
    });

    const products = (response.data.products || []).map(p => ({
      id: p.id,
      name: p.title,
      sku: p.variants?.[0]?.sku || '',
      shopifyId: p.id,
    }));

    // Also try to find matching Lightspeed product IDs by name
    // For PO creation we need the LS product ID
    const lsProducts = await lsRequest('GET', `2.0/products?page_size=200`);
    const lsMap = {};
    (lsProducts.data || []).forEach(p => { lsMap[p.name?.toLowerCase()] = p.id; });

    const enriched = products.map(p => ({
      ...p,
      id: lsMap[p.name?.toLowerCase()] || p.id,
      lightspeedId: lsMap[p.name?.toLowerCase()] || null,
    }));

    res.json({ success: true, products: enriched });
  } catch (err) {
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

    const poUrl = `https://merridian.retail.lightspeed.app/inventory/purchase-orders/${consignmentId}`;

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
