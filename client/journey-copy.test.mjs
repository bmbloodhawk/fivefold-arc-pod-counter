import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const app = await readFile(new URL('app.js', root), 'utf8');
const styles = await readFile(new URL('styles.css', root), 'utf8');
const feedbackPage = await readFile(new URL('feedback.html', root), 'utf8');
const layoutInvariants = await readFile(new URL('../UI_LAYOUT_INVARIANTS.md', root), 'utf8');

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

test('life changes and low-life warnings do not reflow the fixed play surface', () => {
  assert.match(styles, /A changing total must never reflow the play surface/);
  assert.match(styles, /\.main-value \{ display: block; min-width: 3ch; font-feature-settings: "tnum" 1; \}/);
  assert.match(styles, /compact overlay slot between the player title[\s\S]*fixed turn-action slot/);
  assert.match(styles, /\.life-change-indicator,[\s\S]*\.status-message \{[\s\S]*position: absolute;[\s\S]*bottom: 51px;/);
  assert.match(styles, /font-size: 1\.2rem;[\s\S]*line-height: 1\.1;/);
  assert.match(app, /lifeChangeOwnsStatusSlot = lifeChange\?\.playerId === player\.id/);
  assert.match(app, /\$\{safetyStatus\} · \$\{sign\}\$\{Math\.abs\(lifeChange\.delta\)\} LIFE/);
});

test('the elimination mark is an overlay, not a layout row', () => {
  assert.match(styles, /Elimination is a visible state, never a new layout row/);
  assert.match(styles, /\.lethal-mark \{ position: absolute;[\s\S]*top: 12px; left: 50%;[\s\S]*width: 32px; height: 32px;[\s\S]*translateX\(-50%\)/);
});

test('counter titles clear the number without reflowing the fixed readout', () => {
  assert.match(styles, /Keep the counter title clear of wide or tall totals[\s\S]*\.counter-mode \{ transform: translateY\(-18px\); \}/);
});

test('turn state keeps the Your Turn active-play geometry as its anchor', () => {
  assert.match(layoutInvariants, /Your Turn.*fixed geometry anchor/s);
  assert.match(layoutInvariants, /must not move the header, table summary, center emblem, mode[\s\S]*fixed navigation/);
  assert.match(styles, /HARD LAYOUT INVARIANT: Your Turn is the geometry anchor/);
  assert.match(styles, /\.game-shell \.counter-stage,[\s\S]*\.game-shell\[data-your-turn="true"\] \.counter-stage,[\s\S]*\.game-shell\[data-your-turn="false"\] \.counter-stage/s);
  assert.match(styles, /#turnActions \{[\s\S]*transform: translateY\(-28px\)/);
});

test('three-dot menu uses one selectable row pattern except for intentional control roles', () => {
  assert.match(html, /<aside id="gameMenu" class="game-menu"[\s\S]*id="coinTossButton"[\s\S]*id="resetButton"/);
  assert.match(styles, /Three-dot menu: every selectable destination uses the same full-width/);
  assert.match(styles, /\.game-menu > button:not\(\.menu-close\) \{[\s\S]*min-height: 46px/);
  assert.match(styles, /\.game-menu > button\.danger-text \{/);
});

test('touch feedback is local, optional, and never part of game state', () => {
  assert.match(html, /id="toggleTouchFeedbackButton"/);
  assert.match(app, /fivefold-arc:touch-feedback/);
  assert.match(app, /navigator\.vibrate\?\.\(12\)/);
  assert.match(app, /document\.addEventListener\('pointerup'/);
  assert.match(styles, /Shared tactile visual response/);
  assert.match(styles, /Routine game taps must not be interpreted as browser double-tap zooms/);
  assert.match(styles, /button \{ touch-action: manipulation;/);
});

test('private feedback review includes a non-personal field-test insights tab', () => {
  assert.match(feedbackPage, /data-tab="insights">Test insights/);
  assert.match(feedbackPage, /Aggregated, real-table field-test data only/);
  assert.match(feedbackPage, /excludes names, room codes, device identifiers, raw taps, and free-text observations/);
  assert.match(feedbackPage, /\/api\/feedback\/insights/);
});
