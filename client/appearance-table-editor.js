import { sceneDesignSpec, sceneMoments } from './appearance-scene-design.js';
import { canvasDesignSpec, tableDesignSpec } from './appearance-table-design.js?v=4';

const canvasFields = [
  ['fill','Backdrop fill',['Solid','Linear gradient','Radial glow']],
  ['endColor','Second color','#18334a'], ['angle','Gradient angle',145,'°'],
  ['lightX','Glow center across',50,'%'], ['lightY','Glow center down',25,'%'],
  ['pattern','Printed pattern',['None','Grid','Dots','Diagonal stripes','Woven lines','Star field','Contour lines','Rays']],
  ['patternColor','Pattern ink','#d8ae61'], ['spacing','Pattern spacing',28,' px'],
  ['strength','Pattern opacity',12,'%'], ['artShade','Image shading',32,'%'],
  ['frame','Playfield frame',['None','Single rule','Double rule','Corner marks']],
  ['frameColor','Frame ink','#d8ae61'], ['frameStrength','Frame opacity',40,'%'],
  ['flourish','Edge ornament',['None','Breathing corners','Travelling edge lights','Soft glints']],
  ['flourishColor','Ornament ink','#d8ae61'], ['flourishStrength','Ornament opacity',18,'%'], ['flourishPeriod','Motion cycle',28,' s']
];
const tableFields = [
  ['dialSocket','Dial socket',['None','Carved stone','Brushed metal']],
  ['seatArrangement','Player card order',['Name first','Number first']],
  ['seatAlign','Player card alignment',['Left','Center','Right']],
  ['titleRule','Table title ornaments',['None','Short rules','Double rules']], ['titleInk','Table title ink','#cba66d'],
  ['turnMarker','Active player card',['Leading edge','Double keyline','Inset keyline']],
  ['turnAccent','Turn highlight','#d8ae61'], ['ownerMarker','My seat marker',['Underline name','Dot beside name']],
  ['ownerAccent','My seat highlight','#d8ae61'], ['bannerMark','Turn banner edge',['Leading rule','Double rule','Ticket edge']],
  ['navMark','Selected counter marker',['Bottom bar','Label capsule','Keyline']],
  ['stepMark','Adjustment button edge',['Solid rule','Dotted rule']], ['stepInk','Dial plus and minus ink','#d8ae61'],
  ['feedbackMark','Status message frame',['Side rule','Double keyline','Dashed line']],
  ['tableWidth','Maximum playfield width',720,' px'], ['sideGutter','Side margins',12,' px'], ['rowGap','Space between rows',6,' px']
];

function namedBlock(title) {
  const section = document.createElement('details'); section.className = 'inspector-block design-inspector';
  const summary = document.createElement('summary'); summary.textContent = title; section.append(summary);
  const grid = document.createElement('div'); grid.className = 'design-field-grid'; section.append(grid);
  return {section,grid};
}
export function mountTableDesignEditor({getDraft,change}) {
  const bindings = [];
  function build(parent,title,key,spec,fields,moments) {
    const {section,grid} = namedBlock(title);
    document.querySelector(parent).append(section);
    let selected = 'ownTurn';
    const currentFields = () => (moments ? getDraft()[key]?.[selected] : getDraft()[key]) || {};
    if (moments) {
      const label = document.createElement('label'); label.textContent = 'Game moment';
      const select = document.createElement('select'); select.id = 'designMoment'; label.htmlFor = select.id;
      for (const [id,[name]] of Object.entries(moments)) select.add(new Option(name,id));
      label.append(select); section.insertBefore(label,grid);
      select.addEventListener('change',()=>{selected=select.value;render();});
      const preview = document.createElement('button'); preview.type = 'button'; preview.textContent = 'Preview this moment';
      preview.addEventListener('click',()=>{
        const scene = document.getElementById('studioScene');
        scene.value = moments[selected][1]; scene.dispatchEvent(new Event('change',{bubbles:true}));
      });
      section.insertBefore(preview,grid);
    }
    function write(name,value) {
      const draft = getDraft();
      const next = {...currentFields()};
      if (value === undefined) delete next[name]; else next[name] = value;
      if (moments) {
        const settings = {...draft[key]};
        if (Object.keys(next).length) settings[selected] = next; else delete settings[selected];
        if (Object.keys(settings).length) draft[key] = settings; else delete draft[key];
      } else if (Object.keys(next).length) draft[key] = next;
      else delete draft[key];
      change(); render();
    }
    for (const [name,labelText,defaults,unit = ''] of fields) {
      const field = spec.fields[name], row = document.createElement('div');
      row.className = 'design-field'; grid.append(row);
      const label = document.createElement('label'); label.textContent = labelText;
      const control = document.createElement(field.type === 'enum' ? 'select' : 'input');
      control.id = key + '-' + name; label.htmlFor = control.id;
      row.append(label,control);
      if (field.type === 'enum') {
        control.add(new Option('Inherit',''));
        field.values.forEach((value,index) => control.add(new Option(defaults[index],value)));
        control.addEventListener('change',() => write(name,control.value || undefined));
      } else {
        const action = document.createElement('button');
        action.type = 'button'; action.className = 'inherit-field'; action.textContent = 'Inherit';
        action.setAttribute('aria-label','Inherit ' + labelText.toLowerCase());
        action.addEventListener('click',() => write(name,field.type === 'color' && !Object.hasOwn(currentFields(),name) ? control.value : undefined)); row.append(action);
        const value = document.createElement('output'); value.htmlFor.value = control.id;
        value.setAttribute('aria-hidden','true'); label.append(' ',value);
        if (field.type === 'number') {
          control.type = 'range'; control.min = field.min; control.max = field.max; control.step = 1;
          control.addEventListener('input',() => write(name,Number(control.value)));
        } else {
          control.type = 'color';
          control.addEventListener('input',() => write(name,control.value));
          const hex = document.createElement('input'); hex.className = 'design-hex'; hex.type = 'text'; hex.maxLength = 7;
          hex.autocomplete = 'off'; hex.spellcheck = false; hex.setAttribute('aria-label',labelText + ' hex');
          row.insertBefore(hex,action);
          const commit = () => {
            const raw = hex.value.trim();
            if (!/^#?[a-f0-9]{6}$/i.test(raw)) {
              hex.setCustomValidity('Enter six hexadecimal digits.'); hex.reportValidity(); return;
            }
            hex.setCustomValidity(''); write(name,'#' + raw.replace(/^#/,'').toLowerCase());
          };
          hex.addEventListener('change',commit);
          hex.addEventListener('input',() => hex.setCustomValidity(''));
          hex.addEventListener('keydown',event => {
            if (event.key === 'Enter') {event.preventDefault(); commit();}
            if (event.key === 'Escape') {event.preventDefault(); hex.setCustomValidity(''); render();}
          });
          bindings.push(() => { hex.value = control.value.toUpperCase(); hex.setCustomValidity(''); });
        }
        bindings.push(() => {
          const custom = Object.hasOwn(currentFields(),name);
          value.textContent = field.type === 'number' ? control.value + unit : '';
          action.hidden = !custom && field.type !== 'color';
          action.textContent = custom ? 'Inherit' : 'Use color';
          action.setAttribute('aria-label',(custom ? 'Inherit ' : 'Use current color for ') + labelText.toLowerCase());
        });
      }
      // Sync the input before its readout and keyboard color field.
      bindings.unshift(() => {
        const current = currentFields()[name];
        const fallback = field.type === 'enum' ? '' : field.type === 'color' && name !== 'titleInk'
          ? (name === 'endColor' ? getDraft().surface : getDraft().accent) || defaults : defaults;
        control.value = current ?? fallback;
        const canvas = getDraft().canvasDesign || {};
        if (key === 'canvasDesign') {
          if (name === 'angle') row.hidden = canvas.fill !== 'linear';
          if (name === 'endColor') row.hidden = !['linear','radial'].includes(canvas.fill);
          if (['lightX','lightY'].includes(name)) row.hidden = canvas.fill !== 'radial';
          if (['patternColor','spacing','strength'].includes(name)) row.hidden = !canvas.pattern || canvas.pattern === 'none' || (name === 'spacing' && canvas.pattern === 'rays');
          if (['frameColor','frameStrength'].includes(name)) row.hidden = !canvas.frame || canvas.frame === 'plain';
          if (['flourishColor','flourishStrength','flourishPeriod'].includes(name)) row.hidden = !canvas.flourish || canvas.flourish === 'none';
          if (name === 'artShade') row.hidden = !getDraft().backgroundAsset;
        }
      });
    }
  }
  build('#edit-foundation','Backdrop, pattern & frame','canvasDesign',canvasDesignSpec,canvasFields);
  build('#edit-foundation','Appearance by game moment','sceneDesign',sceneDesignSpec.fields.ownTurn,[
    ['tint','Backdrop tint','#d8ae61'], ['strength','Tint strength',12,'%'],
    ['edge','Moment frame',['None','Single rule','Double rule']], ['edgeColor','Moment frame color','#d8ae61']
  ],sceneMoments);
  build('#edit-layout','Playfield & table markers','tableDesign',tableDesignSpec,tableFields);
  function render() { for (const sync of bindings) sync(); }
  render(); return render;
}
