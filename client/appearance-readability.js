// WCAG relative luminance for opaque sRGB token pairs. Art, compositing and
// text fit are reviewed on the actual surface rather than inferred from hex.
import { contrastRatio, isHexColor } from './appearance-contrast.js';
export { contrastRatio } from './appearance-contrast.js';
import { surfaceReadability } from './appearance-surface-design.js';
function mixRgb(top,base,alpha) {
  if (!isHexColor(top) || !isHexColor(base)) return null;
  return '#' + [1,3,5].map(i => {
    const a = parseInt(top.slice(i,i+2),16), b = parseInt(base.slice(i,i+2),16);
    return Math.round(a*alpha+b*(1-alpha)).toString(16).padStart(2,'0');
  }).join('');
}
export function appearanceReadability(skin = {}) {
  const findings = [];
  const expanded = skin.rendererVersion === 2;
  const colors = expanded ? (skin.tokens?.color || {}) : {};
  const pair = (foreground, background, path, name, minimum = 4.5) => {
    const ratio = contrastRatio(foreground, background);
    if (ratio == null || ratio >= minimum) return;
    findings.push({severity:'error', path, label: name + ' contrast is ' + ratio.toFixed(2) + '∶1.',
      fix:'Adjust the foreground or background until this pair reaches ' + minimum + '∶1.'});
  };
  const surface = skin.surface ?? colors.surface, canvas = skin.background ?? colors.canvas;
  const ink = skin.text ?? colors.text, muted = skin.muted ?? colors.textMuted;
  pair(ink, surface, 'text', 'Main text on the surface');
  pair(ink, canvas, 'text', 'Main text on the background');
  pair(muted, surface, 'muted', 'Supporting labels on the surface');
  pair(muted, canvas, 'muted', 'Supporting labels on the background');
  const names = {endTurn:'End Turn',lifeButtons:'Life buttons',playerCards:'Player cards',navigation:'Counter navigation'};
  for (const [key,name] of Object.entries(expanded ? names : {})) {
    const field = skin.componentColors?.[key];
    if (!field) continue;
    if (key === 'endTurn' && skin.buttonTreatment === 'glass') {
      const glass = mixRgb(field.background,surface,.36 * Number(skin.buttonOpacity ?? 100)/100);
      pair(ink,glass,'componentColors.endTurn.background','End Turn label on frosted glass');
    } else if (key === 'endTurn' && skin.buttonTreatment === 'outline') {
      pair(skin.accent ?? colors.accentPrimary,canvas,'accent','End Turn outline label on the background');
    } else {
      pair(field.text, field.background, 'componentColors.' + key + '.text', name + ' labels');
    }
    if (key === 'navigation') pair(field.selectedText, field.background, 'componentColors.navigation.selectedText', 'Selected counter label');
  }
  for (const [key,token,name] of [['stateSuccess','success','Success'],['stateWarning','warning','Warning'],['stateDanger','danger','Danger']]) {
    if (expanded) pair(skin[key] ?? colors[token], surface, key, name + ' feedback text');
  }
  if (!expanded && skin.buttonTreatment === 'outline') pair(skin.accent,canvas,'accent','End Turn outline label on the background');
  for (const [mode,layout] of Object.entries(skin.modeLayouts || {})) {
    if (!layout) continue;
    if (Math.min(layout.labelTextScale ?? 100,layout.seatTextScale ?? 100) < 95)
      findings.push({severity:'warning',path:'modeLayouts.' + mode,label:'Small labels in the ' + mode + ' layout.',fix:'Check player names at the narrow phone size, or raise the label scale to 100%.'});
  }
  const translucent = ['button','lifeButton','customLife','commanderTax','commanderDamage','seat'].filter(prefix => Number(skin[prefix+'Opacity'] ?? 100) < 65);
  if (translucent.length) findings.push({severity:'warning',path:translucent[0]+'Opacity',label:'Low control opacity lets the background affect contrast.',fix:'Preview the controls over the brightest artwork or raise opacity to 65% or higher.'});
  if (skin.backgroundAsset || skin.buttonAsset || Object.values(skin.modeLayouts || {}).some(layout=>Object.values(layout?.overlays || {}).some(Boolean))) findings.push({severity:'warning',path:'backgroundAsset',label:'Artwork changes the background behind text.',fix:'Check the brightest and darkest parts of the artwork in both control layouts.'});
  if (expanded) {
    findings.push(...surfaceReadability(skin));
    const canvasEnd = skin.canvasDesign?.endColor;
    if (['linear','radial'].includes(skin.canvasDesign?.fill) && canvasEnd) {
      pair(ink,canvasEnd,'canvasDesign.endColor','Main text at the other end of the backdrop');
      pair(muted,canvasEnd,'canvasDesign.endColor','Supporting text at the other end of the backdrop');
    }
    for (const [moment,design] of Object.entries(skin.sceneDesign || {})) {
      if (!design?.tint) continue;
      const amount = Number(design.strength ?? 12) / 100;
      for (const base of new Set([canvas,canvasEnd].filter(Boolean))) {
        const tinted = mixRgb(design.tint,base,amount);
        pair(ink,tinted,'sceneDesign.'+moment+'.tint',moment+' backdrop and text');
        pair(muted,tinted,'sceneDesign.'+moment+'.tint',moment+' backdrop and supporting labels');
      }
    }
    for (const [mode,design] of Object.entries(skin.counterDesign?.modes || {})) {
      if (!design) continue;
      const bg = design.surface || skin.surfaceDesign?.surfaces?.readout?.fill?.color || canvas;
      if (design.text || design.surface) pair(design.text || ink,bg,'counterDesign.modes.'+mode+'.text',mode+' counter value',3);
      if (design.accent || design.surface) pair(design.accent || skin.accent,bg,'counterDesign.modes.'+mode+'.accent',mode+' counter label');
      if (design.captionBacking === 'surface') {
        const plate = design.surface || surface || '#161616';
        pair(design.text || ink || '#f4ecd9',plate,'counterDesign.modes.'+mode+'.text',mode+' caption on its plate');
        pair(design.accent || skin.accent || colors.accentPrimary || '#d8ae61',plate,'counterDesign.modes.'+mode+'.accent',mode+' counter name on its plate');
      }
    }
    if (Object.values(skin.surfaceArt || {}).some(layer => layer?.assetId) || Object.values(skin.counterDesign?.modes || {}).some(mode => mode?.artAsset)) {
      findings.push({severity:'warning',path:'surfaceArt',label:'Original artwork sits behind a game surface.',fix:'Check text over the brightest area in the preview. Reduce artwork opacity or use a stronger backing color.'});
    }
  }
  if (!skin.thumbnailAsset) findings.push({severity:'polish',path:'thumbnailAsset',label:'The library uses the skin color swatch.',fix:'Choose a thumbnail under Background & art for a visual catalog tile.'});
  return findings;
}
