import { next, rewrite } from '@vercel/functions';
import sessionModule from './lib/tool-session.js';

const { readSessionCookie, verifySession, sessionSecret } = sessionModule;

function loginPage(configured){
  const configurationMessage = configured ? '' : '<p class="notice">Login is not configured for this deployment yet. Add <code>TOOL_LOGIN_PASSWORD</code> in Vercel Project Settings, then redeploy.</p>';
  const form = configured ? `<form id="loginForm"><label for="password">Tool password</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Log in</button><p id="loginError" role="status"></p></form>` : '';
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BuyGoods Tool Login</title><style>
    :root{color-scheme:light;--ink:#2d281f;--muted:#786f62;--cream:#f4efe4;--card:#fffdf8;--line:#ded4c3;--brown:#805033}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--cream);color:var(--ink);font:15px/1.5 Arial,sans-serif}
    main{width:min(100%,410px);padding:34px;background:var(--card);border:1px solid var(--line);border-radius:16px;box-shadow:0 16px 48px #37260f18}h1{margin:0 0 7px;font-size:24px}p{color:var(--muted)}label{display:block;margin:22px 0 7px;font-weight:600}input{width:100%;padding:12px;border:1px solid var(--line);border-radius:8px;font:inherit}button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:8px;background:var(--brown);color:white;font:600 15px Arial,sans-serif;cursor:pointer}#loginError,.notice{min-height:20px;color:#a33434}.notice{padding:12px;background:#fff3e9;border:1px solid #edcfb3;border-radius:8px}code{overflow-wrap:anywhere}
  </style></head><body><main><p>BuyGoods Internal Tools</p><h1>Sign in</h1><p>Enter the tool password to continue. Your session stays active for 7 days.</p>${configurationMessage}${form}</main>${configured ? `<script>
    const form=document.getElementById('loginForm');
    form.addEventListener('submit',async event=>{event.preventDefault();const error=document.getElementById('loginError');const button=form.querySelector('button');button.disabled=true;error.textContent='';try{const response=await fetch('/api/auth?action=login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('password').value})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Login failed');location.replace('/');}catch(e){error.textContent=e.message;}finally{button.disabled=false;}});
  </script>` : ''}</body></html>`, {
    status: configured ? 401 : 503,
    headers: {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'}
  });
}

function jsonUnauthorized(){
  return new Response(JSON.stringify({error:'Login required'}), {
    status:401,
    headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
  });
}

export default function proxy(request){
  const url = new URL(request.url);

  if(url.pathname === '/api/auth') return next();
  if(url.pathname === '/api/documents' && request.method === 'GET' && url.searchParams.get('action') === 'share') return next();

  const shareToken = url.searchParams.get('share');
  if(request.method === 'GET' && shareToken && !url.pathname.startsWith('/api/')){
    return rewrite(new URL(`/share.html?token=${encodeURIComponent(shareToken)}`, request.url));
  }
  if(url.pathname === '/share.html' && url.searchParams.has('token')) return next();

  const configured = !!(process.env.TOOL_LOGIN_PASSWORD && sessionSecret());
  const token = readSessionCookie(request.headers.get('cookie') || '');
  if(configured && verifySession(token)) return next();
  if(url.pathname.startsWith('/api/')) return jsonUnauthorized();
  return loginPage(configured);
}
