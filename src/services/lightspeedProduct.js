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

  // 1. Find product type
  let productTypeId = await findProductType(category).catch(() => null);

  // 2. Create product
  const productPayload = { name, description: fullDescription, type: 'standard' };
  if (productTypeId) productPayload.product_type_id = productTypeId;
  if (retailPrice) productPayload.price_standard = { tax_exclusive: String(retailPrice) };

  const product = await lsRequest('POST', '2.0/products', productPayload);
  const productId = Array.isArray(product.data) ? product.data[0] : product.data?.id;

  if (!productId) throw new Error('No product ID returned: ' + JSON.stringify(product));
  console.log(`[LS] Product created: ${productId}`);

  // 3. Link supplier
  await linkSupplier(productId, supplierName, vendorItemCode, supplierPrice).catch(err => {
    console.warn('[LS] Supplier link failed (non-fatal):', err.message);
  });

  // 4. Upload image as multipart/form-data
  if (images?.length > 0) {
    await uploadImageMultipart(productId, images[0]).catch(err => {
      console.warn('[LS] Image upload failed (non-fatal):', err.message);
    });
  }

  return { lightspeedProductId: productId, product: product.data };
}

async function findProductType(categoryName) {
  if (!categoryName) return null;
  const res = await lsRequest('GET', '2.0/product_types?page_size=100');
  const types = res.data || [];
  const match = types.find(t => t.name?.toLowerCase() === categoryName.toLowerCase());
  if (match) return match.id;
  try {
    const created = await lsRequest('POST', '2.0/product_types', { name: categoryName });
    return Array.isArray(created.data) ? created.data[0] : created.data?.id;
  } catch { return null; }
}

async function linkSupplier(productId, supplierName, supplierCode, supplierPrice) {
  if (!supplierName) return;
  const res = await lsRequest('GET', '2.0/suppliers?page_size=100');
  const suppliers = res.data || [];
  const match = suppliers.find(s => s.name?.toLowerCase() === supplierName?.toLowerCase());
  if (!match) { console.warn(`[LS] Supplier "${supplierName}" not found`); return; }

  await lsRequest('POST', `2.0/supplier_products`, {
    product_id: productId,
    supplier_id: match.id,
    supplier_code: supplierCode || '',
    price: supplierPrice ? String(supplierPrice) : '0',
  });
  console.log(`[LS] Supplier linked: ${match.id}`);
}

async function uploadImageMultipart(productId, imageUrl) {
  // Download image
  const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const imageBuffer = Buffer.from(imgResponse.data);
  const contentType = imgResponse.headers['content-type'] || 'image/jpeg';
  const ext = contentType.split('/')[1] || 'jpg';

  // Build multipart form
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
