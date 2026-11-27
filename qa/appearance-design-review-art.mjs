// Optional original artwork for the disposable loopback review catalog only.
// Production recipes and saved catalogs never import this module.
import { readFile } from 'node:fs/promises';
import { inspectImageData } from '../client/appearance-validation.js';

const fixtureArt = [
  { id: 'qa-observatory-rose', file: 'observatory-rose.webp', name: 'Observatory rose', placement: 'dial' },
  { id: 'qa-violet-glasswork', file: 'violet-glasswork.webp', name: 'Violet glasswork', placement: 'panel' },
];
const modes = ['life', 'commander', 'radiation', 'poison', 'energy', 'generic'];
const surfaces = ['turnBar', 'navigation', 'playerCard', 'counterPanel', 'gameHeader', 'gameDialog', 'resultHeader'];

export async function loadDesignReviewArt(catalog) {
  const targetId = 'studio-example-rose-window';
  if (!catalog.skins.some(skin => skin.id === targetId)) throw new Error('Original review artwork needs STUDIO_DESIGN_REVIEW=1 and its Rose Window example.');
  const assets = await Promise.all(fixtureArt.map(async ({ file, ...asset }) => {
    const bytes = await readFile(new URL('./fixtures/appearance-art/' + file, import.meta.url));
    const data = 'data:image/webp;base64,' + bytes.toString('base64');
    return { ...asset, source: 'Original artwork generated for disposable Appearance Studio review (2026-11-23)', status: 'Approved', ...inspectImageData(data), data };
  }));
  if (assets.some(asset => catalog.assets.some(row => row.id === asset.id))) throw new Error('Original review artwork fixture IDs already exist. Start with a fresh disposable catalog.');
  return {
    ...catalog,
    assets: [...catalog.assets, ...assets],
    skins: catalog.skins.map(skin => skin.id !== targetId ? skin : {
      ...skin,
      counterDesign: { ...skin.counterDesign, modes: Object.fromEntries(modes.map(mode => [mode, { ...skin.counterDesign?.modes?.[mode], artAsset: 'qa-observatory-rose', artOpacity: 35, artScale: 105 }])) },
      surfaceArt: { ...skin.surfaceArt, ...Object.fromEntries(surfaces.map(slot => [slot, { assetId: 'qa-violet-glasswork', fit: 'cover', scale: 110, positionX: 50, positionY: 50, opacity: slot === 'counterPanel' ? 14 : 22 }])) },
    }),
  };
}
