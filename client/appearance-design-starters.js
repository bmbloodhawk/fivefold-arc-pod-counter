import { surfaceDesignSpec } from './appearance-surface-design.js';

// Original visual recipes. Only appearance values are returned to the Studio.
// A fresh draft supplies identity, lifecycle and storage information.
const starters = {
  'field-notes': {
    name:'Field Notes', description:'Warm paper, ruled cards and letterpress numerals.',
    palette:['#e5d9bc','#f9f1da','#29251e','#413a2d','#704025','#6f5336'],
    family:'literata', fill:'linear', end:'#cfc0a2', pattern:'dots', patternInk:'#5d4434',
    frame:'double', shape:'flat', marker:'double', nav:'keyline', align:'start', radius:3,
    signals:['#26553d','#74440b','#882c2c'],
    dial:['rings','ticks','native'], inks:['#704025','#513b72','#4b591e','#235740','#205566','#584536'],
    surface:{kind:'solid',color:'#f5e9cd'}, border:{color:'#826d4b',width:1,style:'solid'},
    texture:{kind:'lines',strength:3}, shadow:'none'
  },
  'night-circuit': {
    name:'Night Circuit', description:'A cyan plotting grid, instrument markings and monospaced totals.',
    palette:['#061517','#0e282b','#e4fff4','#a7cfc4','#82f5d3','#61b7bd'],
    family:'mono', fill:'linear', end:'#10282e', pattern:'grid', patternInk:'#77e8c6',
    frame:'corners', shape:'flat', marker:'edge', nav:'bar', align:'start', radius:2,
    signals:['#82f5b2','#ffda80','#ffada5'],
    dial:['faceted','ticks','mode'], inks:['#82f5d3','#b6bbfc','#e4ef79','#9eeb8d','#97deff','#d6d0b4'],
    surface:{kind:'linear',color:'#123439',color2:'#091f25',angle:125}, border:{color:'#428b87',width:1,style:'solid'},
    texture:{kind:'grid',strength:5}, shadow:'inset'
  },
  'rose-window': {
    name:'Rose Window', description:'Plum glass, woven light and engraved rings.',
    palette:['#1c132b','#30223e','#fff2ef','#dbc8d5','#ffcf96','#c48eba'],
    family:'cinzel', fill:'radial', end:'#56334f', pattern:'weave', patternInk:'#cba0cf',
    frame:'ruled', shape:'raised', marker:'inset', nav:'pill', align:'center', radius:18,
    signals:['#a2e9c4','#ffda8e','#ffb4b1'],
    dial:['radial','runes','native'], inks:['#ffcf96','#d2c0ff','#eff59b','#ace6af','#9cdcf8','#e3c4dc'],
    surface:{kind:'linear',color:'#432d4b',color2:'#271d38',angle:135}, border:{color:'#ac7b9e',width:1,style:'solid'},
    texture:{kind:'dots',strength:5}, shadow:'soft'
  }
};
const modes = ['life','commander','radiation','poison','energy','generic'];
export const designStarters = Object.entries(starters).map(([id,recipe]) => ({id,name:recipe.name,description:recipe.description,palette:[...recipe.palette]}));
export function designStarterValues(id) {
  if (!Object.hasOwn(starters,id)) throw new Error('Unknown design starter.');
  const recipe = starters[id];
  const [background,surface,text,muted,accent,secondary] = recipe.palette;
  const [stateSuccess,stateWarning,stateDanger] = recipe.signals;
  const [face,markings,seal] = recipe.dial;
  const surfaces = {};
  for (const key of ['playerCards','turnBar','navigation','gameMenu','dialogs','inputs','lobby','results','commanderTools','lifeControls']) {
    const fields = surfaceDesignSpec.fields.surfaces.fields[key].fields;
    const material = {fill:{...recipe.surface},ink:text,border:{...recipe.border},shadow:recipe.shadow};
    if (fields.muted) material.muted = muted;
    if (fields.accent) material.accent = accent;
    if (fields.typography.fields.label) material.typography = {label:{family:recipe.family,weight:600}};
    surfaces[key] = material;
  }
  surfaces.gameHeader = {fill:{...recipe.surface},ink:text,muted,typography:{heading:{family:recipe.family,weight:700}}};
  surfaces.playerCards.texture = {...recipe.texture};
  surfaces.readout = {ink:text,typography:{value:{family:recipe.family,weight:700,...(id==='field-notes' ? {shadow:'none'} : {})}}};
  const layout = {seatRadius:recipe.radius,buttonRadius:recipe.radius};
  return { background,surface,text,muted,accent,secondary,stateSuccess,stateWarning,stateDanger,focusColor:accent,
    borderColor:recipe.border.color, atmosphereColor:secondary, atmosphereStrength:0,
    fontFamily:recipe.family,fontWeight:600,buttonTreatment:'solid',seatTreatment:recipe.shape,
    backgroundTreatment:'plain',interfaceStyle:'dial',rendererVersion:2,
    componentColors:{
      endTurn:{background:accent,text:background,border:accent},
      lifeButtons:{background:surface,text,border:recipe.border.color},playerCards:{background:surface,text,border:recipe.border.color},
      navigation:{background:surface,text:muted,border:recipe.border.color,selectedText:accent,selectedBorder:accent}
    },
    canvasDesign:{fill:recipe.fill,endColor:recipe.end,angle:145,lightX:32,lightY:20,pattern:recipe.pattern,
      patternColor:recipe.patternInk,strength:16,spacing:id === 'field-notes' ? 14 : 30,frame:recipe.frame,frameColor:accent,frameStrength:48,flourish:id==='field-notes'?'none':id==='night-circuit'?'runners':'pulse',flourishPeriod:30},
    sceneDesign:{ownTurn:{tint:accent,strength:3},otherTurn:{tint:secondary,strength:8},complete:{tint:accent,strength:12,edge:'double',edgeColor:accent}},
    tableDesign:{seatAlign:recipe.align,turnMarker:recipe.marker,bannerMark:id === 'field-notes' ? 'ticket' : 'rail',navMark:recipe.nav,
      titleRule:id === 'field-notes' ? 'double' : 'short',ownerMarker:'underline',feedbackMark:'rail'},
    counterDesign:{navigationIcons:'native',modes:Object.fromEntries(modes.map((mode,index) => [mode,{accent:recipe.inks[index],surface,text,face,markings,seal,...(id==='field-notes' ? {captionBacking:'surface'} : {})}]))},
    surfaceDesign:{surfaces},modeLayouts:{button:{...layout},dial:{...layout}},
    variants:{numerals:'tabular',commander:'accent',panels:'outlined'}
  };
}
