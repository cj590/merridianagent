import axios from 'axios';
import { getLightspeedToken } from './lightspeedAuth.js';

async function lsRequest(method, endpoint, data = null) {
  const token = await getLightspeedToken();
  const prefix = process.env.LIGHTSPEED_STORE_PREFIX;
  const baseURL = `https://${prefix}.retail.lightspeed.app/api`;
  const fullUrl = `${baseURL}/${endpoint}`;

  console.log(`[LS] ${method} ${fullUrl}`, data ? JSON.stringify(data).slice(0, 200) : '');

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

  // 1. Find or create product type (category)
  let productTypeId = null;
  if (category) {
    productTypeId = await findOrCreateProductType(category);
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
  // API returns data as array of IDs or as object with id field
  const productId = Array.isArray(product.data) ? product.data[0] : product.data?.id;

  if (!productId) {
    throw new Error('Product created but no ID returned: ' + JSON.stringify(product));
  }

  console.log(`[LS] Product created: ${productId}`);

  // 3. Add supplier info
  if (supplierName || vendorItemCode) {
    await addSupplierToProduct(productId, supplierName, vendorItemCode, supplierPrice).catch(err => {
      console.warn('[LS] Supplier add failed (non-fatal):', err.message);
    });
  }

  // 4. Upload images via URL
  let lightspeedImageUrl = null;
  if (images && images.length > 0) {
    lightspeedImageUrl = await uploadImageToLightspeed(productId, images[0]);
  }

  return {
    lightspeedProductId: productId,
    lightspeedImageUrl,
    product: product.data,
  };
}

async function findOrCreateProductType(categoryName) {
  try {
    // List all product types and find a match
    const res = await lsRequest('GET', '2.0/product_types?page_size=100');
    const types = res.data || [];
    const match = types.find(t => t.name?.toLowerCase() === categoryName.toLowerCase());
    if (match) {
      console.log(`[LS] Found product type: ${match.id} (${match.name})`);
      return match.id;
    }

    // Create it
    const created = await lsRequest('POST', '2.0/product_types', { name: categoryName });
    console.log(`[LS] Created product type: ${created.data?.id}`);
    return created.data?.id || null;
  } catch (err) {
    console.warn('[LS] Product type lookup/create failed (non-fatal):', err.message);
    return null;
  }
}

async function addSupplierToProduct(productId, supplierName, supplierCode, supplierPrice) {
  let supplierId = null;
  if (supplierName) {
    try {
      const res = await lsRequest('GET', `2.0/suppliers?page_size=100`);
      const suppliers = res.data || [];
      const match = suppliers.find(s => s.name?.toLowerCase() === supplierName.toLowerCase());
      if (match) {
        supplierId = match.id;
        console.log(`[LS] Found supplier: ${supplierId}`);
      }
    } catch (err) {
      console.warn('[LS] Supplier lookup failed:', err.message);
    }
  }

  const payload = {
    supplier_code: supplierCode || '',
    price: supplierPrice ? String(supplierPrice) : '0',
  };

  if (supplierId) payload.supplier_id = supplierId;

  await lsRequest('POST', `2.0/products/${productId}/supplier_products`, payload);
  console.log(`[LS] Supplier added to product ${productId}`);
}

async function uploadImageToLightspeed(productId, imageUrl) {
  try {
    // Download image and upload as base64
    const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(imgResponse.data).toString('base64');
    const contentType = imgResponse.headers['content-type'] || 'image/jpeg';

    const res = await lsRequest('POST', `2.0/products/${productId}/images`, {
      content: base64,
      content_type: contentType,
    });

    console.log(`[LS] Image uploaded to product ${productId}`);
    return res.data?.url || null;
  } catch (err) {
    console.warn('[LS] Image upload failed (non-fatal):', err.message);
    return null;
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
