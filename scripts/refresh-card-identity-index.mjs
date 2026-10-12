import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourceUrl = "https://mtgjson.com/api/v5/AtomicCards.json";
const checksumUrl = `${sourceUrl}.sha256`;
const outputPath = resolve("server/static-data/card-identity-index.json");

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim().replace(/\s+/gu, " ");
}

const [sourceResponse, checksumResponse] = await Promise.all([fetch(sourceUrl), fetch(checksumUrl)]);
if (!sourceResponse.ok || !checksumResponse.ok) throw new Error(`MTGJSON download failed (${sourceResponse.status}/${checksumResponse.status}).`);
const source = Buffer.from(await sourceResponse.arrayBuffer());
const expected = (await checksumResponse.text()).trim().split(/\s+/u)[0].toLowerCase();
const actual = createHash("sha256").update(source).digest("hex");
if (!/^[a-f0-9]{64}$/u.test(expected) || actual !== expected) throw new Error("MTGJSON checksum verification failed.");
const payload = JSON.parse(source.toString("utf8"));
const byName = new Map();
for (const [key, candidates] of Object.entries(payload?.data || {})) {
  for (const card of Array.isArray(candidates) ? candidates : []) {
    const name = String(card?.name || key || "").trim();
    const normalized = normalize(name);
    if (!normalized) continue;
    const colors = [...new Set((Array.isArray(card.colorIdentity) ? card.colorIdentity : []).filter((color) => ["W", "U", "B", "R", "G"].includes(color)))].sort((left, right) => "WUBRG".indexOf(left) - "WUBRG".indexOf(right));
    const existing = byName.get(normalized) || { name, colors, aliases: new Set() };
    existing.aliases.add(name);
    if (card.asciiName) existing.aliases.add(String(card.asciiName));
    byName.set(normalized, existing);
  }
}
const cards = [...byName.values()]
  .map((card) => ({ name: card.name, colors: card.colors, aliases: [...card.aliases].filter((alias) => normalize(alias) !== normalize(card.name)).sort() }))
  .sort((left, right) => left.name.localeCompare(right.name));
let existing = null;
try { existing = JSON.parse(await readFile(outputPath, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
if (JSON.stringify(existing?.cards || []) === JSON.stringify(cards)) {
  console.log(`Local card identities are already current (${cards.length} cards).`);
  process.exit(0);
}
const output = { source: "MTGJSON AtomicCards", sourceUrl, generatedAt: new Date().toISOString(), sourceSha256: actual, cards };
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`, "utf8");
console.log(`Wrote ${cards.length} local card identities to ${outputPath}.`);
