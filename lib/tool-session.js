const { createHmac, timingSafeEqual } = require('node:crypto');

const SESSION_COOKIE = 'bgtool_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function sessionSecret(){
  return process.env.TOOL_SESSION_SECRET || process.env.SUPABASE_SECRET_KEY || '';
}

function signSession(expiresAt){
  const secret = sessionSecret();
  if(!secret) throw new Error('Session signing secret is not configured');
  const payload = Buffer.from(JSON.stringify({exp:expiresAt})).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySession(token){
  const secret = sessionSecret();
  if(!secret || typeof token !== 'string') return false;
  const separator = token.lastIndexOf('.');
  if(separator <= 0) return false;
  const payload = token.slice(0, separator);
  const suppliedSignature = Buffer.from(token.slice(separator + 1));
  const expectedSignature = Buffer.from(createHmac('sha256', secret).update(payload).digest('base64url'));
  if(suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isInteger(decoded.exp) && decoded.exp > Math.floor(Date.now() / 1000);
  } catch(_) {
    return false;
  }
}

function readSessionCookie(cookieHeader = ''){
  const prefix = `${SESSION_COOKIE}=`;
  const pair = String(cookieHeader).split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
  if(!pair) return '';
  try { return decodeURIComponent(pair.slice(prefix.length)); } catch(_) { return ''; }
}

module.exports = { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession, readSessionCookie, sessionSecret };
