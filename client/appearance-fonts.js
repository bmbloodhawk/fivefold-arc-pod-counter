// One allowlist for catalog validation, global type, and surface role controls.
// Existing keys retain their exact released stacks. New local faces are opt-in.
export const appearanceFonts=Object.freeze({
  system:{label:'Clear system',family:'inherit',surfaceFamily:'Inter, ui-sans-serif, system-ui, sans-serif'},
  serif:{label:'Tabletop serif',family:'Georgia,serif',surfaceFamily:'Georgia, "Times New Roman", serif'},
  rounded:{label:'Rounded modern',family:'ui-rounded,system-ui,sans-serif',surfaceFamily:'"Arial Rounded MT Bold", "Trebuchet MS", sans-serif'},
  mono:{label:'Technical mono',family:'ui-monospace,monospace',surfaceFamily:'ui-monospace, "SFMono-Regular", Consolas, monospace'},
  cinzel:{label:'Cinzel · engraved',family:'"Cinzel",Georgia,serif',aspect:.5,file:'./assets/fonts/cinzel-latin-variable.woff2',license:'./assets/fonts/cinzel-OFL.txt',weights:[400,500,600,700]},
  robotoCondensed:{label:'Roboto Condensed · narrow',family:'"Roboto Condensed","Arial Narrow",Arial,sans-serif',aspect:1082/2048,file:'./assets/fonts/roboto-condensed-latin-variable.woff2',license:'./assets/fonts/roboto-condensed-OFL.txt',weights:[400,500,600,700]},
  literata:{label:'Literata · book',family:'"Literata",Georgia,serif',aspect:.507,file:'./assets/fonts/literata-latin-variable.woff2',license:'./assets/fonts/literata-OFL.txt',weights:[400,500,600,700]}
});
export const appearanceFontKeys=Object.freeze(Object.keys(appearanceFonts));
export const localFontKeys=Object.freeze(appearanceFontKeys.filter(key=>appearanceFonts[key].file));
export function fontFamily(key,scope='global') {
  const font=typeof key==='string'&&Object.hasOwn(appearanceFonts,key)?appearanceFonts[key]:appearanceFonts.system;
  return scope==='surface' ? font.surfaceFamily||font.family : font.family;
}
export function mountAppearanceFontPicker(select) {
  if(!select)return;
  const selected=select.value;select.replaceChildren();
  for(const key of appearanceFontKeys){const option=document.createElement('option');option.value=key;option.textContent=appearanceFonts[key].label;select.append(option);}
  select.value=appearanceFontKeys.includes(selected)?selected:'system';
}

export function prepareAppearanceFonts(document,skin) {
  if(skin?.rendererVersion!==2||skin.id==='__neutral_arc__'||!document.fonts?.load)return Promise.resolve([]);
  const requests=new Set();
  const add=(family,weight)=>{if(localFontKeys.includes(family))requests.add(([400,500,600,700].includes(Number(weight))?Number(weight):600)+' 1em '+appearanceFonts[family].family.split(',')[0]);};
  add(skin.fontFamily,skin.fontWeight);
  for(const surface of Object.values(skin.surfaceDesign?.surfaces||{}))for(const role of Object.values(surface?.typography||{}))add(role?.family,role?.weight??skin.fontWeight);
  // Start only selected faces before the renderer waits for fonts.ready.
  // Loading completion then remeasures the actual glyphs in either engine.
  return Promise.allSettled([...requests].map(async request=>document.fonts.load(request)));
}
