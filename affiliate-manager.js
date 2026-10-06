(() => {
  const builderView = document.getElementById('builderView');
  const affiliateView = document.getElementById('affiliateManagerView');
  const builderNav = document.getElementById('builderNav');
  const affiliateNav = document.getElementById('affiliateManagerNav');
  const form = document.getElementById('trackingVerifyForm');
  const button = document.getElementById('verifyTrackingButton');
  const localButton = document.getElementById('verifyTrackingLocalButton');
  const localStatus = document.getElementById('trackingLocalStatus');
  const status = document.getElementById('trackingVerifyStatus');
  const result = document.getElementById('trackingVerifyResult');
  const headline = document.getElementById('trackingVerifyHeadline');
  const checks = document.getElementById('trackingVerifyChecks');
  const checkedUrl = document.getElementById('trackingCheckedUrl');
  const extensionChannel = 'bgtool-tracking-extension-v1';
  let activeLocalRequestId = null;
  let localStartTimeout = null;

  localButton.addEventListener('click', () => {
    const value = document.getElementById('trackingPageUrl').value.trim();
    let target;
    try { target = new URL(value); } catch (_) {
      localStatus.textContent = 'Enter a valid page URL first.';
      return;
    }
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
      localStatus.textContent = 'Use a public http:// or https:// page URL.';
      return;
    }
    if (target.port && target.port !== (target.protocol === 'https:' ? '443' : '80')) {
      localStatus.textContent = 'Use a page on the standard HTTP or HTTPS port.';
      return;
    }

    result.hidden = true;
    activeLocalRequestId = crypto.randomUUID();
    window.clearTimeout(localStartTimeout);
    localButton.disabled = true;
    localStatus.textContent = 'Starting the background check…';
    window.postMessage({
      channel: extensionChannel,
      type: 'verify-request',
      requestId: activeLocalRequestId,
      url: target.href,
    }, window.location.origin);

    const expectedRequestId = activeLocalRequestId;
    localStartTimeout = window.setTimeout(() => {
      if (activeLocalRequestId !== expectedRequestId) return;
      localButton.disabled = false;
      activeLocalRequestId = null;
      localStartTimeout = null;
      localStatus.textContent = 'BuyGoods Verifier is not responding. Load the repository’s browser-extension folder in chrome://extensions or edge://extensions, then try again.';
    }, 1200);
  });

  window.addEventListener('message', event => {
    const message = event.data;
    if (event.source !== window || event.origin !== window.location.origin || message?.channel !== extensionChannel) return;
    if (!activeLocalRequestId || message.requestId !== activeLocalRequestId) return;

    if (message.type === 'status') {
      window.clearTimeout(localStartTimeout);
      localStartTimeout = null;
      if (message.status === 'permission-required') {
        localStatus.textContent = message.message || 'The extension does not have permission to inspect this site. Reload the extension and approve its requested site access.';
      } else if (message.status === 'checking') {
        localStatus.textContent = 'Checking in a background tab. This page stays active…';
      } else if (message.status === 'error') {
        localStatus.textContent = message.message || 'The background check could not start.';
        localButton.disabled = false;
        activeLocalRequestId = null;
      }
      return;
    }

    if (message.type !== 'result') return;
    window.clearTimeout(localStartTimeout);
    localStartTimeout = null;
    const data = message.result;
    if (data?.blocked) {
      const ray = data.cfRay ? ` Cloudflare Ray ID: ${data.cfRay}. Search it in Cloudflare Analytics → Events.` : ' No Cloudflare Ray ID was returned; check the origin or other CDN logs as well.';
      localStatus.textContent = `The browser received HTTP ${data.statusCode || 'error'}.${ray}`;
      status.textContent = 'The destination denied the background browser request.';
    } else if (data && typeof data.trackingFound === 'boolean' && typeof data.sessid2Found === 'boolean' && typeof data.affIdFound === 'boolean' && typeof data.finalUrl === 'string') {
      showResult(data);
      localStatus.textContent = 'Checked in a background tab. This page stayed active.';
      status.textContent = `Checked in your browser. Found ${Number(data.buyLinkCount) || 0} BuyGoods buy link${Number(data.buyLinkCount) === 1 ? '' : 's'}.`;
    } else {
      localStatus.textContent = 'The background check returned an incomplete result.';
    }
    localButton.disabled = false;
    activeLocalRequestId = null;
  });

  function switchView(showAffiliateManager) {
    builderView.hidden = showAffiliateManager;
    affiliateView.hidden = !showAffiliateManager;
    document.body.classList.toggle('affiliate-theme', showAffiliateManager);
    builderNav.setAttribute('aria-pressed', String(!showAffiliateManager));
    affiliateNav.setAttribute('aria-pressed', String(showAffiliateManager));
  }

  builderNav.addEventListener('click', () => switchView(false));
  affiliateNav.addEventListener('click', () => switchView(true));

  function addCheck(label, passed) {
    const row = document.createElement('div');
    row.className = `affiliate-check-row ${passed ? 'good' : 'bad'}`;
    const icon = document.createElement('span');
    icon.className = 'affiliate-check-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = passed ? '✓' : '✕';
    const text = document.createElement('span');
    text.textContent = label;
    row.append(icon, text);
    checks.append(row);
  }

  function showResult(data) {
    let message;
    if (!data.trackingFound) message = 'Tracking is missing';
    else if (!data.sessid2Found) message = "Tracking it's not working";
    else if (!data.affIdFound) message = "Tracking it's working but aff_id is missing or incorrect";
    else message = 'All good';

    headline.textContent = message;
    headline.className = `affiliate-result-title ${message === 'All good' ? 'good' : 'bad'}`;
    checks.replaceChildren();
    addCheck("BuyGoods tracking code with ReadCookie('sessid2')", data.trackingFound);
    addCheck('sessid2 present in a BuyGoods buy link', data.sessid2Found);
    addCheck('aff_id present in a BuyGoods buy link', data.affIdFound);
    checkedUrl.textContent = `Page checked: ${data.finalUrl || data.url}`;
    result.hidden = false;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const url = document.getElementById('trackingPageUrl').value.trim();
    result.hidden = true;
    status.textContent = 'Opening page and waiting for its scripts…';
    button.disabled = true;
    button.textContent = 'Checking…';
    try {
      const response = await fetch('/api/verify-tracking', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({url}),
      });
      const data = await response.json();
      if (!response.ok) {
        const reason = data.error || `Request failed (${response.status})`;
        const denied = response.status === 502 && data.statusCode === 403;
        const ray = data.cfRay
          ? ` Cloudflare Ray ID: ${data.cfRay}.`
          : ' No Cloudflare Ray ID was returned; search Cloudflare Events by host, path, and request time, then check the origin or other CDN if no event matches.';
        throw new Error(denied ? `${reason}${ray} Use “Verify without leaving this page” below.` : reason);
      }
      showResult(data);
      status.textContent = data.buyLinkCount
        ? `Page loaded. Found ${data.buyLinkCount} BuyGoods buy link${data.buyLinkCount === 1 ? '' : 's'}.`
        : 'Page loaded, but no BuyGoods buy links were found.';
    } catch (error) {
      status.textContent = `Could not verify tracking: ${error.message}`;
    } finally {
      button.disabled = false;
      button.textContent = 'Verify Tracking';
    }
  });

  const cleanLinksButton = document.getElementById('cleanBuyLinksButton');
  const cleanLinksInput = document.getElementById('buyLinksInput');
  const cleanLinksOutput = document.getElementById('buyLinksOutput');
  const cleanLinksWrap = document.getElementById('cleanBuyLinksOutputWrap');
  const cleanLinksStatus = document.getElementById('cleanBuyLinksStatus');
  cleanLinksButton.addEventListener('click', () => {
    const raw = cleanLinksInput.value.trim();
    cleanLinksWrap.hidden = true;
    if (!raw) {
      cleanLinksStatus.textContent = 'Paste at least one BuyGoods link.';
      return;
    }

    const candidates = raw.match(/https?:\/\/[^\s<>"']+/gi) || raw.split(/[\r\n]+/).map(line => line.trim()).filter(Boolean);
    const cleaned = [];
    const errors = [];
    candidates.forEach((candidate, index) => {
      const value = candidate.replace(/[),.;\]]+$/g, '');
      try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        if (!['buygoods.com', 'www.buygoods.com'].includes(host) || !/^\/secure\/(checkout\.html|upsell\/?)/i.test(url.pathname)) {
          throw new Error('not a BuyGoods checkout URL');
        }
        const source = url.searchParams;
        const accountId = source.get('account_id');
        const codename = source.get('product_codename');
        if (!accountId || !codename) throw new Error('account_id or product_codename is missing');
        const params = new URLSearchParams();
        params.set('account_id', accountId);
        params.set('product_codename', codename);
        if (source.get('lang')) params.set('lang', source.get('lang'));
        if (source.get('redirect')) params.set('redirect', source.get('redirect'));
        url.search = params.toString();
        url.hash = '';
        cleaned.push(url.toString());
      } catch (error) {
        errors.push(`Link ${index + 1}: ${error.message}`);
      }
    });

    if (!cleaned.length) {
      cleanLinksStatus.textContent = errors[0] || 'No valid BuyGoods checkout links found.';
      return;
    }
    cleanLinksOutput.value = cleaned.join('\n');
    cleanLinksWrap.hidden = false;
    cleanLinksStatus.textContent = errors.length
      ? `Cleaned ${cleaned.length} link(s); skipped ${errors.length} invalid link(s). ${errors[0]}`
      : `Cleaned ${cleaned.length} link(s).`;
  });

  document.getElementById('copyBuyLinksButton').addEventListener('click', async () => {
    await copyText(cleanLinksOutput.value, cleanLinksStatus, 'Buy links copied.');
  });

  const addAffIdButton = document.getElementById('addAffIdButton');
  const affIdOutput = document.getElementById('affIdOutput');
  const affIdOutputWrap = document.getElementById('affIdOutputWrap');
  const affIdStatus = document.getElementById('affIdStatus');
  addAffIdButton.addEventListener('click', () => {
    const rawUrl = document.getElementById('affIdUrl').value.trim();
    const value = document.getElementById('affIdValue').value.trim();
    affIdOutputWrap.hidden = true;
    if (!rawUrl || !value) {
      affIdStatus.textContent = 'Enter both a URL and an aff_id value.';
      return;
    }
    try {
      const url = new URL(rawUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS URL.');
      url.searchParams.set('aff_id', value);
      affIdOutput.value = url.toString();
      affIdOutputWrap.hidden = false;
      affIdStatus.textContent = 'Affiliate ID added.';
    } catch (error) {
      affIdStatus.textContent = error.message || 'Enter a valid URL.';
    }
  });
  document.getElementById('copyAffIdButton').addEventListener('click', async () => {
    await copyText(affIdOutput.value, affIdStatus, 'URL copied.');
  });

  async function copyText(value, statusElement, successMessage) {
    try {
      await navigator.clipboard.writeText(value);
      statusElement.textContent = successMessage;
    } catch (_) {
      statusElement.textContent = 'Copy was blocked by the browser. Select the output and copy it manually.';
    }
  }
})();
