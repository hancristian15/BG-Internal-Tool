(() => {
  const builderView = document.getElementById('builderView');
  const affiliateView = document.getElementById('affiliateManagerView');
  const builderNav = document.getElementById('builderNav');
  const affiliateNav = document.getElementById('affiliateManagerNav');
  const form = document.getElementById('trackingVerifyForm');
  const button = document.getElementById('verifyTrackingButton');
  const localButton = document.getElementById('verifyTrackingLocalButton');
  const localStatus = document.getElementById('trackingLocalStatus');
  const bookmarkletLink = document.getElementById('trackingBookmarklet');
  const status = document.getElementById('trackingVerifyStatus');
  const result = document.getElementById('trackingVerifyResult');
  const headline = document.getElementById('trackingVerifyHeadline');
  const checks = document.getElementById('trackingVerifyChecks');
  const checkedUrl = document.getElementById('trackingCheckedUrl');
  const localResultMessage = 'bgtool-tracking-result-v1';
  let localVerifyWindow = null;

  function bookmarkletUrl(){
    const allowedToolOrigin = JSON.stringify(window.location.origin);
    const source = String.raw`(()=>{
      const scriptText = Array.from(document.scripts).map(script => script.src + "\n" + (script.textContent || "")).join("\n");
      const resources = performance.getEntriesByType("resource").map(item => item.name).join("\n");
      const hasCookieReader = /ReadCookie\s*\(\s*(['\"])sessid2\1\s*\)/i.test(scriptText);
      const hasTrackingEndpoint = /tracking\.buygoods\.com\/track\//i.test(scriptText) || /tracking\.buygoods\.com\/track\//i.test(resources);
      const candidates = Array.from(document.querySelectorAll("a[href],area[href],[data-href],[data-url],[formaction]"))
        .flatMap(element => ["href", "data-href", "data-url", "formaction"].map(name => element.getAttribute(name)).filter(Boolean));
      const buyLinks = candidates.map(value => { try { return new URL(value, location.href); } catch (_) { return null; } })
        .filter(url => url && (url.hostname === "buygoods.com" || url.hostname.endsWith(".buygoods.com")) && (/checkout|upsell/i.test(url.pathname) || url.searchParams.has("product_codename")));
      const hasParam = (url, name) => Array.from(url.searchParams.entries()).some(([key, value]) => key.toLowerCase() === name && value.trim() !== "");
      const payload = {type:"${localResultMessage}", result:{
        trackingFound:hasCookieReader && hasTrackingEndpoint,
        sessid2Found:buyLinks.some(url => hasParam(url, "sessid2")),
        affIdFound:buyLinks.some(url => hasParam(url, "aff_id")),
        buyLinkCount:buyLinks.length,
        finalUrl:location.href
      }};
      if (window.opener && !window.opener.closed) window.opener.postMessage(payload, ${allowedToolOrigin});
      else alert("No BuyGoods tool tab is connected. Open this page using Verify in my browser, then click the bookmarklet again.");
    })();`;
    return `javascript:${source}`;
  }

  const bookmarklet = bookmarkletUrl();
  bookmarkletLink.href = bookmarklet;
  bookmarkletLink.addEventListener('click', event => {
    event.preventDefault();
    localStatus.textContent = 'Drag this link to your bookmarks bar first; then use it on the page opened by “Verify in my browser”.';
  });
  bookmarkletLink.addEventListener('dragstart', event => {
    event.dataTransfer.setData('text/uri-list', bookmarklet);
    event.dataTransfer.setData('text/plain', bookmarklet);
  });

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
    result.hidden = true;
    localVerifyWindow = window.open(target.href, '_blank');
    if (!localVerifyWindow) {
      localStatus.textContent = 'The browser blocked the new tab. Allow pop-ups for this tool and try again.';
      return;
    }
    localStatus.textContent = 'Page opened. Wait for it to finish loading, then click the Tracking Check bookmarklet in your bookmarks bar.';
    localVerifyWindow.focus();
  });

  window.addEventListener('message', event => {
    if (!localVerifyWindow || event.source !== localVerifyWindow || event.data?.type !== localResultMessage) return;
    const data = event.data.result;
    if (!data || typeof data.trackingFound !== 'boolean' || typeof data.sessid2Found !== 'boolean' || typeof data.affIdFound !== 'boolean' || typeof data.finalUrl !== 'string') return;
    let finalUrl;
    try { finalUrl = new URL(data.finalUrl); } catch (_) { return; }
    if (!['http:', 'https:'].includes(finalUrl.protocol) || finalUrl.origin !== event.origin) return;
    showResult(data);
    localStatus.textContent = 'Tracking results received from your browser.';
    status.textContent = `Checked in your browser. Found ${Number(data.buyLinkCount) || 0} BuyGoods buy link${Number(data.buyLinkCount) === 1 ? '' : 's'}.`;
    localVerifyWindow = null;
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
        throw new Error(response.status === 502 && /HTTP 403/.test(reason) ? `${reason} Use “Verify in my browser” below.` : reason);
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
})();
