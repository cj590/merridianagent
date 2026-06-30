import axios from 'axios';
import FormData from 'form-data';
import { getLightspeedToken } from './lightspeedAuth.js';

async function lsRequest(method, endpoint, data = null, isFormData = false) {
  const token = (await getLightspeedToken()).replace(/^["']|["']$/g, '').trim();
  const prefix = (process.env.LIGHTSPEED_STORE_PREFIX || '').replace(/^["']|["']$/g, '').trim();
  const baseURL = `https://${prefix}.retail.lightspeed.app/api`;
  const fullUrl = `${baseURL}/${endpoint}`;

  console.log(`[LS] ${method} ${fullUrl}`);

  const headers = { Authorization: `Bearer ${token}` };
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (isFormData && data) Object.assign(headers, data.getHeaders());

  const config = { method, url: fullUrl, headers };
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
  const { name, description, vendorItemCode, category, dimensions, supplierName, supplierPrice, retailPrice, images } = productData;

  const fullDescription = buildDescription(description, dimensions);

  // 1. Find product type (optional — skip if not found or error)
  let productTypeId = null;
  try {
    productTypeId = await findProductType(category);
  } catch (err) {
    console.warn('[LS] Product type lookup failed (non-fatal):', err.message);
  }

  // 2. Create product
  const productPayload = { name, description: fullDescription, type: 'standard' };
  if (productTypeId) productPayload.product_type_id = productTypeId;
  if (retailPrice) productPayload.price_excluding_tax = parseFloat(retailPrice);

  let product;
  try {
    product = await lsRequest('POST', '2.0/products', productPayload);
  } catch (err) {
    if (err.message.includes('leaf category') && productPayload.product_type_id) {
      // Retry without product type
      console.warn('[LS] Retrying without product_type_id due to leaf category error');
      delete productPayload.product_type_id;
      product = await lsRequest('POST', '2.0/products', productPayload);
    } else {
      throw err;
    }
  }
  const productId = Array.isArray(product.data) ? product.data[0] : product.data?.id;

  if (!productId) throw new Error('No product ID returned: ' + JSON.stringify(product));
  console.log(`[LS] Product created: ${productId}`);

  // 3. Link supplier via API 2.1 PUT
  const updatePayload = {};
  if (supplierName) {
    const supplierId = await findSupplierId(supplierName);
    if (supplierId) {
      updatePayload.common = {
        product_suppliers: [{
          supplier_id: supplierId,
          code: vendorItemCode || '',
          price: supplierPrice ? supplierPrice : 0,
        }]
      };
    }
  }

  if (Object.keys(updatePayload).length > 0) {
    try {
      await lsRequest('PUT', `2.1/products/${productId}`, updatePayload);
      console.log(`[LS] Supplier linked`);
    } catch (err) {
      console.warn('[LS] Supplier link failed (non-fatal):', err.message);
    }
  }

  // 4. Tag with merridian-agent
  const MERRIDIAN_AGENT_TAG_ID = 'b7a7b652-e0f3-4ca4-b0b9-e499f83671d2';
  try {
    await lsRequest('PUT', `2.1/products/${productId}`, {
      common: { tags: [MERRIDIAN_AGENT_TAG_ID] }
    });
    console.log(`[LS] Tagged with merridian-agent`);
  } catch (err) {
    console.warn('[LS] Tagging failed (non-fatal):', err.message);
  }

  // 5. Upload image
  if (images?.length > 0) {
    await uploadImageMultipart(productId, images[0]).catch(err => {
      console.warn('[LS] Image upload failed (non-fatal):', err.message);
    });
  }

  return { lightspeedProductId: productId, product: product.data };
}

async function findProductType(categoryName) {
  if (!categoryName) return null;
  // Increase page size to get all types
  const res = await lsRequest('GET', '2.0/product_types?page_size=250');
  const types = res.data || [];
  const match = types.find(t => t.name?.toLowerCase() === categoryName.toLowerCase());
  if (match) {
    console.log(`[LS] Found product type: ${match.id} (${match.name})`);
    return match.id;
  }
  try {
    const created = await lsRequest('POST', '2.0/product_types', { name: categoryName });
    return Array.isArray(created.data) ? created.data[0] : created.data?.id;
  } catch (err) {
    // Extract existing ID from 422 error
    if (err.message.includes('existing_id')) {
      const idMatch = err.message.match(/"existing_id":"([^"]+)"/);
      if (idMatch) {
        console.log(`[LS] Using existing product type: ${idMatch[1]}`);
        return idMatch[1];
      }
    }
    return null;
  }
}

async function findSupplierId(supplierName) {
  if (!supplierName) return null;
  try {
    const res = await lsRequest('GET', '2.0/suppliers?page_size=200');
    const suppliers = res.data || [];
    const searchName = supplierName.toLowerCase();
    const match = suppliers.find(s => s.name?.toLowerCase() === searchName)
      || suppliers.find(s => s.name?.toLowerCase().includes(searchName))
      || suppliers.find(s => searchName.split(' ').some(word => word.length > 3 && s.name?.toLowerCase().includes(word)));
    if (match) {
      console.log(`[LS] Found supplier: ${match.name}`);
      return match.id;
    }
    console.warn(`[LS] Supplier "${supplierName}" not found`);
    return null;
  } catch (err) {
    console.warn('[LS] Supplier lookup failed:', err.message);
    return null;
  }
}

async function uploadImageMultipart(productId, imageUrl) {
  const imgResponse = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Referer': new URL(imageUrl).origin,
    },
    timeout: 15000,
  });
  const imageBuffer = Buffer.from(imgResponse.data);
  const contentType = imgResponse.headers['content-type'] || 'image/jpeg';
  const ext = contentType.split('/')[1] || 'jpg';

  const form = new FormData();
  form.append('image', imageBuffer, { filename: `product.${ext}`, contentType });

  await lsRequest('POST', `2.0/products/${productId}/actions/image_upload`, form, true);
  console.log(`[LS] Image uploaded for product ${productId}`);
}

function buildDescription(description, dimensions) {
  const parts = [];
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
