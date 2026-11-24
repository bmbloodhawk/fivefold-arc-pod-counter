import { record, choice, number, id, image } from './appearance-design-schema.js';

// These renderer-owned surfaces are the complete target list. Asset records and
// imported skin JSON cannot provide selectors or attach event handlers.
export const SURFACE_ART_SLOTS = Object.freeze({
  turnBar: { label: 'Turn bar', selector: '#turnBanner' },
  navigation: { label: 'Counter navigation plate', selector: '#modeNav' },
  playerCard: { label: 'Player cards', selector: '#gameView .pod-seat' },
  counterPanel: { label: 'Counter panel', selector: '#gameView .counter-stage' },
  gameHeader: { label: 'Table header', selector: '#gameView .game-topline' },
  gameDialog: { label: 'Counter dialogs', selector: '#customLifeDialog > form, #radiationDialog > form, #commanderSourceDialog > form' },
  resultHeader: { label: 'Result heading', selector: '#victoryDialog .victory-winner-copy' },
});
export const SURFACE_ART_ROLES = Object.freeze(['panel', 'overlay', 'background']);
const keys = Object.keys(SURFACE_ART_SLOTS);
const fields = { assetId: id, fit: choice('cover', 'contain'), scale: number(50, 160), positionX: number(0, 100), positionY: number(0, 100), opacity: number(0, 35) };
export const surfaceArtSpec = record(Object.fromEntries(keys.map(key => [key, record(fields)])));
export const surfaceArtDataSpec = record(Object.fromEntries(keys.map(key => [key, image])));
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const bounded = (value, fallback, min, max) => value === null || value === '' || !['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) ? fallback : Math.min(max, Math.max(min, Number(value)));
const stableId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const defaults = { assetId: '', fit: 'cover', scale: 100, positionX: 50, positionY: 50, opacity: 20 };

function normalized(value) {
  const entry = object(value);
  return { assetId: stableId(entry.assetId) ? entry.assetId : '', fit: entry.fit === 'contain' ? 'contain' : 'cover', scale: bounded(entry.scale, 100, 50, 160), positionX: bounded(entry.positionX, 50, 0, 100), positionY: bounded(entry.positionY, 50, 0, 100), opacity: bounded(entry.opacity, 20, 0, 35) };
}
export function compileSurfaceArtwork(skin, { safeImage = () => '' } = {}) {
  if (skin?.rendererVersion !== 2) return {};
  const result = {};
  for (const key of keys) {
    const entry = normalized(object(skin.surfaceArt)[key]);
    if (!entry.assetId) continue;
    const data = safeImage(object(skin.surfaceArtData)[key]);
    if (!data) continue;
    result[key] = { data, fit: entry.fit, scale: entry.scale / 100, position: `${entry.positionX}% ${entry.positionY}%`, opacity: entry.opacity / 100 };
  }
  return result;
}
export function updateSurfaceArtwork(skin, slot, patch) {
  if (!Object.hasOwn(SURFACE_ART_SLOTS, slot)) throw new TypeError('Choose a named artwork surface.');
  const surfaceArt = { ...object(skin?.surfaceArt) };
  const entry = normalized({ ...defaults, ...object(surfaceArt[slot]), ...object(patch) });
  if (entry.assetId) surfaceArt[slot] = entry; else delete surfaceArt[slot];
  const result = { ...skin };
  if (Object.keys(surfaceArt).length) result.surfaceArt = surfaceArt; else delete result.surfaceArt;
  return result;
}

export function createSurfaceArtRenderer(document, { safeImage } = {}) {
  const rendered = new Map();
  let active = {}, styleReady = false;
  function ensureStyle() {
    let stylesheet = document.querySelector('link[data-surface-art-css]');
    if (!stylesheet) {
      stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('./appearance-surface-art.css', import.meta.url).href; stylesheet.setAttribute('data-surface-art-css', '');
      document.head.append(stylesheet);
    }
    if (stylesheet.sheet || typeof stylesheet.addEventListener !== 'function') styleReady = true;
    else stylesheet.addEventListener('load', () => { styleReady = true; for (const { layer } of rendered.values()) layer.hidden = false; }, { once: true });
  }
  function clearTarget(target, state) { state.layer.remove(); target.removeAttribute('data-surface-art'); rendered.delete(target); }
  function refresh() {
    const targets = new Set();
    for (const [slot, art] of Object.entries(active)) for (const target of document.querySelectorAll(SURFACE_ART_SLOTS[slot].selector)) {
      targets.add(target);
      let state = rendered.get(target);
      if (!state) {
        const layer = document.createElement('span'), image = document.createElement('img');
        layer.className = 'appearance-surface-art'; layer.setAttribute('aria-hidden', 'true'); layer.setAttribute('inert', '');
        layer.hidden = !styleReady;
        image.alt = ''; image.decoding = 'async'; layer.append(image);
        state = { layer, image }; rendered.set(target, state);
      }
      target.setAttribute('data-surface-art', slot);
      if (state.layer.parentNode !== target) target.append(state.layer);
      if (state.art !== art) {
        if (state.data !== art.data) state.image.src = art.data;
        state.layer.style.setProperty('--surface-art-fit', art.fit);
        state.layer.style.setProperty('--surface-art-position', art.position);
        state.layer.style.setProperty('--surface-art-scale', String(art.scale));
        state.layer.style.setProperty('--surface-art-opacity', String(art.opacity));
        state.art = art; state.data = art.data;
      }
    }
    for (const [target, state] of rendered) if (!targets.has(target)) clearTarget(target, state);
  }
  function apply(skin) {
    active = compileSurfaceArtwork(skin, { safeImage });
    if (Object.keys(active).length) ensureStyle();
    refresh();
  }
  function clear() { active = {}; for (const [target, state] of rendered) clearTarget(target, state); }
  return { apply, refresh, clear };
}
