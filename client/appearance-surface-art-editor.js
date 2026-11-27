import { SURFACE_ART_SLOTS, SURFACE_ART_ROLES, updateSurfaceArtwork } from './appearance-surface-art.js';
import { assetInspection } from './appearance-studio-assets.js';

export function mountSurfaceArtEditor({ getDraft, getAssets, change, openAssets, document = globalThis.document, container = document.querySelector('#edit-artwork') }) {
  if (!container) throw new Error('Mount the artwork inspector before its surface-art editor.');
  const panelRole = document.querySelector('#assetPlacement option[value="panel"]');
  if (panelRole) panelRole.textContent = 'Surface art — bars, cards & dialogs';
  if (!document.querySelector('link[data-surface-art-editor-css]')) {
    const sheet = document.createElement('link'); sheet.rel = 'stylesheet'; sheet.href = new URL('./appearance-surface-art-editor.css', import.meta.url).href; sheet.setAttribute('data-surface-art-editor-css', ''); document.head.append(sheet);
  }
  const node = (tag, text, cls) => { const result = document.createElement(tag); if (text) result.textContent = text; if (cls) result.className = cls; return result; };
  const section = node('section', '', 'inspector-block surface-art-editor');
  section.append(node('h3', 'Art on game surfaces'));
  const help = node('p', 'Place original panel, overlay or background artwork behind game text. The controls and award artwork stay in place.', 'helper'); help.id = 'surface-art-help'; section.append(help);
  const slot = node('select'); slot.id = 'surfaceArtSlot'; slot.setAttribute('aria-describedby', help.id);
  const label = (text, input) => { const element = node('label', text); element.htmlFor = input.id; element.append(input); return element; };
  for (const [value, info] of Object.entries(SURFACE_ART_SLOTS)) { const option = node('option', info.label); option.value = value; slot.append(option); }
  section.append(label('Visual area', slot));
  const asset = node('select'); asset.id = 'surfaceArtAsset'; section.append(label('Artwork for this area', asset));
  const preview = node('div', '', 'surface-art-preview'), sample = node('img'), description = node('small'); sample.alt = ''; preview.append(sample, description); section.append(preview);
  const fit = node('select'); fit.id = 'surfaceArtFit';
  for (const [value, text] of [['cover', 'Fill area — crop edges'], ['contain', 'Show complete artwork']]) { const option = node('option', text); option.value = value; fit.append(option); }
  const fields = new Map([['fit', fit]]), grid = node('div', '', 'surface-art-fields'); grid.append(label('Image fit', fit));
  for (const [key, text, min, max, fallback] of [['scale', 'Art scale', 50, 160, 100], ['positionX', 'Horizontal crop', 0, 100, 50], ['positionY', 'Vertical crop', 0, 100, 50], ['opacity', 'Art opacity', 0, 35, 20]]) {
    const input = node('input'); input.type = 'range'; input.id = `surfaceArt-${key}`; input.min = String(min); input.max = String(max); input.step = '1'; input.value = String(fallback);
    const row = label(text, input), output = node('output'); output.setAttribute('aria-hidden', 'true'); row.insertBefore(output, input); grid.append(row);
    input.addEventListener('input', () => { output.value = `${input.value}%`; edit({ [key]: Number(input.value) }); });
    fields.set(key, input);
  }
  section.append(grid);
  const status = node('p', '', 'helper'); status.setAttribute('aria-live', 'polite'); section.append(status);
  const actions = node('div', '', 'surface-art-actions'), reset = node('button', 'Reset this area', 'text-button'), upload = node('button', 'Import original surface art…', 'text-button');
  reset.type = upload.type = 'button'; actions.append(reset, upload); section.append(actions); container.append(section);
  function edit(patch) {
    const draft = getDraft(); if (draft.rendererVersion !== 2) return;
    const updated = updateSurfaceArtwork(draft, slot.value, patch);
    if (updated.surfaceArt) draft.surfaceArt = updated.surfaceArt; else delete draft.surfaceArt;
    change(); render();
  }
  slot.addEventListener('change', render);
  asset.addEventListener('change', () => edit({ assetId: asset.value }));
  fit.addEventListener('change', () => edit({ fit: fit.value }));
  reset.addEventListener('click', () => edit({ assetId: '' }));
  upload.addEventListener('click', () => {
    if (openAssets) openAssets(); else document.querySelector('[aria-controls="edit-assets"]')?.click();
    const role = document.getElementById('assetPlacement'); if (role) { role.value = 'panel'; role.dispatchEvent(new Event('input', { bubbles: true })); }
    document.getElementById('assetFile')?.focus();
  });
  function render() {
    const draft = getDraft(), entry = draft.surfaceArt?.[slot.value] || {}, expanded = draft.rendererVersion === 2;
    const assets = getAssets().filter(item => SURFACE_ART_ROLES.includes(item.placement));
    asset.replaceChildren();
    const native = node('option', 'Use native surface'); native.value = ''; asset.append(native);
    for (const item of assets) { const option = node('option', item.name + (item.status === 'Pending' ? ' — pending review' : '')); option.value = item.id; asset.append(option); }
    if (entry.assetId && !assets.some(item => item.id === entry.assetId)) { const missing = node('option', 'Missing or unsupported artwork — ' + entry.assetId); missing.value = entry.assetId; asset.append(missing); }
    asset.value = entry.assetId || ''; asset.disabled = !expanded;
    fit.value = entry.fit || 'cover';
    for (const [key, input] of fields) {
      input.disabled = !expanded || !entry.assetId;
      if (key === 'fit') continue;
      input.value = String(entry[key] ?? (key === 'opacity' ? 20 : key === 'scale' ? 100 : 50));
      input.previousElementSibling.value = `${input.value}%`;
    }
    reset.disabled = !expanded || !entry.assetId;
    const selected = assets.find(item => item.id === entry.assetId), inspected = selected && assetInspection(selected);
    sample.hidden = !inspected?.info; if (inspected?.info) sample.src = selected.data; else sample.removeAttribute('src');
    description.textContent = selected ? `${selected.name} · ${selected.placement}${selected.status === 'Pending' ? ' · approve it in Asset library before publishing' : ''}` : entry.assetId ? 'Choose existing panel, overlay or background artwork to restore this slot.' : 'The native surface remains unchanged.';
    status.textContent = !expanded ? 'Expand this legacy draft to use new surface art.' : 'Artwork is decorative, limited to 35% opacity and clipped behind labels. Review contrast over its brightest detail.';
  }
  render(); return render;
}
