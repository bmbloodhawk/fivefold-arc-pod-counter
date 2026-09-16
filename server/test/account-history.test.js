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
  assert.deepEqual(await history.summary(accountId), { gamesPlayed: 2, wins: 1, winRate: .5, recentGames: [
    { gameId: "game_2", savedAt: 20, tableSize: 4, won: true, place: 1, outcomeDescription: "Combat damage", commanderName: "Alela", deckId: null },
    { gameId: "game_3", savedAt: 20, tableSize: 4, won: false, place: null, outcomeDescription: null, commanderName: null, deckId: null },
  ] });
});

test("account history rejects room details and unrecorded placement data", async () => {
  const history = new AccountHistory({ store: new MemoryAccountHistoryStore() }); const accountId = await history.ensureAccount("subject");
  await assert.rejects(() => history.saveGame(accountId, { tableSize: 4, won: true, place: 5 }), /Place is invalid/);
  await assert.rejects(() => history.saveGame(accountId, { tableSize: 4, won: true, roomCode: "PRIVATE" }), /Text|invalid|allowed/);
});

test("account deletion removes the subject mapping and every saved account record", async () => {
  const store = new MemoryAccountHistoryStore(); const history = new AccountHistory({ store, createId: (() => { let id = 0; return () => String(++id); })() });
  const accountId = await history.ensureAccount("subject");
  const deck = await history.createDeck(accountId, { commanderName: "Alela" });
  await history.saveGame(accountId, { tableSize: 4, won: true, deckId: deck.deckId });
  assert.equal(await history.deleteAccount("subject"), true);
  assert.equal(await history.deleteAccount("subject"), false);
  assert.deepEqual(await history.summary(accountId), { gamesPlayed: 0, wins: 0, winRate: null, recentGames: [] });
  assert.deepEqual(await history.decks(accountId), []);
  assert.notEqual(await history.ensureAccount("subject"), accountId);
});
