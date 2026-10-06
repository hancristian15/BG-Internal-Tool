const { randomBytes, randomUUID } = require('node:crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;

const TABLE_URL = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/funnel_documents`
  : null;
const s3 = R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
  : null;

function send(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    ...extra,
  };
}

async function dbRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: supabaseHeaders(options.headers || {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return {};
}

function localDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(value);
  const part = key => parts.find(item => item.type === key)?.value || '';
  return { display: `${part('day')}/${part('month')}/${part('year')}`, file: `${part('day')}-${part('month')}-${part('year')}` };
}

function safeFilePart(value) {
  return String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'document';
}

function displayDocumentName(productName, accountId, createdAt) {
  const date = localDateParts(new Date(createdAt)).display;
  return `${String(productName).trim()} - ${String(accountId).trim()} - ${date}`;
}

async function findById(id, select = '*') {
  const url = new URL(TABLE_URL);
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('select', select);
  url.searchParams.set('limit', '1');
  const rows = await dbRequest(url);
  return rows?.[0] || null;
}

async function findDuplicates(accountId, productName) {
  const url = new URL(TABLE_URL);
  url.searchParams.set('account_id', `eq.${String(accountId).trim()}`);
  url.searchParams.set('select', 'id,account_id,product_name,document_name,file_name,share_token,created_at,updated_at');
  url.searchParams.set('order', 'created_at.desc');
  url.searchParams.set('limit', '100');
  const rows = await dbRequest(url);
  const normalized = String(productName).trim().toLocaleLowerCase();
  return rows.filter(row => String(row.product_name).trim().toLocaleLowerCase() === normalized);
}

async function publicShare(token, res) {
  if (!token || !/^[A-Za-z0-9_-]{32,80}$/.test(token)) return send(res, 404, { error: 'Document not found' });
  const url = new URL(TABLE_URL);
  url.searchParams.set('share_token', `eq.${token}`);
  url.searchParams.set('select', 'document_name,object_key,created_at');
  url.searchParams.set('limit', '1');
  const rows = await dbRequest(url);
  const row = rows?.[0];
  if (!row) return send(res, 404, { error: 'Document not found' });

  const object = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: row.object_key }));
  const output = await object.Body.transformToString('utf-8');
  return send(res, 200, { documentName: row.document_name, createdAt: row.created_at, output });
}

async function saveDocument(body, res) {
  const accountId = String(body.accountId || '').trim();
  const productName = String(body.productName || '').trim();
  const output = typeof body.output === 'string' ? body.output : '';
  const builderState = body.builderState;
  const products = Array.isArray(body.products) ? body.products : null;
  if (!accountId || !productName || !output || !builderState || !products) {
    return send(res, 400, { error: 'Account, product, builder state, product variants, and output are required' });
  }
  if (output.length > 500000 || JSON.stringify(builderState).length > 500000 || JSON.stringify(products).length > 200000) {
    return send(res, 413, { error: 'Document is too large' });
  }

  let existing = null;
  if (body.id) {
    existing = await findById(String(body.id));
    if (!existing) return send(res, 404, { error: 'Document to edit was not found' });
  } else if (!body.allowDuplicate) {
    const duplicates = await findDuplicates(accountId, productName);
    if (duplicates.length) return send(res, 409, { error: 'A document already exists for this account and product', duplicates });
  }

  const now = new Date().toISOString();
  const id = existing?.id || randomUUID();
  const shareToken = existing?.share_token || randomBytes(32).toString('base64url');
  const createdAt = existing?.created_at || now;
  const date = localDateParts(new Date(createdAt));
  const fileName = `${safeFilePart(productName)}-${safeFilePart(accountId)}-${date.file}.txt`;
  const documentName = displayDocumentName(productName, accountId, createdAt);
  const objectKey = `${id}/${randomUUID()}-${fileName}`;

  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: objectKey,
    Body: Buffer.from(output, 'utf-8'),
    ContentType: 'text/plain; charset=utf-8',
    ContentDisposition: `inline; filename="${fileName}"`,
    CacheControl: 'private, no-store',
  }));

  const record = {
    id, share_token: shareToken, account_id: accountId, product_name: productName,
    document_name: documentName, file_name: fileName, object_key: objectKey,
    builder_state: builderState, products, created_at: createdAt, updated_at: now,
  };
  const saveUrl = new URL(TABLE_URL);
  saveUrl.searchParams.set('on_conflict', 'id');
  try {
    await dbRequest(saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(record),
    });
  } catch (error) {
    try { await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: objectKey })); } catch (_) {}
    throw error;
  }

  if (existing?.object_key) {
    try { await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: existing.object_key })); } catch (_) {}
  }
  return send(res, 200, { id, documentName, fileName, shareToken, createdAt, updatedAt: now });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const action = url.searchParams.get('action') || '';

  if (!TABLE_URL || !SUPABASE_SECRET_KEY || !s3 || !R2_BUCKET) {
    return send(res, 503, { error: 'Document storage is not configured' });
  }

  try {
    if (req.method === 'GET' && action === 'share') {
      return await publicShare(url.searchParams.get('token'), res);
    }

    if (req.method === 'GET' && action === 'search') {
      const query = String(url.searchParams.get('q') || '').trim();
      if (!query) return send(res, 200, { documents: [] });
      const safe = query.replace(/[,*()%_\\]/g, ' ').replace(/\s+/g, ' ').trim();
      const searchUrl = new URL(TABLE_URL);
      searchUrl.searchParams.set('or', `(account_id.ilike.*${safe}*,product_name.ilike.*${safe}*)`);
      searchUrl.searchParams.set('select', 'id,account_id,product_name,document_name,file_name,share_token,created_at,updated_at');
      searchUrl.searchParams.set('order', 'created_at.desc');
      searchUrl.searchParams.set('limit', '50');
      return send(res, 200, { documents: await dbRequest(searchUrl) });
    }

    if (req.method === 'GET' && action === 'duplicates') {
      const accountId = String(url.searchParams.get('accountId') || '').trim();
      const productName = String(url.searchParams.get('productName') || '').trim();
      if (!accountId || !productName) return send(res, 200, { documents: [] });
      return send(res, 200, { documents: await findDuplicates(accountId, productName) });
    }

    if (req.method === 'GET' && action === 'get') {
      const id = url.searchParams.get('id');
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return send(res, 400, { error: 'Valid document id is required' });
      const document = await findById(id, 'id,account_id,product_name,document_name,file_name,share_token,created_at,updated_at,builder_state,products,object_key');
      if (!document) return send(res, 404, { error: 'Document not found' });
      const object = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: document.object_key }));
      document.output = await object.Body.transformToString('utf-8');
      delete document.object_key;
      return send(res, 200, { document });
    }

    if (req.method === 'POST' && action === 'save') {
      return await saveDocument(getBody(req), res);
    }

    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { error: 'Unsupported document action' });
  } catch (error) {
    console.error('Document API request failed:', error.message);
    return send(res, 502, { error: 'Document request failed' });
  }
};
