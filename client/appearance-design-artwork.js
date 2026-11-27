import { SURFACE_ART_SLOTS, SURFACE_ART_ROLES } from './appearance-surface-art.js';
import { COUNTER_DESIGN_MODES } from './counter-design.js?v=5';

const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
export function designArtworkReferences(skin) {
  const refs = [], surfaces = object(skin?.surfaceArt), modes = object(object(skin?.counterDesign).modes);
  for (const key of Object.keys(SURFACE_ART_SLOTS)) {
    const id = object(surfaces[key]).assetId;
    if (validId(id)) refs.push({ id, path: `surfaceArt.${key}.assetId`, roles: [...SURFACE_ART_ROLES], dataKey: 'surfaceArtData', slot: key });
  }
  for (const key of COUNTER_DESIGN_MODES) {
    const mode = object(modes[key]);
    for (const [field, dataKey] of [['artAsset', 'counterArtData'], ['ringArtAsset', 'counterRingArtData']]) {
      const id = mode[field];
      if (validId(id)) refs.push({ id, path: `counterDesign.modes.${key}.${field}`, roles: ['dial', 'seal', 'overlay'], dataKey, slot: key });
    }
  }
  return refs;
}
function assign(result, ref, data) {
  result[ref.dataKey] ||= {};
  result[ref.dataKey][ref.slot] = typeof data === 'string' ? data : '';
}
export function resolveDesignArtwork(skin, resolveAsset) {
  const result = {};
  for (const ref of designArtworkReferences(skin)) {
    let data = '';
    try { data = resolveAsset(ref.id, ref.roles); } catch { /* Missing art uses the native surface. */ }
    assign(result, ref, data);
  }
  return result;
}
export async function hydrateDesignArtwork(skin, resolveAsset) {
  const result = {};
  await Promise.all(designArtworkReferences(skin).map(async ref => {
    let data = '';
    try { data = await resolveAsset(ref.id, ref.roles); } catch { /* Keep private storage errors off public DTOs. */ }
    assign(result, ref, data);
  }));
  return result;
}
