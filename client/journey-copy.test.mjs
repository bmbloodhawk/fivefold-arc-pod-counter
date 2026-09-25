import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { commanderFallbackLabel, commanderSourceSections } from './commander-source-flow.js';

const root = new URL('./', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const app = await readFile(new URL('app.js', root), 'utf8');
const styles = await readFile(new URL('styles.css', root), 'utf8');
const feedbackPage = await readFile(new URL('feedback.html', root), 'utf8');
const layoutInvariants = await readFile(new URL('../UI_LAYOUT_INVARIANTS.md', root), 'utf8');

test('phone layout uses the visible viewport and prevents browser text inflation from changing geometry', () => {
  assert.match(html, /interactive-widget=resizes-content/);
  assert.match(styles, /-webkit-text-size-adjust: 100%; text-size-adjust: 100%/);
  assert.match(styles, /--app-viewport-height: 100dvh/);
  assert.match(styles, /min-height: var\(--app-viewport-height\)/);
  assert.match(app, /function syncViewportMetrics\(\)/);
  assert.match(app, /window\.visualViewport\?\.addEventListener\('resize', syncViewportMetrics/);
});

test('joining keeps optional commander setup out of the primary claim path', () => {
  assert.match(html, /STEP 2 OF 4/);
  assert.match(html, /STEP 3 OF 4/);
  assert.match(html, /STEP 4 OF 4/);
  assert.match(html, /id="joinStepTwoNext"[^>]*>Next: your name/);
  assert.match(html, /id="joinStepThreeNext"[^>]*>Next: commander/);
  assert.match(html, /id="joinSignInDeckButton"[^>]*>Sign in to use a saved deck/);
  assert.match(html, /Claim this seat/);
  assert.match(app, /function showJoinStep\(step\)/);
  assert.match(app, /joinSignInDeckButton'\)\.hidden = true/);
  assert.doesNotMatch(html, /Preview join locally/);
});

test('developer tools stay hidden until a host unlocks them with the protected portal key', () => {
  assert.match(html, /id="quickTestButton"[^>]*hidden/);
  assert.match(html, /id="localSimulationField"[^>]*hidden/);
  assert.match(html, /id="developerModeDialog"/);
  assert.match(app, /const DEVELOPER_MODE_KEY = 'fivefold-arc:developer-mode';/);
  assert.match(app, /\/api\/developer\/access/);
  assert.match(app, /dom\.podLabel\.addEventListener\('pointerdown'/);
  assert.match(app, /developerMode && developerHost\(\)/);
});

test('updating a pod confirms only entered commander names that have not already been checked', () => {
  assert.match(app, /async function confirmUnresolvedCommanderDetails\(container, count\)/);
  assert.match(app, /input\.dataset\.commanderLookupFailed === 'true'/);
  assert.match(app, /input\.dataset\.commanderLookupFailed = 'true';/);
  assert.match(app, /status\.textContent = error\.message \|\| 'Commander not found\. Check the spelling and try again\.'/);
  assert.match(app, /dom\.saveCommanderCountButton\.textContent = 'Update without colors';/);
  assert.match(app, /event\.preventDefault\(\);[\s\S]*await confirmUnresolvedCommanderDetails\(dom\.gameCommanderNames, count\)/);
  assert.match(app, /dom\.saveCommanderCountButton\.textContent = 'Update this pod';[\s\S]*dom\.saveCommanderCountButton\.disabled = false;[\s\S]*dom\.commanderCountDialog\.showModal\(\)/);
});

test('joining explains the claimed-seat boundary and normalizes the join code', () => {
  assert.match(html, /id="joinSeatClaim"/);
  assert.match(app, /This phone will control only \$\{seat\}/);
  assert.match(app, /toUpperCase\(\)\.replace\(\/\[\^A-Z0-9\]\/g, ''\)/);
});

test('the host lobby makes sharing the primary next setup action', () => {
  assert.match(html, /POD CREATED · INVITE PLAYERS/);
  assert.match(html, /Players open Fivefold Arc, choose <strong>Join a pod<\/strong>, then enter this code\./);
  assert.match(html, /id="lobbyInviteCode"/);
  assert.match(html, /id="copyLobbyJoinLinkButton"[^>]*>Copy invite link/);
  assert.match(app, /dom\.lobbyInviteCode\.textContent = state\.podCode/);
  assert.match(app, /dom\.copyLobbyJoinLinkButton\.addEventListener\('click', \(\) => copyJoinLink\(dom\.copyLobbyJoinLinkButton\)\)/);
});

test('creating a pod is distinct from starting a game', () => {
  assert.match(html, /name="gameFormat" value="commander" checked/);
  assert.match(html, /name="gameFormat" value="casual"/);
  assert.match(html, /id="customStartingLife"[^>]*min="1" max="999"/);
  assert.match(app, /function updateFormatSetup\(\)/);
  assert.match(app, /gameFormat === 'custom' \? form\.get\('customStartingLife'\)/);
  assert.match(app, /gameFormat === 'commander' \? Number\(form\.get\('commanderCount'\)\) : 1/);
  assert.match(app, /selectedGameFormat\(\) === 'casual'\) \{ \$\('input\[name="startingLife"\]\[value="20"\]'\)\.checked = true; \$\('input\[name="playerCount"\]\[value="2"\]'\)\.checked = true; \}/);
  assert.match(html, /STEP 1 OF 4/);
  assert.match(html, /STEP 2 OF 4/);
  assert.match(html, /STEP 3 OF 4/);
  assert.match(html, /STEP 4 OF 4/);
  assert.match(html, /STEP 4 OF 4[\s\S]*?Optional table settings[\s\S]*?Round limit/);
  assert.match(html, /id="createDeckField" class="select-field" hidden>My deck/);
  assert.match(html, /class="create-step commander-setup-step" data-create-step="3"/);
  assert.match(app, /function sortSetupDecks\(decks\) \{ return \[\.\.\.decks\]\.sort\(\(left, right\) => Number\(right\.favorite\) - Number\(left\.favorite\)/);
  assert.match(app, /\[dom\.createDeck, dom\.joinDeck\]\.forEach\(select => \{ select\.innerHTML = options; select\.value = ''; \}\)/);
  assert.match(html, /name="deckCommanderCount" value="2"/);
  assert.match(styles, /\.setup-form:has\(\.commander-setup-step:not\(\[hidden\]\)\) \{ margin-top: 16px; \}/);
  assert.match(styles, /\.commander-setup-step \.dialog-actions \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); gap: 6px; margin-top: 8px; \}/);
  assert.match(html, /id="createStepThreeSkip"[^>]*>Skip for now/);
  assert.match(app, /Enter colors manually/);
  assert.match(app, /Keep without colors/);
  assert.match(app, /commanderNames = deck\?\.commanderNames\?\.length \? deck\.commanderNames/);
  assert.match(app, /const name = names\[slot\] \?\? prior\?\.name \?\? '';/);
  assert.match(html, /<button class="primary-action" type="submit">Create pod<\/button>/);
  assert.match(html, /id="startGameButton"[^>]*>Start game · P1 goes first/);
});

test('the lobby explains its two-player start threshold and what happens to empty seats', () => {
  assert.match(html, /Start when 2 or more players are ready\. Unclaimed seats stay unused\./);
  assert.match(app, /dom\.startGameButton\.disabled = !isHost \|\| claimedPlayers\.length < 2;/);
});

test('turn cues offer explicit sound and vibration modes with an iPhone support note', () => {
  assert.match(html, /id="turnCueDialog"/);
  assert.match(html, /value="sound"><span>Single ding/);
  assert.match(html, /value="vibrate"><span>Vibrate/);
  assert.match(html, /value="both"><span>Both/);
  assert.match(html, /including many iPhones/);
  assert.match(app, /function cueMode\(turn = state\?\.turn\)/);
  assert.match(app, /mode === 'vibrate' \|\| mode === 'both'/);
  assert.match(app, /mode === 'sound' \|\| mode === 'both'/);
  assert.match(app, /function prepareTurnCueAudio\(preview = false, mode = cueMode\(\), force = false\)/);
  assert.match(app, /window\.webkitAudioContext/);
  assert.match(app, /prepareTurnCueAudio\(false, mode\);/);
  assert.match(app, /document\.addEventListener\('pointerdown', \(\) => prepareTurnCueAudio\(false, cueMode\(\), true\)\);/);
});

test('declaring an alternate winner offers an optional visible reason without a redundant celebration close button', () => {
  assert.match(html, /id="winnerReason"[^>]*maxlength="160"/);
  assert.match(html, /How did they win\?/);
  assert.doesNotMatch(html, />Close celebration</);
  assert.match(app, /declarationDetail: declarationDetail \|\| null/);
});

test('the landing page explains the privacy boundary without overclaiming record retention', () => {
  assert.match(html, /id="signInButton"[^>]*>Sign in/);
  assert.match(html, /id="continueGuestButton"[^>]*>Continue as guest/);
  assert.match(html, /id="playActions"[^>]*hidden/);
  assert.match(html, /id="joinPodButton" class="primary-action" type="button">Join a pod/);
  assert.match(html, /id="myGamesButton" class="secondary-action account-action" type="button" aria-disabled="true">My profile/);
  assert.match(html, /id="myDecksButton" class="secondary-action account-action" type="button" aria-disabled="true"/);
  assert.match(html, /id="accountSignedInStatus" class="account-signed-in" hidden>Signed in/);
  assert.match(app, /function enterApp\(signedIn = false\) \{ accountChoice\.hidden = true; playActions\.hidden = false; myGamesButton\.setAttribute\('aria-disabled', String\(!signedIn\)\); myDecksButton\.setAttribute\('aria-disabled', String\(!signedIn\)\);/);
  assert.match(app, /myDecksButton\.getAttribute\('aria-disabled'\) === 'true'\) return openSignIn\(\)/);
  assert.doesNotMatch(html, /PHONE-FIRST PLAYTEST/);
  assert.match(html, /Test build · Guest play is always available/);
  assert.match(html, /You can optionally sign in to save your own games and decks\./);
  assert.match(html, /href="privacy\.html"/);
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

test('the local four-player demo expires after a generous idle period instead of restoring stale timers', () => {
  assert.match(app, /const LOCAL_DEMO_IDLE_TIMEOUT_MS = 24 \* 60 \* 60 \* 1000;/);
  assert.match(app, /Date\.now\(\) - lastInteractionAt > LOCAL_DEMO_IDLE_TIMEOUT_MS/);
  assert.match(app, /localStorage\.removeItem\(LOCAL_DEMO_STATE_KEY\); return null;/);
  assert.match(app, /state\.localDemoLastInteractionAt = Date\.now\(\);/);
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

test('card advisor Close always dismisses without requiring a lookup input', () => {
  assert.match(html, /<button value="close" class="secondary-action" formnovalidate>Close<\/button>/);
  assert.match(app, /dom\.cardAdvisorForm\.addEventListener\('submit', event => \{ if \(event\.submitter\?\.value === 'close'\) return;/);
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

test('commander damage keeps the entry controls independent of source count', () => {
  assert.doesNotMatch(app, /sources\.map\(source => \{ const value = commanderValue\(player, source\.id\)/);
  assert.match(app, /const source = selectedSourceFor\(player\);/);
  assert.match(styles, /\.source-panel \{ grid-template-columns: 1fr; gap: 4px; margin: 2px 0 7px; \}/);
});

test('commander damage keeps entry compact and moves every source into a grouped selector', () => {
  assert.match(html, /id="commanderSourceDialog"/);
  assert.match(html, /id="commanderSourceList"/);
  assert.match(app, /function sourceChoiceLabel\(source\)/);
  assert.match(app, /commanderFallbackLabel\(source, owner\)/);
  assert.match(app, /function openCommanderSourceDialog\(player\)/);
  assert.match(app, /if \(suggested\.length === 1\) state\.selectedSourceId = suggested\[0\]\.id;/);
  assert.match(app, /Suggested · \$\{sourceOwnerLabel\(suggested\[0\]\)\}'s turn/);
  assert.match(app, /section\('Recent', recent/);
  assert.match(app, /<h3>All commanders<\/h3>/);
  assert.match(app, /data-source-choice=/);
  assert.match(app, /dom\.commanderSourceDialog\.close\('selected'\); render\(\);/);
  assert.match(app, /id="changeCommanderSourceButton"/);
  assert.match(styles, /\.commander-source-dialog \{[\s\S]*height: min\(100dvh, 760px\)/);
  assert.match(styles, /\.commander-source-list \{[\s\S]*overflow-y: auto/);
  assert.match(styles, /\.selected-source-button \{[\s\S]*min-height: 40px/);
  assert.match(app, /dom\.game\.dataset\.counterMode = state\.mode/);
  assert.match(styles, /\.game-shell\[data-counter-mode="commander"\] #turnActions \{ margin-top: 2px; transform: none; \}/);
});

test('commander source selection keeps every source grouped, suggests the active turn, and names unnamed partners', () => {
  const players = Array.from({ length: 8 }, (_, index) => ({ id: `P${index + 1}`, commanderCount: index === 2 ? 2 : 1 }));
  const sources = players.flatMap(player => Array.from({ length: player.commanderCount }, (_, index) => ({ id: `${player.id}-${index + 1}`, ownerPlayerId: player.id, slot: index ? 'B' : 'A' })));
  const sections = commanderSourceSections({ sources, players, defenderDamage: { 'P1-1': 4, 'P5-1': 2 }, turnSeatId: 'P3', turnTrackingEnabled: true });
  assert.equal(sections.groups.length, 8);
  assert.deepEqual(sections.suggested.map(source => source.id), ['P3-1', 'P3-2']);
  assert.deepEqual(sections.recent.map(source => source.id), ['P1-1', 'P5-1']);
  assert.ok(sections.groups.find(group => group.owner.id === 'P1').sources.some(source => source.id === 'P1-1'));
  assert.equal(commanderFallbackLabel({ ownerPlayerId: 'P3', slot: 'A' }, players[2]), "P3's commander 1");
  assert.equal(commanderFallbackLabel({ ownerPlayerId: 'P3', slot: 'B' }, players[2]), "P3's commander 2");
  assert.equal(commanderSourceSections({ sources, players, defenderDamage: {}, turnSeatId: 'P3', turnTrackingEnabled: false }).suggested.length, 0);
});

test('commander seat cards identify the selected source and show every other defender\'s source-specific damage', () => {
  assert.match(app, /function commanderSeatCardValue\(player, source\)/);
  assert.match(app, /if \(player\.id === source\.ownerPlayerId\) return \{ text: 'SOURCE', state: 'source' \}/);
  assert.match(app, /text: `CMD \$\{commanderValue\(player, source\.id\)\}`/);
  assert.match(app, /const commanderSource = state\.mode === 'commander'/);
  assert.match(styles, /\.pod-seat\.commander-seat-source \.seat-life/);
  assert.match(styles, /\.pod-seat\.commander-seat-damage \.seat-life/);
});

test('selecting a saved deck immediately confirms every selected commander identity for create and join', () => {
  assert.match(app, /const container = joining \? dom\.joinCommanderNames : dom\.createCommanderNames/);
  assert.match(app, /renderCommanderNameFields\(container, commanderNames\.length, commanderNames\); void confirmUnresolvedCommanderDetails\(container, commanderNames\.length\)/);
});

test('every player has a confirmed route home that preserves their reclaimable seat', () => {
  assert.match(html, /id="leaveTableButton"[^>]*>Leave table/);
  assert.match(html, /id="leaveTableDialog"/);
  assert.match(html, /Your seat stays reserved here so you can rejoin from this device\./);
  assert.match(app, /function leaveTable\(\)/);
  assert.match(app, /dom\.confirmLeaveTableButton\?\.addEventListener\('click', leaveTable\)/);
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
  assert.match(html, /id="lethalMark" class="lethal-mark" hidden><img src="assets\/elimination-skull-v1\.png" alt="">/);
  assert.match(html, /id="eliminationOutcome" class="elimination-outcome" hidden/);
  assert.match(styles, /Elimination is a visible state, never a new layout row[\s\S]*artwork shares[\s\S]*behind the readout/);
  assert.match(styles, /\.lethal-mark \{ position: absolute; z-index: 1; top: 47%; left: 50%;[\s\S]*translate\(-50%, -43%\)/);
  assert.match(styles, /\.lethal-mark img \{[\s\S]*opacity: \.46;/);
  assert.match(app, /ELIMINATION_ART = \{ life: 'assets\/elimination-skull-v1\.png', poison: 'assets\/elimination-skull-poison-v1\.png', commander: 'assets\/elimination-skull-commander-v1\.png' \}/);
  assert.match(styles, /\.main-value\.elimination-placeholder \{ visibility: hidden; \}[\s\S]*\.elimination-outcome \{ position: absolute; z-index: 3;/);
  assert.match(styles, /\.counter-readout \{[\s\S]*z-index: 2;/);
  assert.match(app, /detail: `COMMANDER DAMAGE · \$\{displaySource\(lethalSource\)\}`, art: 'commander'/);
  assert.match(app, /detail: 'POISON', art: 'poison'/);
  assert.match(app, /detail: 'LIFE TOTAL 0', art: 'life'/);
  assert.match(app, /dom\.lethalImage\.src = ELIMINATION_ART\[player\.eliminationOutcome\.art\] \|\| ELIMINATION_ART\.life/);
  assert.match(app, /state\.players\.forEach\(evaluatePlayer\)[\s\S]*!player\.eliminated/);
});

test('counter titles clear the number without reflowing the fixed readout', () => {
  assert.match(styles, /Keep the counter title clear of wide or tall totals[\s\S]*\.counter-mode \{ transform: translateY\(-18px\); \}/);
});

test('large-pod side seats keep their visible card as the tap target', () => {
  assert.match(styles, /focused readout is display-only[\s\S]*\.counter-readout \{ pointer-events: none; \}/);
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

test('the three-dot menu captures its own scrolling instead of scrolling the game behind it', () => {
  assert.match(styles, /\.game-menu \{[\s\S]*overscroll-behavior: contain[\s\S]*touch-action: pan-y/);
  assert.match(styles, /html\.game-menu-open, body\.game-menu-open \{ overflow: hidden/);
  assert.match(app, /new MutationObserver\(syncGameMenuScrollLock\)\.observe\(dom\.gameMenu/);
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

test('the confirmed winner is celebrated on every phone with artwork and a tap-to-exit screen', () => {
  assert.match(html, /id="victoryDialog"[\s\S]*assets\/victory-seal-v1\.png[\s\S]*id="victoryEyebrow"[\s\S]*id="victoryTapHint"[^>]*>Enjoy the win/);
  assert.match(html, /class="victory-winner-copy"[\s\S]*id="personalMatchMoment"[\s\S]*class="victory-dismissal"/);
  assert.match(app, /if \(key !== shownVictoryKey\)/);
  assert.match(app, /if \(!result \|\| !winner\) \{ shownVictoryKey = null; if \(dom\.victoryDialog\.open\) dom\.victoryDialog\.close\('game-reset'\); return; \}/);
  assert.match(app, /const youWon = winner\.id === actingSeatId/);
  assert.match(app, /victoryDismissReady && dom\.victoryDialog\.open/);
  assert.match(styles, /\.victory-art \{[\s\S]*object-position: center 31%/);
  assert.doesNotMatch(styles, /\.victory-art \{[^}]*opacity:/);
  assert.doesNotMatch(styles, /\.victory-art \{[^}]*mix-blend-mode:/);
  assert.match(styles, /\.victory-dialog-content \{[\s\S]*grid-template-rows: 1fr 1fr/);
  assert.match(app, /function accoladeArtUrl\(title\).*assets\/accolades/s);
  assert.match(app, /function winnerArtUrl\(winner\).*last-one-standing.*table-monarch.*arc-victor/s);
  assert.match(app, /dom\.personalMatchArt\.style\.backgroundImage/);
  assert.match(html, /id="nextGameButton"[^>]*>Start next game/);
  assert.match(app, /dom\.nextGameButton\.hidden = !result \|\| !winner \|\| !\(state\?\.localSimulation \|\| transport\.seatId === state\?\.hostSeatId\)/);
  assert.match(app, /openResetDialog\(\{ nextGame: true \}\)/);
  assert.match(app, /dom\.confirmResetButton\.textContent = nextGame \? 'Start next game' : 'Reset game';/);
  assert.match(styles, /\.personal-match-art \{[\s\S]*background-size: cover/);
  assert.doesNotMatch(styles, /\.personal-match-art \{[^}]*opacity:/);
});

test('achievements follow the personal match accolade and reveal every new rarity only after unlock', () => {
  assert.match(html, /id="achievementDialog"[\s\S]*ACHIEVEMENT UNCOVERED[\s\S]*id="achievementUnlockList"/);
  assert.match(app, /function showAchievementUnlocks\(gameKey\)/);
  assert.match(app, /unlockedAchievementsByGame\.set\(gameKey, unlockedAchievements\)/);
  assert.match(app, /dom\.victoryDialog\.addEventListener\('close', \(\) => \{ if \(dom\.victoryDialog\.returnValue === 'tap' && !showAchievementUnlocks/);
  assert.match(app, /data-rarity="\$\{escapeHtml\(achievement\.rarity \|\| 'common'\)\}"/);
  assert.match(app, /unlocked\.map\(achievement =>/);
  assert.match(styles, /\.achievement-card\[data-rarity="legendary"\]/);
  assert.match(styles, /\.achievement-card\[data-rarity="epic"\]/);
});

test('private feedback review includes a non-personal insights tab', () => {
  assert.match(feedbackPage, /data-tab="insights">Test insights/);
  assert.match(feedbackPage, /Automatic metrics come from qualified standard games in Diagnostics/);
  assert.match(feedbackPage, /excludes names, room codes, device identifiers, raw taps, and free-text observations/);
  assert.match(feedbackPage, /\/api\/feedback\/insights/);
});

test('private feedback preserves room and game context for debugging', () => {
  assert.match(feedbackPage, /Diagnostic context/);
  assert.match(feedbackPage, /Room \$\{escapeHtml\(note\.roomCode \|\| 'unavailable'\)\}/);
  assert.match(feedbackPage, /Game \$\{escapeHtml\(note\.gameId \|\| 'unavailable'\)\}/);
});

test('developer diagnostics are protected and limited to retained confirmed table history', () => {
  assert.match(feedbackPage, /data-tab="diagnostics">Diagnostics/);
  assert.match(feedbackPage, /server-confirmed changes and saved table snapshots/);
  assert.match(feedbackPage, /never contains seat credentials, device identifiers, IP addresses, or raw tap data/);
  assert.match(feedbackPage, /\/api\/feedback\/diagnostics/);
  assert.match(feedbackPage, /Recent games/);
  assert.match(feedbackPage, /review opportunity, not a confirmed defect/);
  assert.match(feedbackPage, /Accolade decisions/);
  assert.match(feedbackPage, /selection\.selectionReason/);
});

test('standard tables remain the default while hosts can exclude development runs', () => {
  assert.match(html, /id="markDevelopmentButton"/);
  assert.match(app, /Mark development run/);
  assert.match(app, /setSessionKind/);
  assert.match(feedbackPage, /greater of 3 minutes or 25 seconds per recorded pass/);
  assert.match(feedbackPage, /Review this definition after 12 qualified standard tables or 30 days/);
});

test('developer insights distinguish automatic qualified games from host-reported field tests', () => {
  assert.match(feedbackPage, /Automatic · qualified standard games/);
  assert.match(feedbackPage, /Host-reported real-table tests/);
  assert.match(html, /Did the app ever show the table incorrectly\?/);
  assert.match(feedbackPage, /Did the app ever show the table incorrectly\?/);
  assert.match(feedbackPage, /averageQualifiedDurationMs/);
  assert.match(feedbackPage, /No table insights have been recorded yet/);
});

test('host recovery finds the most recent saved host pod on this phone without asking for its code', () => {
  assert.match(html, /No pod code needed\./);
  assert.match(html, /id="recoverPodButton"[^>]*>Recover my host pod/);
  assert.match(app, /function latestRecoverableHostPodCode\(\)/);
  assert.match(app, /transport\.hostRecoveryPodCodes\(\)/);
  assert.match(app, /This phone does not have a saved host pod to recover\./);
  assert.doesNotMatch(app, /Enter the six-character pod code first\./);
});

test('signed-in accounts keep private deck details and personal history tools', () => {
  assert.match(html, /id="deckNotes"/);
  assert.match(html, /name="deckColors"/);
  assert.match(html, /id="deckFavorite"/);
  assert.match(html, /id="accountPreferredName"/);
  assert.match(app, /\/api\/account\/preferences/);
  assert.match(app, /profile-tabs/);
  assert.match(html, /Achievements uncovered/);
  assert.match(app, /transport\.getPersonalMatchMoment\(\)/);
  assert.match(app, /counterTotals,/);
  assert.match(app, /More await\./);
  assert.match(styles, /\.achievement-card/);
  assert.match(app, /'Settings'/);
  assert.match(app, /const profileSettings = \[accountDefaultPlayerCountField/);
  assert.match(app, /emailSignInFields\.hidden = true; accountPassword\.value = '';/);
  assert.match(app, /Deck statistics/);
  assert.match(app, /id="gameHistorySearch"/);
  assert.match(app, /data-toggle-archive/);
  assert.match(app, /data-edit-deck/);
  assert.match(app, /function beginDeckEdit\(deckId\)/);
  assert.match(app, /exportDeckSummary/);
  assert.match(html, /id="accountDefaultPlayerCount"/);
  assert.match(html, /id="signOutButton"[^>]*>Sign out/);
  assert.match(app, /signOutAccount/);
  assert.match(app, /const profileSettings = \[accountDefaultPlayerCountField[^\]]*signOutButton\]/);
});

test('completed signed-in games save automatically without a final player action', () => {
  assert.match(app, /void saveGameToHistory\(\{ automatic: true, gameKey: key \}\);/);
  assert.match(app, /const token = automatic \? await currentAccountToken\(\) : await currentAccountToken\(\) \|\| await googleAccountToken\(\);/);
  assert.match(app, /automaticallySavedGameKey = gameKey/);
  assert.match(app, /Game saved automatically/);
  assert.match(app, /state\?\.sessionKind === 'development'/);
  assert.match(app, /sourceGameId: `\$\{state\.podCode\}:\$\{result\.decidedAt\}:\$\{seatId\}`/);
});

test('radiation is prompted after turn handoff and resolved from the entered mill result', () => {
  assert.match(html, /id="radiationDialog"/);
  assert.match(html, /Nonland cards milled/);
  assert.match(app, /promptRadiationAfterHandoff/);
  assert.match(app, /resolveRadiation\(nonlandCount\)/);
});

test('each phone can choose and preview a turn sound at a personal volume', () => {
  assert.match(html, /id="turnSoundDialog"/);
  assert.match(html, /Soft chime/);
  assert.match(html, /id="turnSoundVolume"/);
  assert.match(app, /function turnSound\(\)/);
  assert.match(app, /playTurnCue\(true\)/);
});

test('email accounts can request a password-reset email', () => {
  assert.match(html, /id="forgotPasswordButton"/);
  assert.match(app, /sendAccountPasswordReset/);
  assert.match(app, /emailSignInButton\.textContent = 'Sign in with email';/);
  assert.match(app, /Enter your email and password, then choose Sign in with email\./);
});

test('email autofill does not close the My games dialog', () => {
  assert.match(app, /myGamesDialog\.querySelector\('form'\)\.addEventListener\('submit', event => event\.preventDefault\(\)\);/);
  assert.match(app, /myGamesDialog\.querySelector\('button\[value="close"\]'\)\.addEventListener\('click', \(\) => myGamesDialog\.close\(\)\)/);
});

test('a completed account sign-in goes directly to the pod choice without loading the profile', () => {
  assert.match(app, /async function finishAccountSignIn\(token\)/);
  assert.match(app, /enterApp\(true\); await loadSetupDecks\(\); myGamesDialog\.close\(\);/);
  assert.match(app, /else showView\(dom\.landing\);/);
  assert.match(app, /finishAccountSignIn\(await googleAccountToken\(\)\)/);
  assert.match(app, /finishAccountSignIn\(await emailAccountToken\(accountEmail\.value, accountPassword\.value\)\)/);
  assert.doesNotMatch(app, /showMyGames\(true, true\)/);
});

test('sign-in is a single-purpose gate rather than a detour through the profile', () => {
  assert.match(html, /<h2 id="myGamesTitle">Sign in<\/h2>/);
  assert.match(app, /function openSignIn\(\{ returnToJoin = false \} = \{\}\) \{[\s\S]*Guest play is always available[\s\S]*myGamesDialog\.showModal\(\); \}/);
  assert.match(app, /function openMyProfile\(\) \{ myGamesDialog\.showModal\(\); void showMyGames\(\); \}/);
  assert.doesNotMatch(app, /function openSignIn\(\) \{ myGamesDialog\.showModal\(\); showMyGames\(\); \}/);
});

test('signed-in profile hides sign-in controls and clears the password field', () => {
  assert.match(app, /myGamesSignInButton\.hidden = true; emailSignInButton\.hidden = true; emailSignInFields\.hidden = true; accountPassword\.value = ''; forgotPasswordButton\.hidden = true; createAccountButton\.hidden = true;/);
});

test('signing in for a saved deck returns a QR joiner to the join step', () => {
  assert.match(app, /function openSignIn\(\{ returnToJoin = false \} = \{\}\)/);
  assert.match(app, /pendingSignInReturn = returnToJoin \? \{ view: 'join', code: \$\('#podCode'\)\.value\.trim\(\)\.toUpperCase\(\), step: joinStep \} : null;/);
  assert.match(app, /if \(returnTo\?\.view === 'join'[^\n]*showView\(dom\.joinSeatView\); showJoinStep\(returnTo\.step\);/);
  assert.match(app, /joinSignInDeckButton'\)\.addEventListener\('click', \(\) => openSignIn\(\{ returnToJoin: true \}\)\)/);
});

test('signing out returns the device to guest play without deleting account data', () => {
  assert.match(app, /async function signOut\(\) \{/);
  assert.match(app, /await signOutAccount\(\);/);
  assert.match(app, /selectedDeckId = ''; setupDecks = \[\]; savedDecks = \[\];/);
  assert.match(app, /enterApp\(false\);/);
  assert.match(app, /signOutButton\.addEventListener\('click', \(\) => void signOut\(\)\)/);
});

test('compact actions use the shared button treatment while removals remain distinct', () => {
  assert.match(styles, /\.text-action, \.back-button \{[\s\S]*border: 1px solid var\(--line\)[\s\S]*text-decoration: none/);
  assert.match(styles, /\.text-action\[data-remove-game\][\s\S]*#deleteAccountButton \{[\s\S]*color: var\(--danger\)/);
});
