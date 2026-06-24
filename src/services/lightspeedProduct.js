import axios from 'axios';

function getShopifyConfig() {
  // Strip any surrounding quotes Railway may add
  const store = (process.env.SHOPIFY_STORE || '').replace(/^["']|["']$/g, '').trim();
  const token = (process.env.SHOPIFY_ACCESS_TOKEN || '').replace(/^["']|["']$/g, '').trim();
  console.log(`[Shopify] Store: ${store} | Token prefix: ${token.slice(0, 15)}`);
  return { store, token };
}

async function shopifyRequest(method, endpoint, data = null) {
  const { store, token } = getShopifyConfig();

  const config = {
    method,
    url: `https://${store}/admin/api/2024-10/${endpoint}`,
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
      images: images?.slice(0, 1).map((src) => ({ src })) || [],
    },
  };

  console.log(`[Shopify] Creating product: ${name}`);
  const result = await shopifyRequest('POST', 'products.json', payload);
  console.log(`[Shopify] Product created: ${result.product?.id}`);
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
      console.log(`[Shopify] Image added: ${src}`);
    } catch (err) {
      results.push({ src, success: false, error: err.message });
      console.warn(`[Shopify] Image failed: ${src}`, err.message);
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
