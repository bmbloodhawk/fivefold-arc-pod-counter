import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const renderer = app.slice(app.indexOf('function personalMatchArt('), app.indexOf('function winnerArtUrl('))
  + app.slice(app.indexOf('function showPersonalMatchMoment('), app.indexOf('function finishEndGameFlow('));
const legacyTitles = ['Table Victor', 'Pod Company', 'Turn Order', 'Table Chronicle', 'Format Finish', 'Starting Line',
  'Clock Record', 'Result Recorded', 'Finish Call', 'Turn Logged', 'Place Recorded', 'Closing Total'];
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function render(moment) {
  const dom = {
    personalMatchMoment: { hidden: true, toggleAttribute(name, value) { this[name] = value; } },
    personalMatchMomentTitle: {}, personalMatchMomentLine: {}, personalMatchMomentFact: {},
    personalMatchArt: { dataset: {}, style: {} },
  };
  const show = runInNewContext(renderer + '\nshowPersonalMatchMoment', {
    dom, accoladeArtUrl: art => `assets/accolades/${slug(art)}.png`,
  });
  show(moment);
  return dom;
}

test('legacy text-only accolades show their corresponding artwork from canonical id, category, or title', () => {
  for (const title of legacyTitles) for (const field of ['id', 'category', 'title']) for (const hasNullArt of [false, true]) {
    const moment = { kind: 'accolade', [field]: field === 'id' ? slug(title) : title, line: 'Recorded fact',
      ...(hasNullArt ? { art: null } : {}) };
    const before = structuredClone(moment);
    const dom = render(moment);
    assert.equal(dom.personalMatchArt.hidden, false, `${title} identified by ${field} must show art`);
    assert.equal(dom.personalMatchArt.style.backgroundImage, `url("assets/accolades/${slug(title)}.png")`);
    assert.equal(dom.personalMatchMoment['data-text-card'], false);
    assert.deepEqual(moment, before, 'Rendering must not rewrite frozen completion evidence');
  }
});

test('a known legacy title still identifies its art when its old id is unfamiliar', () => {
  const dom = render({ kind: 'accolade', id: 'old-record-42', title: 'Clock Record', art: null });
  assert.equal(dom.personalMatchArt.style.backgroundImage, 'url("assets/accolades/clock-record.png")');
});

test('existing explicit artwork and displayed accolade facts remain unchanged', () => {
  const dom = render({ kind: 'accolade', id: 'table-victor', title: 'Existing title', category: 'Existing category',
    line: 'Existing description', fact: 'Existing fact', art: 'phoenix-return-refresh-v1' });
  assert.equal(dom.personalMatchArt.style.backgroundImage, 'url("assets/accolades/phoenix-return-refresh-v1.png")');
  assert.equal(dom.personalMatchMomentTitle.textContent, 'Existing title');
  assert.equal(dom.personalMatchMomentLine.textContent, 'Existing description');
  assert.equal(dom.personalMatchMomentFact.textContent, 'Existing fact');
});

test('unidentified old accolades receive generic completion artwork without losing their text', () => {
  const dom = render({ kind: 'accolade', title: 'Older unnamed category', fact: 'Preserved fact' });
  assert.equal(dom.personalMatchArt.hidden, false);
  assert.equal(dom.personalMatchArt.style.backgroundImage, 'url("assets/accolades/arc-complete.png")');
  assert.equal(dom.personalMatchMomentTitle.textContent, 'Older unnamed category');
  assert.equal(dom.personalMatchMomentFact.textContent, 'Preserved fact');
});
