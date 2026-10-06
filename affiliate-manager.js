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
  const postbackButton = document.getElementById('testPostbackButton');
  const postbackInput = document.getElementById('postbackUrlInput');
  const postbackStatus = document.getElementById('postbackStatus');
  const postbackResponse = document.getElementById('postbackResponse');
  const postbackResponseTitle = document.getElementById('postbackResponseTitle');
  const postbackResponseMeta = document.getElementById('postbackResponseMeta');
  const postbackResponseBody = document.getElementById('postbackResponseBody');
  let activePostbackRequestId = null;
  let postbackTimeout = null;

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
    if (activePostbackRequestId && message.requestId === activePostbackRequestId && message.type === 'postback-result') {
      window.clearTimeout(postbackTimeout);
      postbackTimeout = null;
      postbackButton.disabled = false;
      activePostbackRequestId = null;
      if (message.status === 'result' && message.result) {
        showPostbackResponse(message.result);
        postbackStatus.textContent = 'Test request completed.';
      } else {
        postbackStatus.textContent = message.message || 'Could not send the test request.';
      }
      return;
    }
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

  postbackButton.addEventListener('click', () => {
    const input = postbackInput.value.trim();
    const parsed = inspectPostbackTemplate(input);
    postbackResponse.hidden = true;
    if (!parsed.valid) {
      postbackStatus.textContent = parsed.message;
      return;
    }

    activePostbackRequestId = crypto.randomUUID();
    postbackButton.disabled = true;
    postbackStatus.textContent = `Valid template (${parsed.subidTokens.join(', ')}). Sending a test with amount=0…`;
    window.postMessage({
      channel: extensionChannel,
      type: 'test-postback',
      requestId: activePostbackRequestId,
      url: parsed.url.href,
    }, window.location.origin);

    const expectedRequestId = activePostbackRequestId;
    window.clearTimeout(postbackTimeout);
    postbackTimeout = window.setTimeout(() => {
      if (activePostbackRequestId !== expectedRequestId) return;
      activePostbackRequestId = null;
      postbackButton.disabled = false;
      postbackStatus.textContent = 'The verifier did not return a result. Reload the BuyGoods Tracking Verifier extension and try again.';
    }, 20000);
  });

  function inspectPostbackTemplate(value) {
    let url;
    try { url = new URL(value); } catch (_) { return {valid:false, message:'Enter a valid postback URL.'}; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      return {valid:false, message:'Use a public HTTP or HTTPS URL without embedded credentials.'};
    }
    if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) {
      return {valid:false, message:'Use the standard HTTP or HTTPS port.'};
    }
    const candidates = [...url.searchParams.values()].flatMap(value => value.match(/\{SUBID\d*\}/gi) || []);
    const validTokens = candidates.filter(token => /^\{SUBID(?:[2-5])?\}$/.test(token));
    const invalidTokens = candidates.filter(token => !/^\{SUBID(?:[2-5])?\}$/.test(token));
    if (!validTokens.length) {
      return {valid:false, message:'No valid, case-sensitive SUBID macro found. Use {SUBID} or {SUBID2} through {SUBID5}.'};
    }
    if (invalidTokens.length) {
      return {valid:false, message:`Invalid SUBID macro ${invalidTokens.join(', ')}. Only {SUBID} and {SUBID2}–{SUBID5} are accepted, with exact capitalization.`};
    }
    return {valid:true, url, subidTokens:[...new Set(validTokens)]};
  }

  function showPostbackResponse(data) {
    const statusCode = Number(data.statusCode) || 0;
    postbackResponseBody.textContent = data.body || data.error || 'The endpoint returned an empty response body.';
    const interpretation = postbackStatusMeaning(statusCode, data.error);
    postbackResponseTitle.textContent = interpretation.title;
    postbackResponseTitle.className = `postback-response-title ${interpretation.good ? 'good' : 'bad'}`;
    const finalUrl = data.finalUrl ? safeUrlForDisplay(data.finalUrl) : '';
    postbackResponseMeta.textContent = `HTTP ${statusCode || 'unavailable'} · ${interpretation.meaning}${finalUrl ? ` · Final URL: ${finalUrl}` : ''}`;
    postbackResponse.hidden = false;
  }

  function postbackStatusMeaning(statusCode, error) {
    if (!statusCode) return {title:'Request did not receive an HTTP response', meaning:error || 'The browser could not reach the endpoint.', good:false};
    const returnedBody = postbackResponseBody.textContent || '';
    const errorCodeMatch = returnedBody.match(/\b(?:error(?:\s+code)?|code)\D{0,8}(\d{1,2})\b/i);
    const isEverflow = (() => {
      try {
        const url = new URL(postbackInput.value.trim());
        return url.hostname.toLowerCase().includes('g8mv2trk.com') || url.searchParams.has('nid');
      } catch (_) { return false; }
    })();
    if (errorCodeMatch && isEverflow) {
      const code = Number(errorCodeMatch[1]);
      const knownCodes = {
        2:'Advertiser domain is not on the allowlist.',
        3:'The request IP is not on the allowlist.',
        8:'Duplicate conversion: this transaction ID may already be recorded.',
        11:'Invalid or missing network ID (nid).',
        12:'Invalid transaction ID: it is missing, empty, or malformed.',
        13:'Invalid click: the test ID has no matching click. A synthetic test ID can produce this expected result.',
        14:'The click and conversion are associated with different offers.',
        21:'Invalid verification token: the token may be missing or incorrect.',
      };
      if (knownCodes[code]) return {title:`Everflow error code ${code}`, meaning:knownCodes[code], good:false};
    }
    if (statusCode >= 200 && statusCode < 300) return {title:'Endpoint returned a success status', meaning:'The server accepted the HTTP request. Read its response below; this alone does not confirm conversion attribution.', good:true};
    const meanings = {
      400:'Bad request: required parameters may be missing or malformed.',
      401:'Unauthorized: the verification token or account authentication may be invalid.',
      403:'Forbidden: the endpoint refused access; check the token, account permissions, IP rules, or firewall.',
      404:'Not found: the endpoint path or network/account ID may be wrong.',
      405:'Method not allowed: this endpoint does not accept the request method used.',
      409:'Conflict: the test transaction ID may already exist or be duplicated.',
      422:'Unprocessable request: a parameter or its value did not pass validation.',
      429:'Too many requests: the endpoint is rate limiting tests.',
    };
    if (meanings[statusCode]) return {title:'Endpoint returned an error status', meaning:meanings[statusCode], good:false};
    if (statusCode >= 300 && statusCode < 400) return {title:'Endpoint redirected the request', meaning:'Check whether the redirect destination is the intended postback endpoint.', good:false};
    if (statusCode >= 500) return {title:'The endpoint server failed', meaning:'A server-side error occurred. Check the tracking platform status or logs.', good:false};
    return {title:'Endpoint returned a non-success status', meaning:'Read the endpoint response below for its specific explanation.', good:false};
  }

  function safeUrlForDisplay(value) {
    try {
      const url = new URL(value);
      for (const key of [...url.searchParams.keys()]) {
        if (/token|secret|key|auth/i.test(key)) url.searchParams.set(key, '[hidden]');
      }
      return url.toString();
    } catch (_) { return ''; }
  }

  const initiateButton = document.getElementById('generateInitiateCheckoutButton');
  const initiateUrlInput = document.getElementById('initiateCheckoutUrlInput');
  const redTrackCheckbox = document.getElementById('redTrackPostback');
  const initiateOutput = document.getElementById('initiateCheckoutOutput');
  const initiateOutputWrap = document.getElementById('initiateCheckoutOutputWrap');
  const initiateStatus = document.getElementById('initiateCheckoutStatus');
  initiateButton.addEventListener('click', () => {
    const raw = initiateUrlInput.value.trim();
    initiateOutputWrap.hidden = true;
    let url;
    try { url = new URL(raw); } catch (_) { initiateStatus.textContent = 'Enter a valid URL first.'; return; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      initiateStatus.textContent = 'Use a valid HTTP or HTTPS URL without embedded credentials.';
      return;
    }
    const isRedTrack = redTrackCheckbox.checked
      || /redtrack/i.test(`${url.hostname}${url.pathname}`)
      || (url.pathname.toLowerCase().includes('postback') && url.searchParams.has('clickid'))
      || url.searchParams.get('type') === 'InitiateCheckout';
    if (isRedTrack && url.searchParams.get('type') !== 'InitiateCheckout') {
      [...url.searchParams.keys()].filter(key => key.toLowerCase() === 'type').forEach(key => url.searchParams.delete(key));
      url.searchParams.set('type', 'InitiateCheckout');
    }
    const imageUrl = url.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    initiateOutput.value = `<img src="${imageUrl}" width="1" height="1" style="display:none;" />`;
    initiateOutputWrap.hidden = false;
    initiateStatus.textContent = isRedTrack
      ? 'RedTrack detected/selected; type=InitiateCheckout is present.'
      : 'Pixel generated from the URL. Select the RedTrack option if this is a RedTrack postback.';
  });
  document.getElementById('copyInitiateCheckoutButton').addEventListener('click', async () => {
    await copyText(initiateOutput.value, initiateStatus, 'InitiateCheckout pixel copied.');
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
