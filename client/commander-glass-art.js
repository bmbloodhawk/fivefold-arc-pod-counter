// Five authored glass pigments in the master. Each ramp runs from thick, dark
// glass through transmitted body color to the thin, bright edge of a shard.
const ramps = {
  W: [[34,30,27], [99,85,65], [177,155,117], [231,216,175], [255,253,236]],
  U: [[9,15,32], [15,47,88], [22,88,151], [53,154,213], [192,237,250]],
  B: [[5,5,5], [13,13,13], [32,32,32], [65,65,65], [158,158,158]],
  R: [[28,10,20], [88,21,37], [157,32,48], [225,64,53], [255,198,160]],
  G: [[9,24,24], [15,61,53], [28,116,77], [63,171,100], [207,237,175]],
  C: [[26,30,36], [74,82,90], [137,147,153], [204,214,219], [247,250,248]],
};
const identities = ['W','U','B','R','G'];
const maxPixels = 1_600_000;

// Stained glass is strongly chromatic. Near-neutral leading, masonry, glints,
// and low-chroma pewter never enter the pigment map. Smooth edge coverage
// keeps the underlying raster's antialiasing at the glass/leading boundary.
function measureGlass(source, offset, map, pixel) {
  const red = source[offset], green = source[offset + 1], blue = source[offset + 2];
  const high = Math.max(red, green, blue);
  const chroma = high - Math.min(red, green, blue);
  if (!source[offset + 3] || chroma <= 4) return;
  const saturation = chroma / high;
  if (saturation <= .12) return;
  let hue;
  if (high === red) hue = (green - blue) / chroma + (green < blue ? 6 : 0);
  else if (high === green) hue = (blue - red) / chroma + 2;
  else hue = (red - green) / chroma + 4;
  const degrees = hue * 60;
  let family = 3; // Ruby
  if (degrees >= 29 && degrees < 74) family = 0; // Amber
  else if (degrees >= 74 && degrees < 168) family = 4; // Emerald
  else if (degrees >= 168 && degrees < 257) family = 1; // Sapphire
  else if (degrees >= 257 && degrees < 330) family = 2; // Private key for onyx
  // The master's carved limestone has warm brown crevices. Reserve those
  // hues for stone unless the pigment is unmistakably saturated.
  const warmStone = degrees >= 8 && degrees < 39;
  const onyxKey = family === 2;
  const threshold = onyxKey ? .12 : warmStone ? .54 : family === 0 ? .34 : .26;
  const coverage = Math.min(1, (saturation - threshold) / .15, (chroma - (onyxKey ? 4 : 10)) / 16);
  if (coverage <= 0) return;
  map.family[pixel] = family + 1;
  map.coverage[pixel] = Math.round(255 * coverage * coverage * (3 - 2 * coverage));
  // The brightest transmitted channel carries the bubbles, hand-painted
  // hatching and ripples even in saturated blue, where luma alone is low.
  map.light[pixel] = Math.round(.72 * high + .28 * (.2126 * red + .7152 * green + .0722 * blue));
}

function panesForIdentity(colors) {
  const selected = identities.filter(color => colors.includes(color));
  // Four pigments in the master are already final. The fifth is an input
  // key, including in a five-color deck. Null slots retain the artist's RGB.
  if (selected.length === 5) return [null, null, 'B', null, null];
  if (!selected.length) return identities.map(() => 'C');
  const counts = new Map(selected.map(color => [color, 1]));
  return identities.map(family => {
    if (counts.has(family)) return family;
    // Reassign unused families to distribute panes among the chosen colors.
    let chosen = selected[0];
    for (const color of selected) if (counts.get(color) < counts.get(chosen)) chosen = color;
    counts.set(chosen, counts.get(chosen) + 1);
    return chosen;
  });
}

function colorTable(code, family) {
  const stops = ramps[code];
  const table = new Uint8ClampedArray(256 * 3);
  for (let light = 0; light < 256; light++) {
    // Small differences in shard thickness distinguish adjacent panes of the
    // same pigment and retain the contrast originally supplied by different hues.
    const t = light / 255;
    const sample = Math.min(1, Math.max(0, t + (family - 2) * .055 * t * (1 - t))) * (stops.length - 1);
    const lower = Math.min(stops.length - 2, Math.floor(sample));
    const mix = sample - lower;
    for (let channel = 0; channel < 3; channel++) {
      table[light * 3 + channel] = stops[lower][channel] * (1 - mix) + stops[lower + 1][channel] * mix;
    }
  }
  return table;
}

// Yield between large strips when the device needs more than a frame to
// process them. A score change never performs this work.
function checkCancellation(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Artwork cancelled', 'AbortError');
}

async function forPixels(length, signal, run) {
  let startTime = performance.now();
  for (let start = 0; start < length; start += 32768) {
    checkCancellation(signal);
    const end = Math.min(length, start + 32768);
    run(start, end);
    if (end < length && performance.now() - startTime > 8) {
      await new Promise(resolve => setTimeout(resolve, 0));
      startTime = performance.now();
    }
  }
}

export async function prepareGlassPigments(source, signal) {
  checkCancellation(signal);
  const count = source.length / 4;
  const map = { family: new Uint8Array(count), coverage: new Uint8Array(count), light: new Uint8Array(count) };
  await forPixels(count, signal, (start, end) => {
    for (let i = start; i < end; i++) measureGlass(source, i * 4, map, i);
  });
  checkCancellation(signal);
  if (!map.family.some(Boolean)) return null;
  return async (colors, output) => {
    checkCancellation(signal);
    const panes = panesForIdentity(colors);
    const tables = panes.map((pane, family) => pane && colorTable(pane, family));
    output.set(source);
    await forPixels(count, signal, (start, end) => {
      for (let i = start; i < end; i++) {
        const family = map.family[i];
        if (!family || !tables[family - 1]) continue;
        const offset = i * 4, coverage = map.coverage[i] / 255;
        const target = tables[family - 1], light = map.light[i] * 3;
        const achromatic = family === 3 || panes[family - 1] === 'B';
        // The partial-coverage base represents the clear glass at a seam. Strip
        // the key's chroma there so dark edge pixels cannot leave a violet halo.
        const gray = achromatic ? .2126 * source[offset] + .7152 * source[offset + 1] + .0722 * source[offset + 2] : 0;
        for (let channel = 0; channel < 3; channel++) {
          const base = achromatic ? gray : source[offset + channel];
          output[offset + channel] = base + coverage * (target[light + channel] - base);
        }
      }
    });
  };
}

// The renderer supplies its already byte-validated, approved raster. Refuse
// all URLs other than embedded supported formats, including external URLs.
export async function createCommanderGlassArtwork(document, dataUrl, signal) {
  checkCancellation(signal);
  if (typeof dataUrl !== 'string' || dataUrl.length > 2_000_040 || !/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl)) return null;
  const image = document.createElement('img');
  image.src = dataUrl;
  const stopDecode = () => image.removeAttribute('src');
  signal?.addEventListener('abort', stopDecode, { once: true });
  try { await image.decode(); }
  finally { signal?.removeEventListener('abort', stopDecode); }
  checkCancellation(signal);
  const scale = Math.min(1, Math.sqrt(maxPixels / (image.naturalWidth * image.naturalHeight)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale));
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const original = context.getImageData(0, 0, canvas.width, canvas.height);
  const paint = await prepareGlassPigments(original.data, signal);
  if (!paint) return { original: true }; // Decoded and inspected: no keyed pigments.
  return {
    async render(colors) {
      checkCancellation(signal);
      // Independent buffers allow overlapping renders for rapid seat/skin
      // switches. toBlob snapshots the bitmap at the instant it is called.
      const result = context.createImageData(canvas.width, canvas.height);
      await paint(colors, result.data);
      checkCancellation(signal);
      context.putImageData(result, 0, 0);
      return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    },
  };
}
