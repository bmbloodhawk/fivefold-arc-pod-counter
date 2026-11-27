import { inspectImageData, publicAppearanceSkin } from './appearance-validation.js?v=5';
import { createCounterDesignRenderer, usesNativeCounterIcon, nativeTabSet } from './counter-design.js?v=5';
import { previewGeometryChecks } from './appearance-preflight.js';
import { compileSurfaceDesign } from './appearance-surface-design.js';
import { appearanceFonts, fontFamily, localFontKeys, prepareAppearanceFonts } from './appearance-fonts.js';
import { createSurfaceArtRenderer } from './appearance-surface-art.js';
import { compileTableDesign, hasCustomGeometry } from './appearance-table-design.js?v=4';
import { createCommanderGlass } from './commander-glass.js?v=2';
import { createRegionRenderer } from './commander-region-renderer.js';
// Cosmetic projection shared by the real game and isolated Studio fixtures.
// No transport, rules, account preferences, selectors or executable content.
export const RENDERER_MODES = ['life', 'commander', 'radiation', 'poison', 'energy', 'generic'];
export const PREVIEW_STATES = ['lobby', 'turn', 'other', 'damage', 'offline', 'status', 'error', 'dialog', 'end', 'menu', 'radiationDialog', 'commanderDialog', 'eliminated', 'longLabels'];
const icons = { life: '♥', commander: '♜', radiation: '☢', poison: '☠', energy: 'ϟ', generic: '◇' };
const colorDefaults = { background: '#080808', surface: '#161616', text: '#f4ecd9', muted: '#afa590', accent: '#d8ae61', secondary: '#6e552a', atmosphereColor: '#70a97a', stateSuccess: '#85c799', stateWarning: '#efc968', stateDanger: '#ed866f', focusColor: '#d8ae61' };
const numericFields = {
  labelTextScale: [100, 85, 115], seatTextScale: [100, 85, 115], seatRadius: [8, 0, 24], buttonRadius: [8, 0, 24],
  centerSealScale: [100, 60, 150], centerSealOffsetX: [0, -18, 18], centerSealOffsetY: [0, -18, 18],
  lifeNumberScale: [100, 75, 140], lifeNumberOffsetX: [0, -14, 14], lifeNumberOffsetY: [0, -14, 14],
  counterOffsetY: [0, -18, 18], turnOffsetY: [0, -12, 12], controlsOffsetY: [0, -12, 12], seatGap: [8, 4, 16],
  atmosphereStrength: [0, 0, 80], backgroundScale: [100, 50, 200], backgroundPositionX: [50, 0, 100], backgroundPositionY: [50, 0, 100],
};
const regions = { podStrip: 'pod-strip', counterReadout: 'counter-readout', dialSurface: 'dial-surface', commanderDamage: 'commander-damage', turnActions: 'turn-actions', adjustControls: 'adjust-controls', customLife: 'custom-life', commanderTax: 'commander-tax', modeNav: 'mode-nav' };
const componentNames = { endTurn: 'end-turn', lifeButtons: 'life-buttons', playerCards: 'player-cards', navigation: 'navigation' };
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const number = (value, fallback, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
const named = (value, values, fallback) => values.includes(value) ? value : fallback;
const kebab = value => value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);

export function materializeRendererSkin(value) {
  const skin = publicAppearanceSkin(record(value)), tokens = record(skin.tokens);
  const fields = { color: {canvas:'background',surface:'surface',text:'text',textMuted:'muted',accentPrimary:'accent',accentSecondary:'secondary',atmosphere:'atmosphereColor',success:'stateSuccess',warning:'stateWarning',danger:'stateDanger',focus:'focusColor',border:'borderColor',disabled:'disabledColor'}, typography:{family:'fontFamily',weight:'fontWeight',lineHeight:'lineHeight',letterSpacing:'letterSpacing',textTransform:'textTransform',labelAlignment:'labelAlignment',textEffect:'textEffect'}, effects:{backgroundTreatment:'backgroundTreatment',buttonTreatment:'buttonTreatment',seatTreatment:'seatTreatment'} };
  for (const [group,names] of Object.entries(fields)) for (const [token,field] of Object.entries(names)) if (skin[field] == null && record(tokens[group])[token] != null) skin[field] = tokens[group][token];
  for (const prefix of ['seat','button','lifeButton','customLife','commanderTax','commanderDamage']) for (const property of ['opacity','blur','border']) { const field = prefix + property[0].toUpperCase() + property.slice(1); if (skin[field] == null && record(record(tokens.components)[prefix])[property] != null) skin[field] = tokens.components[prefix][property]; }
  return skin;
}

export function rendererComponentDefaults(value) {
  const skin = record(value), surface = color(skin.surface,colorDefaults.surface), text = color(skin.text,colorDefaults.text), muted = color(skin.muted,colorDefaults.muted), accent = color(skin.accent,colorDefaults.accent);
  return {
    endTurn:{background:accent,text:'#1c180e',border:accent},
    lifeButtons:{background:surface,text,border:color(skin.borderColor,'#62583f')},
    playerCards:{background:surface,text,border:color(skin.borderColor,'#5b594f')},
    navigation:{background:surface,text:muted,border:color(skin.borderColor,'#4b4b44'),selectedText:accent,selectedBorder:accent},
  };
}

// Studio source SVG is rasterized before upload. Do not render active SVG or URLs
// from a message; the catalog resolves approved asset IDs into inert raster data.
// Repeated edits send the same roster of raster strings. Cache only successful
// byte inspections by exact value, with a fixed bound for large art libraries.
const vettedImages = new Map();
const imageCacheLimit = 12_000_000;
let cachedImageCharacters = 0;
function safeImage(value) {
  if (!value || typeof value !== 'string') return '';
  if (vettedImages.has(value)) return value;
  let info;
  try { info = inspectImageData(value); } catch { return ''; }
  while (cachedImageCharacters + value.length > imageCacheLimit && vettedImages.size) {
    const oldest = vettedImages.keys().next().value;
    vettedImages.delete(oldest); cachedImageCharacters -= oldest.length;
  }
  vettedImages.set(value, info); cachedImageCharacters += value.length;
  return value;
}


export function normalizePreviewFixture(value) {
  return { state: named(value?.previewState, PREVIEW_STATES, 'turn'), mode: named(value?.previewMode, RENDERER_MODES, value?.previewState === 'damage' ? 'commander' : 'life'), players: [2, 3, 4, 5, 6, 7, 8].includes(Number(value?.previewPlayers)) ? Number(value.previewPlayers) : 4 };
}

export function phoneLayoutChanges(value) {
  if (value?.previewReadOnly || value?.id === '__neutral_arc__') return null;
  const skin = publicAppearanceSkin(record(value));
  if (!skin.modeLayouts) return null;
  const modeLayouts = structuredClone(skin.modeLayouts);
  for (const layout of Object.values(modeLayouts)) delete layout.overlayData;
  return { interfaceStyle: skin.interfaceStyle === 'dial' ? 'dial' : 'button', modeLayouts };
}

export function previewMessageAllowed(event, trustedOrigin, expectedSource) {
  if (!expectedSource || event.source !== expectedSource) return false;
  try {
    if ('Origin' in globalThis) return !Origin.from(event.origin).opaque && Origin.from(event.origin).isSameOrigin(Origin.from(trustedOrigin));
    const sender = new URL(event.origin), trusted = new URL(trustedOrigin);
    return sender.origin !== 'null' && sender.origin === trusted.origin;
  } catch { return false; }
}

// Version 1 is the released production contract, including its historical
// defaults. Do not apply preview-only fields or modern token defaults here.
function buildLegacyTheme(skin, interfaceStyle) {
  const assets = {
    background: safeImage(skin.backgroundData),
    seal: safeImage(skin.sealData),
    symbols: {},
    symbolScale: {},
    overlays: {},
    dialArtSpin: skin.dialArtSpin === true,
  };
  const result = {
    native: false,
    version: 1,
    variables: {},
    datasets: {
      appearanceSeat: named(skin.seatTreatment, ['raised', 'flat', 'glass'], 'raised'),
      appearanceButton: named(skin.buttonTreatment, ['solid', 'outline', 'glass'], 'solid'),
    },
    assets,
  };
  const vars = result.variables;
  const legacyNumber = (value, fallback, min, max) =>
    number(Number(value) || fallback, fallback, min, max);
  const palette = {
    background: 'bg', surface: 'surface', text: 'ink',
    muted: 'muted', accent: 'brass', secondary: 'brass-dark',
  };
  for (const [field, css] of Object.entries(palette)) {
    vars['--' + css] = color(skin[field], colorDefaults[field]);
  }
  vars['--surface-2'] = vars['--surface'];
  vars['--skin-atmosphere'] = color(skin.atmosphereColor, color(skin.secondary, '#000000'));
  vars['--skin-atmosphere-strength'] = String(Math.min(.8, Math.max(0, Number(skin.atmosphereStrength || 0) / 100)));
  vars['--skin-atmosphere-position'] = skin.atmospherePosition === 'bottom'
    ? '50% 100%' : skin.atmospherePosition === 'center' ? '50% 50%' : '50% 0%';
  // The released renderer treated zero radii/borders as their defaults.
  vars['--skin-seat-radius'] = legacyNumber(skin.seatRadius, 8, 0, 24) + 'px';
  vars['--skin-button-radius'] = legacyNumber(skin.buttonRadius, 8, 0, 24) + 'px';
  for (const prefix of ['seat', 'button']) {
    vars['--skin-' + prefix + '-opacity'] = String(legacyNumber(skin[prefix + 'Opacity'], 100, 35, 100));
    vars['--skin-' + prefix + '-blur'] = String(legacyNumber(skin[prefix + 'Blur'], 0, 0, 16));
    vars['--skin-' + prefix + '-border'] = String(legacyNumber(skin[prefix + 'Border'], 70, 0, 100));
  }
  const layout = record(record(skin.modeLayouts)[interfaceStyle] || skin.componentLayout);
  for (const [key, css] of Object.entries(regions)) {
    const placement = record(record(layout.componentLayout)[key]);
    vars['--skin-' + css + '-x'] = legacyNumber(placement.x, 0, -100, 100) + 'px';
    vars['--skin-' + css + '-y'] = legacyNumber(placement.y, 0, -140, 140) + 'px';
    vars['--skin-' + css + '-scale'] = String(legacyNumber(placement.scale, 100, 70, 140) / 100);
  }
  for (const mode of RENDERER_MODES) {
    assets.symbols[mode] = safeImage(record(skin.symbolData)[mode]);
    assets.symbolScale[mode] = Math.min(2, Math.max(.6, Number(record(skin.symbolScale)[mode]) || 100) / 100);
  }
  for (const slot of ['seat', 'counter', 'dial']) {
    assets.overlays[slot] = {
      data: safeImage(record(skin.overlayData)[slot]),
      opacity: legacyNumber(record(skin.overlayOpacity)[slot], 0, 0, 70) / 100,
      scale: number((Number(record(skin.overlayScale)[slot]) || 100) / 100, 1, .5, 1.6),
      blend: named(record(skin.overlayBlend)[slot], ['normal', 'screen', 'multiply', 'overlay'], 'normal'),
    };
  }
  assets.backgroundSize = legacyNumber(skin.backgroundScale, 100, 50, 200) + '% auto';
  assets.backgroundPosition = legacyNumber(skin.backgroundPositionX, 50, 0, 100) + '% '
    + legacyNumber(skin.backgroundPositionY, 50, 0, 100) + '%';
  return result;
}

export function buildRendererTheme(value, interfaceStyle = 'button') {
  const raw=publicAppearanceSkin(record(value));
  if(raw.id!=='__neutral_arc__'&&raw.rendererVersion!==2)return buildLegacyTheme(raw,interfaceStyle);
  const skin = materializeRendererSkin(raw), native = skin.id === '__neutral_arc__';
  const result = { native, version:2, variables: {}, datasets: {}, assets: { background: '', seal: '', symbols: {}, overlays: {} } };
  if (native) return result;
  const layout = { ...skin, ...record(record(skin.modeLayouts)[interfaceStyle]) };
  for (const field of ['overlays','overlayOpacity','overlayScale','overlayBlend','overlayData']) layout[field] = { ...record(skin[field]), ...record(record(record(skin.modeLayouts)[interfaceStyle])[field]) };
  const vars = result.variables, colors = Object.fromEntries(Object.entries(colorDefaults).map(([key, fallback]) => [key, color(skin[key], fallback)]));
  colors.focusColor = color(skin.focusColor,colors.accent);
  colors.atmosphereColor = color(skin.atmosphereColor,color(skin.secondary,colorDefaults.atmosphereColor));
  for (const [key, css] of Object.entries({ background: 'bg', surface: 'surface', text: 'ink', muted: 'muted', accent: 'brass', secondary: 'brass-dark', stateSuccess: 'safe', stateWarning: 'warning', stateDanger: 'danger' })) vars[`--${css}`] = colors[key];
  vars['--surface-2'] = colors.surface;
  vars['--focus-ring'] = `0 0 0 3px #fff,0 0 0 6px ${colors.focusColor}`;
  vars['--skin-font'] = fontFamily(skin.fontFamily);
  vars['--skin-font-weight'] = String(named(Number(skin.fontWeight), [400,500,600,700], 700));
  vars['--skin-line-height'] = String(number(skin.lineHeight, 1.2, 1.1, 1.6));
  vars['--skin-letter-spacing'] = `${number(skin.letterSpacing, 0, -.02, .08)}em`;
  vars['--skin-text-transform'] = named(skin.textTransform, ['none','uppercase'], 'none');
  vars['--skin-label-alignment'] = named(skin.labelAlignment, ['inherit','start','center'], 'inherit');
  vars['--skin-text-shadow'] = skin.textEffect === 'soft-shadow' ? '0 1px 3px rgb(0 0 0 / .7)' : 'none';
  for (const [key, bounds] of Object.entries(numericFields)) {
    const current = number(layout[key], ...bounds), scale = key.endsWith('Scale');
    vars[`--skin-${kebab(key)}`] = scale ? String(current / 100) : `${current}${key === 'atmosphereStrength' ? '' : 'px'}`;
  }
  // The production dial fitter already consumes this scale when measuring ink.
  vars['--appearance-life-number-scale'] = vars['--skin-life-number-scale'];
  vars['--skin-seal-scale'] = vars['--skin-center-seal-scale'];
  vars['--skin-atmosphere'] = colors.atmosphereColor;
  vars['--skin-atmosphere-strength'] = String(number(skin.atmosphereStrength, 0, 0, 80) / 100);
  vars['--skin-atmosphere-position'] = skin.atmospherePosition === 'bottom' ? '50% 100%' : skin.atmospherePosition === 'center' ? '50% 50%' : '50% 0%';
  for (const prefix of ['seat','button','lifeButton','customLife','commanderTax','commanderDamage']) {
    vars[`--skin-${kebab(prefix)}-opacity`] = String(number(skin[`${prefix}Opacity`], 100, 35, 100) / 100);
    vars[`--skin-${kebab(prefix)}-blur`] = `${number(skin[`${prefix}Blur`], 0, 0, 16)}px`;
    vars[`--skin-${kebab(prefix)}-border`] = String(number(skin[`${prefix}Border`], 70, 0, 100) / 100);
  }
  for (const [key, css] of Object.entries(regions)) {
    const placement = record(record(layout.componentLayout)[key]);
    vars[`--skin-${css}-x`] = `${number(placement.x, 0, -100, 100)}px`;
    vars[`--skin-${css}-y`] = `${number(placement.y, 0, -140, 140)}px`;
    vars[`--skin-${css}-scale`] = String(number(placement.scale, 100, 70, 140) / 100);
  }
  const componentDefaults = rendererComponentDefaults(skin);
  for (const [key, css] of Object.entries(componentNames)) {
    const override = record(record(skin.componentColors)[key]);
    for (const [field, fallback] of Object.entries(componentDefaults[key])) vars[`--skin-${css}-${kebab(field)}`] = color(override[field], fallback);
  }
  result.datasets = { appearanceSeat: named(skin.seatTreatment,['raised','flat','glass'],'raised'), appearanceButton: named(skin.buttonTreatment,['solid','outline','glass'],'solid'), appearanceRing: named(skin.ring,['arc','orbit','none'],'arc'), appearanceArt: named(skin.backgroundTreatment,['plain','rays','grain','mist','stars'],'plain') };
  result.datasets.tabIconSet = nativeTabSet(skin);
  const selectedVariants = record(skin.variants);
  for (const [key,choices] of Object.entries({dial:['engraved','plain'],seal:['etched','medallion'],counterMode:['badge','underlined'],navigation:['underline','framed'],commander:['accent','quiet'],panels:['outlined','raised'],numerals:['tabular','proportional']})) {
    if (choices.includes(selectedVariants[key])) result.datasets['variant' + key[0].toUpperCase() + key.slice(1)] = selectedVariants[key];
  }
  for (const [key,field,token] of [['Edge','borderColor','border'],['Disabled','disabledColor','disabled']]) {
    const custom = color(skin[field] ?? skin.tokens?.color?.[token],null);
    if (custom) { vars['--skin-' + token + '-color'] = custom; result.datasets['custom' + key] = 'true'; }
  }
  const buttonImage = safeImage(skin.buttonData);
  if (buttonImage) { vars['--skin-button-image'] = 'url("' + buttonImage + '")'; result.datasets.buttonArt = 'true'; }
  result.assets.background = safeImage(skin.backgroundData);
  if (skin.commanderTreatment === 'prismatic-glass' && result.assets.background) {
    const { width, height } = vettedImages.get(result.assets.background);
    result.assets.backgroundAspect = width / height;
  }
  result.assets.seal = safeImage(skin.sealData);
  for (const mode of RENDERER_MODES) result.assets.symbols[mode] = safeImage(record(skin.symbolData)[mode]);
  for (const slot of ['seat','counter','dial']) result.assets.overlays[slot] = { data: safeImage(record(layout.overlayData)[slot]), opacity: number(record(layout.overlayOpacity)[slot], {seat:35,counter:28,dial:30}[slot], 0, 70) / 100, scale: number(record(layout.overlayScale)[slot],100,50,160) / 100, blend: named(record(layout.overlayBlend)[slot],['normal','screen','multiply','overlay'],slot === 'seat' ? 'normal' : 'screen') };
  result.assets.dialArtSpin = layout.dialArtSpin === true;
  result.assets.symbolScale = Object.fromEntries(RENDERER_MODES.map(mode => [mode, number(record(skin.symbolScale)[mode],100,60,200) / 100]));
  result.assets.symbolText = Object.fromEntries(RENDERER_MODES.map(mode => [mode, typeof record(skin.symbols)[mode] === 'string' && [...skin.symbols[mode]].length <= 3 && !/[<>&"']/.test(skin.symbols[mode]) ? skin.symbols[mode] : icons[mode]]));
  result.assets.backgroundSize = `${number(skin.backgroundScale,100,50,200)}% auto`;
  result.assets.backgroundPosition = `${number(skin.backgroundPositionX,50,0,100)}% ${number(skin.backgroundPositionY,50,0,100)}%`;
  compileSurfaceDesign(skin,result);
  if(localFontKeys.includes(skin.fontFamily)) {result.datasets.localFont=skin.fontFamily;vars['--skin-font-adjust']=String(appearanceFonts[skin.fontFamily].aspect);}
  compileTableDesign(skin,result);
  return result;
}

export function createRendererBridge(document, { modeLabel = mode => mode, getCommanderTable = () => null } = {}) {
  if (!document.querySelector('link[data-renderer-theme]')) { const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('./renderer-theme.css?v=1', import.meta.url).href; stylesheet.dataset.rendererTheme = ''; document.head.append(stylesheet); }
  const root = document.documentElement, game = document.querySelector('#gameView');
  const seal = document.querySelector('.counter-sigil');
  const baseSeal = seal ? [...seal.childNodes].map(node => node.cloneNode(true)) : [];
  const baseNav = new Map(RENDERER_MODES.map(mode => [mode, [...(document.querySelector(`[data-mode="${mode}"]`)?.childNodes || [])].map(node => node.cloneNode(true))]));
  const counterDesignRenderer = createCounterDesignRenderer(document,{safeImage});
  const commanderGlass = createCommanderGlass(document, getCommanderTable);
  const regionRenderer = createRegionRenderer(document, getCommanderTable);
  let applied = new Set(), theme = null, selectedSkin = null, selectedStyle = null, artRevision = 0;
  const surfaceArtwork = createSurfaceArtRenderer(document,{safeImage});
  const renderedArt = new WeakMap();
  const image = data => { const node = document.createElement('img'); node.alt = ''; node.src = data; return node; };
  function clear(preserveGlass = false) {
    if (!preserveGlass) { commanderGlass.clear(); regionRenderer.clear(); }
    surfaceArtwork.clear();
    counterDesignRenderer.clear();
    for (const property of applied) root.style.removeProperty(property);
    applied.clear(); root.classList.remove('game-skin-active'); root.removeAttribute('data-game-skin'); root.removeAttribute('data-renderer-version');
    for (const name of Object.keys(theme?.datasets || {})) delete game.dataset[name];
    document.body.style.backgroundImage = ''; document.body.style.backgroundSize = ''; document.body.style.backgroundPosition = '';
    document.querySelectorAll('.skin-overlay').forEach(node => node.remove());
    if (seal) seal.replaceChildren(...baseSeal.map(node => node.cloneNode(true)));
    for (const [mode, children] of baseNav) { const button = document.querySelector(`[data-mode="${mode}"]`); if (button) { button.replaceChildren(...children.map(node => node.cloneNode(true))); const label = button.querySelector('small'); if (label) label.textContent = modeLabel(mode); } }
    theme = null; selectedSkin = null; selectedStyle = null;
  }
  function apply(skin, interfaceStyle) {
    const next = buildRendererTheme(skin, interfaceStyle);
    clear(next.datasets.commanderTreatment && theme?.datasets.commanderTreatment === next.datasets.commanderTreatment && selectedSkin?.id === skin?.id);
    selectedSkin = skin; selectedStyle = interfaceStyle; theme = next; artRevision += 1;
    if (theme.native) return;
    void prepareAppearanceFonts(document,publicAppearanceSkin(record(skin)));
    surfaceArtwork.apply(skin);
    root.classList.add('game-skin-active'); root.dataset.gameSkin = /^[A-Za-z0-9_-]{1,80}$/.test(skin?.id || '') ? skin.id : 'draft';
    root.dataset.rendererVersion=String(theme.version);
    for (const [name,value] of Object.entries(theme.variables)) { root.style.setProperty(name,value); applied.add(name); }
    Object.assign(game.dataset, theme.datasets);
    if (theme.datasets.commanderTreatment) refreshCommanderArtwork(counterDesignRenderer.refresh(skin, game.dataset.counterMode));
    if (theme.assets.background && !theme.datasets.commanderTreatment) { document.body.style.backgroundImage = `linear-gradient(rgb(0 0 0 / .32),rgb(0 0 0 / .32)),url("${theme.assets.background}")`; document.body.style.backgroundSize = theme.assets.backgroundSize; document.body.style.backgroundPosition = theme.assets.backgroundPosition; }
  }
  function refreshCommanderArtwork(counter) {
    if (theme.datasets.commanderTreatment === 'prismatic-glass') commanderGlass.refresh(theme.assets.background, counter);
    if (theme.datasets.commanderTreatment === 'art-regions') regionRenderer.refresh(selectedSkin, game.dataset.counterMode, theme.assets.background, counter);
  }
  function refreshArt(interfaceStyle = selectedStyle) {
    // Released skins compiled placement only when selected. Preserve that v1
    // transition behavior; expanded skins deliberately follow the active mode.
    if (theme?.version === 2 && selectedSkin && interfaceStyle !== selectedStyle) {
      apply(selectedSkin, interfaceStyle);
    }
    if (!theme || theme.native) return;
    surfaceArtwork.refresh();
    if (seal && renderedArt.get(seal) !== artRevision) {
      const children = theme.assets.seal
        ? [image(theme.assets.seal)] : baseSeal.map(node => node.cloneNode(true));
      seal.replaceChildren(...children);
      renderedArt.set(seal, artRevision);
    }
    for (const mode of RENDERER_MODES) {
      const button = document.querySelector('[data-mode="' + mode + '"]');
      if (!button || renderedArt.get(button) === artRevision) continue;
      const hasImage = Boolean(theme.assets.symbols[mode]);
      // V1 preserves native SVG icons whenever no approved replacement exists.
      if (theme.version === 1 && !hasImage) continue;
      if (!hasImage && usesNativeCounterIcon(selectedSkin,mode)) {
        button.replaceChildren(...baseNav.get(mode).map(node=>node.cloneNode(true)));
        const nativeIcon = button.querySelector('svg');
        if (nativeIcon) nativeIcon.style.transform = 'scale('+theme.assets.symbolScale[mode]+')';
        const label = button.querySelector('small');
        if (label) label.textContent = modeLabel(mode);
        renderedArt.set(button,artRevision);
        continue;
      }
      const icon = hasImage ? image(theme.assets.symbols[mode]) : document.createElement('span');
      if (!hasImage) icon.textContent = theme.assets.symbolText[mode];
      icon.style.transform = 'scale(' + theme.assets.symbolScale[mode] + ')';
      const label = document.createElement('small');
      label.textContent = modeLabel(mode);
      button.replaceChildren(icon, label);
      renderedArt.set(button, artRevision);
    }
    const addOverlay = (target, slot) => {
      const art = theme.assets.overlays[slot];
      if (!target || !art.data || renderedArt.get(target) === artRevision) return;
      const node = image(art.data);
      const rotates = slot === 'dial' && theme.assets.dialArtSpin;
      node.className = 'skin-overlay' + (rotates ? ' skin-dial-art' : '');
      node.style.setProperty('--skin-overlay-opacity', String(art.opacity));
      node.style.setProperty('--skin-overlay-scale', String(art.scale));
      node.style.setProperty('--skin-overlay-blend', art.blend);
      target.append(node);
      renderedArt.set(target, artRevision);
    };
    document.querySelectorAll('.pod-seat').forEach(node => addOverlay(node, 'seat'));
    addOverlay(document.querySelector('.counter-stage'), 'counter');
    addOverlay(document.querySelector('.dial-gesture'), 'dial');
    const counterArtwork = counterDesignRenderer.refresh(selectedSkin,game.dataset.counterMode);
    refreshCommanderArtwork(counterArtwork);
  }
  return { apply, clear, refreshArt };
}

export function fitPreviewScale(width, height, availableWidth, availableHeight, requested = 1) {
  return Math.max(.1, Math.min(requested, availableWidth / (width + 20), availableHeight / (height + 48)));
}

export function previewViewportChecks(metrics, expected) {
  return previewGeometryChecks(metrics,expected);
}

export function appearanceFingerprint(skin) { return JSON.stringify(publicAppearanceSkin(record(skin))); }

export function preflightProofMatches(proof, skin, revision) {
  return Boolean(proof?.pass && proof.revision === revision && proof.fingerprint === appearanceFingerprint(skin));
}

export function needsGeometryPreflight(skin) {
  if (skin?.id === '__neutral_arc__') return false;
  if (skin?.rendererVersion === 2 && (hasCustomGeometry(skin) || Object.values(skin.surfaceDesign?.surfaces || {}).some(surface => surface?.typography || surface?.border?.width != null))) return true;
  const keys = ['--skin-font','--skin-font-weight','--skin-line-height','--skin-letter-spacing','--skin-text-transform','--skin-label-alignment','--skin-label-text-scale','--skin-seat-text-scale','--skin-seat-gap','--skin-counter-offset-y','--skin-turn-offset-y','--skin-controls-offset-y','--skin-center-seal-scale','--skin-center-seal-offset-x','--skin-center-seal-offset-y','--skin-life-number-scale','--skin-life-number-offset-x','--skin-life-number-offset-y',...Object.values(regions).flatMap(region => ['x','y','scale'].map(field => `--skin-${region}-${field}`))];
  for (const style of ['button','dial']) {
    const actual = buildRendererTheme(skin,style).variables, baseline = buildRendererTheme({id:'native-layout',rendererVersion:skin.rendererVersion},style).variables;
    if (keys.some(key => actual[key] !== baseline[key])) return true;
  }
  return false;
}
