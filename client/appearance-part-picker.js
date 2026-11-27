// The picker belongs to the authoring window. It reads the visible bounds of
// the real preview's fixed elements and keeps input outside the game document.
const areas = [
  ['inputs','Form field','dialog[open] :is(input,select,textarea)'],
  ['results','Result heading','#victoryDialog[open] .victory-winner-copy'],
  ['dialogs','Game dialog','#customLifeDialog[open],#radiationDialog[open],#commanderSourceDialog[open],#commanderTaxDialog[open]'],
  ['gameMenu','Game menu','#gameMenu:not([hidden])'],
  ['primaryActions','Turn actions','#turnActions button'], ['lifeControls','Life adjustments','#adjustControls button,#customLifeButton'],
  ['commanderTools','Commander tools','#sourcePanel,.commander-tax-quick button'],
  ['gameHeader','Game header','.brand-bar'], ['turnBar','Turn bar','#turnBanner'], ['playerCards','Player card','.pod-seat'],
  ['readout','Counter number','#mainValue'], ['counter','Dial face','.dial-face,.dial-controls'],
  ['navigation','Counter navigation','#modeNav'], ['lobby','Lobby','#lobbyView,#lobbyControls,#intermissionPanel'],
  ['canvas','Table backdrop','#gameView']
];
const modeNames = {life:'Life',commander:'Commander',radiation:'Radiation',poison:'Poison',energy:'Energy',generic:'Generic'};
export function mountPartPicker({showSection}) {
  const heading = document.querySelector('.workspace-preview-heading');
  const launcher = document.createElement('button'); launcher.type='button'; launcher.id='pickGamePart';
  launcher.className='secondary-action'; launcher.textContent='Pick a part'; launcher.setAttribute('aria-expanded','false');
  heading.append(launcher);
  const tools = document.createElement('div'); tools.id='partPickerTools'; tools.className='part-picker-tools'; tools.hidden=true;
  const label=document.createElement('label'); label.textContent='Edit game part';
  const picker=document.createElement('select'); picker.id='gamePartList'; label.htmlFor=picker.id; label.append(picker);
  picker.add(new Option('Choose from list…',''));
  for (const [id,title] of areas) picker.add(new Option(title,id));
  for (const [id,title] of Object.entries(modeNames)) picker.add(new Option(title+' counter design','mode-'+id));
  const note=document.createElement('span'); note.textContent='Click the game preview or choose a part here.';
  const cancel=document.createElement('button'); cancel.type='button'; cancel.textContent='Cancel';
  tools.append(label,note,cancel); heading.after(tools); launcher.setAttribute('aria-controls',tools.id);
  const overlays=new Map();
  function stop(focus) {
    for (const node of overlays.values()) node.remove(); overlays.clear();
    tools.hidden=true; picker.value=''; launcher.setAttribute('aria-expanded','false');
    if (focus) launcher.focus();
  }
  function choose(id,mode) {
    stop(false);
    const counter = id === 'counter' || id.startsWith('mode-'), canvas=id === 'canvas';
    showSection(canvas ? 'foundation' : counter ? 'symbols' : 'components',false);
    const control = document.getElementById(canvas ? 'canvasDesign-fill' : counter ? 'counterDesignMode' : 'surfaceDesignTarget');
    if (!control) return;
    for (let node=control.parentElement;node;node=node.parentElement) if (node.tagName==='DETAILS') node.open=true;
    if (!canvas) {
      control.value=counter ? (id.startsWith('mode-') ? id.slice(5) : mode || 'life') : id;
      control.dispatchEvent(new Event('change',{bubbles:true}));
    }
    control.focus({preventScroll:true}); control.scrollIntoView({block:'nearest'});
  }
  function hit(doc,x,y) {
    const modal=doc.querySelector('dialog[open]');
    const menu=doc.querySelector('#gameMenu:not([hidden])');
    const scope=modal || menu;
    const contains=node=>{
      const box=node.getBoundingClientRect();
      return box.width && box.height && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    };
    const navButton=[...doc.querySelectorAll('#modeNav button[data-mode]')].find(contains);
    if (!scope && navButton) return {id:'mode-'+navButton.dataset.mode,name:modeNames[navButton.dataset.mode]+' counter',node:navButton};
    for (const [id,name,selector] of areas) {
      const node=[...doc.querySelectorAll(selector)].find(el=>(!scope || scope.contains(el)) && contains(el));
      if (node) return {id,name,node};
    }
    return null;
  }
  function attach(frame) {
    if (overlays.has(frame) || !frame.parentElement) return;
    const layer=document.createElement('div'); layer.className='game-pick-overlay'; layer.setAttribute('aria-hidden','true');
    const marker=document.createElement('span'); marker.className='game-pick-mark';
    const tag=document.createElement('span'); tag.className='game-pick-label'; marker.append(tag); layer.append(marker);
    marker.hidden=true; frame.parentElement.append(layer); overlays.set(frame,layer);
    function locate(event) {
      let doc;
      try { doc=frame.contentDocument; } catch { return null; }
      if (!doc?.documentElement || !doc.querySelector('html.appearance-preview')) return null;
      const rect=frame.getBoundingClientRect();
      const scale=rect.width/doc.documentElement.clientWidth;
      if (!Number.isFinite(scale) || scale <= 0) return null;
      return hit(doc,(event.clientX-rect.left)/scale,(event.clientY-rect.top)/scale);
    }
    layer.addEventListener('pointermove',event=>{
      const part=locate(event); marker.hidden=!part; if (!part) return;
      const box=part.node.getBoundingClientRect();
      marker.style.left=(frame.offsetLeft+box.x)+'px'; marker.style.top=(frame.offsetTop+box.y)+'px';
      marker.style.width=box.width+'px'; marker.style.height=box.height+'px'; tag.textContent=part.name;
    });
    layer.addEventListener('pointerleave',()=>{marker.hidden=true;});
    layer.addEventListener('click',event=>{
      event.preventDefault(); const part=locate(event);
      if (part) choose(part.id,frame.contentDocument.documentElement.dataset.previewMode);
    });
  }
  const grid=document.getElementById('devicePreviewGrid');
  function sync() {
    if (tools.hidden) return;
    for (const [frame,node] of overlays) if (!frame.isConnected) { node.remove(); overlays.delete(frame); }
    for (const frame of grid.querySelectorAll('iframe')) attach(frame);
  }
  const observer=new MutationObserver(sync); observer.observe(grid,{childList:true,subtree:true});
  launcher.addEventListener('click',()=>{
    if (!tools.hidden) {stop(true);return;}
    tools.hidden=false; launcher.setAttribute('aria-expanded','true'); sync(); picker.focus({preventScroll:true});
  });
  cancel.addEventListener('click',()=>stop(true));
  picker.addEventListener('change',()=>{ if (picker.value) choose(picker.value); });
  document.addEventListener('keydown',event=>{ if(event.key==='Escape' && !tools.hidden) {event.preventDefault();stop(true);} });
}
