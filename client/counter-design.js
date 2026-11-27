// Optional v2 decoration. This module never reads or changes counter values,
// targets, ownership, transport, or saved appearance preferences.
export const COUNTER_DESIGN_MODES = Object.freeze(['life','commander','radiation','poison','energy','generic']);
export const COUNTER_TAB_SETS = Object.freeze({neutral:'Neutral Arc', ink:'Woodcut ink', circuit:'Circuit traces', glass:'Leaded glass'});
const patternTabSets = Object.freeze({dots:'ink', grid:'circuit', weave:'glass'});

export function nativeTabSet(skin) {
  const selected = skin.counterDesign?.nativeIconSet;
  if (Object.hasOwn(COUNTER_TAB_SETS, selected)) return selected;
  const pattern = skin.canvasDesign?.pattern;
  return Object.hasOwn(patternTabSets, pattern) ? patternTabSets[pattern] : 'neutral';
}

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
export function counterArtStrengthLimit(skin, mode) {
  if (skin?.rendererVersion !== 2) return 55;
  return skin.commanderTreatment === 'prismatic-glass' || skin.counterDesign?.modes?.[mode]?.captionBacking === 'surface' ? 100 : 55;
}
function schema(maxStrength, extraFields = {}, tabFields = {}) {
  const mode = record({ ...modeFields, artOpacity: number(0,maxStrength), ...extraFields });
  return record({ ...tabFields, navigationIcons:choice('native','configured'), modes:record(Object.fromEntries(COUNTER_DESIGN_MODES.map(key => [key,mode]))) });
}
export const counterDesignSpec = schema(55,{captionBacking:choice('native','surface')});
const movingArtFields = { uprightCenter: {type:'boolean'}, artRotation: choice('dial','fixed'), ringArtAsset:{type:'id'}, ringCrop:choice('annulus','full') };
const tabSetField = { nativeIconSet:choice(...Object.keys(COUNTER_TAB_SETS)) };
const expandedSpec = schema(55, movingArtFields, tabSetField);
const glassSpec = schema(100, movingArtFields, tabSetField);
export function counterDesignSpecFor(skin) {
  if (skin?.rendererVersion !== 2) return counterDesignSpec;
  if (skin.commanderTreatment === 'prismatic-glass') return glassSpec;
  const modes = { ...expandedSpec.fields.modes.fields };
  for (const mode of COUNTER_DESIGN_MODES) {
    if (counterArtStrengthLimit(skin,mode) === 100) modes[mode] = glassSpec.fields.modes.fields[mode];
  }
  return record({ ...expandedSpec.fields, modes: record(modes) });
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
  if (override) return override === 'native';
  if (design.navigationIcons) return design.navigationIcons === 'native';
  return !Object.hasOwn(object(skin.symbols), mode);
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
  if (typeof source.ringArtAsset === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(source.ringArtAsset)) {
    const ring = safeImage(object(skin.counterRingArtData)[mode]);
    if (ring) {
      result.ringArt = ring;
      if (source.ringCrop === 'full') result.ringCrop = 'full';
    }
  }
  if (result.art && !result.ringArt) {
    if (source.uprightCenter === true) result.uprightCenter = true;
    if (movingArtFields.artRotation.values.includes(source.artRotation)) result.artRotation = source.artRotation;
  }
  const socket = skin.tableDesign?.dialSocket;
  if (socket === 'metal' || socket === 'stone') result.socket = socket;
  else if (socket !== 'none' && (result.art || result.ringArt) && skin.commanderTreatment === 'prismatic-glass') result.socket = 'stone';
  result.artOpacity = Number.isFinite(Number(source.artOpacity)) ? Math.min(counterArtStrengthLimit(skin,mode),Math.max(0,Number(source.artOpacity))) / 100 : .28;
  result.artScale = Number.isFinite(Number(source.artScale)) ? Math.min(130,Math.max(70,Number(source.artScale))) / 100 : 1;
  return Object.keys(result).some(key=>!['art','artOpacity','artScale'].includes(key)) || result.art ? result : null;
}

export function createCounterDesignRenderer(document,{safeImage}) {
  const game = document.querySelector('#gameView');
  const face = document.querySelector('.dial-face');
  // Capture the authored native SVGs before a configured navigation skin runs.
  const nativeIcons = new Map(COUNTER_DESIGN_MODES.map(mode=>[mode,document.querySelector('[data-mode="'+mode+'"]')?.querySelector('svg')?.cloneNode(true)]));
  const variables = ['accent','surface','text','art-opacity','art-scale','caption-surface','caption-text','caption-accent'];
  const datasets = ['counterDesign','counterFace','counterMarkings','counterSeal','counterAccent','counterSurface','counterText','counterCaptionBacking','counterSocket','counterArtRotation','counterValueBacking','counterRingArt','counterRingCrop'];
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
  function addImage(parent, data, waitForPigment = false) {
    const image = document.createElement('img');
    image.alt = '';
    if (waitForPigment) image.hidden = true;
    else image.src = data;
    parent.append(image);
    return image;
  }
  function refresh(skin,mode) {
    if (source === skin && activeMode === mode) return artwork;
    clear(); source = skin; activeMode = mode;
    const design = counterDesignFor(skin,mode,safeImage);
    if (!design || !face || !game) return;
    game.dataset.counterDesign = 'true';
    if (design.socket) game.dataset.counterSocket = design.socket;
    if (design.artRotation) game.dataset.counterArtRotation = design.artRotation;
    if (design.ringArt) game.dataset.counterRingArt = 'separate';
    if (design.ringCrop) game.dataset.counterRingCrop = design.ringCrop;
    if ((design.art || design.ringArt) && design.artOpacity > .55 && design.captionBacking === 'surface' && skin.commanderTreatment !== 'prismatic-glass') game.dataset.counterValueBacking = 'surface';
    for (const field of ['face','markings','seal','captionBacking']) if (design[field]) game.dataset['counter'+field[0].toUpperCase()+field.slice(1)] = design[field];
    for (const field of ['accent','surface','text']) if (design[field]) {
      game.dataset['counter'+field[0].toUpperCase()+field.slice(1)] = 'true';
      game.style.setProperty('--counter-design-'+field,design[field]);
    }
    if (design.captionBacking) for (const field of ['Surface','Text','Accent']) {
      game.style.setProperty('--counter-design-caption-'+field.toLowerCase(),design['caption'+field]);
    }
    const surface = decoration('counter-design-face');
    if (design.ringArt) {
      const ring = document.createElement('div');
      ring.className = 'counter-design-ring';
      surface.append(ring);
      addImage(ring, design.ringArt);
    }
    if (design.art) {
      // Only the center master belongs to the commander painter. Legacy
      // single-image split dials paint its second copy with the same result.
      const waitForPigment = skin.commanderTreatment === 'prismatic-glass';
      const center = design.ringArt ? decoration('counter-design-engraving') : surface;
      artwork = { node: addImage(center, design.art, waitForPigment), source: design.art };
      if (design.uprightCenter) {
        surface.classList.add('counter-design-ring');
        artwork.engraving = addImage(decoration('counter-design-engraving'), design.art, waitForPigment);
      }
    }
    if (design.art || design.ringArt) {
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
