import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const app = await readFile(new URL('app.js', root), 'utf8');
const styles = await readFile(new URL('styles.css', root), 'utf8');

test('joining keeps optional commander setup out of the primary claim path', () => {
  assert.match(html, /Commander details \(optional — set later\)/);
  assert.match(html, /Claim this seat/);
  assert.doesNotMatch(html, /Preview join locally/);
});

test('joining explains the claimed-seat boundary and normalizes the join code', () => {
  assert.match(html, /id="joinSeatClaim"/);
  assert.match(app, /This phone will control only \$\{seat\}/);
  assert.match(app, /toUpperCase\(\)\.replace\(\/\[\^A-Z0-9\]\/g, ''\)/);
});

test('the host lobby makes sharing the primary next setup action', () => {
  assert.match(app, /Share code \$\{state\.podCode\}/);
});

test('the host lobby has one default start action and keeps alternate first-player choices secondary', () => {
  assert.match(html, /id="startGameButton"[^>]*>Start game · P1 goes first/);
  assert.match(html, /<details id="firstPlayerOptions" class="lobby-options">/);
  assert.match(html, /<summary>Choose a different first player<\/summary>/);
  assert.match(app, /Start game · \$\{displayName\(firstPlayer\)\} goes first/);
});

test('saved tables and QR links return players to a pod without sharing seat credentials', () => {
  assert.match(html, /id="savedTables"/);
  assert.match(html, /Show join QR/);
  assert.match(html, /id="joinQrImage"/);
  assert.match(app, /SAVED_TABLES_KEY/);
  assert.match(app, /searchParams\.set\('join', state\.podCode\)/);
  assert.match(app, /join-qr\.svg/);
  assert.doesNotMatch(html, /reclaimToken/);
});

test('seat connection state remains a compact symbol at every pod size', () => {
  assert.doesNotMatch(styles, /seat-state::before \{ content: attr\(title\)/);
  assert.match(app, /stateSymbol = isWaiting \? '○' : isOffline \? '×'/);
});

test('card advisor is title-first and keeps rules advice distinct from a judge ruling', () => {
  assert.match(html, /id="cardCameraDialog"/);
  assert.match(html, /Card rules & interaction/);
  assert.match(html, /id="firstCardTitle"/);
  assert.match(html, /id="interactionSituation"/);
  assert.match(html, /this is not a judge ruling/);
  assert.match(app, /createInteractionAdvice/);
  assert.match(app, /lookupCardTitles/);
  assert.match(app, /lookupCardInteraction/);
  assert.match(app, /Commander Spellbook/);
  assert.match(app, /No established interaction was found/);
  assert.match(app, /event\.submitter\?\.value === 'close'/);
  assert.match(styles, /\.card-advisor-dialog/);
  assert.match(styles, /#cardCameraDialog \{[\s\S]*overflow-y: auto/);
});

test('custom-life cancellation bypasses an empty required amount', () => {
  assert.match(html, /<button id="cancelCustomLifeButton" type="button" class="secondary-action">Cancel<\/button>/);
  assert.equal((html.match(/id="cancelCustomLifeButton"/g) || []).length, 1);
});

test('the life readout stays together and the tax action cannot overlap custom life', () => {
  assert.match(html, /class="counter-readout"[\s\S]*id="modeTitle"[\s\S]*id="mainValue"[\s\S]*id="counterContext"/);
  assert.match(html, /class="counter-stage"[\s\S]*id="turnActions"[\s\S]*id="adjustControls"/);
  assert.match(styles, /#turnActions \{ position: relative; z-index: 4; margin-top: -32px; margin-bottom: 20px; \}/);
  assert.match(styles, /\.counter-readout \{[\s\S]*justify-items: center/);
  assert.match(styles, /\.counter-readout \.main-value \{ margin: 0; transform: translateY\(-10px\); \}/);
  assert.match(styles, /\.counter-readout \.counter-context \{ margin: 24px 0 0; transform: translateY\(8px\); \}/);
  assert.match(styles, /\.counter-readout \.counter-context \{ margin-top: 18px; transform: translateY\(6px\); \}/);
  assert.match(styles, /\.custom-life-button, \.commander-tax-quick \{ margin-top: 2px; \}/);
  assert.match(styles, /A turn adds one action, not a different screen/);
  assert.match(styles, /\.game-shell\[data-your-turn="true"\] \.counter-stage \{ min-height: 318px; margin-top: 0; margin-bottom: 0; \}/);
  assert.match(styles, /\.game-shell\[data-your-turn="true"\] \.counter-readout \{ min-height: 282px; \}/);
  assert.match(styles, /\.game-shell\[data-your-turn="true"\] \.commander-tax-quick \{ transform: none; margin-bottom: 0; \}/);
});
