const SCAN_URL = 'https://tcgtracking.com/tcgapi/v1/scan';
const PRODUCT_URL = 'https://tcgtracking.com/tcgapi/v1/products/';

async function json(response, fallback) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || fallback);
  return body;
}

// The image is sent directly from the phone to TCGTracking. Fivefold Arc never
// receives it, and no candidate or photo is persisted in this module.
export async function findCardsFromImage(image, fetchImpl = fetch) {
  const scan = await json(await fetchImpl(SCAN_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ game_id: 1, limit: 3, image }),
  }), 'Image scan is temporarily unavailable. Try a clearer card photo or type the title.');
  const matches = Array.isArray(scan.results) ? scan.results.filter(match => Number.isInteger(match?.product_id)).slice(0, 3) : [];
  if (!matches.length) throw new Error('No card match was found. Center one upright card and try again.');
  const products = await Promise.all(matches.map(async match => {
    const product = await json(await fetchImpl(`${PRODUCT_URL}${match.product_id}`), 'A scan candidate could not be loaded.');
    return { id: match.product_id, score: Number(match.score) || 0, name: String(product.name || ''), setName: String(product.set_name || ''), number: String(product.number || ''), scryfallId: typeof product.scryfall_id === 'string' ? product.scryfall_id : null };
  }));
  return products.filter(product => product.name);
}
