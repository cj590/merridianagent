import axios from 'axios';
import { getLightspeedToken } from './lightspeedAuth.js';

async function lsRequest(method, endpoint, data = null) {
  const token = await getLightspeedToken();
  const prefix = process.env.LIGHTSPEED_STORE_PREFIX;
  const baseURL = `https://${prefix}.retail.lightspeed.app/api`;

  const config = {
    method,
    url: `${baseURL}/${endpoint}`,
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
    console.error('Lightspeed API error:', err.response?.data || err.message);
    throw new Error(`Lightspeed API error: ${err.response?.data?.message || err.message}`);
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

  // Build description with dimensions included
  const fullDescription = buildDescription(description, dimensions);

  // 1. Create the product
  const productPayload = {
    name,
    description: fullDescription,
    type: 'standard',
  };

  if (category) {
    // Try to find or create category
    const categoryId = await findOrCreateCategory(category);
    if (categoryId) productPayload.product_type_id = categoryId;
  }

  if (retailPrice) {
    productPayload.price_standard = {
      tax_exclusive: String(retailPrice),
    };
  }

  const product = await lsRequest('POST', '2.0/products', productPayload);
  const productId = product.data.id;

  // 2. Add supplier info
  if (supplierName || vendorItemCode) {
    await addSupplierToProduct(productId, supplierName, vendorItemCode, supplierPrice);
  }

  // 3. Upload primary image to Lightspeed (first image only — rest go to Shopify)
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

async function addSupplierToProduct(productId, supplierName, supplierCode, supplierPrice) {
  // First find the supplier ID
  let supplierId = null;
  if (supplierName) {
    const suppliers = await lsRequest('GET', '2.0/suppliers?name=' + encodeURIComponent(supplierName));
    if (suppliers.data?.length > 0) {
      supplierId = suppliers.data[0].id;
    }
  }

  const payload = {
    supplier_code: supplierCode || '',
    price: supplierPrice ? String(supplierPrice) : '0',
  };

  if (supplierId) payload.supplier_id = supplierId;

  await lsRequest('POST', `2.0/products/${productId}/supplier_products`, payload);
}

async function findOrCreateCategory(categoryName) {
  try {
    const res = await lsRequest('GET', `2.0/product_types?name=${encodeURIComponent(categoryName)}`);
    if (res.data?.length > 0) return res.data[0].id;

    // Create it
    const created = await lsRequest('POST', '2.0/product_types', { name: categoryName });
    return created.data?.id || null;
  } catch {
    return null;
  }
}

async function uploadImageToLightspeed(productId, imageUrl) {
  try {
    const res = await lsRequest('POST', `2.0/products/${productId}/images`, {
      url: imageUrl,
    });
    return res.data?.url || null;
  } catch (err) {
    console.warn('Image upload to Lightspeed failed:', err.message);
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
