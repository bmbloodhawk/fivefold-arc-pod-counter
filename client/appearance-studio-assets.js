import { appearanceAssetReferences, inspectImageData } from './appearance-validation.js?v=5';
import { SURFACE_ART_SLOTS } from './appearance-surface-art.js';

const roleInfo = {
  background:['Background art','The foundation color fills the background.'],
  seal:['Center seal','The built-in seal remains visible.'],
  symbol:['Counter icon','The counter keeps its built-in symbol and label.'],
  dial:['Dial art','The standard dial surface is used.'],
  overlay:['Art overlay','The underlying surface remains visible.'],
  panel:['Surface art','The native bar, card, dialog or panel remains visible.'],
  thumbnail:['Library thumbnail','The skin uses its color swatch.'],
  button:['Button treatment','The button keeps its normal treatment.']
};
const hints = {
  background:'Allow room to crop on both portrait phones and wider screens.',
  symbol:'Square art works best at counter-icon size.',
  seal:'Keep the seal centered in a square image.',
  dial:'Center the design in a square so it stays aligned as the dial turns.',
  thumbnail:'Use a square crop that remains recognizable in the skin library.',
  button:'A wide strip fits the End Turn button. Keep detail clear of the label.',
  overlay:'Use transparent art so counters and labels stay visible.',
  panel:'For turn bars, navigation plates, player cards, game headers and counter dialogs. Leave space around the focal point for text and different panel proportions.'
};
export function artworkSizeHint(role) {
  const edge = ['symbol','seal','thumbnail'].includes(role) ? 512 : 1536;
  return (hints[role] || '') + ' Long edges above ' + edge + ' px are reduced on import.';
}
export function artworkFitNote(role,info) {
  if (!info) return '';
  const ratio = info.width/info.height;
  if (['symbol','seal','thumbnail','dial'].includes(role) && (ratio > 1.5 || ratio < 1/1.5)) return 'Check the crop in the preview, or use square artwork.';
  if (role === 'button' && ratio < 2) return 'Check the End Turn label and crop, or use a wider strip.';
  return '';
}
const parsed = new WeakMap();
export function assetInspection(asset) {
  if (!asset || typeof asset !== 'object') return {error:'Missing asset record.'};
  const prior = parsed.get(asset);
  if (prior && prior.data === asset.data) return prior.result;
  let result;
  try {
    const info = inspectImageData(asset.data);
    const mismatch = ['mimeType','width','height','bytes'].find(key => asset[key] != null && asset[key] !== info[key]);
    result = mismatch ? {error:'Recorded ' + mismatch + ' differs from the image. Reimport the original artwork under a new ID.'} : {info};
  }
  catch (error) { result = {error:asset.data ? error.message : 'Image data unavailable. Reload the catalog to retry.'}; }
  parsed.set(asset,{data:asset.data,result});
  return result;
}

export function assetUsages(assetId, skins, draft) {
  const usages = new Set();
  const scan = (skin,name) => {
    if (!skin) return;
    for (const ref of appearanceAssetReferences(skin)) {
      if (ref.id !== assetId) continue;
      const path = ref.path.replace(/^versions\.(\d+)\./, (_,index) => 'saved version ' + (Number(index) + 1) + ' · ')
        .replace('buttonAsset','End Turn art').replace('backgroundAsset','background').replace('sealAsset','center seal').replace('thumbnailAsset','thumbnail')
        .replace(/surfaceArt\.([A-Za-z]+)\.assetId/,(_,key) => 'surface art · ' + (SURFACE_ART_SLOTS[key]?.label || key))
        .replace(/counterDesign\.modes\.([a-z]+)\.artAsset/,(_,mode) => mode + ' counter art')
        .replace(/counterDesign\.modes\.([a-z]+)\.ringArtAsset/,(_,mode) => mode + ' dial ring')
        .replace('symbolAssets.','counter icon · ').replace('.overlays.',' · overlay · ');
      usages.add(name + ' · ' + path);
    }
  };
  for (const skin of skins) scan(skin,skin.name || skin.id);
  if (draft) scan({...draft,versions:[]},'Open draft');
  return [...usages];
}
export function renderAssetLibrary(container, {assets, skins, draft, approve, remove, crop, saving}) {
  container.replaceChildren();
  const node = (tag, text, cls) => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; return el; };
  if (!assets.length) { container.append(node('p','Import artwork to preview it here and check where it is used.','helper')); return; }
  for (const asset of assets) {
    const usages = assetUsages(asset.id,skins,draft);
    const [role,fallback] = roleInfo[asset.placement] || ['Unsupported placement','The built-in appearance is used.'];
    const {info,error} = assetInspection(asset);
    const pending = asset.status === 'Pending';
    const row = node('article','','review-asset'), details = node('div','','asset-info');
    const sample = info ? document.createElement('img') : node('span','◇','art-sample');
    if (info) { sample.alt = ''; sample.className = 'art-sample'; sample.src = asset.data; sample.loading = 'lazy'; }
    details.append(node('strong',asset.name),node('small',(pending ? 'Pending review' : 'Approved') + ' · ' + role));
    if (info) details.append(node('small',info.width+' × '+info.height+' · '+info.mimeType.split('/')[1].toUpperCase()+' · '+Math.ceil(info.bytes/1024)+' KB'));
    if (error) details.append(node('small',error));
    else {
      const fit = artworkFitNote(asset.placement,info);
      if (fit) details.append(node('small',fit));
    }

    details.append(node('small','Source · ' + asset.source),node('small','Fallback · ' + fallback));
    const usage = node('details',''); usage.append(node('summary',usages.length ? 'Used in '+usages.length+' locations' : 'Unused'));
    usage.append(node('small',usages.length ? usages.join(' / ') : 'No saved skin, saved version or open draft uses this artwork.'));
    details.append(usage,node('small','ID · ' + asset.id)); row.append(sample,details);
    if (pending || (info && crop)) {
      const actions = node('div','','asset-actions');
      const action = (label,fn,disabled) => { const button = node('button',label,'text-button'); button.type='button'; button.disabled = saving || disabled; button.addEventListener('click',()=>fn(asset.id)); actions.append(button); return button; };
      if (info && crop) action('Crop a copy',crop,false).dataset.cropSource = asset.id;
      if (pending) {
        action('Approve artwork',approve,!info); if (!usages.length) action('Remove unused artwork',remove,false);
      }
      row.append(actions);
    }
    container.append(row);
  }
}
