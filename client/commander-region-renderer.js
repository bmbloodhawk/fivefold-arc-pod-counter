import { assignedRegionSurface, REGION_SURFACES } from './commander-art-regions.js';
import { createMaterialSlot, glassIdentity } from './commander-glass.js?v=2';
import { colorTable, createRasterMaterial, forPixels } from './commander-glass-art.js?v=2';

// Rasterize in source coordinates. The game then applies its normal crop, scaling
// and rotation to the finished artwork, so a region follows the painting.
function regionMaterial(document, dataUrl, signal, regions) {
  return createRasterMaterial(document, dataUrl, signal, (original, cancellation, width, height) => {
    const mask = document.createElement('canvas');
    mask.width = width;
    mask.height = height;
    const context = mask.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    for (const { points, slot } of regions) {
      context.beginPath();
      points.forEach(([x, y], index) => {
        const px = x * width / 100, py = y * height / 100;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      });
      context.closePath();
      context.fillStyle = 'rgb(' + slot * 40 + ' 0 0)';
      context.fill();
    }
    const pixels = context.getImageData(0, 0, width, height).data;
    mask.width = mask.height = 1;
    return async (colors, result) => {
      const tables = (colors.length ? colors : ['C']).map(color => colorTable(color));
      result.set(original);
      await forPixels(width * height, cancellation, (start, end) => {
        for (let pixel = start; pixel < end; pixel++) {
          const offset = pixel * 4;
          if (!pixels[offset + 3] || !original[offset + 3]) continue;
          const slot = Math.max(1, Math.min(5, Math.round(pixels[offset] / 40)));
          const table = tables[(slot - 1) % tables.length];
          const light = Math.round(.2126 * original[offset] + .7152 * original[offset + 1] + .0722 * original[offset + 2]);
          const coverage = pixels[offset + 3] / 255;
          for (let channel = 0; channel < 3; channel++) {
            const source = original[offset + channel];
            result[offset + channel] = source + (table[light * 3 + channel] - source) * coverage;
          }
        }
      });
    };
  });
}

export function createRegionRenderer(document, getTable) {
  let counter = null, currentSkin = null;
  let bindings = new Map();
  const background = createMaterialSlot(document, regionMaterial, (_, url) => {
    const style = document.documentElement.style;
    if (url) style.setProperty('--commander-region-background', 'url("' + url + '")');
    else style.removeProperty('--commander-region-background');
  });
  const dial = createMaterialSlot(document, regionMaterial, (_, url) => {
    for (const node of [counter?.node, counter?.engraving]) {
      if (!node) continue;
      node.hidden = false;
      const source = url || counter.source;
      if (source && node.getAttribute('src') !== source) node.setAttribute('src', source);
    }
  });
  function readBindings(skin) {
    const updated = new Map();
    for (const key of REGION_SURFACES) {
      const config = assignedRegionSurface(skin, key);
      if (!config) continue;
      // Each preview message carries fresh copies. A mode or identity change
      // must not decode a large, unchanged background for a second time.
      const signature = JSON.stringify(config.regions);
      const previous = bindings.get(key);
      const regions = previous?.signature === signature ? previous.regions : config.regions;
      updated.set(key, { source: config.source, regions, signature });
    }
    return updated;
  }
  function refresh(skin, mode, image, artwork) {
    if (currentSkin !== skin) { currentSkin = skin; bindings = readBindings(skin); }
    const table = getTable(), seats = table?.seats;
    const update = (slot, definition, source, replace) => {
      const identity = glassIdentity(seats?.[table?.[definition?.source]]);
      slot.update(definition ? source || '' : '', identity, replace, definition?.regions || null);
    };
    update(background, bindings.get('background'), image, false);
    const replace = counter?.node !== artwork?.node;
    counter = artwork;
    update(dial, bindings.get(mode), counter?.source, replace);
  }
  function clear() {
    background.clear();
    dial.clear();
    document.documentElement.style.removeProperty('--commander-region-background');
    counter = currentSkin = null;
    bindings.clear();
  }
  return { refresh, clear };
}
