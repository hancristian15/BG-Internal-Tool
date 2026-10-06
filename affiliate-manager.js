(() => {
  const builderView = document.getElementById('builderView');
  const affiliateView = document.getElementById('affiliateManagerView');
  const builderNav = document.getElementById('builderNav');
  const affiliateNav = document.getElementById('affiliateManagerNav');
  const form = document.getElementById('trackingVerifyForm');
  const button = document.getElementById('verifyTrackingButton');
  const status = document.getElementById('trackingVerifyStatus');
  const result = document.getElementById('trackingVerifyResult');
  const headline = document.getElementById('trackingVerifyHeadline');
  const checks = document.getElementById('trackingVerifyChecks');
  const checkedUrl = document.getElementById('trackingCheckedUrl');

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
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
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
