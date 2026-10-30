function clone(value) { return value == null ? value : structuredClone(value); }

function validateRoom(room) {
  if (!room || room.schemaVersion !== 1 || !/^[A-Z0-9]{6}$/.test(room.code || "") || !Number.isInteger(room.version) || room.version < 1) {
    throw new Error("Invalid durable room record");
  }
}

export class MemoryRoomStore {
  constructor() { this.rooms = new Map(); }

  async read(code) { return clone(this.rooms.get(String(code).toUpperCase()) || null); }

  async create(room) {
    validateRoom(room);
    const code = room.code.toUpperCase();
    if (this.rooms.has(code)) throw Object.assign(new Error("Room already exists"), { code: "ROOM_EXISTS" });
    this.rooms.set(code, clone(room));
    return clone(room);
  }

  async compareAndSwap(code, expectedVersion, nextRoom) {
    validateRoom(nextRoom);
    const normalized = String(code).toUpperCase();
    const current = this.rooms.get(normalized) || null;
    if (!current || current.version !== expectedVersion) return { committed: false, room: clone(current) };
    this.rooms.set(normalized, clone(nextRoom));
    return { committed: true, room: clone(nextRoom) };
  }

  async delete(code, expectedVersion) {
    const normalized = String(code).toUpperCase();
    const current = this.rooms.get(normalized) || null;
    if (!current || current.version !== expectedVersion) return { deleted: false, room: clone(current) };
    this.rooms.delete(normalized);
    return { deleted: true, room: null };
  }

  async verifyAccess() { return true; }
}

export class FirebaseRoomStore {
  constructor({ databaseUrl, accessToken, fetchImpl = fetch } = {}) {
    this.databaseUrl = String(databaseUrl || "").replace(/\/$/, "");
    this.accessToken = accessToken;
    this.fetch = fetchImpl;
  }

  #url(code) { return `${this.databaseUrl}/live-rooms/${encodeURIComponent(String(code).toUpperCase())}.json`; }

  async #headers(extra = {}) {
    const token = await this.accessToken();
    return { authorization: `Bearer ${token}`, ...extra };
  }

  async #readWithTag(code) {
    const response = await this.fetch(this.#url(code), { headers: await this.#headers({ "x-firebase-etag": "true" }) });
    if (!response.ok) throw new Error(`Firebase room read failed (${response.status})`);
    return { room: await response.json(), tag: response.headers.get("etag") };
  }

  async read(code) { return (await this.#readWithTag(code)).room; }

  async create(room) {
    validateRoom(room);
    const result = await this.compareAndSwap(room.code, null, room);
    if (!result.committed) throw Object.assign(new Error("Room already exists"), { code: "ROOM_EXISTS" });
    return result.room;
  }

  async compareAndSwap(code, expectedVersion, nextRoom) {
    validateRoom(nextRoom);
    const { room: current, tag } = await this.#readWithTag(code);
    if ((current?.version ?? null) !== expectedVersion) return { committed: false, room: current };
    const response = await this.fetch(this.#url(code), {
      method: "PUT",
      headers: await this.#headers({ "content-type": "application/json", "if-match": tag || "null_etag" }),
      body: JSON.stringify(nextRoom),
    });
    const room = await response.json();
    if (response.status === 412) return { committed: false, room };
    if (!response.ok) throw new Error(`Firebase room write failed (${response.status})`);
    return { committed: true, room };
  }

  async delete(code, expectedVersion) {
    const { room: current, tag } = await this.#readWithTag(code);
    if (!current || current.version !== expectedVersion) return { deleted: false, room: current };
    const response = await this.fetch(this.#url(code), {
      method: "PUT",
      headers: await this.#headers({ "content-type": "application/json", "if-match": tag || "null_etag" }),
      body: "null",
    });
    const room = await response.json();
    if (response.status === 412) return { deleted: false, room };
    if (!response.ok) throw new Error(`Firebase room delete failed (${response.status})`);
    return { deleted: true, room: null };
  }

  async verifyAccess() {
    await this.#readWithTag("__room_store_probe__");
    return true;
  }
}
