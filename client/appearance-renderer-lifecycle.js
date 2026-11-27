import { CANONICAL_NEUTRAL_ID } from './appearance-studio-drafts.js';
import { nativeDraftIcons } from './counter-design.js?v=5';
const copy = value => structuredClone(value);
const metadata = ['id', 'name', 'status', 'edited', 'versions', 'sourceSkinId', 'access', 'invitation', 'achievement', 'provenance', 'grants'];

export function isLegacyAppearance(skin) { return Boolean(skin && skin.id !== CANONICAL_NEUTRAL_ID && skin.rendererVersion !== 2); }

export function legacyDraftAppearance(draft, rawSource) {
  const result = copy(rawSource || draft);
  for (const field of metadata) {
    if (Object.hasOwn(draft, field)) result[field] = copy(draft[field]);
    else delete result[field];
  }
  return result;
}

export function expandedDraft(draft, id) {
  return nativeDraftIcons({ ...copy(draft), id, sourceSkinId: draft.id, status: 'Draft', rendererVersion: 2 });
}

export function historyEntry(draft, legacySource) { return { draft: copy(draft), legacySource: legacySource ? copy(legacySource) : null }; }

export function mountRendererLifecycle({ getDraft, saving, expand }) {
  const box = document.createElement('section'); box.className = 'inspector-block renderer-compatibility';
  const heading = document.createElement('h3'), message = document.createElement('p'), button = document.createElement('button');
  heading.textContent = 'Original appearance'; heading.id = 'rendererCompatibilityTitle'; heading.tabIndex = -1; message.className = 'helper'; message.id = 'rendererCompatibilityNote';
  button.id = 'expandAppearanceControls'; button.type = 'button'; button.className = 'secondary-action'; button.textContent = 'Use expanded controls';
  button.setAttribute('aria-describedby', message.id); button.addEventListener('click', () => { expand(); if (!isLegacyAppearance(getDraft())) heading.focus({ preventScroll: true }); });
  box.append(heading, message, button); document.querySelector('.inspector-heading').after(box);
  return function render() {
    const draft = getDraft(), legacy = isLegacyAppearance(draft);
    box.hidden = draft?.id === CANONICAL_NEUTRAL_ID;
    heading.textContent = legacy ? 'Original appearance preserved' : 'Expanded visual controls';
    message.textContent = legacy ? 'Rename, duplicate, and compare this skin in its original appearance. Use expanded controls to create a separate unsaved draft with the newer visual treatments. Compare shows the saved original; Undo reverses the opt-in.' : 'This appearance uses expanded visual controls. Compare with the saved source and validate before publishing. Approved source skins stay intact.';
    button.hidden = !legacy; button.disabled = saving();
    for (const pane of ['foundation', 'typography', 'components', 'layout', 'artwork', 'symbols']) for (const control of document.querySelectorAll(`#edit-${pane} input,#edit-${pane} select,#edit-${pane} button`)) control.disabled = legacy;
    for (const control of document.querySelectorAll('.appearance-presets-panel button,#interfaceStyle,#sectionReset')) control.disabled = legacy;
  };
}
