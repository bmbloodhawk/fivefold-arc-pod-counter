// Read-only measurements of the real fixture document. Rectangles describe
// layout and clipping; they do not certify touch comfort or artwork contrast.
const rect = box => ({x:box.x,y:box.y,width:box.width,height:box.height});
const right = box => box.x+box.width;
const bottom = box => box.y+box.height;
const intersection = (first,second) => ({width:Math.max(0,Math.min(right(first),right(second))-Math.max(first.x,second.x)),height:Math.max(0,Math.min(bottom(first),bottom(second))-Math.max(first.y,second.y))});
const outside = (box,bounds,tolerance=2) => box.x<bounds.x-tolerance || right(box)>right(bounds)+tolerance || box.y<bounds.y-tolerance || bottom(box)>bottom(bounds)+tolerance;

export function hiddenByClosedDetails(node) {
  // WebKit can report layout rectangles for content of a closed disclosure.
  // Only its first summary (and descendants of that summary) is painted.
  for (let parent=node.parentElement;parent;parent=parent.parentElement) {
    if (parent.tagName!=='DETAILS' || parent.open) continue;
    const summary=[...parent.children].find(child=>child.tagName==='SUMMARY');
    if (!summary?.contains(node)) return true;
  }
  return false;
}

export async function settlePreviewDocument(doc) {
  await doc.fonts.ready;
  // Entry motion changes physical rectangles while the production fitter is
  // scheduling its own measurements. Check the settled view, not that motion.
  const entrances=doc.getAnimations().filter(animation=>
    animation.effect?.target?.classList?.contains('view') && Number.isFinite(animation.effect.getTiming().iterations));
  await Promise.all(entrances.map(animation=>animation.finished.catch(()=>{})));
  await new Promise(resolve=>doc.defaultView.requestAnimationFrame(()=>doc.defaultView.requestAnimationFrame(resolve)));
}

export function measurePreviewDocument(doc) {
  const win=doc.defaultView, root=doc.documentElement;
  const style=node=>win.getComputedStyle(node);
  const visible=node=>Boolean(node && node.getClientRects().length && !hiddenByClosedDetails(node) && style(node).visibility!=='hidden' && style(node).display!=='none');
  const all=(scope,selector)=>[...scope.querySelectorAll(selector)].filter(visible);
  const name=node=>node.getAttribute('aria-label') || node.textContent.trim().replace(/\s+/g,' ').slice(0,55) || node.id || 'Control';
  const bounds={x:0,y:0,width:root.clientWidth,height:Math.max(root.clientHeight,root.scrollHeight)};
  function verticalScroll(node) {
    for (let parent=node.parentElement;parent && parent!==root;parent=parent.parentElement) {
      if (['auto','scroll'].includes(style(parent).overflowY) && parent.scrollHeight>parent.clientHeight+1) return true;
    }
    return false;
  }
  function clipped(node,box) {
    if (box.x<-.5 || right(box)>right(bounds)+.5 || (!verticalScroll(node) && (box.y<-.5 || bottom(box)>bottom(bounds)+.5))) return true;
    let canScroll=false;
    for (let parent=node.parentElement;parent && parent!==root;parent=parent.parentElement) {
      const css=style(parent), parentBox=rect(parent.getBoundingClientRect());
      if (['auto','scroll'].includes(css.overflowY) && parent.scrollHeight>parent.clientHeight+1) canScroll=true;
      if (['hidden','clip'].includes(css.overflowX) && (box.x<parentBox.x-2 || right(box)>right(parentBox)+2)) return true;
      if (!canScroll && ['hidden','clip'].includes(css.overflowY) && (box.y<parentBox.y-2 || bottom(box)>bottom(parentBox)+2)) return true;
    }
    return false;
  }
  const game=doc.querySelector('#gameView');
  const modal=all(doc,'dialog[open]').at(-1);
  const menu=doc.querySelector('#gameMenu');
  const lobby=doc.querySelector('#lobbyView');
  const scope=modal || (visible(menu)?menu:visible(lobby)?lobby:game);
  const context=modal?'dialog':visible(menu)?'menu':visible(lobby)?'lobby':'game';
  const requirements=[], nodes=[];
  function requireTargets(selector,label,minimum=1) {
    const found=all(scope,selector);
    requirements.push({label,minimum,found:found.length});nodes.push(...found);
  }
  if (context==='game' && visible(game)) {
    for (const mode of ['life','commander','radiation','poison','energy','generic']) {
      const selector='.mode-nav button[data-mode="'+mode+'"]';
      if (!doc.querySelector(selector)?.hidden) requireTargets(selector,mode+' navigation');
    }
    if (!doc.querySelector('#customLifeButton')?.hidden) requireTargets('#customLifeButton','Custom life action');
    requireTargets('#commanderTaxQuickButton','Commander tax action');
    if (game.dataset.interfaceStyle==='dial') {
      requireTargets('.dial-step','Dial side controls',2);
      requireTargets('.dial-gesture','Rotary counter surface');
    }
    else requireTargets('.adjust-controls button','Life adjustment controls',4);
    if (game.dataset.counterMode==='commander') requireTargets('#sourcePanel button','Commander source control');
    const turn=doc.querySelector('#turnActions');
    const turnCommands=turn?[...turn.querySelectorAll('button')].filter(node=>!node.hidden).length:0;
    if (visible(turn) && turnCommands) requireTargets('#turnActions > button','Turn actions',turnCommands);
    nodes.push(...all(game,'#turnActions > button,#sourcePanel button'));
  } else if (scope) {
    if (modal?.id==='victoryDialog') {
      requirements.push({label:'Victory continuation surface',minimum:1,found:visible(modal)?1:0});
      nodes.push(modal);
    } else requireTargets('button','Visible '+context+' actions');
    nodes.push(...all(scope,'input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea'));
  }
  const unique=[...new Set(nodes)];
  const targets=unique.map(node=>{
    const box=rect(node.getBoundingClientRect());
    // These two native controls already ship below 44px. Preserve their actual
    // minimums instead of imposing unrelated production geometry changes.
    const minimum=node.id==='closeGameMenuButton'?42:node.matches('[data-move-seat]')?30:44;
    return {label:name(node),...box,minimum,scrollable:verticalScroll(node),clipped:clipped(node,box)};
  });
  // Side controls use curved clip paths and intentionally flank the circle.
  // Compare only independent action boxes, never decoration/gesture layers.
  const peers=unique.filter(node=>!node.classList.contains('dial-step') && !node.classList.contains('dial-gesture'));
  const overlaps=[];
  for (let index=0;index<peers.length;index+=1) for (let next=index+1;next<peers.length;next+=1) {
    const first=peers[index], second=peers[next];
    if (first.contains(second) || second.contains(first)) continue;
    const area=intersection(rect(first.getBoundingClientRect()),rect(second.getBoundingClientRect()));
    if (area.width>1.5 && area.height>1.5 && area.width*area.height>24) overlaps.push({first:name(first),second:name(second),...area});
  }
  const textBox=node=>{
    const range=doc.createRange();range.selectNodeContents(node);
    return rect(range.getBoundingClientRect());
  };
  const labels=[];
  for (const node of unique) {
    if (node.id==='victoryDialog') continue;
    const labelNodes=node.matches('.mode-nav button')?all(node,'small'):[node];
    for (const label of labelNodes) {
      const boxes=[], walker=doc.createTreeWalker(label,win.NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text=walker.currentNode, parent=text.parentElement;
        if (!text.textContent.trim() || parent.closest('.sr-only,[aria-hidden="true"]')) continue;
        const parentStyle=style(parent);
        if (parent.clientWidth<=2 && parent.clientHeight<=2 && ['hidden','clip'].includes(parentStyle.overflow)) continue;
        // Names in these native cards deliberately truncate. Counter/action
        // commands remain checked, including all navigation labels.
        if (parent.closest('.seat-name,.commander-tax-quick-name')) continue;
        const range=doc.createRange();range.selectNodeContents(text);
        boxes.push(rect(range.getBoundingClientRect()));
      }
      const target=rect(node.getBoundingClientRect());
      const cut=boxes.some(box=>box.width>0 && box.height>0 && (outside(box,target,3) || clipped(label,box)));
      labels.push({label:name(node)+' label',clipped:cut});
    }
  }
  const values=[];
  const value=doc.querySelector('.main-value');
  if (context==='game' && visible(value) && value.getAttribute('aria-hidden')!=='true') {
    const css=style(value), box=rect(value.getBoundingClientRect());
    const canvas=doc.createElement('canvas').getContext('2d');
    canvas.font=css.fontStyle+' '+css.fontWeight+' '+css.fontSize+' '+css.fontFamily;
    canvas.letterSpacing=css.letterSpacing==='normal'?'0px':css.letterSpacing;
    const metrics=canvas.measureText(value.value || value.textContent);
    const scaleX=box.width/parseFloat(css.width)||1, scaleY=box.height/parseFloat(css.height)||1;
    const ascent=metrics.fontBoundingBoxAscent, descent=metrics.fontBoundingBoxDescent;
    const lineHeight=parseFloat(css.lineHeight)||parseFloat(css.fontSize)*1.2;
    const baseline=(lineHeight-ascent-descent)/2+ascent;
    const ink={x:box.x+(box.width-metrics.width*scaleX)/2-metrics.actualBoundingBoxLeft*scaleX,
      y:box.y+(baseline-metrics.actualBoundingBoxAscent)*scaleY,
      width:(metrics.actualBoundingBoxLeft+metrics.actualBoundingBoxRight)*scaleX,
      height:(metrics.actualBoundingBoxAscent+metrics.actualBoundingBoxDescent)*scaleY};
    if (Object.values(ink).every(Number.isFinite)) {
      const assembly=doc.querySelector('.dial-assembly');
      const captions=all(game,'.counter-mode,.counter-context');
      const collision=captions.find(node=>{const area=intersection(ink,textBox(node));return area.width>2 && area.height>2;});
      const action=peers.find(node=>{const area=intersection(ink,rect(node.getBoundingClientRect()));return area.width>2 && area.height>2;});
      values.push({label:'Counter value '+(value.value||value.textContent),ink,
        clipped:clipped(value,ink) || (visible(assembly)&&outside(ink,rect(assembly.getBoundingClientRect()),3)),
        overlap:collision?'Counter caption':action?name(action):''});
    }
  }
  return {width:root.clientWidth,height:root.clientHeight,scrollWidth:root.scrollWidth,scrollHeight:root.scrollHeight,context,requirements,targets,overlaps,labels,values};
}

export function previewGeometryChecks(metrics,expected) {
  const checks=[
    {label:`Viewport is ${expected.width} × ${expected.height}`,pass:metrics.width===expected.width && metrics.height===expected.height},
    {label:'No horizontal document overflow',pass:metrics.scrollWidth<=metrics.width},
  ];
  for (const requirement of metrics.requirements || []) checks.push({label:requirement.label+' are present',pass:requirement.found>=requirement.minimum});
  for (const target of metrics.targets || []) {
    const minimum=target.minimum||44;
    checks.push({label:target.label+' remains reachable and at least '+minimum+'px',pass:target.width>=minimum-.5 && target.height>=minimum-.5 && target.x>=-.5 && right(target)<=metrics.width+.5 && (target.scrollable || (target.y>=-.5 && bottom(target)<=Math.max(metrics.height,metrics.scrollHeight||0)+.5)) && !target.clipped});
  }
  for (const overlap of metrics.overlaps || []) checks.push({label:overlap.first+' and '+overlap.second+' have separate action areas',pass:false});
  for (const label of metrics.labels || []) checks.push({label:label.label+' remains visible',pass:!label.clipped});
  for (const value of metrics.values || []) checks.push({label:value.label+' fits without covering '+(value.overlap||'other controls'),pass:!value.clipped && !value.overlap});
  return checks;
}
