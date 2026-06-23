import axios from 'axios';

async function shopifyRequest(method, endpoint, data = null) {
  const { SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = process.env;

  // Use client secret as access token (Shopify new auth flow)
  const token = SHOPIFY_CLIENT_SECRET;

  const config = {
    method,
    url: `https://${SHOPIFY_STORE}/admin/api/2024-10/${endpoint}`,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
  };

  if (data) config.data = data;

  try {
    const response = await axios(config);
    return response.data;
  } catch (err) {
    console.error('Shopify API error:', err.response?.data || err.message);
    throw new Error(`Shopify API error: ${JSON.stringify(err.response?.data) || err.message}`);
  }
}

export async function createShopifyProduct(productData, lightspeedProductId) {
  const {
    name,
    description,
    vendorItemCode,
    category,
    dimensions,
    images,
    retailPrice,
    vendor,
  } = productData;

  const fullDescription = buildHtmlDescription(description, dimensions);

  // Build Shopify product payload
  const payload = {
    product: {
      title: name,
      body_html: fullDescription,
      vendor: vendor || 'Unknown',
      product_type: category || 'Furniture',
      tags: [vendorItemCode, vendor, category].filter(Boolean).join(', '),
      variants: [
        {
          price: retailPrice ? String(retailPrice) : '0.00',
          sku: vendorItemCode || '',
          inventory_management: 'shopify',
        },
      ],
      images: images?.map((src) => ({ src })) || [],
    },
  };

  const result = await shopifyRequest('POST', 'products.json', payload);
  return result.product;
}

export async function pushImagesToShopifyProduct(shopifyProductId, imageUrls) {
  const results = [];

  for (const src of imageUrls) {
    try {
      const res = await shopifyRequest('POST', `products/${shopifyProductId}/images.json`, {
        image: { src },
      });
      results.push({ src, success: true, id: res.image?.id });
    } catch (err) {
      results.push({ src, success: false, error: err.message });
    }
  }

  return results;
}

function buildHtmlDescription(description, dimensions) {
  let html = '';

  if (description) {
    html += `<p>${description}</p>`;
  }

  if (dimensions) {
    const rows = [];
    if (dimensions.outside) rows.push(['Overall', dimensions.outside]);
    if (dimensions.inside) rows.push(['Interior', dimensions.inside]);
    if (dimensions.seatHeight) rows.push(['Seat Height', dimensions.seatHeight]);
    if (dimensions.armHeight) rows.push(['Arm Height', dimensions.armHeight]);

    if (rows.length) {
      html += '<table><tbody>';
      rows.forEach(([label, value]) => {
        html += `<tr><td><strong>${label}</strong></td><td>${value}</td></tr>`;
      });
      html += '</tbody></table>';
    }
  }

  return html;
}
