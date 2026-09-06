import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export class AppearanceCatalog {
  constructor(path) { this.path = path; this.value = { skins: [], assets: [], selected: "neutral" }; }
  async read() { try { this.value = JSON.parse(await readFile(this.path, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; } return this.value; }
  async write(value) { this.value = { skins: Array.isArray(value?.skins) ? value.skins : [], assets: Array.isArray(value?.assets) ? value.assets : [], selected: String(value?.selected || "neutral") }; await mkdir(dirname(this.path), { recursive: true }); const temp = `${this.path}.tmp`; await writeFile(temp, JSON.stringify(this.value), "utf8"); await rename(temp, this.path); return this.value; }
}
