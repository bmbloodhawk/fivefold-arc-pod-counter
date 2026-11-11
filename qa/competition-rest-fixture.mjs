// Disposable, service-token-only RTDB REST fixture. Never uses Firebase or OAuth.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

export function firebaseShape(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return value;
  const entries = Object.entries(value).map(([key, item]) => [key, firebaseShape(item)]).filter(([, item]) => item !== null);
  if (!entries.length) return null;
  if (entries.every(([key]) => /^(0|[1-9]\d*)$/.test(key))) {
    const max = Math.max(...entries.map(([key]) => Number(key)));
    if (max < entries.length * 2) return Array.from({ length: max + 1 }, (_, index) => entries.find(([key]) => Number(key) === index)?.[1] ?? null);
  }
  return Object.fromEntries(entries);
}

export async function startCompetitionRestFixture({ delayMs = 0 } = {}) {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 1000) throw new Error('Fixture delay must be 0–1000ms.');
  let root = {}; const calls = []; let conflicts = 0;
  const pathParts = path => path.replace(/^\//, '').replace(/\.json$/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const read = path => structuredClone(pathParts(path).reduce((value, key) => value?.[key], root) ?? null);
  const etag = value => value == null ? 'null_etag' : '"' + createHash('sha256').update(JSON.stringify(value)).digest('hex') + '"';
  const write = (path, value) => {
    const parts = pathParts(path); let parent = root;
    for (const key of parts.slice(0, -1)) {
      if (!parent[key] || typeof parent[key] !== 'object') parent[key] = {};
      parent = parent[key];
    }
    if (!parts.length) root = value || {};
    else if (value == null) delete parent[parts.at(-1)];
    else parent[parts.at(-1)] = value;
  };
  const timestamps = value => {
    if (!value || typeof value !== 'object') return value;
    if (value['.sv'] === 'timestamp') return Date.now();
    return Array.isArray(value) ? value.map(timestamps) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, timestamps(item)]));
  };
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer local-fixture-only') { res.writeHead(401); res.end('{}'); return; }
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    calls.push({ method: req.method, path });
    let current = read(path);
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json', ...(req.headers['x-firebase-etag'] === 'true' ? { etag: etag(current) } : {}) });
      res.end(JSON.stringify(current)); return;
    }
    if (req.method !== 'PUT') { res.writeHead(405); res.end('{}'); return; }
    let body = '';
    try { for await (const chunk of req) body += chunk; }
    catch { if (!res.destroyed) { res.writeHead(400); res.end('{}'); } return; }
    // Compare at commit, after reading the request, so concurrent writers really race.
    current = read(path);
    const tag = req.headers['if-match'];
    if (tag && tag !== etag(current)) {
      conflicts++; res.writeHead(412, { 'content-type': 'application/json', etag: etag(current) }); res.end(JSON.stringify(current)); return;
    }
    try {
      const value = firebaseShape(timestamps(JSON.parse(body)));
      write(path, value);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value));
    } catch { res.writeHead(400); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, read,
    get conflicts() { return conflicts; },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
