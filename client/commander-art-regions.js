export const REGION_SURFACES = Object.freeze(['background', 'life', 'commander', 'radiation', 'poison', 'energy', 'generic']);
export const REGION_LIMIT = 12;
export const POINT_LIMIT = 32;

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactFields = (value, fields) => record(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));

function polygonArea(points) {
  return Math.abs(points.reduce((sum, [x, y], index) => {
    const [nextX, nextY] = points[(index + 1) % points.length];
    return sum + x * nextY - y * nextX;
  }, 0)) / 2;
}

export function validRegionPoints(points) {
  return Array.isArray(points) && points.length >= 3 && points.length <= POINT_LIMIT
    && points.every(point => Array.isArray(point) && point.length === 2
      && point.every(value => Number.isFinite(value) && value >= 0 && value <= 100))
    && polygonArea(points) >= .01;
}

export function validRegionSurface(surface) {
  return exactFields(surface, ['assetId', 'source', 'regions'])
    && typeof surface.assetId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(surface.assetId)
    && ['owner', 'viewed'].includes(surface.source)
    && Array.isArray(surface.regions) && surface.regions.length > 0 && surface.regions.length <= REGION_LIMIT
    && surface.regions.every(region => exactFields(region, ['slot', 'points'])
      && Number.isInteger(region.slot) && region.slot >= 1 && region.slot <= 5 && validRegionPoints(region.points));
}

export function validCommanderRegions(value) {
  return record(value) && Object.keys(value).length <= REGION_SURFACES.length
    && Object.entries(value).every(([key, surface]) => REGION_SURFACES.includes(key) && validRegionSurface(surface));
}

export function regionAssetId(skin, surface) {
  return surface === 'background' ? skin?.backgroundAsset : skin?.counterDesign?.modes?.[surface]?.artAsset;
}

export function assignedRegionSurface(skin, surface) {
  const assigned = skin?.commanderRegions?.[surface];
  return validRegionSurface(assigned) && assigned.assetId === regionAssetId(skin, surface) ? assigned : null;
}
