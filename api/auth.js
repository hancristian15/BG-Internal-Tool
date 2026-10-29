const { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, sessionSecret, readSessionCookie, verifySession } = require('../lib/tool-session');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

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

module.exports = async function handler(req, res){
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const action = url.searchParams.get('action') || 'login';
  res.setHeader('Cache-Control', 'no-store');

  if(action === 'logout' && req.method === 'POST'){
    const secure = secureRequest(req) ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
    return send(res, 200, {authenticated:false});
  }
  if(action === 'check' && req.method === 'GET'){
    const authenticated = verifySession(readSessionCookie(req.headers.cookie || ''));
    return send(res, 200, {authenticated});
  }
  if(action !== 'login' || req.method !== 'POST'){
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, {error:'Unsupported authentication action'});
  }

  if(!SUPABASE_URL || !SUPABASE_SECRET_KEY || !sessionSecret()) return send(res, 503, {error:'Supabase login is not configured'});
  const suppliedPassword = String(getBody(req).password || '');
  if(!suppliedPassword || suppliedPassword.length > 256) return send(res, 401, {error:'Incorrect password'});
  let passwordMatches = false;
  try {
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/verify_tool_password`, {
      method:'POST',
      headers:{apikey:SUPABASE_SECRET_KEY, Authorization:`Bearer ${SUPABASE_SECRET_KEY}`, 'Content-Type':'application/json'},
      body:JSON.stringify({supplied_password:suppliedPassword}),
    });
    if(!response.ok){
      console.error('Supabase password verification failed:', response.status, (await response.text()).slice(0, 300));
      return send(res, 503, {error:'Could not verify the password in Supabase. Run the tool access SQL migration.'});
    }
    passwordMatches = (await response.json()) === true;
  } catch(error) {
    console.error('Supabase password verification request failed:', error.message);
    return send(res, 502, {error:'Could not reach Supabase to verify the password'});
  }
  if(!passwordMatches) return send(res, 401, {error:'Incorrect password'});

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = signSession(expiresAt);
  const secure = secureRequest(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
  return send(res, 200, {authenticated:true, expiresAt});
};
