import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRealtimeServer } from '../src/app.js';

test('only the isolated preview document admits same-origin embedding', async () => {
  const { server } = createRealtimeServer({ staticDir: fileURLToPath(new URL('../../client/', import.meta.url)) });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const preview = await fetch(`${origin}/index.html?appearance-preview=1`);
    assert.equal(preview.status,200);
    assert.equal(preview.headers.get('x-frame-options'),'SAMEORIGIN');
    assert.equal(preview.headers.get('content-security-policy'),"frame-ancestors 'self'");
    for (const path of ['/','/index.html','/index.html?appearance-preview=0','/health?appearance-preview=1','/appearance-studio.html?appearance-preview=1']) {
      const response = await fetch(origin + path);
      assert.equal(response.headers.get('x-frame-options'),'DENY',path);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
