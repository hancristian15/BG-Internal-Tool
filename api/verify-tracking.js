const dns = require('node:dns').promises;
const net = require('node:net');

function send(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function publicIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function publicAddress(address) {
  const version = net.isIP(address);
  if (version === 4) return publicIpv4(address);
  if (version !== 6) return false;
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized.startsWith('::ffff:') || normalized.startsWith('2001:db8:') || normalized.startsWith('2001:0000:') || normalized.startsWith('2001:10:') || normalized.startsWith('2001:20:') || normalized.startsWith('2002:')) return false;
  const first = parseInt(normalized.split(':')[0], 16);
  return Number.isInteger(first) && first >= 0x2000 && first <= 0x3fff;
}

const dnsCache = new Map();

async function isPublicHttpUrl(value) {
  let url;
  try { url = new URL(value); } catch (_) { return false; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) return false;
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false;

  if (net.isIP(hostname)) return publicAddress(hostname);
  if (!dnsCache.has(hostname)) {
    if (dnsCache.size > 500) dnsCache.clear();
    dnsCache.set(hostname, dns.lookup(hostname, {all:true, verbatim:true}).then(records => records.length > 0 && records.every(record => publicAddress(record.address))).catch(() => false));
  }
  return dnsCache.get(hostname);
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

module.exports = async function verifyTracking(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, {error:'Method not allowed'});
  }

  const value = String(bodyOf(req).url || '').trim();
  if (!value || value.length > 2048) return send(res, 400, {error:'Enter a valid page URL (maximum 2048 characters)'});
  let target;
  try { target = new URL(value); } catch (_) { return send(res, 400, {error:'Enter a valid URL starting with http:// or https://'}); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    return send(res, 400, {error:'Only public http:// or https:// page URLs are supported'});
  }
  if (!await isPublicHttpUrl(target.href)) return send(res, 400, {error:'The page must use a public host and the standard HTTP or HTTPS port'});

  let browser;
  try {
    const [{default:chromium}, {default:puppeteer}] = await Promise.all([
      import('@sparticuz/chromium'),
      import('puppeteer-core'),
    ]);
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: {width:1365, height:900, deviceScaleFactor:1},
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    });
    const page = await browser.newPage();
    await page.setBypassServiceWorker(true);
    page.setDefaultNavigationTimeout(22000);
    await page.setRequestInterception(true);

    let requestCount = 0;
    page.on('request', request => {
      requestCount += 1;
      if (requestCount > 100) return request.abort('blockedbyclient').catch(() => {});
      const requestUrl = request.url();
      if (/^(data|blob|about):/i.test(requestUrl)) return request.continue().catch(() => {});
      isPublicHttpUrl(requestUrl)
        .then(isPublic => isPublic ? request.continue() : request.abort('blockedbyclient'))
        .catch(() => request.abort('blockedbyclient'))
        .catch(() => {});
    });
    page.on('popup', popup => popup.close().catch(() => {}));

    const response = await page.goto(target.href, {waitUntil:'domcontentloaded', timeout:22000});
    if (!response) return send(res, 502, {error:'The page did not return an HTTP response'});
    if (response.status() >= 400) return send(res, 502, {error:`The page returned HTTP ${response.status()}`});
    await page.waitForNetworkIdle({idleTime:800, timeout:6000}).catch(() => {});
    await page.waitForTimeout(1000);

    const result = await page.evaluate(() => {
      const scriptText = Array.from(document.scripts).map(script => `${script.src}\n${script.textContent || ''}`).join('\n');
      const resources = performance.getEntriesByType('resource').map(item => item.name).join('\n');
      const hasCookieReader = /ReadCookie\s*\(\s*(['"])sessid2\1\s*\)/i.test(scriptText);
      const hasTrackingEndpoint = /tracking\.buygoods\.com\/track\//i.test(scriptText) || /tracking\.buygoods\.com\/track\//i.test(resources);
      const trackingFound = hasCookieReader && hasTrackingEndpoint;
      const candidates = Array.from(document.querySelectorAll('a[href],area[href],[data-href],[data-url],[formaction]'))
        .map(element => element.href || element.getAttribute('data-href') || element.getAttribute('data-url') || element.getAttribute('formaction'))
        .filter(Boolean);
      const buyLinks = candidates.map(value => {
        try { return new URL(value, location.href); } catch (_) { return null; }
      }).filter(url => url && (url.hostname === 'buygoods.com' || url.hostname.endsWith('.buygoods.com')) && (/checkout|upsell/i.test(url.pathname) || url.searchParams.has('product_codename')));
      const hasParam = (url, name) => Array.from(url.searchParams.entries()).some(([key, value]) => key.toLowerCase() === name && value.trim() !== '');
      return {
        trackingFound,
        sessid2Found: buyLinks.some(url => hasParam(url, 'sessid2')),
        affIdFound: buyLinks.some(url => hasParam(url, 'aff_id')),
        buyLinkCount: buyLinks.length,
        finalUrl: location.href,
      };
    });

    return send(res, 200, result);
  } catch (error) {
    console.error('Tracking verification failed:', error.message);
    return send(res, 502, {error:'Could not load the page in the verification browser. Check that it is public and try again.'});
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};

module.exports.config = {maxDuration:60};
