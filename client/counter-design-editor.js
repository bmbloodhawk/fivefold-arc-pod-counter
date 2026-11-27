import { COUNTER_DESIGN_MODES, COUNTER_TAB_SETS, counterArtStrengthLimit, usesNativeCounterIcon } from './counter-design.js?v=5';

export const COUNTER_LABELS = Object.freeze({life:'Life',commander:'Commander damage',radiation:'Radiation',poison:'Poison',energy:'Energy',generic:'Generic counters'});
const icons = ['♥','♜','☢','☠','ϟ','◇'];
const presets = {
  life:{accent:'#e4a5a5',surface:'#251316',text:'#fff1eb',face:'rings',markings:'ticks',seal:'mode'},
  commander:{accent:'#e2bc72',surface:'#211b12',text:'#fff3d8',face:'rings',markings:'runes',seal:'mode'},
  radiation:{accent:'#a7e978',surface:'#112014',text:'#f0ffe9',face:'radial',markings:'ticks',seal:'mode'},
  poison:{accent:'#c4a0f0',surface:'#1c1427',text:'#f7eeff',face:'rings',markings:'runes',seal:'mode'},
  energy:{accent:'#ffe18a',surface:'#261e0d',text:'#fff8de',face:'faceted',markings:'ticks',seal:'mode'},
  generic:{accent:'#91d5ed',surface:'#10212b',text:'#eefaff',face:'faceted',markings:'runes',seal:'mode'},
};

export function updateCounterDesign(skin,mode,field,value) {
  if (!COUNTER_DESIGN_MODES.includes(mode)) return;
  skin.counterDesign ||= {}; skin.counterDesign.modes ||= {};
  const design = skin.counterDesign.modes[mode] ||= {};
  if (value == null || value === '' || (value === 'native' && field !== 'icon')) delete design[field];
  else design[field] = value;
  if (!Object.keys(design).length) delete skin.counterDesign.modes[mode];
  if (!Object.keys(skin.counterDesign.modes).length) delete skin.counterDesign.modes;
  if (!Object.keys(skin.counterDesign).length) delete skin.counterDesign;
}

function element(tag,text,className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function options(select,rows,value) {
  for (const [key,label] of rows) { const option=element('option',label); option.value=key; select.append(option); }
  select.value=value;
}

export function renderNativeIconEditor({mount,skin,assetOptions,changed,render}) {
  mount.replaceChildren();
  if (skin.rendererVersion === 2) {
    const label = element('label','Built-in tab artwork ');
    const select = element('select');
    select.dataset.tabIconSet = '';
    options(select,[['auto','Match skin'],...Object.entries(COUNTER_TAB_SETS)],skin.counterDesign?.nativeIconSet || 'auto');
    select.addEventListener('input',()=>{
      if (select.value === 'auto') {
        if (skin.counterDesign) {
          delete skin.counterDesign.nativeIconSet;
          if (!Object.keys(skin.counterDesign).length) delete skin.counterDesign;
        }
      } else {
        skin.counterDesign ||= {};
        skin.counterDesign.nativeIconSet = select.value;
      }
      changed();
    });
    label.append(select);
    mount.append(label);
  }
  for (const mode of COUNTER_DESIGN_MODES) {
    const row=element('div',null,'symbol-control'), heading=element('span',COUNTER_LABELS[mode]);
    heading.append(element('small','Accessible label stays fixed'));
    const configuredGlyph = () => skin.symbols[mode] || icons[COUNTER_DESIGN_MODES.indexOf(mode)];
    const glyph=element('select'); glyph.dataset.symbol=mode; glyph.setAttribute('aria-label',COUNTER_LABELS[mode]+' built-in symbol');
    options(glyph,[['__native__','Built-in artwork'],...icons.map(icon=>[icon,icon])],usesNativeCounterIcon(skin,mode)?'__native__':configuredGlyph());
    const artwork=element('select'); artwork.dataset.symbolAsset=mode; artwork.setAttribute('aria-label',COUNTER_LABELS[mode]+' custom image');
    artwork.innerHTML=assetOptions('symbol',skin.symbolAssets[mode],'No custom image');
    glyph.addEventListener('input',()=>{
      const native=glyph.value==='__native__';
      updateCounterDesign(skin,mode,'icon',native?'native':'configured');
      if (native) { skin.symbolAssets[mode]=''; artwork.value=''; }
      else skin.symbols[mode]=glyph.value;
      changed();
    });
    artwork.addEventListener('input',()=>{
      skin.symbolAssets[mode]=artwork.value;
      if (artwork.value) {updateCounterDesign(skin,mode,'icon','configured');glyph.value=configuredGlyph();}
      changed();
    });
    const scale=element('label','Icon scale ','icon-scale'), output=element('output',(skin.symbolScale[mode]||100)+'%'), input=element('input');
    input.type='range'; input.min='60';input.max='200';input.step='5';input.value=String(skin.symbolScale[mode]||100);input.dataset.symbolScale=mode;input.setAttribute('aria-label',COUNTER_LABELS[mode]+' icon scale');
    input.addEventListener('input',()=>{skin.symbolScale[mode]=Number(input.value);output.textContent=input.value+'%';changed();});
    scale.append(output,input);
    const fit=element('button','Auto-fit icon','text-button');fit.type='button';fit.dataset.symbolAutofit=mode;
    fit.addEventListener('click',()=>{skin.symbolScale[mode]=100;render();changed();});
    row.append(heading,glyph,artwork,scale,fit);mount.append(row);
  }
}

export function mountCounterDesignEditor({mount,getSkin,assetOptions,changed,preview}) {
  let mode='life';
  const section=element('section',null,'inspector-block counter-design-editor');section.id='counterDesignEditor';
  const heading=element('h3','Counter face & identity');
  const note=element('p','Customize one counter at a time. Native inherits the appearance. These changes decorate the real dial and readout; game controls stay in place.','helper');
  const choose=element('label','Counter '), select=element('select');select.id='counterDesignMode';
  options(select,COUNTER_DESIGN_MODES.map(key=>[key,COUNTER_LABELS[key]]),mode);choose.append(select);
  const body=element('div',null,'counter-design-fields');
  section.append(heading,note,choose,body);mount.insertBefore(section,mount.querySelector('#symbolControls'));
  select.addEventListener('change',()=>{mode=select.value;render();preview(mode);});
  function render() {
    const skin=getSkin(), design=skin.counterDesign?.modes?.[mode] || {};
    select.value=mode;body.replaceChildren();
    const grid=element('div',null,'counter-design-color-grid');
    for (const [field,label,fallback] of [['accent','Accent',skin.accent],['surface','Face color',skin.background],['text','Readout text',skin.text]]) {
      const wrapper=element('div',null,'counter-color-option'), toggleLabel=element('label'), enabled=element('input');
      enabled.type='checkbox';enabled.checked=Boolean(design[field]);enabled.dataset.counterEnabled=field;
      toggleLabel.append(enabled,document.createTextNode(label));
      const input=element('input');input.type='color';input.value=design[field]||fallback||'#080808';input.disabled=!enabled.checked;input.dataset.counterColor=field;input.setAttribute('aria-label',COUNTER_LABELS[mode]+' '+label);
      enabled.addEventListener('change',()=>{updateCounterDesign(skin,mode,field,enabled.checked?input.value:null);input.disabled=!enabled.checked;preview(mode);changed();});
      input.addEventListener('input',()=>{updateCounterDesign(skin,mode,field,input.value);preview(mode);changed();});
      wrapper.append(toggleLabel,input);grid.append(wrapper);
    }
    body.append(grid);
    for (const [field,label,rows] of [
      ['face','Dial face',[['native','Native face'],['rings','Concentric rings'],['radial','Radiating sectors'],['faceted','Faceted crystal']]],
      ['markings','Dial markings',[['native','Native markings'],['ticks','Twelve ticks'],['runes','Runic ring'],['none','No extra markings']]],
      ['seal','Center emblem',[['native','Current skin seal'],['mode','Counter’s native emblem'],['none','Hide center seal']]],
      ['captionBacking','Caption backing',[['native','Native caption fade'],['surface','Face color plate'],
        ...(skin.rendererVersion === 2 ? [['compact','Compact label plate']] : [])]],
    ]) {
      const labelNode=element('label',label), control=element('select');control.dataset.counterField=field;
      options(control,rows,design[field]||'native');control.addEventListener('input',()=>{
        updateCounterDesign(skin,mode,field,control.value);
        if (field === 'captionBacking') {
          const limit = counterArtStrengthLimit(skin,mode);
          if (design.artOpacity > limit) updateCounterDesign(skin,mode,'artOpacity',limit);
          render();
        }
        preview(mode);changed();
      });
      labelNode.append(control);body.append(labelNode);
    }
    const artworkRoles = ['dial','seal','overlay'];
    const artLabel = element('label'), artTitle = element('span','Face artwork'), art = element('select');
    artTitle.id = 'counterFaceArtLabel';
    art.setAttribute('aria-labelledby',artTitle.id);
    art.dataset.counterField = 'artAsset';
    art.innerHTML = assetOptions(artworkRoles, design.artAsset, 'No counter-specific artwork');
    art.addEventListener('input',()=>{updateCounterDesign(skin,mode,'artAsset',art.value);preview(mode);changed();});
    artLabel.append(artTitle,art); body.append(artLabel);
    const motion = element('fieldset',null,'counter-single-art-motion');
    motion.setAttribute('aria-label','Single-image motion');
    const rotationLabel = element('label','Artwork rotation'), rotation = element('select');
    rotation.dataset.counterField = 'artRotation';
    options(rotation,[['native','Follow skin'],['dial','Turn with dial'],['fixed','Stay upright']],design.artRotation || 'native');
    rotation.addEventListener('input',()=>{updateCounterDesign(skin,mode,'artRotation',rotation.value);preview(mode);changed();});
    rotationLabel.append(rotation); motion.append(rotationLabel);
    if (skin.rendererVersion === 2) {
      const label = element('label',null,'counter-checkbox'), checkbox = element('input');
      checkbox.type = 'checkbox'; checkbox.checked = design.uprightCenter === true; checkbox.dataset.counterField = 'uprightCenter';
      checkbox.addEventListener('change', () => { updateCounterDesign(skin,mode,'uprightCenter',checkbox.checked || null); preview(mode); changed(); });
      label.append(checkbox,document.createTextNode('Keep center engraving upright')); motion.append(label);
      const ringLabel = element('label','Outer ring artwork'), ring = element('select');
      ring.dataset.counterField = 'ringArtAsset';
      ring.innerHTML = assetOptions(artworkRoles,design.ringArtAsset,'No separate ring');
      const cropLabel = element('label','Rotating image area'), crop = element('select');
      crop.dataset.counterField = 'ringCrop';
      options(crop,[['annulus','Outer ring only'],['full','Whole face behind center']],design.ringCrop || 'annulus');
      crop.addEventListener('input',()=>{
        updateCounterDesign(skin,mode,'ringCrop',crop.value === 'full' ? 'full' : null);
        preview(mode); changed();
      });
      cropLabel.append(crop);
      const hint = element('p',null,'helper');
      hint.id = 'counterRingArtHelp';
      ring.setAttribute('aria-describedby',hint.id);
      function showMotion() {
        const separate = Boolean(ring.value);
        cropLabel.hidden = !separate;
        crop.disabled = !separate;
        artTitle.textContent = separate ? 'Center artwork' : 'Face artwork';
        hint.textContent = separate
          ? 'In Dial mode the outer ring turns and the center stays upright. Both images use the size and strength below.'
          : 'Choose a separate image to make the outer ring turn around a fixed center.';
        motion.hidden = separate;
        motion.disabled = separate;
      }
      ring.addEventListener('input',()=>{
        updateCounterDesign(skin,mode,'ringArtAsset',ring.value);
        if (!ring.value) { updateCounterDesign(skin,mode,'ringCrop',null); crop.value = 'annulus'; }
        showMotion(); preview(mode); changed();
      });
      showMotion();
      ringLabel.append(ring); body.append(ringLabel,cropLabel,hint);
    }
    body.append(motion);
    for (const [field,label,min,max,fallback] of [['artOpacity','Artwork strength',0,counterArtStrengthLimit(skin,mode),28],['artScale','Artwork size',70,130,100]]) {
      const labelNode=element('label',label+' '), output=element('output',(design[field]??fallback)+'%'), control=element('input');
      control.type='range';control.min=String(min);control.max=String(max);control.step='1';control.value=String(design[field]??fallback);control.dataset.counterField=field;
      control.addEventListener('input',()=>{updateCounterDesign(skin,mode,field,Number(control.value));output.textContent=control.value+'%';preview(mode);changed();});labelNode.append(output,control);body.append(labelNode);
      if (field === 'artOpacity' && max === 55) body.append(element('small','Choose Face color plate for artwork strength up to 100%.','helper'));
    }
    const actions=element('div',null,'counter-design-actions'), apply=element('button','Use '+COUNTER_LABELS[mode]+' identity','secondary-action'), reset=element('button','Reset this counter face','text-button');
    apply.type='button';apply.dataset.counterIdentity=mode;reset.type='button';reset.dataset.counterReset=mode;
    apply.addEventListener('click',()=>{for(const [key,value] of Object.entries(presets[mode]))updateCounterDesign(skin,mode,key,value);render();preview(mode);changed();});
    reset.addEventListener('click',()=>{for(const field of ['accent','surface','text','face','markings','seal','captionBacking','artAsset','ringArtAsset','ringCrop','artOpacity','artScale','artRotation','uprightCenter'])updateCounterDesign(skin,mode,field,null);render();preview(mode);changed();});
    actions.append(apply,reset);body.append(actions);
  }
  render();return render;
}
