import axios from 'axios';
import { getLightspeedToken } from './lightspeedAuth.js';

async function lsRequest(method, endpoint, data = null) {
  const token = await getLightspeedToken();
  const prefix = process.env.LIGHTSPEED_STORE_PREFIX;
  const baseURL = `https://${prefix}.retail.lightspeed.app/api`;
  const fullUrl = `${baseURL}/${endpoint}`;

  console.log(`[LS] ${method} ${fullUrl}`, data ? JSON.stringify(data) : '');

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

  // 1. Create the product
  const productPayload = {
    name,
    description: fullDescription,
    type: 'standard',
  };

  if (retailPrice) {
    productPayload.price_standard = {
      tax_exclusive: String(retailPrice),
    };
  }

  const product = await lsRequest('POST', '2.0/products', productPayload);
  const productId = product.data?.id;

  if (!productId) {
    throw new Error('Product created but no ID returned: ' + JSON.stringify(product));
  }

  console.log(`[LS] Product created: ${productId}`);

  // 2. Add supplier info
  if (supplierName || vendorItemCode) {
    await addSupplierToProduct(productId, supplierName, vendorItemCode, supplierPrice).catch(err => {
      console.warn('[LS] Supplier add failed (non-fatal):', err.message);
    });
  }

  // 3. Upload primary image to Lightspeed
  let lightspeedImageUrl = null;
  if (images && images.length > 0) {
    lightspeedImageUrl = await uploadImageToLightspeed(productId, images[0]).catch(err => {
      console.warn('[LS] Image upload failed (non-fatal):', err.message);
      return null;
    });
  }

  return {
    lightspeedProductId: productId,
    lightspeedImageUrl,
    product: product.data,
  };
}

async function addSupplierToProduct(productId, supplierName, supplierCode, supplierPrice) {
  // Find supplier by name
  let supplierId = null;
  if (supplierName) {
    try {
      const suppliers = await lsRequest('GET', `2.0/suppliers?name=${encodeURIComponent(supplierName)}`);
      if (suppliers.data?.length > 0) {
        supplierId = suppliers.data[0].id;
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
}

async function uploadImageToLightspeed(productId, imageUrl) {
  try {
    const res = await lsRequest('POST', `2.0/products/${productId}/images`, {
      url: imageUrl,
    });
    return res.data?.url || null;
  } catch (err) {
    console.warn('[LS] Image upload failed:', err.message);
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
