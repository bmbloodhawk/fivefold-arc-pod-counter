import { compileSceneDesign } from './appearance-scene-design.js';
import { choice, color, number, record } from './appearance-design-schema.js';

// All keys, gradients and dimensions are application-owned. Uploaded art reaches
// this compiler only after the renderer has verified its raster bytes.
export const canvasDesignSpec = record({
  fill: choice('solid','linear','radial'), endColor: color, angle: number(0,360),
  lightX: number(0,100), lightY: number(0,100),
  pattern: choice('none','grid','dots','diagonal','weave','stars','contours','rays'),
  patternColor: color, spacing: number(8,80), strength: number(0,32),
  frame: choice('plain','ruled','double','corners'), frameColor: color,
  frameStrength: number(10,75), artShade: number(0,85),
  flourish: choice('none','pulse','runners','glints'), flourishColor: color, flourishStrength: number(0,35), flourishPeriod: number(12,60)
});
export const tableDesignSpec = record({
  seatArrangement: choice('nameFirst','numberFirst'), seatAlign: choice('start','center','end'),
  turnMarker: choice('edge','double','inset'), ownerMarker: choice('underline','dot'),
  turnAccent: color, ownerAccent: color, bannerMark: choice('rail','double','ticket'),
  navMark: choice('bar','pill','keyline'), stepMark: choice('rail','dotted'),
  feedbackMark: choice('rail','double','dashed'), titleRule: choice('plain','short','double'),
  tableWidth: number(520,720), sideGutter: number(8,24), rowGap: number(3,10)
});

const validHex = value => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
const cssColor = (value,fallback) => validHex(value) ? value : fallback;
const bounded = (value,fallback,min,max) => Number.isFinite(Number(value)) ? Math.max(min,Math.min(max,Number(value))) : fallback;
const own = (value,key) => value && Object.hasOwn(value,key);
const patternLayers = {
  grid: tint => [`linear-gradient(to right,${tint} 1px,transparent 1px)`,`linear-gradient(to bottom,${tint} 1px,transparent 1px)`],
  dots: tint => [`radial-gradient(circle at center,${tint} 1.2px,transparent 1.6px)`],
  diagonal: tint => [`linear-gradient(135deg,transparent 47%,${tint} 48% 51%,transparent 52%)`],
  weave: tint => [`linear-gradient(45deg,transparent 47%,${tint} 48% 50%,transparent 51%)`,`linear-gradient(-45deg,transparent 47%,${tint} 48% 50%,transparent 51%)`],
  stars: tint => [`radial-gradient(circle at 21% 17%,${tint} 0 1.2px,transparent 1.7px)`,`radial-gradient(circle at 78% 64%,${tint} 0 .9px,transparent 1.5px)`],
  contours: tint => [`repeating-radial-gradient(ellipse at 0% 90%,transparent 0 19%,${tint} 20% 21%,transparent 22% 33%)`],
  rays: tint => [`repeating-conic-gradient(from 5deg at 50% 35%,transparent 0 15deg,${tint} 15deg 16deg,transparent 16deg 30deg)`]
};

export function compileTableDesign(skin,result) {
  if (result.native || result.version !== 2) return;
  const { variables, datasets } = result;
  const hasMoments = compileSceneDesign(skin,result);
  const glass = skin.commanderTreatment === 'prismatic-glass';
  if (glass) datasets.commanderTreatment = 'prismatic-glass';
  if (skin.canvasDesign || hasMoments || glass) {
    const canvas = skin.canvasDesign || {};
    const hasLayers = glass || hasMoments || Object.keys(canvas).some(key => !key.startsWith('frame') && !key.startsWith('flourish'));
    if (hasLayers) {
      const images = [], sizes = [], positions = [], repeats = [];
      const layer = (image,size = 'cover',position = 'center',repeat = 'no-repeat') => {
        images.push(image); sizes.push(size); positions.push(position); repeats.push(repeat);
      };
      if (hasMoments) layer('linear-gradient(var(--scene-wash,transparent),var(--scene-wash,transparent))');
      if (own(canvas,'pattern')) datasets.canvasPattern = 'true';
      const spacing = bounded(canvas.spacing,28,8,80) + 'px';
      const tint = `color-mix(in srgb,${cssColor(canvas.patternColor,'var(--brass)')} ${bounded(canvas.strength,12,0,32)}%,transparent)`;
      if (Object.hasOwn(patternLayers,canvas.pattern)) {
        for (const image of patternLayers[canvas.pattern](tint)) {
          layer(image,canvas.pattern === 'rays' ? 'cover' : spacing + ' ' + spacing,'center','repeat');
        }
      }
      if (result.assets.background) {
        const shade = bounded(canvas.artShade,32,0,85);
        layer(`linear-gradient(rgb(0 0 0 / ${shade}%),rgb(0 0 0 / ${shade}%))`);
        const zoom = bounded(skin.backgroundScale,100,50,200);
        let size = glass && zoom === 100 ? 'cover' : result.assets.backgroundSize;
        if (glass && result.assets.backgroundAspect) {
          // In landscape the whole painting fits within 92% of viewport height
          // at authored 100%. Portrait retains its usual width/cover framing.
          variables['--prism-fitted-size'] = `min(${zoom}%,${(result.assets.backgroundAspect * .92 * zoom).toFixed(2)}dvh) auto`;
          size = `var(--prism-landscape-size,${size})`;
        }
        const image = glass ? 'var(--prism-hall-art,none)' : `url("${result.assets.background}")`;
        layer(image,size,result.assets.backgroundPosition);
      }
      const end = cssColor(canvas.endColor,'var(--surface)');
      if (canvas.fill === 'linear') layer(`linear-gradient(${bounded(canvas.angle,145,0,360)}deg,var(--bg),${end})`);
      else if (canvas.fill === 'radial') layer(`radial-gradient(ellipse at ${bounded(canvas.lightX,50,0,100)}% ${bounded(canvas.lightY,25,0,100)}%,${end},var(--bg) 80%)`);
      else if (canvas.fill !== 'solid') layer('radial-gradient(circle at var(--skin-atmosphere-position),color-mix(in srgb,var(--skin-atmosphere) calc(var(--skin-atmosphere-strength) * 100%),transparent),transparent 58%)');
      datasets.canvasLayers = 'true';
      variables['--design-canvas-images'] = images.join(',') || 'none';
      variables['--design-canvas-sizes'] = sizes.join(',') || 'auto';
      variables['--design-canvas-positions'] = positions.join(',') || 'center';
      variables['--design-canvas-repeats'] = repeats.join(',') || 'no-repeat';
    }
    if (['pulse','runners','glints'].includes(canvas.flourish)) {
      datasets.canvasFlourish = canvas.flourish;
      variables['--design-flourish-color'] = cssColor(canvas.flourishColor,'var(--brass)');
      variables['--design-flourish-opacity'] = String(bounded(canvas.flourishStrength,18,0,35)/100);
      variables['--design-flourish-period'] = bounded(canvas.flourishPeriod,28,12,60)+'s';
    }
    if (['ruled','double','corners'].includes(canvas.frame)) {
      datasets.canvasFrame = canvas.frame;
      variables['--design-frame-color'] = `color-mix(in srgb,${cssColor(canvas.frameColor,'var(--brass)')} ${bounded(canvas.frameStrength,40,10,75)}%,transparent)`;
    }
  }
  const table = skin.tableDesign;
  if (!table) return;
  for (const [key,spec] of Object.entries(tableDesignSpec.fields)) {
    if (!own(table,key)) continue;
    if (spec.type === 'enum' && spec.values.includes(table[key])) datasets['design' + key[0].toUpperCase() + key.slice(1)] = table[key];
    if (spec.type === 'color' && validHex(table[key])) variables[key === 'turnAccent' ? '--design-turn-accent' : '--design-owner-accent'] = table[key];
    if (spec.type === 'number') {
      const css = {tableWidth:'width',sideGutter:'gutter',rowGap:'row-gap'}[key];
      datasets['design' + key[0].toUpperCase() + key.slice(1)] = 'true';
      variables['--design-' + css] = bounded(table[key],spec.min,spec.min,spec.max) + 'px';
    }
  }
}

export function hasCustomGeometry(skin) {
  const table = skin?.tableDesign;
  return Boolean(table && ['seatArrangement','seatAlign','tableWidth','sideGutter','rowGap'].some(key => own(table,key)));
}
