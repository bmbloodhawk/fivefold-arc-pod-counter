import assert from 'node:assert/strict';
import test from 'node:test';
import { findCardsFromImage } from './card-image-scan.js';

test('card image scan sends a compact image directly to the public scanner and returns candidates', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith('/scan')) return new Response(JSON.stringify({ results: [{ product_id: 8, score: 94 }] }), { status: 200 });
    return new Response(JSON.stringify({ name: 'Lightning Bolt', set_name: 'Magic 2010', number: '146', scryfall_id: 'id' }), { status: 200 });
  };
  assert.deepEqual(await findCardsFromImage('data:image/jpeg;base64,abc', fetchImpl), [{ id: 8, score: 94, name: 'Lightning Bolt', setName: 'Magic 2010', number: '146', scryfallId: 'id' }]);
  assert.equal(requests[0].url, 'https://tcgtracking.com/tcgapi/v1/scan');
  assert.deepEqual(JSON.parse(requests[0].options.body), { game_id: 1, limit: 3, image: 'data:image/jpeg;base64,abc' });
});
