import axios from 'axios';
import { getLightspeedToken } from './lightspeedAuth.js';

async function lsRequest(method, endpoint, data = null) {
  const token = (await getLightspeedToken()).replace(/^["']|["']$/g, '').trim();
  const prefix = (process.env.LIGHTSPEED_STORE_PREFIX || '').replace(/^["']|["']$/g, '').trim();
  const baseURL = `https://${prefix}.retail.lightspeed.app/api`;
  const fullUrl = `${baseURL}/${endpoint}`;

  console.log(`[LS] ${method} ${fullUrl}`, data ? JSON.stringify(data).slice(0, 100) : '');

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
    const errData = err.response?.data;
    console.error(`[LS] Error ${err.response?.status} on ${method} ${fullUrl}:`, errData);
    throw new Error(`Lightspeed API error on ${endpoint}: ${JSON.stringify(errData) || err.message}`);
  }
}

export async function createLightspeedProduct(productData) {
  const {
    name,
    description,
    vendorItemCode,
    category,
    dimensions,
    supplierName,
    supplierPrice,
    retailPrice,
    images,
  } = productData;

  const fullDescription = buildDescription(description, dimensions);

  // 1. Find existing product type (don't try to create)
  let productTypeId = null;
  if (category) {
    productTypeId = await findProductType(category);
  }

  // 2. Create the product
  const productPayload = {
    name,
    description: fullDescription,
    type: 'standard',
  };

  if (productTypeId) productPayload.product_type_id = productTypeId;

  if (retailPrice) {
    productPayload.price_standard = {
      tax_exclusive: String(retailPrice),
    };
  }

  const product = await lsRequest('POST', '2.0/products', productPayload);
  const productId = Array.isArray(product.data) ? product.data[0] : product.data?.id;

  if (!productId) {
    throw new Error('Product created but no ID returned: ' + JSON.stringify(product));
  }

  console.log(`[LS] Product created: ${productId}`);

  // 3. Find supplier and link via catalog
  if (supplierName || vendorItemCode) {
    await linkSupplier(productId, supplierName, vendorItemCode, supplierPrice).catch(err => {
      console.warn('[LS] Supplier link failed (non-fatal):', err.message);
    });
  }

  // 4. Upload image
  if (images && images.length > 0) {
    await uploadImage(productId, images[0]).catch(err => {
      console.warn('[LS] Image upload failed (non-fatal):', err.message);
    });
  }

  return {
    lightspeedProductId: productId,
    product: product.data,
  };
}

async function findProductType(categoryName) {
  try {
    const res = await lsRequest('GET', '2.0/product_types?page_size=100');
    const types = res.data || [];
    const match = types.find(t => t.name?.toLowerCase() === categoryName.toLowerCase());
    if (match) {
      console.log(`[LS] Found product type: ${match.id} (${match.name})`);
      return match.id;
    }
    // Try to create it
    try {
      const created = await lsRequest('POST', '2.0/product_types', { name: categoryName });
      return Array.isArray(created.data) ? created.data[0] : created.data?.id;
    } catch {
      return null;
    }
  } catch (err) {
    console.warn('[LS] Product type lookup failed:', err.message);
    return null;
  }
}

async function linkSupplier(productId, supplierName, supplierCode, supplierPrice) {
  // Find supplier ID
  let supplierId = null;
  try {
    const res = await lsRequest('GET', '2.0/suppliers?page_size=100');
    const suppliers = res.data || [];
    const match = suppliers.find(s => s.name?.toLowerCase() === supplierName?.toLowerCase());
    if (match) supplierId = match.id;
  } catch (err) {
    console.warn('[LS] Supplier lookup failed:', err.message);
  }

  if (!supplierId) {
    console.warn(`[LS] Supplier "${supplierName}" not found in Lightspeed — skipping supplier link`);
    return;
  }

  // Use the correct endpoint for linking supplier to product
  await lsRequest('POST', `2.0/supplier_products`, {
    product_id: productId,
    supplier_id: supplierId,
    supplier_code: supplierCode || '',
    price: supplierPrice ? String(supplierPrice) : '0',
  });

  console.log(`[LS] Supplier linked to product ${productId}`);
}

async function uploadImage(productId, imageUrl) {
  try {
    // Try URL-based upload first
    const res = await lsRequest('POST', `2.0/images`, {
      product_id: productId,
      url: imageUrl,
    });
    console.log(`[LS] Image uploaded via URL`);
    return res;
  } catch (err) {
    console.warn('[LS] Image URL upload failed:', err.message);
  }
}

function buildDescription(description, dimensions) {
  let parts = [];
  if (description) parts.push(description);

  if (dimensions) {
    const dimLines = [];
    if (dimensions.outside) dimLines.push(`Outside: ${dimensions.outside}`);
    if (dimensions.inside) dimLines.push(`Inside: ${dimensions.inside}`);
    if (dimensions.seatHeight) dimLines.push(`Seat Height: ${dimensions.seatHeight}`);
    if (dimensions.armHeight) dimLines.push(`Arm Height: ${dimensions.armHeight}`);
    if (dimLines.length) parts.push(dimLines.join(' | '));
  }

  return parts.join('\n\n');
}
