const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function send(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'Method not allowed' });
  }

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return send(res, 503, { error: 'Click tracking is not configured' });
  }

  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
  };
  const tableUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/generate_clicks`;

  try {
    if (req.method === 'POST') {
      const response = await fetch(tableUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({}),
      });
      if (!response.ok) return send(res, 502, { error: 'Could not store click' });
      return send(res, 201, { stored: true });
    }

    const response = await fetch(`${tableUrl}?select=id`, {
      method: 'GET',
      headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
    });
    if (!response.ok) return send(res, 502, { error: 'Could not read click total' });

    const contentRange = response.headers.get('content-range') || '';
    const totalText = contentRange.split('/')[1];
    const total = totalText && totalText !== '*' ? Number(totalText) : null;
    if (!Number.isSafeInteger(total) || total < 0) {
      return send(res, 502, { error: 'Supabase did not return a valid click total' });
    }
    return send(res, 200, { total });
  } catch (error) {
    console.error('Supabase click tracking request failed:', error.message);
    return send(res, 502, { error: 'Click tracking request failed' });
  }
};
