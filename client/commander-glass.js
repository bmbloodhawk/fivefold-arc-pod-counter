import { createCommanderGlassArtwork } from './commander-glass-art.js';

const mana = ['W', 'U', 'B', 'R', 'G'];
export function glassIdentity(colors) {
  return mana.filter(code => Array.isArray(colors) && colors.includes(code)).join('') || 'C';
}

// One decoded painting per surface. Coalesce fast seat/identity changes; a
// late decode or PNG from an old skin must never paint the next table.
function createMaterialSlot(document, makeArtwork, show) {
  const urls = document.defaultView?.URL || globalThis.URL;
  let asset = null, identity = null;

  function clear() {
    asset?.controller.abort();
    for (const url of asset?.variants.values() || []) if (url) urls.revokeObjectURL(url);
    asset = null;
    identity = null;
  }

  async function prepare(current) {
    if (current.busy) return;
    current.busy = true;
    try {
      current.material ??= await makeArtwork(document, current.source, current.controller.signal);
      if (asset !== current) return;
      if (current.material?.original) {
        show(identity, current.source, true);
        return;
      }
      if (!current.material) throw new Error('Glass renderer is unavailable');
      while (asset === current && !current.variants.has(identity)) {
        const key = identity;
        const blob = await current.material.render(key === 'C' ? [] : [...key]);
        if (asset !== current) return;
        if (!blob) throw new Error('Glass image could not be encoded');
        const url = urls.createObjectURL(blob);
        current.variants.set(key, url);
        if (current.variants.size > 3) {
          const oldest = [...current.variants.keys()].find(id => current.variants.get(id) !== current.visible);
          const discarded = current.variants.get(oldest);
          if (discarded) urls.revokeObjectURL(discarded);
          current.variants.delete(oldest);
        }
        if (identity === key) { current.visible = url; show(key, url, true); }
      }
    } catch {
      // The input's reserved pigment is never a player-facing color. A
      // decoder or allocation failure leaves the skin's neutral surface.
      if (asset === current) { current.failed = true; current.visible = null; show(identity, null, false); }
    } finally {
      current.busy = false;
    }
  }

  function update(source, key, newTarget = false) {
    const changed = source !== (asset?.source || '');
    if (!changed && key === identity && !newTarget) return;
    if (changed) {
      clear();
      if (source) asset = { source, controller: new AbortController(), variants: new Map(), busy: false, failed: false, material: null, visible: null };
    }
    identity = key;
    if (!asset) return show(key, null, true);
    if (asset.failed) return show(key, null, false);
    if (asset.material?.original) return show(key, asset.source, true);
    if (asset.variants.has(key)) {
      const saved = asset.variants.get(key);
      asset.variants.delete(key); asset.variants.set(key, saved);
      asset.visible = saved;
      return show(key, saved, true);
    }
    show(key, asset.visible, false);
    void prepare(asset);
  }
  return { update, clear };
}

export function createCommanderGlass(document, getTable, makeArtwork = createCommanderGlassArtwork) {
  const root = document.documentElement, game = document.querySelector('#gameView');
  const dial = document.querySelector('.dial-face');
  let active = false, setting = null, counter = null;
  const hall = createMaterialSlot(document, makeArtwork, (key, url, ready) => {
    if (url) root.style.setProperty('--prism-rendered-hall', `url("${url}")`);
    else root.style.removeProperty('--prism-rendered-hall');
    if (ready) game.dataset.glassHallReady = key;
    else delete game.dataset.glassHallReady;
  });
  const enamel = createMaterialSlot(document, makeArtwork, (key, url, ready) => {
    for (const image of [counter?.node, counter?.engraving]) {
      if (!image) continue;
      image.hidden = !url;
      if (url && image.getAttribute('src') !== url) image.setAttribute('src', url);
      else if (!url && image.hasAttribute('src')) image.removeAttribute('src');
    }
    if (ready) game.dataset.glassDialReady = key;
    else delete game.dataset.glassDialReady;
  });

  function jewels(mount, identity, arc) {
    if (!mount || mount.dataset.glassJewels === identity) return;
    const stones = [...identity].map((code, index) => {
      const gem = document.createElement('i');
      gem.className = 'commander-jewel';
      gem.dataset.mana = code;
      if (arc) {
        const angle = 90 + ((identity.length - 1) / 2 - index) * 28;
        const radians = angle * Math.PI / 180;
        gem.style.setProperty('--jewel-x', (50 + 42 * Math.cos(radians)).toFixed(2) + '%');
        gem.style.setProperty('--jewel-y', (50 + 42 * Math.sin(radians)).toFixed(2) + '%');
        gem.style.setProperty('--jewel-angle', (angle - 90) + 'deg');
      }
      return gem;
    });
    mount.replaceChildren(...stones);
    mount.dataset.glassJewels = identity;
  }

  function refresh(background, artwork) {
    active = true;
    const table = getTable();
    const seats = table?.seats || {};
    const owner = glassIdentity(seats[table?.owner]), viewed = glassIdentity(seats[table?.viewed]);
    game.dataset.glassOwner = owner;
    game.dataset.glassViewed = viewed;
    hall.update(background || '', owner);
    const newTarget = counter?.node !== artwork?.node;
    counter = artwork || null;
    if (counter) game.dataset.glassMedallion = 'true';
    else delete game.dataset.glassMedallion;
    enamel.update(counter?.source || '', viewed, newTarget);
    if (dial && !counter) {
      if (!setting) {
        setting = document.createElement('div');
        setting.className = 'commander-dial-jewels'; setting.setAttribute('aria-hidden', 'true');
        dial.append(setting);
      }
      jewels(setting, viewed, true);
    } else if (setting) {
      setting.remove(); setting = null;
    }
    document.querySelectorAll('.pod-seat').forEach(card => {
      const key = glassIdentity(seats[card.dataset.seat]);
      card.dataset.glassIdentity = key;
      jewels(card.querySelector('.identity-rail'), key, false);
    });
  }

  function clear() {
    if (!active) return;
    hall.clear(); enamel.clear();
    root.style.removeProperty('--prism-rendered-hall');
    for (const field of ['glassOwner','glassViewed','glassHallReady','glassDialReady','glassMedallion']) delete game.dataset[field];
    setting?.remove(); setting = null; counter = null;
    document.querySelectorAll('.pod-seat').forEach(card => {
      delete card.dataset.glassIdentity;
      const rail = card.querySelector('.identity-rail');
      if (rail?.dataset.glassJewels) { rail.replaceChildren(); delete rail.dataset.glassJewels; }
    });
    active = false;
  }
  return { refresh, clear };
}
