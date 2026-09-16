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
    if (input.deckId && !(await this.store.read(decksPath(accountId)))?.[input.deckId]) throw new TypeError("Deck is invalid");
    const games = (await this.store.read(gamesPath(accountId))) || {};
    const gameId = `game_${this.createId()}`;
    const game = { gameId, savedAt: this.now(), tableSize, won, place, outcomeDescription: text(input.outcomeDescription, 160), commanderName: text(input.commanderName, 120), deckId: input.deckId || null };
    await this.store.write(gamesPath(accountId), { ...games, [gameId]: game });
    return game;
  }

  async createDeck(accountId, input = {}) {
    const extra = Object.keys(input).find((key) => !["commanderName", "commanderNames", "name", "colors", "notes", "favorite"].includes(key));
    if (extra) throw new TypeError(`Deck field is not allowed: ${extra}`);
    const rawNames = input.commanderNames ?? [input.commanderName];
    if (!Array.isArray(rawNames) || rawNames.length < 1 || rawNames.length > 2) throw new TypeError("Commander names are invalid");
    const commanderNames = rawNames.map((value) => text(value, 120));
    if (commanderNames.some((name) => !name)) throw new TypeError("Commander name is required");
    const commanderName = commanderNames.join(" / ");
    const colors = Array.isArray(input.colors) ? [...new Set(input.colors)] : [];
    if (colors.some((color) => !["W", "U", "B", "R", "G"].includes(color))) throw new TypeError("Deck colors are invalid");
    if (input.favorite != null && typeof input.favorite !== "boolean") throw new TypeError("Favorite is invalid");
    const decks = (await this.store.read(decksPath(accountId))) || {}; const deckId = `deck_${this.createId()}`;
    const deck = { deckId, commanderName, commanderNames, name: text(input.name, 120), colors, notes: text(input.notes, 500), favorite: input.favorite === true, createdAt: this.now(), updatedAt: this.now() };
    await this.store.write(decksPath(accountId), { ...decks, [deckId]: deck }); return deck;
  }

  async decks(accountId) {
    return Object.values((await this.store.read(decksPath(accountId))) || {}).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
  }

  async preferences(accountId) { return (await this.store.read(accountPath(accountId)))?.preferences || { preferredName: null }; }

  async savePreferences(accountId, input = {}) {
    const extra = Object.keys(input).find((key) => key !== "preferredName"); if (extra) throw new TypeError(`Preference is not allowed: ${extra}`);
    const account = (await this.store.read(accountPath(accountId))) || { accountId, createdAt: this.now(), consentVersion: null };
    const preferences = { preferredName: text(input.preferredName, 24) };
    await this.store.write(accountPath(accountId), { ...account, preferences }); return preferences;
  }

  async removeGame(accountId, gameId) {
    if (!/^game_[A-Za-z0-9-]{1,80}$/.test(gameId || "")) throw new TypeError("Game is invalid");
    const games = (await this.store.read(gamesPath(accountId))) || {}; if (!games[gameId]) return false;
    delete games[gameId]; await this.store.write(gamesPath(accountId), games); return true;
  }

  async removeDeck(accountId, deckId) {
    if (!/^deck_[A-Za-z0-9-]{1,80}$/.test(deckId || "")) throw new TypeError("Deck is invalid");
    const decks = (await this.store.read(decksPath(accountId))) || {}; if (!decks[deckId]) return false;
    delete decks[deckId]; await this.store.write(decksPath(accountId), decks); return true;
  }

  async summary(accountId) {
    const games = Object.values((await this.store.read(gamesPath(accountId))) || {}).sort((a, b) => b.savedAt - a.savedAt);
    const wins = games.filter((game) => game.won).length;
    const deckStats = Object.values((await this.store.read(decksPath(accountId))) || {}).map(deck => { const deckGames = games.filter(game => game.deckId === deck.deckId); const deckWins = deckGames.filter(game => game.won).length; return { deckId: deck.deckId, name: deck.name || deck.commanderName, gamesPlayed: deckGames.length, wins: deckWins, winRate: deckGames.length ? deckWins / deckGames.length : null }; });
    const milestones = [{ label: "First saved game", reached: games.length >= 1 }, { label: "Ten games saved", reached: games.length >= 10 }, { label: "Five different decks", reached: new Set(games.map(game => game.deckId).filter(Boolean)).size >= 5 }];
    return { gamesPlayed: games.length, wins, winRate: games.length ? wins / games.length : null, recentGames: games.slice(0, 12), games, deckStats, milestones };
  }

  async export(accountId) {
    return { schemaVersion: 1, exportedAt: this.now(), history: await this.summary(accountId), decks: await this.decks(accountId), preferences: await this.preferences(accountId) };
  }

  async deleteAccount(providerSubject) {
    if (typeof providerSubject !== "string" || !providerSubject) throw new TypeError("Account subject is required");
    const mappingPath = `account-history/subjects/${subjectKey(providerSubject)}.json`;
    const mapping = await this.store.read(mappingPath);
    if (!mapping?.accountId) return false;
    await Promise.all([
      this.store.write(gamesPath(mapping.accountId), null),
      this.store.write(decksPath(mapping.accountId), null),
      this.store.write(accountPath(mapping.accountId), null),
      this.store.write(mappingPath, null),
    ]);
    return true;
  }
}
