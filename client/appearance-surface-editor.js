import { surfaceDefinitions, surfaceDesignSpec } from './appearance-surface-design.js';
import { appearanceFonts } from './appearance-fonts.js';

const clone = value => structuredClone(value);
const get = (value,path) => path.reduce((record,key)=>record?.[key],value);
// Removing the last override really removes the record. No materialized
// defaults are written into a catalog just because a panel was opened.
export function setSurfaceField(draft,key,path,value) {
  if (!surfaceDesignSpec.fields.surfaces.fields[key]) return;
  draft.surfaceDesign ||= {}; draft.surfaceDesign.surfaces ||= {};
  const parents=[draft.surfaceDesign.surfaces],keys=[key,...path];
  for (const part of keys.slice(0,-1)) { const parent=parents.at(-1); parent[part] ||= {}; parents.push(parent[part]); }
  if (value===undefined) delete parents.at(-1)[keys.at(-1)]; else parents.at(-1)[keys.at(-1)]=clone(value);
  for (let index=parents.length-1;index>0;index--) if (!Object.keys(parents[index]).length) delete parents[index-1][keys[index-1]];
  if (!Object.keys(draft.surfaceDesign.surfaces).length) delete draft.surfaceDesign.surfaces;
  if (!Object.keys(draft.surfaceDesign).length) delete draft.surfaceDesign;
}

export function mergeSurfaceOverrides(draft,key,copied) {
  const spec=surfaceDesignSpec.fields.surfaces.fields[key];if(!spec)return;
  const filter=(value,descriptor)=>{
    if(descriptor.type!=='object')return clone(value);
    const result={};
    if(!value||typeof value!=='object'||Array.isArray(value))return result;
    for(const [field,child]of Object.entries(descriptor.fields))if(Object.hasOwn(value,field)) {
      const next=filter(value[field],child);
      if(child.type!=='object'||Object.keys(next).length)result[field]=next;
    }
    return result;
  };
  const supported=filter(copied,spec);if(!Object.keys(supported).length)return;
  const merge=(previous,next)=>{const result=clone(previous||{});for(const [field,value]of Object.entries(next))result[field]=value&&typeof value==='object'&&!Array.isArray(value)?merge(result[field],value):clone(value);return result;};
  setSurfaceField(draft,key,[],merge(draft.surfaceDesign?.surfaces?.[key],supported));
}

export function mountSurfaceEditor({getDraft,change,getSource=()=>null}) {
  const host=document.querySelector('#edit-components');
  if (!host) return ()=>{};
  const element=(tag,text,className) => { const node=document.createElement(tag); if(text)node.textContent=text;if(className)node.className=className;return node; };
  const box=element('section',null,'inspector-block surface-design-editor');
  const title=element('h3','Surface materials & type');
  const explanation=element('p','Choose one game surface. Inherit uses this skin’s shared palette and type; overrides affect only the chosen surface.','helper');
  const pickerLabel=element('label','Game surface'),picker=element('select'); picker.id='surfaceDesignTarget';pickerLabel.htmlFor=picker.id;
  for(const definition of surfaceDefinitions) { const option=element('option',definition.label); option.value=definition.key;picker.append(option); }
  pickerLabel.append(picker);
  const state=element('p',null,'helper');state.setAttribute('aria-live','polite');
  const actions=element('div',null,'surface-design-actions'),reset=element('button','Reset surface to inherited'),source=element('button','Restore source surface');
  reset.type=source.type='button';actions.append(reset,source);
  const transfer=element('div',null,'surface-design-actions'),copyStyle=element('button','Copy surface style'),pasteStyle=element('button','Merge copied style');
  copyStyle.type=pasteStyle.type='button';transfer.append(copyStyle,pasteStyle);
  const transferNote=element('p','Copy keeps this surface’s explicit overrides in this tab. Merge overwrites matching fields on the chosen target, keeps its other overrides, and skips unsupported text roles. Undo reverses the merge.','helper');
  let clipboard=null,clipboardName='';
  const materials=element('details'),materialTitle=element('summary','Fill, texture & colors'); materials.open=true;materials.append(materialTitle);
  const edges=element('details'),edgeTitle=element('summary','Border & depth');edges.append(edgeTitle);
  const typography=element('details'),typeTitle=element('summary','Typography by role');typography.append(typeTitle);
  const typeNote=element('p','Each role can inherit independently. Local Cinzel, Roboto Condensed and Literata use upright variable weights 400–700; italic slants those upright faces in the browser. Other scripts use the fallback stack. The main value keeps automatic number fit.','helper');typography.append(typeNote);
  const roleLabel=element('label','Text role'),rolePicker=element('select');rolePicker.id='surfaceDesignRole';roleLabel.htmlFor=rolePicker.id;roleLabel.append(rolePicker);typography.append(roleLabel);
  const roleRows=element('div');typography.append(roleRows);
  box.append(title,explanation,pickerLabel,state,actions,transfer,transferNote,materials,edges,typography);host.append(box);
  let selected='playerCards',selectedRole='label',sequence=0;
  const rows=[];
  const data=()=>getDraft()?.surfaceDesign?.surfaces?.[selected]||{};
  const fallback=(path) => {
    const draft=getDraft()||{},key=path.at(-1);
    const components={playerCards:'playerCards',primaryActions:'endTurn',lifeControls:'lifeButtons',navigation:'navigation'},component=draft.componentColors?.[components[selected]]||{};
    const colors={color:component.background||draft.surface||'#161616',color2:draft.background||'#080808',ink:component.text||draft.text||'#f4ecd9',muted:draft.muted||'#afa590',accent:component.selectedText||draft.accent||'#d8ae61'};
    const defaults={kind:'solid',opacity:100,angle:135,width:1,style:'solid',shadow:'soft',strength:6,family:draft.fontFamily||'system',weight:Number(draft.fontWeight)||600,lineHeight:Number(draft.lineHeight)||1.3,tracking:Number(draft.letterSpacing)||0,case:draft.textTransform||'none',scale:100,topLeft:8,topRight:8,bottomRight:8,bottomLeft:8};
    if(path[0]==='typography'&&key==='style')return 'normal';
    if(path[0]==='typography'&&key==='shadow')return 'none';
    if(path[0]==='texture'&&key==='kind')return 'lines';
    if(path[0]==='border'&&key==='color')return draft.borderColor||draft.accent||'#d8ae61';
    return colors[key]??defaults[key];
  };
  const commit=(path,value) => { setSurfaceField(getDraft(),selected,path,value);change();render(); };
  function row(parent,label,path,spec) {
    const line=element('div',null,'surface-design-field'),id='surface-design-control-'+(++sequence);
    const overrideLabel=element('label'),toggle=element('input');toggle.type='checkbox';toggle.id=id+'-override';overrideLabel.htmlFor=toggle.id;
    overrideLabel.append(toggle,document.createTextNode(label));
    const value=element(spec.type==='enum'?'select':'input');value.id=id;value.setAttribute('aria-label',label+' value');
    if(spec.type==='enum') for(const choice of spec.values) {const option=element('option',path.at(-1)==='family'?appearanceFonts[choice].label:String(choice));option.value=String(choice);value.append(option);}
    else if(spec.type==='color')value.type='color';
    else {value.type='number';value.min=spec.min;value.max=spec.max;value.step=spec.max<=2?'.01':spec.min<0?'.005':'1';value.inputMode='decimal';}
    const hint=element('small');hint.id=id+'-state';value.setAttribute('aria-describedby',hint.id);
    let hexInput;
    if(spec.type==='color') {
      const pair=element('div',null,'surface-design-color-pair');hexInput=element('input');hexInput.type='text';hexInput.pattern='#[0-9a-fA-F]{6}';hexInput.maxLength=7;hexInput.spellcheck=false;hexInput.setAttribute('aria-label',label+' hex');hexInput.setAttribute('aria-describedby',hint.id);
      pair.append(value,hexInput);line.append(overrideLabel,pair,hint);
      hexInput.addEventListener('change',()=>{if(!hexInput.checkValidity()){hexInput.reportValidity();return;}commit(path,hexInput.value.toLowerCase());});
    } else line.append(overrideLabel,value,hint);
    parent.append(line);
    const entry={line,toggle,value,hexInput,hint,path,spec};rows.push(entry);
    toggle.addEventListener('change',()=>{
      if(path.length===1&&path[0]==='fill')return;
      commit(path,toggle.checked?fallback(path):undefined);
    });
    value.addEventListener('change',()=>{
      if(spec.type==='number'&&!value.checkValidity()){value.reportValidity();return;}
      const numeric=spec.type==='number'||(spec.type==='enum'&&typeof spec.values[0]==='number');
      commit(path,numeric?Number(value.value):value.value);
    });
    return entry;
  }
  // Fill is a coherent override: selecting its kind also seeds its first stop.
  const fillLine=element('label','Fill'),fillPicker=element('select');fillPicker.id='surfaceDesignFill';fillLine.htmlFor=fillPicker.id;
  for(const [value,label] of [['','Inherit existing fill'],['solid','Solid'],['linear','Linear gradient'],['radial','Radial gradient']]) {const option=element('option',label);option.value=value;fillPicker.append(option);}
  fillLine.append(fillPicker);materials.append(fillLine);
  const glassBacking = element('button','Use translucent card backing','text-button');
  glassBacking.type = 'button';
  glassBacking.addEventListener('click', () => {
    const fill = data().fill || {};
    commit(['fill'], { ...fill, kind:fill.kind || 'solid', color:fill.color || fallback(['fill','color']), opacity:55 });
  });
  materials.append(glassBacking);
  fillPicker.addEventListener('change',()=>{
    if(!fillPicker.value)commit(['fill'],undefined);
    else {const existing=data().fill||{};commit(['fill'],{...existing,kind:fillPicker.value,color:existing.color||fallback(['fill','color'])});}
  });
  const fillRows=element('div');materials.append(fillRows);
  for(const [key,label] of [['color','Fill first color'],['color2','Fill second color'],['angle','Gradient angle'],['opacity','Fill opacity %']])row(fillRows,label,['fill',key],surfaceDesignSpec.fields.surfaces.fields.playerCards.fields.fill.fields[key]);
  for(const [key,label] of [['ink','Main text'],['muted','Supporting text'],['accent','Accent labels']])row(materials,label,[key],{type:'color'});
  for(const [key,label] of [['kind','Texture pattern'],['strength','Texture strength %']])row(materials,label,['texture',key],surfaceDesignSpec.fields.surfaces.fields.playerCards.fields.texture.fields[key]);
  for(const [key,label] of [['color','Border color'],['width','Border width px'],['style','Border style']])row(edges,label,['border',key],surfaceDesignSpec.fields.surfaces.fields.playerCards.fields.border.fields[key]);
  for(const [key,label] of [['topLeft','Top left corner px'],['topRight','Top right corner px'],['bottomRight','Bottom right corner px'],['bottomLeft','Bottom left corner px']])row(edges,label,['radii',key],surfaceDesignSpec.fields.surfaces.fields.playerCards.fields.radii.fields[key]);
  row(edges,'Shadow',['shadow'],surfaceDesignSpec.fields.surfaces.fields.playerCards.fields.shadow);
  const borderNote=element('p','On a borderless surface, set width, style and color to draw a visible border.','helper');edges.prepend(borderNote);edges.prepend(edgeTitle);
  function buildRoles() {
    for(let index=rows.length-1;index>=0;index--)if(rows[index].path[0]==='typography')rows.splice(index,1);
    roleRows.replaceChildren();rolePicker.replaceChildren();
    const definition=surfaceDefinitions.find(surface=>surface.key===selected);
    if(!definition.roles[selectedRole])selectedRole=Object.keys(definition.roles)[0];
    for(const [value,role] of Object.entries(definition.roles)){const option=element('option',role.label);option.value=value;rolePicker.append(option);}
    rolePicker.value=selectedRole;
    const fields=surfaceDesignSpec.fields.surfaces.fields[selected].fields.typography.fields[selectedRole].fields;
    for(const [key,spec] of Object.entries(fields))row(roleRows,({family:'Font family',weight:'Font weight',style:'Font style',shadow:'Text shadow',lineHeight:'Line height',tracking:'Letter spacing em',case:'Letter case',scale:'Role size %'})[key],['typography',selectedRole,key],spec);
  }
  picker.addEventListener('change',()=>{selected=picker.value;buildRoles();render();});
  rolePicker.addEventListener('change',()=>{selectedRole=rolePicker.value;buildRoles();render();});
  reset.addEventListener('click',()=>{setSurfaceField(getDraft(),selected,[],undefined);change();render();});
  source.addEventListener('click',()=>{setSurfaceField(getDraft(),selected,[],getSource()?.surfaceDesign?.surfaces?.[selected]);change();render();});
  copyStyle.addEventListener('click',()=>{clipboard=clone(data());clipboardName=surfaceDefinitions.find(surface=>surface.key===selected).label;render();});
  pasteStyle.addEventListener('click',()=>{if(!clipboard)return;mergeSurfaceOverrides(getDraft(),selected,clipboard);change();render();});
  function render() {
    const draft=getDraft()||{},definition=surfaceDefinitions.find(surface=>surface.key===selected),current=data(),locked=draft.id!=='__neutral_arc__'&&draft.rendererVersion!==2;
    picker.value=selected;fillPicker.value=current.fill?.kind||'';fillPicker.disabled=locked;
    glassBacking.hidden = selected !== 'playerCards' || current.fill?.opacity === 55;
    glassBacking.disabled = locked;
    fillRows.hidden=!current.fill?.kind;
    for(const entry of rows) {
      const actual=get(current,entry.path),overridden=actual!==undefined;
      entry.toggle.checked=overridden;entry.toggle.disabled=locked;
      entry.value.disabled=locked||!overridden;
      entry.value.value=String(overridden?actual:fallback(entry.path));
      if(entry.hexInput) {entry.hexInput.value=entry.value.value;entry.hexInput.disabled=entry.value.disabled;}
      entry.hint.textContent=overridden?(entry.spec.type==='color'?String(actual):'Custom'):'Inherited';
      entry.line.hidden=entry.path.length===1&&['ink','muted','accent'].includes(entry.path[0])&&!definition[entry.path[0]];
      if(entry.path[0]==='fill') {
        if(entry.path[1]==='color')entry.toggle.disabled=true;
        if(entry.path[1]==='color2')entry.line.hidden=current.fill?.kind==='solid';
        if(entry.path[1]==='angle')entry.line.hidden=current.fill?.kind!=='linear';
      }
      if(entry.path[0]==='texture'&&entry.path[1]==='strength')entry.line.hidden=!current.texture?.kind||current.texture.kind==='none';
    }
    reset.disabled=locked||!Object.keys(current).length;source.hidden=!getSource();source.disabled=locked;
    copyStyle.disabled=locked||draft.id==='__neutral_arc__'||!Object.keys(current).length;pasteStyle.disabled=locked||draft.id==='__neutral_arc__'||!clipboard;
    pasteStyle.textContent=clipboard?'Merge '+clipboardName+' style':'Merge copied style';
    state.textContent=locked?'Use expanded controls before customizing these surfaces.':definition.label+': '+(Object.keys(current).length?'custom overrides; unchecked fields inherit.':'all fields inherited.');
  }
  buildRoles();render();return render;
}
