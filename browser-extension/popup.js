const message = document.getElementById('message');
const pendingPanel = document.getElementById('pending');
const originText = document.getElementById('origin');
const grantButton = document.getElementById('grantButton');
let pendingVerification = null;

async function loadPending() {
  ({pendingVerification} = await chrome.storage.local.get('pendingVerification'));
  if (!pendingVerification) return;
  const host = new URL(pendingVerification.permissionOrigin).host;
  originText.textContent = host;
  pendingPanel.hidden = false;
  message.textContent = 'The tool stays open while the page is checked in a background tab.';
}

grantButton.addEventListener('click', async () => {
  grantButton.disabled = true;
  grantButton.textContent = 'Requesting access…';
  try {
    if (!pendingVerification) {
      message.textContent = 'There is no pending check. Start one from the Affiliate Manager.';
      message.classList.add('error');
      pendingPanel.hidden = true;
      return;
    }

    const permissionRequest = chrome.permissions.request({
      permissions: ['webRequest'],
      origins: [`${pendingVerification.permissionOrigin}/*`],
    });
    const granted = await permissionRequest;
    if (!granted) {
      chrome.runtime.sendMessage({
        type: 'permission-denied',
        appTabId: pendingVerification.appTabId,
        requestId: pendingVerification.requestId,
      });
      message.textContent = 'Access was not granted. No page was opened.';
      message.classList.add('error');
      grantButton.disabled = false;
      grantButton.textContent = 'Try again';
      return;
    }

    const reply = await chrome.runtime.sendMessage({type: 'permission-granted'});
    if (reply?.status === 'error') {
      message.textContent = reply.message || 'The check could not start.';
      message.classList.add('error');
      grantButton.disabled = false;
      grantButton.textContent = 'Try again';
      return;
    }
    message.textContent = 'Access granted. Checking in a background tab…';
    window.close();
  } catch (error) {
    message.textContent = error.message || 'The permission request failed.';
    message.classList.add('error');
    grantButton.disabled = false;
    grantButton.textContent = 'Try again';
  }
});

document.getElementById('cancelButton').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({
    type: 'cancel-pending',
    appTabId: pendingVerification?.appTabId,
    requestId: pendingVerification?.requestId,
  });
  pendingVerification = null;
  message.textContent = 'Check cancelled.';
  pendingPanel.hidden = true;
});

loadPending().catch(() => {
  message.textContent = 'The extension could not load its pending request.';
  message.classList.add('error');
});
