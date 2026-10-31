import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('visiting another player exposes their recorded commander damage as read-only details', () => {
  assert.match(html, /id="viewCommanderDamageButton"[^>]*hidden[^>]*>Commander damage details<\/button>/);
  assert.match(app, /commanderDamageDetails: \$\('#viewCommanderDamageButton'\)/);
  assert.match(app, /dom\.commanderDamageDetails\.hidden = !\(inspectingSharedSeat && commanderFormat\)/);
  assert.match(app, /dom\.commanderDamageDetails\.addEventListener\('click', \(\) => \{ const player = activePlayer\(\); if \(player\) openCommanderSourceDialog\(player, \{ readOnly: true \}\); \}\)/);
  assert.match(app, /function openCommanderSourceDialog\(player\) \{\s*const readOnly = arguments\[1\]\?\.readOnly === true;/);
});
