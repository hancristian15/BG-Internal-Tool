const APP_ORIGINS = new Set([
  'https://bgtool-git-dev-buy-goods-internal.vercel.app',
  'https://bgtool-rho.vercel.app',
]);
const JOB_PREFIX = 'trackingJob:';
let webRequestListenersRegistered = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'verify-request') {
    handleVerifyRequest(message, sender).then(sendResponse).catch(error => sendResponse({
      status: 'error',
      message: error.message || 'The extension could not start the check.',
    }));
    return true;
  }

});

async function handleVerifyRequest(message, sender) {
  const appUrl = sender.url ? new URL(sender.url) : null;
  if (!sender.tab?.id || !appUrl || !APP_ORIGINS.has(appUrl.origin)) {
    return {status: 'error', message: 'This extension only accepts checks from the BuyGoods tool.'};
  }

  const target = parsePublicTarget(message.url);
  if (!target) return {status: 'error', message: 'Use a public HTTP or HTTPS URL on port 80 or 443.'};
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(message.requestId || '')) {
    return {status: 'error', message: 'The verification request ID is invalid.'};
  }
  const hasHostAccess = await chrome.permissions.contains({origins: [`${target.origin}/*`]});
  if (!hasHostAccess) {
    return {status: 'error', message: `The extension does not have access to ${target.host}. Open its Details in the extensions page, set Site access to On all sites, then reload the extension.`};
  }

  const job = {
    requestId: message.requestId,
    url: target.href,
    appTabId: sender.tab.id,
    createdAt: Date.now(),
  };
  await startVerification(job);
  return {status: 'checking', host: target.host};
}

async function startVerification(pending) {
  await ensureWebRequestListeners();
  const tab = await chrome.tabs.create({url: 'about:blank', active: false});
  const job = {
    ...pending,
    targetTabId: tab.id,
    started: false,
    httpStatus: null,
    cfRay: null,
    networkError: null,
    redirectUrl: null,
  };
  await chrome.storage.session.set({[`${JOB_PREFIX}${tab.id}`]: job});
  await reportToTool(job.appTabId, job.requestId, 'checking', 'Checking the page in a background tab.');
  chrome.alarms.create(`tracking-timeout:${tab.id}`, {delayInMinutes: 1});
  await chrome.tabs.update(tab.id, {url: job.url});
}

async function ensureWebRequestListeners() {
  if (webRequestListenersRegistered) return true;
  chrome.webRequest.onHeadersReceived.addListener(details => {
    if (details.type !== 'main_frame') return;
    updateJob(details.tabId, job => ({
      ...job,
      httpStatus: details.statusCode,
      cfRay: (details.responseHeaders || []).find(header => header.name.toLowerCase() === 'cf-ray')?.value || job.cfRay,
    }));
  }, {urls: ['http://*/*', 'https://*/*']}, ['responseHeaders']);

  chrome.webRequest.onBeforeRedirect.addListener(details => {
    if (details.type !== 'main_frame') return;
    updateJob(details.tabId, job => ({...job, redirectUrl: details.redirectUrl}));
  }, {urls: ['http://*/*', 'https://*/*']});

  chrome.webRequest.onErrorOccurred.addListener(details => {
    if (details.type !== 'main_frame') return;
    updateJob(details.tabId, job => ({...job, networkError: details.error}));
  }, {urls: ['http://*/*', 'https://*/*']});
  webRequestListenersRegistered = true;
  return true;
}

chrome.runtime.onStartup.addListener(() => ensureWebRequestListeners().catch(() => {}));
ensureWebRequestListeners().catch(() => {});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') finishPageLoad(tabId).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(`${JOB_PREFIX}${tabId}`).catch(() => {});
  chrome.alarms.clear(`tracking-timeout:${tabId}`).catch(() => {});
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (!alarm.name.startsWith('tracking-timeout:')) return;
  const tabId = Number(alarm.name.slice('tracking-timeout:'.length));
  finishWithError(tabId, 'The page did not finish loading within one minute.').catch(() => {});
});

async function finishPageLoad(tabId) {
  const key = `${JOB_PREFIX}${tabId}`;
  const {[key]: job} = await chrome.storage.session.get(key);
  if (!job || job.started) return;
  await chrome.storage.session.set({[key]: {...job, started: true}});

  await new Promise(resolve => setTimeout(resolve, 1200));
  const {[key]: currentJob} = await chrome.storage.session.get(key);
  if (!currentJob) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const finalUrl = tab?.url || currentJob.redirectUrl || currentJob.url;
  if (!isPublicTarget(finalUrl)) {
    return finishWithError(tabId, 'The page redirected to a browser-internal or private address.');
  }

  if (currentJob.httpStatus >= 400) {
    return finishWithResult(tabId, currentJob, {
      blocked: true,
      statusCode: currentJob.httpStatus,
      cfRay: currentJob.cfRay,
      finalUrl,
    });
  }

  if (currentJob.networkError) {
    return finishWithError(tabId, `The browser blocked navigation to ${new URL(finalUrl).host} before the page loaded (${currentJob.networkError}). Check browser privacy/ad-blocking extensions or local network filtering for this site.`);
  }

  try {
    const [{result}] = await chrome.scripting.executeScript({target: {tabId}, func: collectPageData});
    await finishWithResult(tabId, currentJob, {...result, finalUrl});
  } catch (error) {
    const host = new URL(finalUrl).host;
    const hasHostAccess = await chrome.permissions.contains({origins: [`${new URL(finalUrl).origin}/*`]}).catch(() => false);
    if (!hasHostAccess) {
      await finishWithError(tabId, `The extension cannot inspect ${host} because its site access is off. In the extensions page, open BuyGoods Tracking Verifier → Details → Site access → On all sites, then reload it.`);
    } else if (/blocked/i.test(error.message || '')) {
      await finishWithError(tabId, `Chrome blocked script inspection on ${host} (${error.message}). Check that the extension has Site access set to On all sites and that no ad-blocker or privacy extension is blocking this page.`);
    } else {
      await finishWithError(tabId, `The browser could not inspect ${host}: ${error.message || 'unknown browser restriction'}`);
    }
  }
}

async function collectPageData() {
  function scan() {
    const scriptText = Array.from(document.scripts).map(script => `${script.src}\n${script.textContent || ''}`).join('\n');
    const resources = performance.getEntriesByType('resource').map(item => item.name).join('\n');
    const hasCookieReader = /ReadCookie\s*\(\s*(['"])sessid2\1\s*\)/i.test(scriptText);
    const hasTrackingEndpoint = /tracking\.buygoods\.com\/track\//i.test(scriptText) || /tracking\.buygoods\.com\/track\//i.test(resources);
    const candidates = Array.from(document.querySelectorAll('a[href],area[href],[data-href],[data-url],[formaction]'))
      .flatMap(element => ['href', 'data-href', 'data-url', 'formaction'].map(name => element.getAttribute(name)).filter(Boolean));
    const buyLinks = candidates.map(value => { try { return new URL(value, location.href); } catch (_) { return null; } })
      .filter(url => url && (url.hostname === 'buygoods.com' || url.hostname.endsWith('.buygoods.com')) && (/checkout|upsell/i.test(url.pathname) || url.searchParams.has('product_codename')));
    const hasParam = (url, name) => Array.from(url.searchParams.entries()).some(([key, value]) => key.toLowerCase() === name && value.trim() !== '');
    return {
      trackingFound: hasCookieReader && hasTrackingEndpoint,
      sessid2Found: buyLinks.some(url => hasParam(url, 'sessid2')),
      affIdFound: buyLinks.some(url => hasParam(url, 'aff_id')),
      buyLinkCount: buyLinks.length,
      ready: hasCookieReader && hasTrackingEndpoint && buyLinks.length > 0,
    };
  }

  let result = scan();
  const deadline = Date.now() + 5000;
  while (!result.ready && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 350));
    result = scan();
  }
  delete result.ready;
  return result;
}

async function finishWithResult(tabId, job, result) {
  await reportToTool(job.appTabId, job.requestId, 'result', '', result);
  await removeJobTab(tabId);
}

async function finishWithError(tabId, message) {
  const key = `${JOB_PREFIX}${tabId}`;
  const {[key]: job} = await chrome.storage.session.get(key);
  if (!job) return removeJobTab(tabId);
  await reportToTool(job.appTabId, job.requestId, 'error', message);
  await removeJobTab(tabId);
}

async function reportToTool(tabId, requestId, status, message = '', result = null) {
  if (!tabId) return;
  await chrome.tabs.sendMessage(tabId, {
    type: 'tool-update', requestId, status, message, result,
  }).catch(() => {});
}

async function removeJobTab(tabId) {
  await chrome.storage.session.remove(`${JOB_PREFIX}${tabId}`);
  await chrome.alarms.clear(`tracking-timeout:${tabId}`);
  await chrome.tabs.remove(tabId).catch(() => {});
}

async function updateJob(tabId, updater) {
  const key = `${JOB_PREFIX}${tabId}`;
  const {[key]: job} = await chrome.storage.session.get(key);
  if (job) await chrome.storage.session.set({[key]: updater(job)});
}

function parsePublicTarget(value) {
  try {
    const url = new URL(value);
    if (!isPublicTarget(url.href)) return null;
    return url;
  } catch (_) {
    return null;
  }
}

function isPublicTarget(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    if (host.includes(':')) return !host.startsWith('::') && !/^f[cd]/i.test(host) && !/^fe[89ab]/i.test(host) && !host.startsWith('2001:db8:');
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      const [a, b] = host.split('.').map(Number);
      if ([a, b].some(part => part < 0 || part > 255)) return false;
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}
