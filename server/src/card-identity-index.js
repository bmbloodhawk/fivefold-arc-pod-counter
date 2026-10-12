import { readFile } from "node:fs/promises";

const MAX_SUGGESTIONS = 5;

export function normalizeCardName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function compact(value) { return normalizeCardName(value).replaceAll(" ", ""); }

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function publicCard(card) { return { name: card.name, colors: [...card.colors] }; }

export class CardIdentityIndex {
  constructor(cards = []) {
    this.cards = cards
      .filter((card) => typeof card?.name === "string" && Array.isArray(card?.colors))
      .map((card) => ({
        name: card.name,
        colors: [...new Set(card.colors)].filter((color) => ["W", "U", "B", "R", "G"].includes(color)),
        keys: [...new Set([card.name, ...(Array.isArray(card.aliases) ? card.aliases : [])].map(normalizeCardName).filter(Boolean))],
      }));
    this.exact = new Map();
    this.buckets = new Map();
    for (const card of this.cards) for (const key of card.keys) {
      const matches = this.exact.get(key) || [];
      matches.push(card);
      this.exact.set(key, matches);
      for (const term of [...key.split(" "), compact(key)]) {
        const bucketKey = term.slice(0, 2);
        if (bucketKey.length < 2) continue;
        const bucket = this.buckets.get(bucketKey) || new Set();
        bucket.add(card);
        this.buckets.set(bucketKey, bucket);
      }
    }
  }

  lookup(value) {
    const query = normalizeCardName(value);
    if (!query) throw Object.assign(new Error("A commander name is required"), { status: 400, code: "INVALID_INPUT" });
    const exact = this.exact.get(query) || [];
    if (exact.length === 1) return { kind: "exact", card: publicCard(exact[0]) };
    const queryWords = query.split(" ");
    const candidates = this.#candidates(queryWords);
    const prefix = candidates.filter((card) => card.keys.some((key) => queryWords.every((word) => key.split(" ").some((candidate) => candidate.startsWith(word)))));
    const ranked = (prefix.length ? prefix.sort((left, right) => left.name.localeCompare(right.name)) : this.#fuzzy(query))
      .slice(0, MAX_SUGGESTIONS)
      .map(publicCard);
    if (ranked.length) return { kind: "selection", matches: ranked };
    throw Object.assign(new Error("No local card match was found. Check the spelling, choose colors manually, or keep without colors."), { status: 404, code: "COMMANDER_NOT_FOUND" });
  }

  #candidates(queryWords) {
    const pools = queryWords
      .map((word) => this.buckets.get(word.slice(0, 2)))
      .filter(Boolean)
      .sort((left, right) => left.size - right.size);
    return pools.length ? [...pools[0]] : [];
  }

  #fuzzy(query) {
    const target = compact(query);
    if (target.length < 4) return [];
    return this.#candidates(query.split(" "))
      .map((card) => ({
        card,
        distance: Math.min(...card.keys.flatMap((key) => [compact(key), ...key.split(" ")]).map((candidate) => levenshtein(target, candidate))),
        comparisonLength: Math.min(...card.keys.flatMap((key) => [compact(key), ...key.split(" ")]).map((candidate) => candidate.length)),
      }))
      .filter(({ distance, comparisonLength }) => distance / Math.max(target.length, comparisonLength) <= 0.28)
      .sort((left, right) => left.distance - right.distance || left.card.name.localeCompare(right.card.name))
      .map(({ card }) => card);
  }
}

export async function loadCardIdentityIndex(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(value?.cards) || !value.cards.length) throw new Error("Local card identity index is missing or empty.");
  return new CardIdentityIndex(value.cards);
}

export function createLocalCommanderIdentityLookup(index) {
  return async (name) => index.lookup(name);
}
