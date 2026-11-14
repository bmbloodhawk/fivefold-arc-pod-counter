// Disposable, service-token-only RTDB REST fixture. Never uses Firebase or OAuth.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { databaseKeyCompare } from '../server/src/database-key-page.js';

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

export async function startCompetitionRestFixture({ delayMs = 0, beforeConditionalPut = null } = {}) {
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 1000) throw new Error('Fixture delay must be 0–1000ms.');
  let root = {}; const calls = []; let conflicts = 0;
  const pathParts = path => path.replace(/^\//, '').replace(/\.json$/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const read = path => structuredClone(pathParts(path).reduce((value, key) => value?.[key], root) ?? null);
  const etag = value => value == null ? 'null_etag' : '"' + createHash('sha256').update(JSON.stringify(value)).digest('hex') + '"';
  const write = (path, value) => {
    const parts = pathParts(path); let parent = root;
    for (const key of parts.slice(0, -1)) {
      if (!Object.hasOwn(parent, key) || !parent[key] || typeof parent[key] !== 'object') {
        Object.defineProperty(parent, key, { value: {}, configurable: true, enumerable: true, writable: true });
      }
      parent = parent[key];
    }
    if (!parts.length) root = value || {};
    else if (value == null) delete parent[parts.at(-1)];
    else Object.defineProperty(parent, parts.at(-1), { value, configurable: true, enumerable: true, writable: true });
  };
  const timestamps = value => {
    if (!value || typeof value !== 'object') return value;
    if (value['.sv'] === 'timestamp') return Date.now();
    return Array.isArray(value) ? value.map(timestamps) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, timestamps(item)]));
  };
  const patchAt = (current, parts, value) => {
    if (!parts.length) return value;
    const next = Array.isArray(current) ? Object.defineProperties([], Object.getOwnPropertyDescriptors(current))
      : current && typeof current === 'object' ? { ...current } : {};
    const [key, ...remaining] = parts;
    if (!remaining.length && value == null) delete next[key];
    else {
      const child = current && typeof current === 'object' && Object.hasOwn(current, key) ? current[key] : undefined;
      Object.defineProperty(next, key, { value: remaining.length ? patchAt(child, remaining, value) : value,
        configurable: true, enumerable: true, writable: true });
    }
    return next;
  };
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer local-fixture-only') { res.writeHead(401); res.end('{}'); return; }
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    const url = new URL(req.url, 'http://127.0.0.1'), path = url.pathname;
    const call = { method: req.method, path, ...(url.search ? { query: url.search.slice(1) } : {}) };
    calls.push(call);
    let current = req.method === 'PATCH' ? undefined : read(path);
    if (req.method === 'GET') {
      if (url.search) {
        try {
          const query = url.searchParams;
          if (query.get('orderBy') !== '"$key"') throw new Error('Fixture supports key queries only.');
          const first = query.get('limitToFirst'), last = query.get('limitToLast');
          const limit = Number(first ?? last);
          if ((first === null) === (last === null) || !Number.isInteger(limit) || limit < 1 || limit > 102) throw new Error('Invalid bounded query.');
          const start = query.has('startAt') ? JSON.parse(query.get('startAt')) : null;
          const end = query.has('endAt') ? JSON.parse(query.get('endAt')) : null;
          if ((start !== null && typeof start !== 'string') || (end !== null && typeof end !== 'string')) throw new Error('Invalid key boundary.');
          const entries = Object.entries(current || {}).filter(([key, value]) => value != null
            && (start === null || databaseKeyCompare(key, start) >= 0)
            && (end === null || databaseKeyCompare(key, end) <= 0))
            .sort(([left], [right]) => databaseKeyCompare(left, right));
          const selected = first !== null ? entries.slice(0, limit) : entries.slice(-limit);
          // REST does not promise order. Reverse selected rows to exercise callers.
          current = selected.length ? Object.fromEntries(selected.reverse()) : null;
        } catch { res.writeHead(400); res.end('{}'); return; }
      }
      const body = JSON.stringify(current);
      call.returnedEntries = Object.values(current || {}).filter(value => value != null).length;
      call.responseBytes = Buffer.byteLength(body, 'utf8');
      res.writeHead(200, { 'content-type': 'application/json', ...(req.headers['x-firebase-etag'] === 'true' ? { etag: etag(current) } : {}) });
      res.end(body); return;
    }
    if (!['PUT', 'PATCH'].includes(req.method)) { res.writeHead(405); res.end('{}'); return; }
    let body = '';
    try { for await (const chunk of req) body += chunk; }
    catch { if (!res.destroyed) { res.writeHead(400); res.end('{}'); } return; }
    if (req.method === 'PATCH') {
      try {
        if (req.headers['if-match']) throw new Error('Conditional PATCH is unsupported by Firebase REST.');
        const patch = JSON.parse(body);
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('PATCH requires an object.');
        const paths = Object.keys(patch).sort();
        const updates = paths.map(key => {
          const segments = key.split('/');
          if (segments.some(segment => !segment || /[.#$\[\]\u0000-\u001f\u007f]/.test(segment))) throw new Error('Invalid update path.');
          return [[...pathParts(path), ...segments], firebaseShape(timestamps(patch[key]))];
        });
        const pathSet = new Set(paths);
        for (const key of paths) {
          const segments = key.split('/');
          for (let size = 1; size < segments.length; size++) {
            if (pathSet.has(segments.slice(0, size).join('/'))) throw new Error('Overlapping update paths.');
          }
        }
        // Validate everything before changing data; publish all locations together.
        // Copy affected ancestors only; unrelated history is not cloned per life tap.
        let staged = root;
        for (const [parts, value] of updates) staged = patchAt(staged, parts, value);
        root = staged;
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(patch));
      } catch { res.writeHead(400); res.end('{}'); }
      return;
    }
    if (req.headers['if-match'] && beforeConditionalPut) await beforeConditionalPut({ path, ifMatch: req.headers['if-match'] });
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
