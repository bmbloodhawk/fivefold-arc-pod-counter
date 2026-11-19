import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const start = app.indexOf("$('#createForm').addEventListener('submit'");
const source = app.slice(start, app.indexOf("$('#joinForm').addEventListener", start));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  const token = deferred(), result = deferred(), entered = deferred(); let submit;
  const button = { disabled: false, textContent: '', scrollIntoView() {} };
  const values = { gameFormat: 'casual', playerCount: '4', name: 'Host' };
  const context = createContext({ pendingTableCreation: null, backgroundTableEpoch: null, createStep: 4, state: null,
    dom: { localSimulation: { checked: false }, createCommanderNames: {}, roundLimitMinutes: {} },
    $: selector => selector.includes('button') ? button : { addEventListener(type, fn) { submit = fn; } },
    FormData: class { get(key) { return values[key] || ''; } },
    commanderColorsFromFields: () => [], validateCreateStartingLife: () => 40,
    accountTokenForSkin: () => token.promise, calls: 0,
    transport: { createRoom() { context.calls++; entered.resolve(); return result.promise; } },
    shown: 0, saved: 0, links: 0, errors: [], clearedActive: null,
    showSharedGame() { context.shown++; }, stateFromSnapshot: snapshot => ({ ...snapshot, podCode: snapshot.code }),
    saveTable() { context.saved++; }, renderSavedTables() {}, render() {},
    clearActiveTable(expected) { context.clearedActive = expected; },
    competitionHub: { async tableCreated() { context.links++; } }, showError: error => context.errors.push(error.message),
  });
  runInContext(source, context);
  return { context, token, result, entered, submit: () => submit({ preventDefault() {}, currentTarget: {} }),
    back() { if (context.pendingTableCreation) context.pendingTableCreation.foreground = false; },
    complete() { result.resolve({ snapshot: { code: 'ABC123' } }); } };
}
test('a delayed creation stays saved without forcing the lobby after deliberate Back', async () => {
  const f = fixture(), pending = f.submit(); f.token.resolve(null); await f.entered.promise; f.back(); f.complete(); await pending;
  assert.equal(f.context.shown, 0); assert.equal(f.context.saved, 1); assert.equal(f.context.links, 1);
  assert.equal(f.context.clearedActive?.code, 'ABC123', 'A background creation belongs in history without rearming automatic return on reload.');
});
test('Back before account token acquisition cancels creation before sending', async () => {
  const f = fixture(), pending = f.submit(); f.back(); f.token.resolve(null); f.complete(); await pending;
  assert.equal(f.context.calls, 0); assert.equal(f.context.shown, 0);
});
test('a late creation failure does not open an error over the page the player chose', async () => {
  const f = fixture(), pending = f.submit(); f.token.resolve(null); await f.entered.promise; f.back();
  f.result.reject(new Error('Old create failed')); await pending; assert.deepEqual(f.context.errors, []);
});
test('normal creation still opens the lobby and links a pending competition', async () => {
  const f = fixture(), pending = f.submit(); f.token.resolve(null); await f.entered.promise; f.complete(); await pending;
  assert.equal(f.context.calls, 1); assert.equal(f.context.shown, 1); assert.equal(f.context.links, 1);
});
