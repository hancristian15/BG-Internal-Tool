(() => {
  const channel = 'bgtool-tracking-extension-v1';

  function postToTool(message) {
    window.postMessage({channel, ...message}, location.origin);
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || message.channel !== channel || !['verify-request', 'test-postback'].includes(message.type)) return;
    if (typeof message.requestId !== 'string' || typeof message.url !== 'string') return;

    chrome.runtime.sendMessage({
      type: message.type,
      requestId: message.requestId,
      url: message.url,
    }).then(reply => {
      if (message.type === 'test-postback') {
        postToTool({
          type: 'postback-result',
          requestId: message.requestId,
          status: reply?.status || 'error',
          result: reply?.result || null,
          message: reply?.message || '',
        });
        return;
      }
      postToTool({type:'status', requestId:message.requestId, status:reply?.status || 'error', host:reply?.host || '', message:reply?.message || ''});
    }).catch(() => {
      postToTool({
        type: message.type === 'test-postback' ? 'postback-result' : 'status',
        requestId: message.requestId,
        status: 'error',
        message: 'The extension could not start the background check.',
      });
    });
  });

  chrome.runtime.onMessage.addListener(message => {
    if (!message || message.type !== 'tool-update' || typeof message.requestId !== 'string') return;
    postToTool({
      ...message,
      type: message.status === 'result' ? 'result' : 'status',
    });
  });
})();
