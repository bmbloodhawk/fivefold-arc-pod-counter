import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FirebasePlaytestLedger } from "./playtest-ledger.js";

export const APPEARANCE_CATALOG_SCHEMA_VERSION = 1;
const MAX_SKINS = 100;
const MAX_ASSETS = 250;
const MAX_SKIN_VERSIONS = 12;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const emptyCatalog = () => ({ schemaVersion: APPEARANCE_CATALOG_SCHEMA_VERSION, revision: 0, skins: [], assets: [], selected: "__neutral_arc__", gameDefaultLayout: null });
const requireRevision = (current, expected) => { if ((current?.revision ?? 0) !== expected) throw Object.assign(new Error('The appearance catalog changed. Reload it before saving.'), { status: 409, code: 'APPEARANCE_CONFLICT' }); };
export const sameAppearanceAssetContent = (left, right) => ['id', 'name', 'source', 'placement', 'data'].every(key => left?.[key] === right?.[key]);
const existingAssetOrNew = (current, next) => { if (!current) return next; if (sameAppearanceAssetContent(current, next)) return current; throw Object.assign(new TypeError('This asset ID already contains different artwork or metadata. Import it under a new ID.'), { status: 400, code: 'APPEARANCE_INVALID' }); };

// Catalog content is authored in the protected Studio, but it is still input.
// Preserve supported appearance fields verbatim for forward compatibility while
// rejecting malformed records before they become shared catalog state.
export function normalizeCatalog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyCatalog();
  if (value.schemaVersion != null && ![0, APPEARANCE_CATALOG_SCHEMA_VERSION].includes(value.schemaVersion)) throw Object.assign(new TypeError("Unsupported appearance catalog schema version; future catalogs are not downgraded."), { status: 400, code: "APPEARANCE_INVALID" });
  if (value.revision != null && (!Number.isSafeInteger(value.revision) || value.revision < 0)) throw Object.assign(new TypeError('Invalid appearance catalog revision.'), { status: 400, code: 'APPEARANCE_INVALID' });
  const skins = Array.isArray(value.skins) ? value.skins.filter(skin => skin && typeof skin === "object" && !Array.isArray(skin) && ID.test(String(skin.id || ""))).slice(0, MAX_SKINS).map(skin => {
    const versions = Array.isArray(skin.versions) ? skin.versions.filter(version => version && typeof version === "object" && !Array.isArray(version) && ID.test(String(version.id || "")) && version.appearance && typeof version.appearance === "object" && !Array.isArray(version.appearance)).slice(-MAX_SKIN_VERSIONS).map(version => {
      const appearance = { ...version.appearance };
      delete appearance.versions;
      return { id: String(version.id), label: typeof version.label === "string" ? version.label.slice(0, 80) : "Saved draft", savedAt: typeof version.savedAt === "string" ? version.savedAt.slice(0, 40) : "", appearance };
    }) : [];
    return versions.length ? { ...skin, versions } : { ...skin };
  }) : [];
  const assets = Array.isArray(value.assets) ? value.assets.filter(asset => asset && typeof asset === "object" && !Array.isArray(asset) && ID.test(String(asset.id || ""))).slice(0, MAX_ASSETS) : [];
  const selected = value.selected === '__neutral_arc__' ? '__neutral_arc__' : skins.some(skin => skin.id === value.selected) ? String(value.selected) : '__neutral_arc__';
  return {
    schemaVersion: APPEARANCE_CATALOG_SCHEMA_VERSION,
    revision: value.revision ?? 0,
    skins,
    assets,
    selected,
    gameDefaultLayout: value.gameDefaultLayout && typeof value.gameDefaultLayout === "object" && !Array.isArray(value.gameDefaultLayout) ? value.gameDefaultLayout : null
  };
}

export class AppearanceCatalog {
  constructor(path) { this.path = path; this.value = emptyCatalog(); }
  async read() { try { this.value = normalizeCatalog(JSON.parse(await readFile(this.path, "utf8"))); } catch (error) { if (error.code !== "ENOENT") throw error; } return this.value; }
  async write(value, { expectedRevision } = {}) { if (expectedRevision !== undefined) requireRevision(await this.read(), expectedRevision); const catalog = normalizeCatalog(value); await mkdir(dirname(this.path), { recursive: true }); const temp = `${this.path}.tmp`; await writeFile(temp, JSON.stringify(catalog), "utf8"); await rename(temp, this.path); this.value = catalog; return catalog; }
  assetPath(id) { if (typeof id !== 'string' || !ID.test(id)) throw new TypeError('Invalid appearance asset ID'); return join(dirname(this.path), "appearance-studio-assets", `${id}.json`); }
  async readAsset(id) { try { return JSON.parse(await readFile(this.assetPath(id), "utf8")); } catch (error) { if (error.code !== 'ENOENT') throw error; const embedded = (await this.read()).assets.find(asset => asset.id === id && asset.data); if (embedded) return embedded; throw error; } }
  async writeAsset(id, value, { createOnly = false } = {}) { if (createOnly) { let current; try { current = await this.readAsset(id); } catch (error) { if (error.code !== 'ENOENT') throw error; } const next = existingAssetOrNew(current, value); if (current) return next; } const path = this.assetPath(id); await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp`; await writeFile(temp, JSON.stringify(value), "utf8"); await rename(temp, path); return value; }
  async deleteAsset(id) { try { await unlink(this.assetPath(id)); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}

export class FirebaseAppearanceCatalog {
  constructor(options = {}) { this.client = options.client || new FirebasePlaytestLedger(options); }
  async read() { return normalizeCatalog(await this.client.read("appearance-studio/catalog.json")); }
  async write(value, { expectedRevision } = {}) {
    const catalog = normalizeCatalog(value);
    if (expectedRevision !== undefined && typeof this.client.update === 'function') return this.client.update('appearance-studio/catalog.json', current => { requireRevision(current, expectedRevision); return catalog; });
    if (expectedRevision !== undefined) requireRevision(await this.read(), expectedRevision);
    await this.client.write("appearance-studio/catalog.json", catalog); return catalog;
  }
  async readAsset(id) { const asset = await this.client.read(`appearance-studio/assets/${id}.json`); if (asset) return asset; return (await this.read()).assets.find(item => item.id === id && item.data) || null; }
  async writeAsset(id, value, { createOnly = false } = {}) { const path = `appearance-studio/assets/${id}.json`; if (createOnly && typeof this.client.update === 'function') return this.client.update(path, current => existingAssetOrNew(current, value)); if (createOnly) { const current = await this.readAsset(id); const next = existingAssetOrNew(current, value); if (current) return next; } await this.client.write(path, value); return value; }
  async deleteAsset(id) { await this.client.write(`appearance-studio/assets/${id}.json`, null); }
}

export function createAppearanceCatalogFromEnv({ env = process.env, path, client } = {}) {
  if (client || (env.FIREBASE_DATABASE_URL && env.FIREBASE_SERVICE_ACCOUNT_EMAIL && env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY)) return new FirebaseAppearanceCatalog({ databaseUrl: env.FIREBASE_DATABASE_URL, clientEmail: env.FIREBASE_SERVICE_ACCOUNT_EMAIL, privateKey: env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY, client });
  return new AppearanceCatalog(path);
}
