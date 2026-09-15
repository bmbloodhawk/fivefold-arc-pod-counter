import { createHash, randomUUID } from "node:crypto";

const accountPath = (accountId) => `account-history/accounts/${encodeURIComponent(accountId)}.json`;
const gamesPath = (accountId) => `account-history/games/${encodeURIComponent(accountId)}.json`;
const decksPath = (accountId) => `account-history/decks/${encodeURIComponent(accountId)}.json`;
const subjectKey = (subject) => createHash("sha256").update(String(subject)).digest("hex");
const text = (value, max) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new TypeError("Text must be a string");
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (!normalized || [...normalized].length > max || /[\p{Cc}\p{Cf}]/u.test(normalized)) throw new TypeError("Text is invalid");
  return normalized;
};

export class MemoryAccountHistoryStore {
  constructor() { this.values = new Map(); }
  async read(path) { return this.values.get(path) ?? null; }
  async write(path, value) { this.values.set(path, value); }
}

// This works with the existing server-only Firebase client, whose read/write
// methods use service-account credentials and never expose them to a phone.
export class AccountHistory {
  constructor({ store, now = () => Date.now(), createId = () => randomUUID() } = {}) {
    if (!store?.read || !store?.write) throw new TypeError("Account history storage is required");
    this.store = store; this.now = now; this.createId = createId;
  }

  async ensureAccount(providerSubject) {
    if (typeof providerSubject !== "string" || !providerSubject) throw new TypeError("Account subject is required");
    const key = subjectKey(providerSubject); const mappingPath = `account-history/subjects/${key}.json`;
    const existing = await this.store.read(mappingPath);
    if (existing?.accountId) return existing.accountId;
    const accountId = `acct_${this.createId()}`;
    await this.store.write(mappingPath, { accountId });
    await this.store.write(accountPath(accountId), { accountId, createdAt: this.now(), consentVersion: null });
    return accountId;
  }

  async saveGame(accountId, input = {}) {
    const extra = Object.keys(input).find((key) => !["tableSize", "won", "place", "outcomeDescription", "commanderName", "deckId"].includes(key));
    if (extra) throw new TypeError(`Game field is not allowed: ${extra}`);
    const tableSize = Number(input.tableSize); const won = input.won === true;
    const place = input.place == null ? null : Number(input.place);
    if (!Number.isInteger(tableSize) || tableSize < 2 || tableSize > 8) throw new TypeError("Table size is invalid");
    if (place !== null && (!Number.isInteger(place) || place < 1 || place > tableSize)) throw new TypeError("Place is invalid");
    const games = (await this.store.read(gamesPath(accountId))) || {};
    const gameId = `game_${this.createId()}`;
    const game = { gameId, savedAt: this.now(), tableSize, won, place, outcomeDescription: text(input.outcomeDescription, 160), commanderName: text(input.commanderName, 120), deckId: input.deckId || null };
    await this.store.write(gamesPath(accountId), { ...games, [gameId]: game });
    return game;
  }

  async createDeck(accountId, input = {}) {
    const commanderName = text(input.commanderName, 120); if (!commanderName) throw new TypeError("Commander name is required");
    const decks = (await this.store.read(decksPath(accountId))) || {}; const deckId = `deck_${this.createId()}`;
    const deck = { deckId, commanderName, name: text(input.name, 120), createdAt: this.now(), updatedAt: this.now() };
    await this.store.write(decksPath(accountId), { ...decks, [deckId]: deck }); return deck;
  }

  async decks(accountId) {
    return Object.values((await this.store.read(decksPath(accountId))) || {}).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async summary(accountId) {
    const games = Object.values((await this.store.read(gamesPath(accountId))) || {}).sort((a, b) => b.savedAt - a.savedAt);
    const wins = games.filter((game) => game.won).length;
    return { gamesPlayed: games.length, wins, winRate: games.length ? wins / games.length : null, recentGames: games.slice(0, 12) };
  }
}
