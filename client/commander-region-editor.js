import { POINT_LIMIT, REGION_LIMIT, REGION_SURFACES, regionAssetId, validRegionPoints, validRegionSurface } from './commander-art-regions.js';

const surfaceName = key => key === 'background' ? 'Table background' : key[0].toUpperCase() + key.slice(1) + ' counter';
const slotColors = ['#e1c17d', '#65bddd', '#c4a0ce', '#f28a79', '#8ed5ac'];
const point = value => Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
const newRegion = () => ({ slot: 1, points: [] });

export function mountRegionEditor({ mount, getDraft, getAssets, change }) {
  const row = document.createElement('div');
  row.className = 'commander-region-launch';
  row.innerHTML = `<label>Artwork surface<select data-region-surface></select></label>
    <button type="button" data-open-regions>Edit color regions…</button><small data-region-summary></small>
    <button type="button" data-clear-regions hidden>Clear outlines on this surface</button>`;
  mount.append(row);
  const target = row.querySelector('select');
  for (const surface of REGION_SURFACES) target.add(new Option(surfaceName(surface), surface));

  const dialog = document.createElement('dialog');
  dialog.className = 'commander-region-dialog';
  dialog.setAttribute('aria-labelledby', 'commander-region-title');
  dialog.innerHTML = `<header><div><h2 id="commander-region-title">Commander color regions</h2><span data-surface-title></span></div>
    <button type="button" data-cancel>Cancel</button></header>
    <div class="commander-region-body">
      <section class="commander-region-canvas" aria-label="Artwork outline">
        <div class="commander-region-stage" hidden><img alt="Selected artwork"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Region outlines on the selected artwork"></svg></div>
        <span data-empty-art></span>
      </section>
      <section class="commander-region-tools">
        <label>Artwork<select data-region-art></select></label>
        <label>Use colors from<select data-region-source><option value="owner">My commander</option><option value="viewed">Commander on the selected seat</option></select></label>
        <label>Region<select data-region-list></select></label>
        <label>Commander color slot<select data-region-slot></select></label>
        <p>Click around an area to outline it. Slots use your commander’s colors in order and repeat when needed.</p>
        <details data-point-tools><summary>Point coordinates</summary>
          <label>Point<select data-region-vertex></select></label>
          <div class="commander-region-xy"><label>X (%)<input type="number" data-point-x min="0" max="100" step="0.01" value="50"></label>
          <label>Y (%)<input type="number" data-point-y min="0" max="100" step="0.01" value="50"></label></div>
          <button type="button" data-place-point>Add point</button>
        </details>
        <div class="commander-region-actions"><button type="button" data-undo-point>Remove point</button><button type="button" data-remove-region>Remove region</button></div>
        <button type="button" data-finish-region>Finish region</button>
        <label data-repeat-label hidden><input type="checkbox" data-repeat> Use on other counter faces with this artwork</label>
        <output data-region-status role="status"></output>
      </section>
    </div>
    <footer><button type="button" data-save-regions>Save regions to draft</button></footer>`;
  document.body.append(dialog);
  const find = selector => dialog.querySelector(selector);
  const choices = find('[data-region-list]'), art = find('[data-region-art]'), source = find('[data-region-source]');
  const slot = find('[data-region-slot]'), vertex = find('[data-region-vertex]'), stage = find('.commander-region-stage');
  const image = find('img'), svg = find('svg'), status = find('[data-region-status]');
  const x = find('[data-point-x]'), y = find('[data-point-y]');
  for (let i = 1; i <= 5; i++) slot.add(new Option('Color ' + i, String(i)));
  let skin, surface, shapes, selected, working, selectedPoint, previousArtwork, savedSource;
  const message = value => { status.textContent = value; };
  function renderLauncher() {
    const draft = getDraft();
    row.hidden = draft?.commanderTreatment !== 'art-regions';
    const config = draft?.commanderRegions?.[target.value];
    const count = config?.assetId === regionAssetId(draft, target.value) ? config?.regions?.length : 0;
    row.querySelector('small').textContent = count ? count + (count === 1 ? ' region' : ' regions') : config ? 'These outlines belong to the previous artwork.' : '';
    row.querySelector('[data-clear-regions]').hidden = !config;
  }
  const svgNode = (name, attributes) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  function outline(shape, active) {
    if (!shape.points.length) return;
    const color = slotColors[shape.slot - 1];
    const vertices = shape.points.map(pair => pair.join(',')).join(' ');
    const geometry = svgNode(shape.points.length > 2 ? 'polygon' : 'polyline', {
      points: vertices, stroke: color, 'stroke-width': active ? 2 : 1.4, 'vector-effect': 'non-scaling-stroke',
      fill: shape.points.length > 2 ? color : 'none', 'fill-opacity': active ? '.23' : '.12'
    });
    svg.append(geometry);
    if (active) shape.points.forEach(([cx, cy], i) => svg.append(svgNode('circle', {
      cx, cy, r: i === selectedPoint ? 1.25 : .85, stroke: '#151714', 'stroke-width': 1,
      'vector-effect': 'non-scaling-stroke', fill: i === selectedPoint ? '#fff' : color, 'data-index': i
    })));
  }
  function controls() {
    slot.value = String(working.slot);
    choices.replaceChildren(...shapes.map((_, i) => new Option('Region ' + (i + 1), String(i))));
    if (shapes.length < REGION_LIMIT) choices.add(new Option('New region', '-1'));
    choices.value = String(selected);
    vertex.replaceChildren(new Option('Add a point', '-1'), ...working.points.map((_, i) => new Option('Point ' + (i + 1), String(i))));
    vertex.value = String(selectedPoint);
    if (selectedPoint >= 0) [x.value, y.value] = working.points[selectedPoint].map(String);
    find('[data-place-point]').textContent = selectedPoint < 0 ? 'Add point' : 'Move point';
    find('[data-place-point]').disabled = !art.value || (selectedPoint < 0 && working.points.length >= POINT_LIMIT);
    find('[data-undo-point]').disabled = !working.points.length;
    find('[data-remove-region]').disabled = selected < 0 && !working.points.length;
    find('[data-finish-region]').disabled = !validRegionPoints(working.points);
    find('[data-save-regions]').disabled = !art.value || (working.points.length > 0 && !validRegionPoints(working.points));
    svg.replaceChildren();
    shapes.forEach((shape, i) => { if (i !== selected) outline(shape, false); });
    outline(working, true);
  }
  function edit(index) {
    selected = index;
    working = index < 0 ? newRegion() : structuredClone(shapes[index]);
    if (index < 0) working.slot = shapes.length % 5 + 1;
    selectedPoint = -1;
    controls();
  }
  function remember() {
    if (selected < 0 && working.points.length === 0) return true;
    if (!validRegionPoints(working.points)) {
      message('Outline at least three points enclosing an area, or remove the unfinished region.');
      return false;
    }
    if (selected < 0) {
      if (shapes.length >= REGION_LIMIT) return false;
      shapes.push(structuredClone(working));
    } else shapes[selected] = structuredClone(working);
    return true;
  }
  function selectArt() {
    previousArtwork = art.value;
    const asset = getAssets().find(item => item.id === art.value);
    const assigned = skin.commanderRegions?.[surface];
    const config = validRegionSurface(assigned) && assigned.assetId === art.value ? assigned : null;
    shapes = structuredClone(config?.regions || []);
    savedSource = config?.source || (surface === 'background' ? 'owner' : 'viewed');
    source.value = savedSource;
    stage.hidden = !asset?.data;
    if (asset?.data) image.src = asset.data;
    else image.removeAttribute('src');
    find('[data-empty-art]').textContent = asset?.data ? '' : 'Assign imported artwork to start an outline.';
    find('[data-repeat-label]').hidden = surface === 'background';
    find('[data-repeat]').checked = false;
    message('');
    edit(shapes.length ? 0 : -1);
  }
  row.querySelector('[data-open-regions]').addEventListener('click', () => {
    skin = getDraft(); surface = target.value;
    find('[data-surface-title]').textContent = surfaceName(surface);
    const roles = surface === 'background' ? ['background'] : ['dial', 'overlay', 'seal'];
    const assets = getAssets().filter(asset => roles.includes(asset.placement) && asset.data);
    art.replaceChildren(new Option('Choose artwork…', ''), ...assets.map(item => new Option(item.name, item.id)));
    art.value = regionAssetId(skin, surface) || '';
    selectArt();
    dialog.showModal();
  });
  art.addEventListener('change', () => {
    const current = skin.commanderRegions?.[surface];
    const baseline = validRegionSurface(current) && current.assetId === previousArtwork ? current.regions : [];
    const modified = JSON.stringify(shapes) !== JSON.stringify(baseline)
      || (selected === -1 ? working.points.length > 0 : JSON.stringify(working) !== JSON.stringify(shapes[selected]))
      || source.value !== savedSource;
    if (modified) {
      art.value = previousArtwork;
      message('Save these outlines to the draft, or cancel before choosing different artwork.');
    } else selectArt();
  });
  choices.addEventListener('change', () => {
    const next = Number(choices.value);
    if (!remember()) { choices.value = String(selected); return; }
    edit(next === -1 && shapes.length >= REGION_LIMIT ? 0 : next);
    message('');
  });
  slot.addEventListener('change', () => { working.slot = Number(slot.value); controls(); });
  vertex.addEventListener('change', () => { selectedPoint = Number(vertex.value); controls(); });
  const addPoint = coords => {
    if (working.points.length >= POINT_LIMIT) { message('An outline can have up to ' + POINT_LIMIT + ' points.'); return; }
    working.points.push(coords);
    selectedPoint = -1;
    message('Outline has ' + working.points.length + ' points.');
    controls();
  };
  const position = event => {
    const box = svg.getBoundingClientRect();
    return [point(100 * (event.clientX - box.left) / box.width), point(100 * (event.clientY - box.top) / box.height)];
  };
  let dragging = null;
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || dragging) return;
    const handle = event.target.closest('circle[data-index]');
    if (handle) {
      selectedPoint = Number(handle.dataset.index);
      dragging = { id: event.pointerId, original: [...working.points[selectedPoint]] };
      svg.setPointerCapture(event.pointerId);
      controls();
    } else addPoint(position(event));
  });
  svg.addEventListener('pointermove', event => {
    if (dragging?.id !== event.pointerId) return;
    working.points[selectedPoint] = position(event);
    controls();
  });
  svg.addEventListener('pointerup', () => { dragging = null; });
  svg.addEventListener('pointercancel', () => {
    if (dragging) working.points[selectedPoint] = dragging.original;
    dragging = null;
    controls();
  });
  find('[data-place-point]').addEventListener('click', () => {
    if (!x.value || !y.value || !x.checkValidity() || !y.checkValidity()) { message('Use coordinates from 0 to 100%.'); return; }
    const coordinates = [Number(x.value), Number(y.value)];
    if (selectedPoint < 0) addPoint(coordinates);
    else { working.points[selectedPoint] = coordinates; controls(); }
  });
  find('[data-undo-point]').addEventListener('click', () => {
    working.points.splice(selectedPoint < 0 ? working.points.length - 1 : selectedPoint, 1);
    selectedPoint = -1; controls();
  });
  find('[data-remove-region]').addEventListener('click', () => {
    if (selected >= 0) shapes.splice(selected, 1);
    edit(-1);
    message('Region removed from this edit.');
  });
  find('[data-finish-region]').addEventListener('click', () => {
    if (!remember()) return;
    edit(shapes.length < REGION_LIMIT ? -1 : shapes.length - 1);
    message(shapes.length + (shapes.length === 1 ? ' region ready.' : ' regions ready.'));
  });
  find('[data-save-regions]').addEventListener('click', () => {
    if (!art.value || !remember()) return;
    if (getDraft() !== skin) { dialog.close(); return; }
    const assetId = art.value;
    if (surface === 'background') skin.backgroundAsset = assetId;
    else {
      skin.counterDesign ||= {}; skin.counterDesign.modes ||= {};
      const mode = skin.counterDesign.modes[surface] ||= {};
      mode.artAsset = assetId;
    }
    const targets = [surface];
    if (surface !== 'background' && find('[data-repeat]').checked) {
      targets.push(...REGION_SURFACES.filter(key => key !== 'background' && key !== surface && regionAssetId(skin, key) === assetId));
    }
    const regions = { ...skin.commanderRegions };
    for (const key of targets) {
      if (shapes.length) regions[key] = { assetId, source: source.value, regions: structuredClone(shapes) };
      else delete regions[key];
    }
    if (Object.keys(regions).length) skin.commanderRegions = regions;
    else delete skin.commanderRegions;
    dialog.close(); change(); renderLauncher();
  });
  find('[data-cancel]').addEventListener('click', () => dialog.close());
  row.querySelector('[data-clear-regions]').addEventListener('click', () => {
    const draft = getDraft();
    if (!draft?.commanderRegions?.[target.value]) return;
    delete draft.commanderRegions[target.value];
    if (!Object.keys(draft.commanderRegions).length) delete draft.commanderRegions;
    change(); renderLauncher();
  });
  target.addEventListener('change', renderLauncher);
  return renderLauncher;
}
