import { choice, color, number, record } from './appearance-design-schema.js';
import { contrastRatio } from './appearance-contrast.js';
import { appearanceFontKeys, appearanceFonts, fontFamily } from './appearance-fonts.js';

const typeFields = {family:choice(...appearanceFontKeys),weight:choice(400,500,600,700),style:choice('normal','italic'),shadow:choice('native','none','soft'),lineHeight:number(1.1,1.6),tracking:number(-.02,.08),case:choice('none','uppercase'),scale:number(85,115)};
const fittedType = {...typeFields}; delete fittedType.scale;
const fillSpec = record({kind:choice('solid','linear','radial'),color,color2:color,angle:number(0,360),opacity:number(40,100)});
const roles = (label,selector,size) => ({label,selector,size});
const gameDialogs=':is(#customLifeDialog,#radiationDialog,#commanderSourceDialog,#commanderCountDialog,#commanderTaxDialog,#turnCueDialog,#turnSoundDialog,#editPlayerNameDialog,#tableOrderDialog,#coinTossDialog,#startingRollDialog)';
const gameFields=':is(#gameView,#gameMenu,#lobbyView,#intermissionView,'+gameDialogs+') :is(input:not([type=checkbox]):not([type=radio]),select,textarea)';
const ordinaryCopy=':is(p,small):not([role]):not(.error):not(.warning):not(.danger-text)';
// These selectors are application-owned and match the real game DOM. State
// badges, safety messages, focus rings and disabled feedback retain their rules.
export const surfaceDefinitions = [
  {key:'gameHeader',label:'Gameplay app header',scope:'outer',gameplayOnly:true,selector:'.brand-bar',ink:'.brand-bar .brand strong',muted:'.brand-bar .brand small',roles:{heading:roles('Fivefold Arc title','.brand-bar .brand strong','1.1rem'),body:roles('Brand subtitle','.brand-bar .brand small','.65rem')}},
  {key:'playerCards',label:'Player cards',scope:'game',selector:'.pod-seat:not(.eliminated)',ink:'.pod-seat:not(.eliminated) .seat-name,.pod-seat:not(.eliminated) .seat-life',accent:'.pod-seat.is-owner:not(.eliminated) .seat-name',roles:{label:roles('Player name','.pod-seat .seat-name','.6875rem'),value:roles('Player life','.pod-seat .seat-life','1.6rem')}},
  {key:'readout',label:'Counter readout',scope:'game',selector:'.counter-readout',ink:'.main-value',muted:'.counter-context',accent:'.counter-mode',roles:{label:roles('Counter name','.counter-mode','.72rem'),value:roles('Fitted counter value','.main-value',null),body:roles('Counter context','.counter-context','.7rem')}},
  {key:'turnBar',label:'Turn bar',scope:'game',selector:'.turn-banner',ink:'.turn-banner strong',muted:'.turn-banner p,.turn-banner span',accent:'.turn-banner p',roles:{heading:roles('Player turn','.turn-banner strong','.75rem'),label:roles('Turn labels and timers','.turn-banner p,.turn-banner span','.625rem')}},
  {key:'primaryActions',label:'Turn actions',scope:'game',selector:'#turnActions > button',ink:'#turnActions > button',roles:{label:roles('Action labels','#turnActions > button','.82rem')}},
  {key:'lifeControls',label:'Life controls',scope:'game',selector:'.adjust-controls button,.custom-life-button',ink:'.adjust-controls button,.adjust-controls button span,.custom-life-button',muted:'.adjust-controls small',roles:{value:roles('Step amounts','.adjust-controls button span','1.1rem'),label:roles('Step labels and custom life','.adjust-controls small,.custom-life-button','.72rem')}},
  {key:'commanderTools',label:'Commander tools',scope:'game',selector:'.commander-tax-quick > button,.commander-tax-quick-value,.selected-source-button,.inline-commander-choice',ink:'.commander-tax-quick-name,.commander-tax-quick-value,.commander-tax-quick-value span,.selected-source-button,.selected-source-button strong,.selected-source-button em,.selected-source-button b,.inline-commander-choice,.inline-commander-choice strong,.inline-commander-choice span',muted:'.commander-tax-quick-title,.selected-source-button small,.inline-commander-choice small',roles:{label:roles('Commander labels','.commander-tax-quick-title,.selected-source-button,.inline-commander-choice','.68rem'),heading:roles('Commander name','.commander-tax-quick-name,.selected-source-button strong','1rem'),value:roles('Commander amounts','.commander-tax-quick-value span,.selected-source-button em','1rem')}},
  {key:'navigation',label:'Counter navigation',scope:'game',selector:'.mode-nav button',ink:'.mode-nav button:not(.active),.mode-nav button:not(.active) small',accent:'.mode-nav button.active,.mode-nav button.active small',roles:{label:roles('Counter labels','.mode-nav small','.6rem')}},
  {key:'gameMenu',label:'Game menu',scope:'outer',selector:'#gameMenu',ink:'#gameMenu button:not(.danger-text):not(:disabled)',roles:{label:roles('Menu commands','#gameMenu button','.85rem')}},
  {key:'dialogs',label:'Gameplay dialogs',scope:'outer',selector:gameDialogs,ink:gameDialogs+' :is(h2,label,legend)',muted:gameDialogs+' '+ordinaryCopy,roles:{heading:roles('Dialog titles',gameDialogs+' h2','1.8rem'),body:roles('Dialog copy',gameDialogs+' '+ordinaryCopy+', '+gameDialogs+' label','1rem'),label:roles('Dialog commands',gameDialogs+' button','.85rem')}},
  {key:'inputs',label:'Game form fields',scope:'outer',selector:gameFields,ink:gameFields,roles:{body:roles('Field values',gameFields,'1rem')}},
  {key:'lobby',label:'Lobby and intermission',scope:'outer',selector:'#lobbyControls,#lobbyView,#intermissionPanel',ink:':is(#lobbyControls,#lobbyView,#intermissionPanel) :is(h1,h2,h3,strong,label)',muted:':is(#lobbyControls,#lobbyView,#intermissionPanel) '+ordinaryCopy,accent:'.lobby-invite-code',roles:{heading:roles('Lobby titles',':is(#lobbyControls,#lobbyView,#intermissionPanel) :is(h1,h2,h3)','1.5rem'),body:roles('Lobby copy',':is(#lobbyControls,#lobbyView,#intermissionPanel) '+ordinaryCopy,'.85rem'),label:roles('Lobby commands',':is(#lobbyControls,#lobbyView,#intermissionPanel) :is(button,label)','.85rem')}},
  {key:'results',label:'Results and victory',scope:'outer',selector:'#victoryDialog,#victoryDialog .victory-dialog-content',ink:'#victoryDialog h2,#victoryDialog strong',muted:'#victoryDialog p,#victoryDialog small',accent:'#victoryDialog .eyebrow',roles:{heading:roles('Result title','#victoryDialog h2','1.8rem'),body:roles('Result details','#victoryDialog p,#victoryDialog small','1rem'),label:roles('Result commands','#victoryDialog button','.85rem')}}
];
const materialFields = {fill:fillSpec,ink:color,muted:color,accent:color,border:record({color,width:number(0,3),style:choice('solid','dashed')}),radii:record({topLeft:number(0,28),topRight:number(0,28),bottomRight:number(0,28),bottomLeft:number(0,28)}),shadow:choice('none','soft','lifted','inset','glow'),texture:record({kind:choice('none','lines','grid','dots'),strength:number(0,16)})};
export const surfaceDesignSpec = record({surfaces:record(Object.fromEntries(surfaceDefinitions.map(surface=>{
  const fields={...materialFields,typography:record(Object.fromEntries(Object.entries(surface.roles).map(([key,role])=>[key,record(role.size ? typeFields : fittedType)])))};
  for (const key of ['ink','muted','accent']) if (!surface[key]) delete fields[key];
  return [surface.key,record(fields)];
})))});

export const surfaceFonts = Object.fromEntries(appearanceFontKeys.map(key=>[key,fontFamily(key,'surface')]));
const hex = value => typeof value==='string' && /^#[\da-f]{6}$/i.test(value);
const object = value => value && typeof value==='object' && !Array.isArray(value) ? value : {};
const own = (value,key) => Object.hasOwn(value,key);
const kebab = value => value.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase());
const bounded = (value,fallback,min,max) => ['number','string'].includes(typeof value)&&Number.isFinite(Number(value)) ? Math.max(min,Math.min(max,Number(value))) : fallback;
const rgba = (value,opacity) => `rgb(${[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)).join(' ')} / ${opacity}%)`;
function fillValue(value) {
  const fill=object(value); if (!['solid','linear','radial'].includes(fill.kind)||!hex(fill.color)) return null;
  const first=rgba(fill.color,bounded(fill.opacity,100,40,100)),second=rgba(hex(fill.color2)?fill.color2:fill.color,bounded(fill.opacity,100,40,100));
  if (fill.kind==='solid') return {background:first,image:'none'};
  // sRGB is intentional: the color editor and readability sampler use the
  // same interpolation space, including gradient interiors rather than stops.
  const image=fill.kind==='linear' ? `linear-gradient(${bounded(fill.angle,135,0,360)}deg in srgb,${first},${second})` : `radial-gradient(ellipse at center in srgb,${first},${second})`;
  return {background:image,image};
}
const shadowValues = {none:'none',soft:'0 3px 12px rgb(0 0 0 / .25)',lifted:'0 3px 0 rgb(0 0 0 / .4),0 9px 22px rgb(0 0 0 / .35)',inset:'inset 0 2px 7px rgb(0 0 0 / .45)',glow:'0 0 16px var(--sd-accent, var(--brass))'};

export function compileSurfaceDesign(skin,result) {
  if (result.native || result.version!==2) return result;
  const surfaces=object(skin.surfaceDesign?.surfaces);
  for (const definition of surfaceDefinitions) {
    const data=object(surfaces[definition.key]),name=kebab(definition.key),capital=definition.key[0].toUpperCase()+definition.key.slice(1);
    const put=(key,value) => { result.variables['--sd-'+name+'-'+key]=String(value); result.datasets['surface'+capital+key.split('-').map(part=>part[0].toUpperCase()+part.slice(1)).join('')]='true'; };
    const fill=fillValue(data.fill);
    if(fill) { put('fill',fill.background); result.variables['--sd-'+name+'-image']=fill.image; }
    for (const key of ['ink','muted','accent']) if (definition[key] && hex(data[key])) put(key,data[key]);
    const border=object(data.border);
    if (hex(border.color)) put('border-color',border.color);
    if (own(border,'width')) put('border-width',bounded(border.width,1,0,3)+'px');
    if (['solid','dashed'].includes(border.style)) put('border-style',border.style);
    for (const key of ['topLeft','topRight','bottomRight','bottomLeft']) if (own(object(data.radii),key)) put('radius-'+kebab(key),bounded(data.radii[key],0,0,28)+'px');
    if (own(shadowValues,data.shadow)) put('shadow',shadowValues[data.shadow].replace('--sd-accent','--sd-'+name+'-accent'));
    const texture=object(data.texture);
    if (['none','lines','grid','dots'].includes(texture.kind)) {
      const tint='rgb(255 255 255 / '+bounded(texture.strength,6,0,16)+'%)';
      const images={none:'none',lines:`repeating-linear-gradient(135deg,transparent 0 7px,${tint} 7px 8px)`,grid:`repeating-linear-gradient(0deg,transparent 0 11px,${tint} 11px 12px),repeating-linear-gradient(90deg,transparent 0 11px,${tint} 11px 12px)`,dots:`radial-gradient(circle,${tint} 1px,transparent 1.5px)`};
      put('texture',images[texture.kind]); result.variables['--sd-'+name+'-texture-size']=texture.kind==='dots'?'10px 10px':'auto';
    }
    for (const [role,definitionRole] of Object.entries(definition.roles)) {
      const type=object(object(data.typography)[role]);
      if (own(surfaceFonts,type.family)) { put(role+'-family',surfaceFonts[type.family]);result.datasets['surface'+capital+role[0].toUpperCase()+role.slice(1)+'Family']=type.family;result.variables['--sd-'+name+'-'+role+'-font-adjust']=String(appearanceFonts[type.family].aspect??'none'); }
      if ([400,500,600,700].includes(type.weight)) put(role+'-weight',type.weight);
      if (['normal','italic'].includes(type.style)) put(role+'-style',type.style);
      if (['none','soft'].includes(type.shadow)) put(role+'-shadow',type.shadow==='none'?'none':'0 1px 3px rgb(0 0 0 / .5)');
      if (own(type,'lineHeight')) put(role+'-line-height',bounded(type.lineHeight,1.3,1.1,1.6));
      if (own(type,'tracking')) put(role+'-tracking',bounded(type.tracking,0,-.02,.08)+'em');
      if (['none','uppercase'].includes(type.case)) put(role+'-case',type.case);
      if (definitionRole.size && own(type,'scale')) put(role+'-scale',bounded(type.scale,100,85,115)/100);
    }
  }
  return result;
}

const rgb = value => [1,3,5].map(i=>parseInt(value.slice(i,i+2),16));
const mix = (first,second,fraction) => '#'+rgb(first).map((channel,index)=>Math.round(channel*(1-fraction)+rgb(second)[index]*fraction).toString(16).padStart(2,'0')).join('');
function surfaceBase(skin,key) {
  const components={playerCards:'playerCards',primaryActions:'endTurn',lifeControls:'lifeButtons',navigation:'navigation'};
  const field=skin.componentColors?.[components[key]]||{};
  const fallback=(...values)=>values.find(hex);
  return {background:fallback(field.background,['readout','turnBar'].includes(key)?skin.background:skin.surface,'#161616'),ink:fallback(field.text,skin.text,'#f4ecd9'),muted:fallback(skin.muted,'#afa590'),accent:fallback(field.selectedText,skin.accent,'#d8ae61')};
}
export function surfaceReadability(skin={}) {
  if (skin?.rendererVersion!==2 || skin.id==='__neutral_arc__') return [];
  const findings=[];
  for (const definition of surfaceDefinitions) {
    const data=object(skin.surfaceDesign?.surfaces?.[definition.key]); if (!Object.keys(data).length) continue;
    const base=surfaceBase(skin,definition.key),fill=object(data.fill),path='surfaceDesign.surfaces.'+definition.key;
    const first=hex(fill.color)?fill.color:base.background,second=fill.kind==='solid'?first:(hex(fill.color2)?fill.color2:first),alpha=bounded(fill.opacity,100,40,100)/100;
    const samples=Array.from({length:33},(_,i)=>mix(base.background,mix(first,second,i/32),alpha));
    const strength=['lines','grid','dots'].includes(data.texture?.kind)?bounded(data.texture.strength,6,0,16)/100:0;
    const backgrounds=samples.flatMap(value=>strength?[value,mix(value,'#ffffff',strength)]:[value]);
    for (const key of ['ink','muted','accent']) {
      if (!definition[key]) continue;
      // Report inherited ink too when an explicit fill/texture changes the pair.
      if (!own(data,key)&&!own(data,'fill')&&!own(data,'texture')) continue;
      const foreground=hex(data[key])?data[key]:base[key];
      const ratios=backgrounds.map(background=>contrastRatio(foreground,background)).filter(value=>value!==null);
      if (!ratios.length) continue;
      const ratio=Math.min(...ratios);
      if (ratio<4.5) findings.push({severity:'error',path:path+'.'+key,label:definition.label+' '+({ink:'text',muted:'supporting text',accent:'accent labels'}[key])+' worst sampled contrast is '+ratio.toFixed(2)+'∶1.',fix:'Adjust this surface fill or '+key+' to reach 4.5∶1 across the gradient and texture. Review actual text over artwork.'});
    }
    if (alpha<1) findings.push({severity:'warning',path:path+'.fill.opacity',label:definition.label+' uses a translucent fill.',fix:'Review the actual surface over the brightest artwork. An opaque fill makes text contrast predictable.'});
    if (data.border && bounded(data.border.width,1,0,3)!==0 && hex(data.border.color)) {
      const ratio=Math.min(...backgrounds.map(background=>contrastRatio(data.border.color,background)));
      if (ratio<3) findings.push({severity:'warning',path:path+'.border.color',label:definition.label+' border contrast is below 3∶1.',fix:'Use a stronger border if it is needed to identify the control. Focus and state indicators retain their own marks.'});
    }
  }
  return findings;
}
