import assert from "node:assert/strict";
import test from "node:test";
import { AccountHistory, MemoryAccountHistoryStore } from "../src/account-history.js";

test("account history uses an opaque account id and does not retain the provider subject", async () => {
  const store = new MemoryAccountHistoryStore(); const history = new AccountHistory({ store, now: () => 10, createId: () => "opaque" });
  const accountId = await history.ensureAccount("provider-subject-private");
  assert.equal(accountId, "acct_opaque");
  assert.equal(JSON.stringify([...store.values.values()]).includes("provider-subject-private"), false);
  assert.equal(await history.ensureAccount("provider-subject-private"), accountId);
});

test("personal games retain only the saver’s explicitly supplied result", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), now: () => 20, createId: (() => { let id = 0; return () => String(++id); })() });
  const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 4, won: true, place: 1, outcomeDescription: "Combat damage", commanderName: "Alela" });
  await history.saveGame(accountId, { tableSize: 4, won: false });
  const summary = await history.summary(accountId);
  assert.deepEqual({ gamesPlayed: summary.gamesPlayed, wins: summary.wins, winRate: summary.winRate, recentGames: summary.recentGames }, { gamesPlayed: 2, wins: 1, winRate: .5, recentGames: [
    { gameId: "game_2", savedAt: 20, tableSize: 4, won: true, place: 1, outcomeDescription: "Combat damage", commanderName: "Alela", deckId: null, counterTotals: { poison: 0, energy: 0, radiation: 0, commanderDamage: 0 }, achievementFacts: {} },
    { gameId: "game_3", savedAt: 20, tableSize: 4, won: false, place: null, outcomeDescription: null, commanderName: null, deckId: null, counterTotals: { poison: 0, energy: 0, radiation: 0, commanderDamage: 0 }, achievementFacts: {} },
  ] });
  assert.equal(summary.games.length, 2);
  assert.equal(summary.achievements.some(achievement => achievement.id === "first-chronicle"), true);
  assert.equal(summary.achievements.find(achievement => achievement.id === "first-chronicle").rarity, "common");
});

test("saving the same completed table twice is idempotent", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() });
  const accountId = await history.ensureAccount("subject");
  const first = await history.saveGame(accountId, { tableSize: 2, won: true, sourceGameId: "table:123:0" });
  const second = await history.saveGame(accountId, { tableSize: 2, won: true, sourceGameId: "table:123:0" });
  assert.equal(second.gameId, first.gameId);
  assert.equal((await history.summary(accountId)).gamesPlayed, 1);
});

test("account history rejects room details and unrecorded placement data", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore() }); const accountId = await history.ensureAccount("subject");
  await assert.rejects(() => history.saveGame(accountId, { tableSize: 4, won: true, place: 5 }), /Place is invalid/);
  await assert.rejects(() => history.saveGame(accountId, { tableSize: 4, won: true, roomCode: "PRIVATE" }), /Text|invalid|allowed/);
});

test("achievements are earned from saved results and do not reveal unfinished goals", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 2, won: true, place: 1 });
  const summary = await history.summary(accountId); const ids = summary.achievements.map(achievement => achievement.id);
  assert.deepEqual(ids, ["account-awakened", "first-chronicle", "first-crown", "duelist", "duo-queue"]);
  assert.equal("milestones" in summary, false);
});

test("achievement folders keep new entries marked until their rarity is viewed", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 2, won: true, place: 1 });
  assert.equal((await history.summary(accountId)).achievements.filter(item => item.rarity === 'common').every(item => item.isNew), true);
  await history.markAchievementRarityViewed(accountId, 'common');
  const achievements = await history.summary(accountId);
  assert.equal(achievements.achievements.filter(item => item.rarity === 'common').every(item => !item.isNew), true);
  assert.equal(achievements.achievements.filter(item => item.rarity === 'uncommon').every(item => item.isNew), true);
  await assert.rejects(() => history.markAchievementRarityViewed(accountId, 'mythic'), /rarity is invalid/);
});

test("turn-loss achievements require the recorded life loss and life total from one turn", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 4, won: false, achievementFacts: { largestLifeLossInTurn: 20, lifeAtLargestLossTurnStart: 40, lostHalfLifeInOneTurn: 1 } });
  let achievements = new Map((await history.summary(accountId)).achievements.map(achievement => [achievement.id, achievement]));
  assert.equal(achievements.get("half-the-story").rarity, "uncommon");
  assert.equal(achievements.has("one-turn-wipeout"), false);
  await history.saveGame(accountId, { tableSize: 4, won: false, achievementFacts: { largestLifeLossInTurn: 20, lifeAtLargestLossTurnStart: 20, lostHalfLifeInOneTurn: 1, lostAllLifeInOneTurn: 1 } });
  achievements = new Map((await history.summary(accountId)).achievements.map(achievement => [achievement.id, achievement]));
  assert.equal(achievements.get("one-turn-wipeout").rarity, "rare");
});

test("alternate outcome achievements require structured saved-game facts", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 4, won: false, achievementFacts: { wasMilledOut: 1 } });
  await history.saveGame(accountId, { tableSize: 4, won: true, achievementFacts: { millEliminations: 2, wonByFinalMillOut: 1, wonByDeclaredAlternateWin: 1 } });
  const achievements = new Map((await history.summary(accountId)).achievements.map(achievement => [achievement.id, achievement]));
  assert.equal(achievements.get("lost-in-the-stacks").rarity, "epic");
  assert.equal(achievements.get("last-chapter").rarity, "epic");
  assert.equal(achievements.get("library-burned").rarity, "legendary");
  assert.equal(achievements.get("alternate-reality").rarity, "epic");
  assert.equal(achievements.get("impossible-route").rarity, "legendary");
});

test("ordinary completed-game moments stay common or uncommon", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 8, won: true, achievementFacts: { reclaimedDuringGame: 1, turnsAfterReclaim: 2, lifeGained: 25, playerCountAtStart: 8, everyStarterTwoTurns: 1 }, counterTotals: { energy: 20, radiation: 10 } });
  const rarities = new Map((await history.summary(accountId)).achievements.map(achievement => [achievement.id, achievement.rarity]));
  ["full-pantry", "still-here", "irradiated-victory", "capacitor-discharge", "round-robin", "full-table", "eightfold-assembly"].forEach(id => assert.equal(rarities.get(id), "uncommon"));
});

test("expanded achievement pool recognizes tracked pod, recovery, counter, and commander-pressure moments", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 5, won: true, counterTotals: { poison: 9, energy: 50, radiation: 25 }, achievementFacts: { lifeGained: 150, lowestLife: 5, lifeGainedAfterLow: 25, playerCountAtStart: 6, everyStarterTwoTurns: 1, everyStarterThreeTurns: 1, everyOpponentCommanderAt10: 1 } });
  await history.saveGame(accountId, { tableSize: 7, won: true });
  const rarities = new Map((await history.summary(accountId)).achievements.map(achievement => [achievement.id, achievement.rarity]));
  ["fivefold-circle", "fivefold-crown", "seven-wonders", "seventh-crown", "second-lap", "six-around", "well-of-life", "high-voltage", "glowing-horizon", "under-siege", "no-quiet-corner", "miracle-work", "fountainhead", "ninth-dose"].forEach(id => assert.equal(rarities.has(id), true));
  assert.equal(rarities.get("fivefold-crown"), "uncommon");
  assert.equal(rarities.get("under-siege"), "rare");
  assert.equal(rarities.get("no-quiet-corner"), "epic");
  assert.equal(rarities.get("fountainhead"), "legendary");
});

test("poison achievements add only counters actually gained during saved games", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 4, won: false, poisonCounters: 999 }); assert.equal((await history.summary(accountId)).achievements.some(achievement => achievement.id === "poisoned-legend"), false);
  await history.saveGame(accountId, { tableSize: 4, won: false, poisonCounters: 1 }); assert.equal((await history.summary(accountId)).achievements.some(achievement => achievement.id === "poisoned-legend"), true);
});

test("counter chronicle chains use private per-game totals and preserve legacy poison saves", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 4, won: false, poisonCounters: 25 });
  await history.saveGame(accountId, { tableSize: 4, won: false, counterTotals: { energy: 100, radiation: 400, commanderDamage: 500 } });
  const summary = await history.summary(accountId); const ids = new Set(summary.achievements.map(item => item.id));
  assert.deepEqual(summary.counterTotals, { poison: 25, energy: 100, radiation: 400, commanderDamage: 500 });
  ["first-dose", "power-cell", "grid-connected", "fallout-shelter", "glow-up", "irradiated-veteran", "marked", "battle-scarred", "legend-scarred"].forEach(id => assert.equal(ids.has(id), true));
  assert.equal(ids.has("toxic-regular"), false); assert.equal(ids.has("living-battery"), false); assert.equal(ids.has("wasteland-legend"), false); assert.equal(ids.has("known-to-legends"), false);
});

test("table progression rewards completion and table variety without requiring a win", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  for (const tableSize of [2, 3, 4, 5, 6, 7, 8]) await history.saveGame(accountId, { tableSize, won: false });
  const ids = new Set((await history.summary(accountId)).achievements.map(item => item.id));
  ["duo-queue", "fourfold-arc", "crowded-table", "eightfold-assembly", "table-regular", "wide-table"].forEach(id => assert.equal(ids.has(id), true));
  assert.equal(ids.has("seasoned"), false);
});

test("recovery achievements require continued play after reclaiming a seat", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 4, won: false, achievementFacts: { reclaimedDuringGame: 1, actionsAfterReclaim: 3, turnsAfterReclaim: 2 } });
  const ids = new Set((await history.summary(accountId)).achievements.map(item => item.id));
  assert.equal(ids.has("back-at-the-table"), true);
  assert.equal(ids.has("still-here"), true);
});

test("shared-table and d20 achievements use only completed-game facts", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 4, won: false, achievementFacts: { tableGameNumber: 5, usedLocalD20: 1 } });
  const ids = new Set((await history.summary(accountId)).achievements.map(item => item.id));
  assert.equal(ids.has("run-it-back"), true);
  assert.equal(ids.has("table-trilogy"), true);
  assert.equal(ids.has("one-more-before-bed"), true);
  assert.equal(ids.has("dice-have-spoken"), true);
});

test("life achievement milestones reward recovery and close wins without requiring a loss", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 4, won: true, achievementFacts: { lowestLife: 1, actionsAfterLow: 1, lifeGainedAfterLow: 15, lifeGained: 75 } });
  const ids = new Set((await history.summary(accountId)).achievements.map(item => item.id));
  ["last-breath", "one-life-to-live", "full-pantry", "overflowing-cup", "phoenix-turn"].forEach(id => assert.equal(ids.has(id), true));
});

test("rare counter moments require values recorded in one completed game", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 5, won: true, counterTotals: { poison: 8, radiation: 10, energy: 20, commanderDamage: 1 }, achievementFacts: { commanderSourcesHit: 4 } });
  const ids = new Set((await history.summary(accountId)).achievements.map(item => item.id));
  ["legendary-welcome", "toxic-tenacity", "irradiated-victory", "capacitor-discharge", "all-systems-go"].forEach(id => assert.equal(ids.has(id), true));
});

test("saved decks retain one or two commanders as separate values", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: () => "pair" }); const accountId = await history.ensureAccount("subject");
  const deck = await history.createDeck(accountId, { commanderNames: ["Thrasios", "Tymna"], name: "Partners" });
  assert.deepEqual(deck.commanderNames, ["Thrasios", "Tymna"]);
  assert.equal(deck.commanderName, "Thrasios / Tymna");
  await assert.rejects(() => history.createDeck(accountId, { commanderNames: ["A", "B", "C"] }), /Commander names are invalid/);
});

test("saved decks retain private colors, notes, favorites, and account preferences", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: () => "details" }); const accountId = await history.ensureAccount("subject");
  const deck = await history.createDeck(accountId, { commanderName: "Alela", colors: ["W", "U", "B", "U"], notes: "Keep a land hand", favorite: true });
  assert.deepEqual(deck.colors, ["W", "U", "B"]); assert.equal(deck.notes, "Keep a land hand"); assert.equal(deck.favorite, true);
  await history.savePreferences(accountId, { preferredName: "Nia" });
  assert.deepEqual(await history.preferences(accountId), { preferredName: "Nia", defaultPlayerCount: 4, defaultRoundLimitMinutes: null, interfaceStyle: "button", personalSkinId: null, usePersonalSkin: false });
  const corrected = await history.updateDeck(accountId, deck.deckId, { commanderNames: ["Alela, Artful Provocateur"], name: "Faeries", colors: ["W", "U", "B"], notes: "Corrected name", favorite: false });
  assert.equal(corrected.commanderName, "Alela, Artful Provocateur"); assert.equal(corrected.name, "Faeries"); assert.equal(corrected.notes, "Corrected name");
  await history.updateDeck(accountId, deck.deckId, { archived: true, favorite: false });
  assert.equal((await history.decks(accountId)).length, 0);
  assert.equal((await history.decks(accountId, { includeArchived: true }))[0].archived, true);
});

test("account deletion removes the subject mapping and every saved account record", async () => {
  const store = new MemoryAccountHistoryStore(); const history = new AccountHistory({ store, createId: (() => { let id = 0; return () => String(++id); })() });
  const accountId = await history.ensureAccount("subject");
  const deck = await history.createDeck(accountId, { commanderName: "Alela" });
  await history.saveGame(accountId, { tableSize: 4, won: true, deckId: deck.deckId });
  assert.equal(await history.deleteAccount("subject"), true);
  assert.equal(await history.deleteAccount("subject"), false);
  const summary = await history.summary(accountId); assert.deepEqual({ gamesPlayed: summary.gamesPlayed, wins: summary.wins, winRate: summary.winRate, recentGames: summary.recentGames, games: summary.games, deckStats: summary.deckStats }, { gamesPlayed: 0, wins: 0, winRate: null, recentGames: [], games: [], deckStats: [] });
  assert.deepEqual(await history.decks(accountId), []);
  assert.notEqual(await history.ensureAccount("subject"), accountId);
});
