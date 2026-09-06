import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FirebasePlaytestLedger } from "./playtest-ledger.js";

const emptyCatalog = () => ({ skins: [], assets: [], selected: "neutral" });
const normalizeCatalog = (value) => ({ skins: Array.isArray(value?.skins) ? value.skins : [], assets: Array.isArray(value?.assets) ? value.assets : [], selected: String(value?.selected || "neutral") });

export class AppearanceCatalog {
  constructor(path) { this.path = path; this.value = emptyCatalog(); }
  async read() { try { this.value = JSON.parse(await readFile(this.path, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; } return this.value; }
  async write(value) { this.value = normalizeCatalog(value); await mkdir(dirname(this.path), { recursive: true }); const temp = `${this.path}.tmp`; await writeFile(temp, JSON.stringify(this.value), "utf8"); await rename(temp, this.path); return this.value; }
  assetPath(id) { return join(dirname(this.path), "appearance-studio-assets", `${id}.json`); }
  async readAsset(id) { return JSON.parse(await readFile(this.assetPath(id), "utf8")); }
  async writeAsset(id, value) { const path = this.assetPath(id); await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp`; await writeFile(temp, JSON.stringify(value), "utf8"); await rename(temp, path); return value; }
  async deleteAsset(id) { try { await unlink(this.assetPath(id)); } catch (error) { if (error.code !== "ENOENT") throw error; } }
}

export class FirebaseAppearanceCatalog {
  constructor(options = {}) { this.client = options.client || new FirebasePlaytestLedger(options); }
  async read() { return normalizeCatalog(await this.client.read("appearance-studio/catalog.json")); }
  async write(value) { const catalog = normalizeCatalog(value); await this.client.write("appearance-studio/catalog.json", catalog); return catalog; }
  async readAsset(id) { return this.client.read(`appearance-studio/assets/${id}.json`); }
  async writeAsset(id, value) { await this.client.write(`appearance-studio/assets/${id}.json`, value); return value; }
  async deleteAsset(id) { await this.client.write(`appearance-studio/assets/${id}.json`, null); }
}

export function createAppearanceCatalogFromEnv({ env = process.env, path, client } = {}) {
  if (client || (env.FIREBASE_DATABASE_URL && env.FIREBASE_SERVICE_ACCOUNT_EMAIL && env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY)) return new FirebaseAppearanceCatalog({ databaseUrl: env.FIREBASE_DATABASE_URL, clientEmail: env.FIREBASE_SERVICE_ACCOUNT_EMAIL, privateKey: env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY, client });
  return new AppearanceCatalog(path);
}
