import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
for (const format of ['commander', 'casual', 'custom']) test(`${format} join offers only the applicable final step`, () => {
  const nodes = new Map(); let step = null, submissions = 0;
  const element = () => ({ hidden: false, textContent: 'Next: commander', previousElementSibling: {}, addEventListener(type, fn) { this.click = fn; }, requestSubmit() { submissions++; } });
  const context = createContext({ joinGameFormat: format, setupDecks: [], selectedGameFormat: () => 'commander',
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, element()); return nodes.get(selector); }, $$: () => [],
    dom: { createCommanderNames: element(), createDeckField: {}, joinCommanderNames: element(), joinDeckField: {}, joinSeat: {} },
    showJoinStep: next => { step = next; },
  });
  const start = app.indexOf('function updateFormatSetup()');
  runInContext(app.slice(start, app.indexOf('\n', start)), context);
  const line = app.match(/^\$\('#joinStepTwoNext'\).*$/m)?.[0]; runInContext(line, context);
  context.updateFormatSetup(); nodes.get('#joinStepThreeNext').click();
  assert.equal(nodes.get('#joinStepThreeNext').textContent, format === 'commander' ? 'Next: commander' : 'Claim this seat');
  assert.equal(step, format === 'commander' ? 4 : null); assert.equal(submissions, format === 'commander' ? 0 : 1);
});
for (const format of ['casual', 'custom']) test(`${format} claim does not submit stale hidden partner fields from a previous Commander Table`, async () => {
  let submit, claimed;
  const context = createContext({ joinGameFormat: format,
    $: selector => selector === '#joinForm' ? { addEventListener(type, fn) { submit = fn; } } : { value: selector === '#podCode' ? 'ABC123' : 'P2' },
    FormData: class { get(key) { return key === 'joinCommanderCount' ? '2' : 'Player'; } },
    dom: { joinCommanderNames: {} },
    commanderNamesFromForm: () => ['STALE_A', 'STALE_B'], commanderColorsFromFields: () => [['R'], ['G']],
    currentAccountToken: async () => null, showError(error) { throw error; }, showSharedGame() {},
    transport: { inspectRoom: async () => ({ snapshot: { seats: [{ claimed: true }, { claimed: false }] } }),
      async claimRoom(request) { claimed = request; return { snapshot: {} }; } },
  });
  runInContext(app.match(/^\$\('#joinForm'\).*$/m)?.[0], context);
  await submit({ preventDefault() {}, currentTarget: {} });
  assert.equal(claimed.commanderCount, 1); assert.deepEqual([...claimed.commanderNames], ['']);
  assert.equal(claimed.commanderColors.length, 1); assert.equal(claimed.commanderColors[0].length, 0);
});
