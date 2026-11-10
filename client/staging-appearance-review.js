import { parseCollectionArtwork, parseCollectionVisual } from './collection-visual.js?v=3';

const reviewKeyPattern = /^[A-Za-z0-9_-]{43}$/;
const skinIdPattern = /^[A-Za-z0-9_-]{1,80}$/;

export async function unlockStagingAppearanceReview(bytes, reviewKey, now = Date.now()) {
  if (!reviewKeyPattern.test(reviewKey) || bytes.length < 29 || bytes.length > 5_000_000) {
    throw new Error('Invalid review pack');
  }
  const keyBytes = Uint8Array.from(atob(reviewKey.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  const pack = JSON.parse(new TextDecoder().decode(decoded));
  if (pack.version !== 1 || !Number.isSafeInteger(pack.expiresAt) || pack.expiresAt <= now
    || !Array.isArray(pack.skins) || pack.skins.length < 1 || pack.skins.length > 6) {
    throw new Error('This review pack is invalid or expired');
  }
  const ids = new Set();
  const skins = pack.skins.map(skin => {
    if (typeof skin?.id !== 'string' || !skinIdPattern.test(skin.id) || ids.has(skin.id)
      || typeof skin.name !== 'string' || !skin.name || skin.name.length > 80
      || !parseCollectionVisual(skin.visual) || (skin.artwork != null && !parseCollectionArtwork(skin.artwork))) {
      throw new Error('Invalid skin in review pack');
    }
    ids.add(skin.id);
    return { id: 'review:' + skin.id, name: skin.name, visual: skin.visual, artwork: skin.artwork };
  });
  if (!ids.has(pack.initialSkinId)) throw new Error('Invalid starting skin');
  return { skins, initialChoice: 'review:' + pack.initialSkinId };
}
