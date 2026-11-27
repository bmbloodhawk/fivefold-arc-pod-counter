const variants = {
  dial:['Dial face',{native:'Game default',engraved:'Engraved rim',plain:'Fine rim'}],
  seal:['Center seal finish',{native:'Game default',etched:'Etched',medallion:'Medallion'}],
  counterMode:['Counter mode label',{native:'Game default',badge:'Tinted label',underlined:'Underline'}],
  navigation:['Counter navigation',{native:'Game default',underline:'Underline selected mode',framed:'Frame selected mode'}],
  commander:['Commander tools',{native:'Game default',accent:'Accent edge',quiet:'Surface edge'}],
  panels:['Dialogs, menus & inputs',{native:'Game default',outlined:'Outlined',raised:'Raised'}],
  numerals:['Counter numerals',{native:'Game default',tabular:'Even-width numerals',proportional:'Proportional numerals'}]
};

export function mountAppearanceTreatments({getDraft,change}) {
  const list = document.createElement('section'); list.className = 'inspector-block treatment-controls';
  const title = document.createElement('h3'); title.textContent = 'Surface treatments'; list.append(title);
  const inputs = new Map();
  const place = (parent,name,input) => {
    const label = document.createElement('label'); label.textContent = name; label.append(input); parent.append(label);
  };
  for (const [key,[name,options]] of Object.entries(variants)) {
    const select = document.createElement('select');
    select.id = 'variant-' + key; select.append(...Object.entries(options).map(([value,text])=>new Option(text,value)));
    select.addEventListener('change',()=>{
      const draft = getDraft();
      draft.variants = {...draft.variants,[key]:select.value};
      change();
    });
    const home = {numerals:'#edit-typography .inspector-block',seal:'#edit-artwork .inspector-block'}[key];
    place(home ? document.querySelector(home) : list,name,select); inputs.set(key,select);
  }
  document.querySelector('#edit-components').prepend(list);
  const type = document.querySelector('#edit-typography .inspector-block:nth-child(2) .ux-grid');
  for (const [key,name] of [['borderColor','Surface edges'],['disabledColor','Disabled labels']]) {
    const input = document.createElement('input'); input.type = 'color'; input.id = key;
    input.addEventListener('input',()=>{ getDraft()[key] = input.value; change(); }); place(type,name,input);
  }
  return function renderTreatments() {
    const skin = getDraft();
    for (const [key,input] of inputs) input.value = skin.variants?.[key] || 'native';
    document.getElementById('borderColor').value = skin.borderColor || skin.tokens?.color?.border || '#59584f';
    document.getElementById('disabledColor').value = skin.disabledColor || skin.tokens?.color?.disabled || '#a4a296';
  };
}
