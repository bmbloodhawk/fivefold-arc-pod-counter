// Arrange the existing, bound controls once. Moving a control retains its input
// listeners. The preview iframe stays in its original document throughout.
// An output inside a wrapping label is labelable itself. Bind the actual
// slider explicitly, including regenerated layout and overlay controls.
function bindStudioControlLabels(root) {
  let sequence = 0;
  function bind(scope) {
    for (const input of scope.querySelectorAll('input[type=range]')) {
      const label = input.closest('label');
      if (!label) continue;
      input.id ||= 'studio-range-' + (++sequence);
      label.htmlFor = input.id;
      const output = label.querySelector('output');
      if (output) { output.htmlFor.value = input.id; output.setAttribute('aria-hidden','true'); }
      if (!input.hasAttribute('aria-label') && (input.dataset.placement || input.dataset.overlayOpacity || input.dataset.overlayScale)) {
        const group = input.closest('.overlay-control')?.querySelector('strong')?.textContent || input.closest('details')?.querySelector('summary')?.textContent;
        const name = [...label.childNodes].filter(node=>node.nodeType === Node.TEXT_NODE).map(node=>node.textContent.trim()).join(' ').trim();
        input.setAttribute('aria-label',[group,name].filter(Boolean).join(' · '));
      }
    }
    for (const select of scope.querySelectorAll('select[data-overlay]')) {
      const name = select.closest('.overlay-control')?.querySelector('strong')?.textContent || select.dataset.overlay;
      select.setAttribute('aria-label', name + ' artwork');
    }
  }
  bind(root);
  const observer = new MutationObserver(records=>{
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) bind(node);
  });
  observer.observe(root,{childList:true,subtree:true});
}

export function mountStudioWorkspace({ resetSection, compareOptions, setComparison, onSection }) {
  const find = selector => document.querySelector(selector);
  const label = id => document.getElementById(id).closest('label');
  const fold = id => document.getElementById(id).closest('details');
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const library = find('.library-panel');
  const oldInspector = find('.library-panel .property-editor');
  const ux = find('#uxStudioPanel');
  const inspector = find('#studioInspector');
  const contents = find('#inspectorContents');
  const nav = find('#studioNavigation');
  const title = find('#inspectorTitle');
  const group = find('#inspectorGroup');
  const reset = find('#sectionReset');
  const panes = new Map();
  const buttons = new Map();
  const compactMedia = matchMedia('(max-width: 899px)');
  let compactSelect, compactToggle;
  let current;

  function show(id, focus = false) {
    for (const [key, pane] of panes) {
      pane.hidden = key !== id;
      if (key === id) buttons.get(key).setAttribute('aria-current', 'page');
      else buttons.get(key).removeAttribute('aria-current');
    }
    current = id;
    onSection?.(id);
    const active = buttons.get(id);
    title.textContent = active.textContent;
    group.textContent = active.parentElement.getAttribute('aria-label');
    reset.hidden = !panes.get(id).dataset.reset;
    label('interfaceStyle').hidden = !['layout', 'typography', 'artwork'].includes(id);
    inspector.scrollTop = 0;
    if (compactSelect) compactSelect.value = id;
    if (compactMedia.matches) {
      library.removeAttribute('data-compact-open');
      compactToggle?.setAttribute('aria-expanded', 'false');
    }
    if (focus) { title.focus({ preventScroll: true }); if (compactMedia.matches) title.scrollIntoView({ block: 'nearest' }); }
  }
  let navGroup;
  function category(name) {
    nav.append(make('p', name, 'rail-label'));
    navGroup = make('div');
    navGroup.setAttribute('aria-label',name);
    navGroup.setAttribute('role','group');
    nav.append(navGroup);
  }
  function page(id, name, nodes, resettable = true) {
    const panel = make('div', '', 'inspector-page');
    panel.id = 'edit-' + id;
    if (resettable) panel.dataset.reset = id;
    panel.append(...nodes.filter(Boolean));
    const button = make('button', name);
    button.type = 'button';
    button.setAttribute('aria-controls', panel.id);
    button.addEventListener('click', () => show(id, true));
    navGroup.append(button);
    contents.append(panel);
    panes.set(id, panel);
    buttons.set(id, button);
    return panel;
  }
  function unpack(node) {
    return [...node.children].filter(child => child.tagName !== 'SUMMARY');
  }
  function block(name, nodes) {
    const section = make('section', '', 'inspector-block');
    section.append(make('h3',name), ...nodes);
    return section;
  }

  const identity = make('details', '', 'skin-management');
  identity.append(make('summary','Skin name & presets'), label('skinName'), find('.appearance-presets-panel'));
  library.querySelector('.rail-action').before(identity);

  category('Skin design');
  page('foundation','Colors & mood',[
    block('Palette',[find('.color-grid')]),
    block('Atmosphere',[label('atmosphere'),find('.atmosphere-controls')])
  ]);
  const semantics = find('.semantic-tokens-panel');
  page('typography','Type & readability',[
    block('Type for this layout', unpack(fold('fontFamily')).filter(el=>!el.matches('.helper'))),
    block('Feedback colors', [semantics.querySelector('.ux-grid')]),
    block('Global type',unpack(semantics).filter(el=>!el.matches('.helper')))
  ]);
  page('components','Controls & cards',[
    label('buttonTreatment'), find('.component-colors-panel'), find('.advanced-styling')
  ]);
  const shape = fold('seatRadius');
  page('layout','Game layout',[
    block('Shape & spacing',unpack(shape)), fold('centerSealScale'), fold('componentPlacementControls')
  ]);
  const background = fold('backgroundAsset');
  const thumb = make('label','Skin thumbnail');
  const picker = make('select');
  picker.id = 'thumbnailAsset';
  thumb.append(picker);
  const buttonArt = make('label','End Turn button art');
  const buttonPicker = make('select'); buttonPicker.id = 'buttonAsset'; buttonArt.append(buttonPicker);
  page('artwork','Background & art',[
    block('Background & center seal',unpack(background)),fold('overlayControls'),thumb,buttonArt
  ]);
  page('symbols','Counter faces & icons',unpack(fold('symbolControls')));
  category('Manage');
  page('assets','Asset library',[find('#assetFile').closest('section')],false);
  page('history','History & backups',[find('.version-history-panel'),find('#catalogBackupFile').closest('section'),find('#revertButton')],false);
  page('review','Review & publish',[find('#validationList').closest('section'),find('.preflight-panel'),find('#publicationControls')],false);

  const layoutSelector = label('interfaceStyle');
  layoutSelector.className = 'active-layout';
  contents.before(layoutSelector);
  oldInspector.hidden = true;
  ux.hidden = true;
  // The original content containers remain stable for legacy DOM lookups.
  find('#symbolControls').closest('.inspector-page').setAttribute('aria-label','Counter faces & icons');
  library.querySelectorAll(':scope > section:not(:first-child)').forEach(el => { el.hidden = true; });
  find('.validation-panel').hidden = true;
  title.tabIndex = -1;
  reset.addEventListener('click', () => resetSection(current));
  find('#workspaceReview').addEventListener('click', () => show('review', true));

  const preview = find('.preview-area');
  const heading = make('header', '', 'workspace-preview-heading');
  const headingBlock = make('div');
  headingBlock.append(make('p','Live preview','kicker'),make('h2','Game surface'));
  const previewTitle = headingBlock.querySelector('h2');
  previewTitle.id = 'studioPreviewTitle'; previewTitle.tabIndex = -1;
  const comparison = make('label','Compare with');
  const select = make('select');
  select.id = 'compareTarget';
  comparison.append(select);
  heading.append(headingBlock, comparison);
  preview.prepend(heading);
  const initialCompare = () => {
    const selected = select.value || 'saved';
    const options = compareOptions();
    select.replaceChildren(...options.map(({value,label}) => new Option(label, value)));
    if (options.some(opt => opt.value === selected)) select.value = selected;
  };
  initialCompare();
  document.addEventListener('studio:draft-state', event => {
    initialCompare();
    if (event.detail.comparisonTarget) select.value = event.detail.comparisonTarget;
  });
  select.addEventListener('change', () => setComparison(select.value));

  const panel = find('.device-preview-panel');
  const deviceBar = make('div', '', 'workspace-device-bar');
  const settings = make('details', '', 'device-settings');
  settings.append(make('summary','Preview settings'));
  const toolbar = find('.preview-toolbar');
  const primaryDevice = label('devicePreset'), zoomControl = label('deviceZoom');
  const extra = make('div','','device-settings-fields');
  extra.append(toolbar, find('.device-preview-controls'), find('.device-preview-toggles'), find('#deviceComparisonSetup'), find('.device-custom'), find('.phone-layout-control'));
  settings.append(extra);
  const stateGroup = toolbar.querySelector('[aria-label="Preview state"]');
  const sceneLabel = make('label','Scene');
  const scene = make('select'); scene.id = 'studioScene';
  for (const button of stateGroup.querySelectorAll('[data-state]')) {
    const option = new Option(button.textContent,button.dataset.state);
    option.selected = button.classList.contains('selected');
    scene.add(option);
    button.addEventListener('click',()=>{ scene.value = button.dataset.state; });
  }
  scene.addEventListener('change',()=>stateGroup.querySelector('[data-state="' + scene.value + '"]').click());
  stateGroup.hidden = true; sceneLabel.append(scene);
  zoomControl.classList.add('preview-zoom-control');
  deviceBar.append(primaryDevice, sceneLabel, zoomControl, settings);
  panel.querySelector('.device-preview-heading').replaceWith(deviceBar);
  preview.append(find('#compareNote'));

  // On narrow windows the editor comes first; the full library is an explicit
  // disclosure, and one native selector keeps every editing area reachable.
  const compact = make('nav', '', 'compact-studio-tools');
  compact.setAttribute('aria-label', 'Studio shortcuts');
  compact.hidden = true;
  const areaLabel = make('label', 'Visual area');
  compactSelect = make('select'); compactSelect.id = 'compactSection';
  areaLabel.htmlFor = compactSelect.id;
  compactSelect.setAttribute('aria-controls', contents.id);
  compactSelect.append(...[...buttons].map(([id, button]) => new Option(button.textContent, id)));
  areaLabel.append(compactSelect);
  compactSelect.addEventListener('change', () => show(compactSelect.value));
  compactToggle = make('button', 'Skins'); compactToggle.id = 'compactLibraryButton'; compactToggle.type = 'button';
  library.id ||= 'studioLibrary';
  compactToggle.setAttribute('aria-controls', library.id);
  compactToggle.setAttribute('aria-expanded', 'false');
  compactToggle.addEventListener('click', () => {
    const open = !library.hasAttribute('data-compact-open');
    library.toggleAttribute('data-compact-open', open);
    compactToggle.setAttribute('aria-expanded', String(open));
  });
  function jumpLink(name, id, target) {
    const link = make('a', name); link.id = id; link.href = '#' + target.id;
    link.addEventListener('click', event => { event.preventDefault(); target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'start' }); });
    return link;
  }
  compact.append(areaLabel, compactToggle, jumpLink('Editor', 'compactEditorLink', title), jumpLink('Preview', 'compactPreviewLink', previewTitle));
  find('.studio-shell').before(compact);
  const pageTitle = library.querySelector('h1');
  const pageTitleAnchor = document.createComment('Appearance Studio title');
  pageTitle.before(pageTitleAnchor);
  function compactMode() {
    const hadCompactFocus = compact.contains(document.activeElement);
    compact.hidden = !compactMedia.matches;
    if (compactMedia.matches) {
      compact.prepend(pageTitle);
      if (!library.hasAttribute('data-compact-open') && library.contains(document.activeElement)) compactToggle.focus();
    } else { pageTitleAnchor.after(pageTitle); if (hadCompactFocus) title.focus({ preventScroll: true }); }
  }
  compactMedia.addEventListener('change', compactMode);
  compactMode();
  bindStudioControlLabels(inspector);
  document.body.classList.add('studio-workspace');
  show('foundation');
  return {showSection:show};
}
