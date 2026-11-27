import assert from 'node:assert/strict';
import test from 'node:test';
import { isLegacyAppearance, legacyDraftAppearance, expandedDraft, historyEntry } from './appearance-renderer-lifecycle.js';
import { restoreDraftSnapshot } from './appearance-studio-drafts.js';

test('legacy rename projects onto exact raw appearance without injecting editor defaults', () => {
  const raw = { id: 'source', status: 'Approved', name: 'Original', background: '#102030', modeLayouts: { dial: { componentLayout: { modeNav: { x: 0, y: -10, scale: 100 } } } }, access: { type: 'invitation' } };
  const before = structuredClone(raw);
  const editor = { ...structuredClone(raw), name: 'Renamed', fontWeight: 700, componentColors: { navigation: { text: '#ffffff' } }, tokens: { schemaVersion: 1 } };
  assert.deepEqual(legacyDraftAppearance(editor, raw), { ...raw, name: 'Renamed' });
  assert.deepEqual(raw, before);
  assert.equal(Object.hasOwn(legacyDraftAppearance(editor, raw), 'rendererVersion'), false);
});

test('explicit legacy version one remains version one after a name edit', () => {
  const raw = { id: 'one', name: 'Original', rendererVersion: 1 };
  assert.equal(legacyDraftAppearance({ ...raw, name: 'New' }, raw).rendererVersion, 1);
});

test('explicit expansion stages version two in a separate draft without changing its source', () => {
  const source = { id: 'old', status: 'Approved', name: 'Old', rendererVersion: 1, access: { type: 'restricted' } };
  const before = structuredClone(source);
  const draft = expandedDraft(source, 'expanded-copy');
  assert.equal(draft.rendererVersion, 2);
  assert.equal(draft.id, 'expanded-copy');
  assert.equal(draft.sourceSkinId, 'old');
  assert.equal(draft.status, 'Draft');
  assert.deepEqual(draft.access, source.access);
  assert.deepEqual(source, before);
});

test('canonical reference is independent of renderer generation while new version two is editable', () => {
  assert.equal(isLegacyAppearance({ id: '__neutral_arc__' }), false);
  assert.equal(isLegacyAppearance({ id: 'old' }), true);
  assert.equal(isLegacyAppearance({ id: 'new', rendererVersion: 2 }), false);
});

test('history captures raw legacy bytes separately from normalized editor state', () => {
  const source = { id: 'legacy', name: 'Raw', background: '#123456' };
  const entry = historyEntry({ ...source, componentColors: {} }, source);
  entry.draft.name = 'Changed'; entry.legacySource.background = '#abcdef';
  assert.equal(source.name, 'Raw');
  assert.equal(source.background, '#123456');
});

test('Undo of explicit expansion returns to the legacy source and Redo recreates the expanded copy', () => {
  const original = { id: 'legacy', name: 'Source', status: 'Approved', background: '#102030' };
  const expanded = expandedDraft(original, 'expanded');
  const undone = restoreDraftSnapshot(original, { original, selectedId: expanded.id });
  assert.equal(undone.selectedId, original.id);
  assert.equal(isLegacyAppearance(undone.draft), true);
  const redone = restoreDraftSnapshot(expanded, { original, selectedId: original.id });
  assert.equal(redone.selectedId, expanded.id);
  assert.equal(redone.draft.rendererVersion, 2);
  assert.equal(redone.draft.status, 'Draft');
  assert.equal(redone.draft.sourceSkinId, original.id);
});
