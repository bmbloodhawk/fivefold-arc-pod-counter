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

const achievementsFor = ({ games, decks, bestWinStreak, monthCount, playedColors }) => {
  const wins = games.filter(game => game.won);
  const tableSizes = new Set(games.map(game => game.tableSize));
  const deckGames = new Map(); games.filter(game => game.deckId).forEach(game => deckGames.set(game.deckId, (deckGames.get(game.deckId) || 0) + 1));
  const deckWins = new Set(wins.filter(game => game.deckId).map(game => game.deckId));
  const definitions = [
    ['account-awakened', 'Account Awakened', 'Created your Fivefold Arc profile.', true],
    ['first-chronicle', 'First Chronicle', 'Saved your first completed game.', games.length >= 1],
    ['first-crown', 'First Crown', 'Recorded your first victory.', wins.length >= 1],
    ['duelist', 'Duelist', 'Won a two-player game.', wins.some(game => game.tableSize === 2)],
    ['pod-victor', 'Pod Victor', 'Won a game with four or more players.', wins.some(game => game.tableSize >= 4)],
    ['full-table', 'Full Table', 'Won a game with six or more players.', wins.some(game => game.tableSize >= 6)],
    ['table-regular', 'Table Regular', 'Saved ten completed games.', games.length >= 10],
    ['seasoned', 'Seasoned', 'Saved twenty-five completed games.', games.length >= 25],
    ['enduring-legend', 'Enduring Legend', 'Saved one hundred completed games.', games.length >= 100],
    ['hot-streak', 'Hot Streak', 'Won three games in a row.', bestWinStreak >= 3],
    ['unstoppable', 'Unstoppable', 'Won five games in a row.', bestWinStreak >= 5],
    ['mythic-run', 'Mythic Run', 'Won eight games in a row.', bestWinStreak >= 8],
    ['trusted-blade', 'Trusted Blade', 'Saved ten games with the same deck.', [...deckGames.values()].some(count => count >= 10)],
    ['armory', 'Full Armory', 'Won with three different saved decks.', deckWins.size >= 3],
    ['color-wheel', 'Color Wheel', 'Played every color identity.', ['W', 'U', 'B', 'R', 'G'].every(color => playedColors.has(color))],
    ['wide-table', 'Across the Table', 'Played at every table size from two through eight.', [2, 3, 4, 5, 6, 7, 8].every(size => tableSizes.has(size))],
    ['month-regular', 'Monthly Ritual', 'Saved three games in one month.', monthCount >= 3],
    ['near-crown', 'Near Crown', 'Recorded second place five times.', games.filter(game => game.place === 2).length >= 5],
    ['ten-crowns', 'Ten Crowns', 'Recorded ten victories.', wins.length >= 10],
    ['fifty-crowns', 'Fifty Crowns', 'Recorded fifty victories.', wins.length >= 50],
    ['poisoned-legend', 'Poisoned Legend', 'Received 1,000 poison counters across saved games.', games.reduce((total, game) => total + (game.poisonCounters || 0), 0) >= 1000],
  ];
  return definitions.filter(([, , , reached]) => reached).map(([id, title, detail]) => ({ id, title, detail }));
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
    const extra = Object.keys(input).find((key) => !["tableSize", "won", "place", "outcomeDescription", "commanderName", "deckId", "poisonCounters", "sourceGameId"].includes(key));
    if (extra) throw new TypeError(`Game field is not allowed: ${extra}`);
    const tableSize = Number(input.tableSize); const won = input.won === true;
    const place = input.place == null ? null : Number(input.place);
    if (!Number.isInteger(tableSize) || tableSize < 2 || tableSize > 8) throw new TypeError("Table size is invalid");
    if (place !== null && (!Number.isInteger(place) || place < 1 || place > tableSize)) throw new TypeError("Place is invalid");
    if (input.deckId && !(await this.store.read(decksPath(accountId)))?.[input.deckId]) throw new TypeError("Deck is invalid");
    const games = (await this.store.read(gamesPath(accountId))) || {};
    const sourceGameId = text(input.sourceGameId, 120);
    if (sourceGameId) {
      const existing = Object.values(games).find((game) => game.sourceGameId === sourceGameId);
      if (existing) return existing;
    }
    const gameId = `game_${this.createId()}`;
    const poisonCounters = input.poisonCounters == null ? 0 : Number(input.poisonCounters); if (!Number.isInteger(poisonCounters) || poisonCounters < 0 || poisonCounters > 9999) throw new TypeError("Poison counters are invalid");
    const game = { gameId, savedAt: this.now(), tableSize, won, place, outcomeDescription: text(input.outcomeDescription, 160), commanderName: text(input.commanderName, 120), deckId: input.deckId || null, poisonCounters, ...(sourceGameId ? { sourceGameId } : {}) };
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

  async decks(accountId, { includeArchived = false } = {}) {
    return Object.values((await this.store.read(decksPath(accountId))) || {}).filter(deck => includeArchived || !deck.archived).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
  }

  async updateDeck(accountId, deckId, input = {}) {
    if (!/^deck_[A-Za-z0-9-]{1,80}$/.test(deckId || "")) throw new TypeError("Deck is invalid");
    const decks = (await this.store.read(decksPath(accountId))) || {}; const deck = decks[deckId]; if (!deck) throw new TypeError("Deck is invalid");
    const extra = Object.keys(input).find(key => !["favorite", "archived", "commanderNames", "name", "colors", "notes"].includes(key)); if (extra) throw new TypeError(`Deck field is not allowed: ${extra}`);
    if (input.favorite != null && typeof input.favorite !== "boolean" || input.archived != null && typeof input.archived !== "boolean") throw new TypeError("Deck update is invalid");
    const commanderNames = input.commanderNames === undefined ? deck.commanderNames : input.commanderNames.map(value => text(value, 120));
    if (!Array.isArray(commanderNames) || commanderNames.length < 1 || commanderNames.length > 2 || commanderNames.some(name => !name)) throw new TypeError("Commander names are invalid");
    const colors = input.colors === undefined ? deck.colors : [...new Set(input.colors)];
    if (!Array.isArray(colors) || colors.some(color => !["W", "U", "B", "R", "G"].includes(color))) throw new TypeError("Deck colors are invalid");
    const updated = { ...deck, ...input, commanderNames, commanderName: commanderNames.join(" / "), colors, ...(input.name !== undefined ? { name: text(input.name, 120) } : {}), ...(input.notes !== undefined ? { notes: text(input.notes, 500) } : {}), updatedAt: this.now() }; await this.store.write(decksPath(accountId), { ...decks, [deckId]: updated }); return updated;
  }

  async preferences(accountId) { return (await this.store.read(accountPath(accountId)))?.preferences || { preferredName: null, defaultPlayerCount: 4, defaultRoundLimitMinutes: null }; }

  async savePreferences(accountId, input = {}) {
    const extra = Object.keys(input).find((key) => !["preferredName", "defaultPlayerCount", "defaultRoundLimitMinutes"].includes(key)); if (extra) throw new TypeError(`Preference is not allowed: ${extra}`);
    const account = (await this.store.read(accountPath(accountId))) || { accountId, createdAt: this.now(), consentVersion: null };
    const defaultPlayerCount = input.defaultPlayerCount == null ? 4 : Number(input.defaultPlayerCount); const defaultRoundLimitMinutes = input.defaultRoundLimitMinutes == null || input.defaultRoundLimitMinutes === "" ? null : Number(input.defaultRoundLimitMinutes);
    if (!Number.isInteger(defaultPlayerCount) || defaultPlayerCount < 2 || defaultPlayerCount > 8) throw new TypeError("Default player count is invalid");
    if (defaultRoundLimitMinutes !== null && (!Number.isInteger(defaultRoundLimitMinutes) || defaultRoundLimitMinutes < 1 || defaultRoundLimitMinutes > 999)) throw new TypeError("Default round limit is invalid");
    const preferences = { preferredName: text(input.preferredName, 24), defaultPlayerCount, defaultRoundLimitMinutes };
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
    const chronologicalGames = [...games].reverse(); let bestWinStreak = 0; let currentWinStreak = 0; chronologicalGames.forEach(game => { currentWinStreak = game.won ? currentWinStreak + 1 : 0; bestWinStreak = Math.max(bestWinStreak, currentWinStreak); });
    const thisMonth = new Date(this.now()); const monthGames = games.filter(game => { const date = new Date(game.savedAt); return date.getFullYear() === thisMonth.getFullYear() && date.getMonth() === thisMonth.getMonth(); });
    const decks = Object.values((await this.store.read(decksPath(accountId))) || {}); const playedColors = new Set(decks.filter(deck => games.some(game => game.deckId === deck.deckId)).flatMap(deck => deck.colors || []));
    const achievements = achievementsFor({ games, decks, bestWinStreak, monthCount: monthGames.length, playedColors });
    return { gamesPlayed: games.length, wins, winRate: games.length ? wins / games.length : null, recentGames: games.slice(0, 12), games, deckStats, achievements, thisMonth: { gamesPlayed: monthGames.length, wins: monthGames.filter(game => game.won).length } };
  }

  async export(accountId) {
    return { schemaVersion: 1, exportedAt: this.now(), history: await this.summary(accountId), decks: await this.decks(accountId, { includeArchived: true }), preferences: await this.preferences(accountId) };
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
