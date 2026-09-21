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
  await history.saveGame(accountId, { tableSize: 4, won: false, achievementFacts: { tableGameNumber: 2, usedLocalD20: 1 } });
  const ids = new Set((await history.summary(accountId)).achievements.map(item => item.id));
  assert.equal(ids.has("run-it-back"), true);
  assert.equal(ids.has("dice-have-spoken"), true);
});

test("life achievement milestones reward recovery and close wins without requiring a loss", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore(), createId: (() => { let id = 0; return () => String(++id); })() }); const accountId = await history.ensureAccount("subject");
  await history.saveGame(accountId, { tableSize: 4, won: true, achievementFacts: { lowestLife: 1, actionsAfterLow: 1, lifeGainedAfterLow: 15, lifeGained: 75 } });
  const ids = new Set((await history.summary(accountId)).achievements.map(item => item.id));
  ["last-breath", "one-life-to-live", "full-pantry", "overflowing-cup", "phoenix-turn"].forEach(id => assert.equal(ids.has(id), true));
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
  assert.deepEqual(await history.preferences(accountId), { preferredName: "Nia", defaultPlayerCount: 4, defaultRoundLimitMinutes: null });
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
