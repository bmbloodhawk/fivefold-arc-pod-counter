// Optional v2 decoration. This module never reads or changes counter values,
// targets, ownership, transport, or saved appearance preferences.
export const COUNTER_DESIGN_MODES = Object.freeze(['life','commander','radiation','poison','energy','generic']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const record = fields => ({type:'object',fields});
const choice = (...values) => ({type:'enum',values});
const number = (min,max) => ({type:'number',min,max});
const modeFields = {
  accent:{type:'color'},surface:{type:'color'},text:{type:'color'},
  face:choice('native','rings','radial','faceted'),
  markings:choice('native','ticks','runes','none'),
  captionBacking:choice('native','surface','compact'),
  seal:choice('native','mode','none'),icon:choice('native','configured'),
  artAsset:{type:'id'},artScale:number(70,130),
};
export function counterArtStrengthLimit(skin) {
  return skin?.rendererVersion === 2 && skin.commanderTreatment === 'prismatic-glass' ? 100 : 55;
}
function schema(maxStrength, extraFields = {}) {
  const mode = record({ ...modeFields, artOpacity: number(0,maxStrength), ...extraFields });
  return record({ navigationIcons:choice('native','configured'), modes:record(Object.fromEntries(COUNTER_DESIGN_MODES.map(key => [key,mode]))) });
}
export const counterDesignSpec = schema(55, {captionBacking:choice('native','surface')});
const expandedSpec = schema(55);
const glassSpec = schema(100, { uprightCenter: {type:'boolean'} });
export function counterDesignSpecFor(skin) {
  if (skin?.rendererVersion !== 2) return counterDesignSpec;
  return counterArtStrengthLimit(skin) === 100 ? glassSpec : expandedSpec;
}
export const counterArtDataSpec = record(Object.fromEntries(COUNTER_DESIGN_MODES.map(mode=>[mode,{type:'image'}])));

export function nativeDraftIcons(skin) {
  const result = structuredClone(skin);
  result.counterDesign = {...object(result.counterDesign),navigationIcons:'native'};
  return result;
}

export function usesNativeCounterIcon(skin,mode) {
  if (skin?.id === '__neutral_arc__' || skin?.rendererVersion !== 2) return true;
  const design = object(skin?.counterDesign), override = object(object(design.modes)[mode]).icon;
  return override === 'native' || (override !== 'configured' && design.navigationIcons === 'native');
}

export function counterDesignFor(skin,mode,safeImage = ()=>'') {
  if (skin?.rendererVersion !== 2 || skin?.id === '__neutral_arc__' || !COUNTER_DESIGN_MODES.includes(mode)) return null;
  const source = object(object(object(skin.counterDesign).modes)[mode]);
  const result = {};
  for (const field of ['accent','surface','text']) if (/^#[0-9a-f]{6}$/i.test(source[field])) result[field] = source[field];
  for (const field of ['face','markings','seal','captionBacking']) if (modeFields[field].values.includes(source[field]) && source[field] !== 'native') result[field] = source[field];
  if (result.captionBacking) {
    const color=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(value)?value:fallback;
    const tokens=object(skin.tokens?.color);
    result.captionSurface=color(source.surface,color(skin.surface,color(tokens.surface,'#161616')));
    result.captionText=color(source.text,color(skin.text,color(tokens.text,'#f4ecd9')));
    result.captionAccent=color(source.accent,color(skin.accent,color(tokens.accentPrimary,'#d8ae61')));
  }
  result.art = safeImage(object(skin.counterArtData)[mode]);
  if (result.art && skin.commanderTreatment === 'prismatic-glass' && source.uprightCenter === true) result.uprightCenter = true;
  result.artOpacity = Number.isFinite(Number(source.artOpacity)) ? Math.min(counterArtStrengthLimit(skin),Math.max(0,Number(source.artOpacity))) / 100 : .28;
  result.artScale = Number.isFinite(Number(source.artScale)) ? Math.min(130,Math.max(70,Number(source.artScale))) / 100 : 1;
  return Object.keys(result).some(key=>!['art','artOpacity','artScale'].includes(key)) || result.art ? result : null;
}

export function createCounterDesignRenderer(document,{safeImage}) {
  const game = document.querySelector('#gameView');
  const face = document.querySelector('.dial-face');
  // Capture the authored native SVGs before a configured navigation skin runs.
  const nativeIcons = new Map(COUNTER_DESIGN_MODES.map(mode=>[mode,document.querySelector('[data-mode="'+mode+'"]')?.querySelector('svg')?.cloneNode(true)]));
  const variables = ['accent','surface','text','art-opacity','art-scale','caption-surface','caption-text','caption-accent'];
  const datasets = ['counterDesign','counterFace','counterMarkings','counterSeal','counterAccent','counterSurface','counterText','counterCaptionBacking'];
  let nodes = [], source = null, activeMode = null, artwork = null;
  function clear() {
    for (const node of nodes) node.remove();
    nodes = []; source = null; activeMode = null; artwork = null;
    if (!game) return;
    for (const field of datasets) delete game.dataset[field];
    for (const field of variables) game.style.removeProperty('--counter-design-'+field);
  }
  function decoration(className) {
    const node = document.createElement('div');
    node.className = className; node.setAttribute('aria-hidden','true');
    face.append(node); nodes.push(node);
    return node;
  }
  function refresh(skin,mode) {
    if (source === skin && activeMode === mode) return artwork;
    clear(); source = skin; activeMode = mode;
    const design = counterDesignFor(skin,mode,safeImage);
    if (!design || !face || !game) return;
    game.dataset.counterDesign = 'true';
    for (const field of ['face','markings','seal','captionBacking']) if (design[field]) game.dataset['counter'+field[0].toUpperCase()+field.slice(1)] = design[field];
    for (const field of ['accent','surface','text']) if (design[field]) {
      game.dataset['counter'+field[0].toUpperCase()+field.slice(1)] = 'true';
      game.style.setProperty('--counter-design-'+field,design[field]);
    }
    if (design.captionBacking) for (const field of ['Surface','Text','Accent']) {
      game.style.setProperty('--counter-design-caption-'+field.toLowerCase(),design['caption'+field]);
    }
    const surface = decoration('counter-design-face');
    if (design.art) {
      const image = document.createElement('img'); image.alt = '';
      // The glass renderer sets a processed source after it resolves the
      // inspected player's identity. The keyed master is never visible.
      if (skin.commanderTreatment === 'prismatic-glass') image.hidden = true;
      else image.src = design.art;
      artwork = { node: image, source: design.art };
      surface.append(image);
      if (design.uprightCenter) {
        surface.classList.add('counter-design-ring');
        const engraving = decoration('counter-design-engraving');
        const center = document.createElement('img');
        center.alt = ''; center.hidden = true;
        engraving.append(center);
        artwork.engraving = center;
      }
      game.style.setProperty('--counter-design-art-opacity',String(design.artOpacity));
      game.style.setProperty('--counter-design-art-scale',String(design.artScale));
    }
    if (design.markings && design.markings !== 'none') {
      const markings = decoration('counter-design-markings');
      if (design.markings === 'runes') for (let index=0;index<12;index+=1) {
        const rune = document.createElement('span'); rune.textContent = ['ᛟ','ᚱ','ᛉ','ᚷ'][index%4];
        rune.style.setProperty('--counter-rune-index',String(index)); markings.append(rune);
      }
    }
    if (design.seal === 'mode' && nativeIcons.get(mode)) {
      const emblem = decoration('counter-design-emblem');
      emblem.append(nativeIcons.get(mode).cloneNode(true));
    }
    return artwork;
  }
  return {clear,refresh};
}
