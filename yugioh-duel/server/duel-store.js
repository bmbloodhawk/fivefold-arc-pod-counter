import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class FileDuelStore {
  constructor(path) { this.path = path; }
  load() { if (!existsSync(this.path)) return []; try { const payload = JSON.parse(readFileSync(this.path, "utf8")); return Array.isArray(payload.rooms) ? payload.rooms : []; } catch { return []; } }
  save(rooms) { mkdirSync(dirname(this.path), { recursive: true }); const next = `${this.path}.next`; writeFileSync(next, JSON.stringify({ version: 1, rooms }), "utf8"); renameSync(next, this.path); }
}

export class MemoryDuelStore {
  constructor(rooms = []) { this.rooms = rooms; }
  load() { return structuredClone(this.rooms); }
  save(rooms) { this.rooms = structuredClone(rooms); }
}
