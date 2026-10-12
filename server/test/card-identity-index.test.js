import assert from "node:assert/strict";
import { test } from "node:test";
import { CardIdentityIndex, normalizeCardName } from "../src/card-identity-index.js";

const index = new CardIdentityIndex([
  { name: "Atraxa, Praetors’ Voice", colors: ["W", "U", "B", "G"] },
  { name: "Atraxa, Grand Unifier", colors: ["W", "U", "B", "G"] },
  { name: "K'rrik, Son of Yawgmoth", colors: ["B"] },
  { name: "The Ur-Dragon", colors: ["W", "U", "B", "R", "G"], aliases: ["Ur Dragon"] },
  { name: "Sol Ring", colors: [] },
]);

test("normalizes case, spacing, punctuation, and accents for local card identity lookup", () => {
  assert.equal(normalizeCardName("  K’rrik,  Son of Yawgmoth "), "k rrik son of yawgmoth");
  assert.deepEqual(index.lookup("K’rrik son of yawgmoth"), { kind: "exact", card: { name: "K'rrik, Son of Yawgmoth", colors: ["B"] } });
  assert.deepEqual(index.lookup("ur dragon"), { kind: "exact", card: { name: "The Ur-Dragon", colors: ["W", "U", "B", "R", "G"] } });
});

test("returns choices instead of applying partial or fuzzy card matches automatically", () => {
  const partial = index.lookup("atraxa");
  assert.equal(partial.kind, "selection");
  assert.deepEqual(partial.matches.map((card) => card.name), ["Atraxa, Grand Unifier", "Atraxa, Praetors’ Voice"]);
  const fuzzy = index.lookup("atraza grand unifier");
  assert.equal(fuzzy.kind, "selection");
  assert.equal(fuzzy.matches[0].name, "Atraxa, Grand Unifier");
});

test("keeps all named cards rather than filtering by commander eligibility", () => {
  assert.deepEqual(index.lookup("Sol Ring"), { kind: "exact", card: { name: "Sol Ring", colors: [] } });
});

test("rejects an unknown name without a network fallback", () => {
  assert.throws(() => index.lookup("Definitely Not A Magic Card"), { code: "COMMANDER_NOT_FOUND" });
});
