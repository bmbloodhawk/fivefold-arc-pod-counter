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
    { gameId: "game_2", savedAt: 20, tableSize: 4, won: true, place: 1, outcomeDescription: "Combat damage", commanderName: "Alela", deckId: null },
    { gameId: "game_3", savedAt: 20, tableSize: 4, won: false, place: null, outcomeDescription: null, commanderName: null, deckId: null },
  ] });
  assert.equal(summary.games.length, 2);
  assert.equal(summary.milestones[0].reached, true);
});

test("account history rejects room details and unrecorded placement data", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore() }); const accountId = await history.ensureAccount("subject");
  await assert.rejects(() => history.saveGame(accountId, { tableSize: 4, won: true, place: 5 }), /Place is invalid/);
  await assert.rejects(() => history.saveGame(accountId, { tableSize: 4, won: true, roomCode: "PRIVATE" }), /Text|invalid|allowed/);
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
