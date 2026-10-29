const { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, sessionSecret } = require('../lib/tool-session');

function send(res, status, body){
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json(body);
}

function getBody(req){
  if(req.body && typeof req.body === 'object') return req.body;
  if(typeof req.body === 'string'){
    try { return JSON.parse(req.body); } catch(_) { return {}; }
  }
  return {};
}

function secureRequest(req){
  return req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1';
}

module.exports = function handler(req, res){
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const action = url.searchParams.get('action') || 'login';
  res.setHeader('Cache-Control', 'no-store');

  if(action === 'logout' && req.method === 'POST'){
    const secure = secureRequest(req) ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
    return send(res, 200, {authenticated:false});
  }
  if(action !== 'login' || req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return send(res, 405, {error:'Unsupported authentication action'});
  }

  const expectedPassword = process.env.TOOL_LOGIN_PASSWORD;
  if(!expectedPassword || !sessionSecret()) return send(res, 503, {error:'Tool login is not configured on this deployment'});
  const suppliedPassword = String(getBody(req).password || '');
  const expected = Buffer.from(expectedPassword);
  const supplied = Buffer.from(suppliedPassword);
  const passwordMatches = supplied.length === expected.length && require('node:crypto').timingSafeEqual(supplied, expected);
  if(!passwordMatches) return send(res, 401, {error:'Incorrect password'});

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = signSession(expiresAt);
  const secure = secureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
  return send(res, 200, {authenticated:true, expiresAt});
};
