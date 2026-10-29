const { readSessionCookie, verifySession } = require('./tool-session');

function requireToolSession(req, res) {
  if (verifySession(readSessionCookie(req.headers.cookie || ''))) return true;
  res.status(401).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: 'Please log in to use the tool' }));
  return false;
}

module.exports = { requireToolSession };
