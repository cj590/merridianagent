import axios from 'axios';

let cachedToken = null;
let tokenExpiry = null;

export async function getLightspeedToken() {
  // Use personal access token directly if provided (simpler, no OAuth needed)
  if (process.env.LIGHTSPEED_ACCESS_TOKEN) {
    return process.env.LIGHTSPEED_ACCESS_TOKEN;
  }

  // Fall back to OAuth client credentials flow
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 300000) {
    return cachedToken;
  }

  const { LIGHTSPEED_CLIENT_ID, LIGHTSPEED_CLIENT_SECRET } = process.env;

  try {
    const response = await axios.post(
      'https://id.lightspeed.app/oauth2/token',
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: LIGHTSPEED_CLIENT_ID,
        client_secret: LIGHTSPEED_CLIENT_SECRET,
        scope: 'employee:products:write employee:products:read employee:inventory:write employee:inventory:read',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + response.data.expires_in * 1000;
    return cachedToken;
  } catch (err) {
    console.error('Lightspeed token error:', err.response?.data || err.message);
    throw new Error('Failed to authenticate with Lightspeed');
  }
}

export function lightspeedApi() {
  const prefix = process.env.LIGHTSPEED_STORE_PREFIX;
  const baseURL = `https://${prefix}.retail.lightspeed.app/api`;
  return { baseURL };
}
