import { createHash } from "node:crypto";

const DAY = 86_400_000;
const RETENTION_MS = 30 * DAY;
const CLEANUP_INTERVAL_MS = 3_600_000;
const DEVICE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const DEVICE_KEY = /^[a-f0-9]{64}$/;

export function normalizedTableDeviceId(value) {
  return typeof value === "string" && DEVICE_ID.test(value) ? value.toLowerCase() : null;
}

function retainedData(raw, now) {
  if (raw == null) return null;
  if (raw.schemaVersion !== 1 || !raw.devices || typeof raw.devices !== "object" || Array.isArray(raw.devices)) {
    throw new Error("Device activity data is invalid");
  }
  const entries = Object.entries(raw.devices);
  const retained = entries.filter(([key, at]) => DEVICE_KEY.test(key) && Number.isSafeInteger(at) && at >= now - RETENTION_MS);
  return retained.length === entries.length ? raw : { ...raw, devices: Object.fromEntries(retained) };
}

// Records a browser's latest successful table entry, independently of gameplay.
export class TableDeviceActivity {
  constructor({ store = null, environment = "production", now = () => Date.now(), logger = console } = {}) {
    this.store = store;
    this.now = now;
    this.logger = logger;
    this.path = "developer-metrics/" + (environment === "staging" ? "staging" : "production") + "/table-devices-v1.json";
    this.pending = Promise.resolve();
    this.nextCleanupAt = 0;
    this.lastFailureAt = null;
  }

  queue(work) {
    this.pending = this.pending.then(work).catch(() => {
      this.lastFailureAt = this.now();
      this.logger.warn(JSON.stringify({ event: "table_device_activity_write_failed" }));
    });
  }

  record(value) {
    const id = normalizedTableDeviceId(value);
    if (!this.store || !id) return;
    const key = createHash("sha256").update(id).digest("hex");
    const at = this.now();
    this.queue(() => this.store.update(this.path, raw => {
      const current = retainedData(raw, at);
      return {
        schemaVersion: 1,
        collectionStartedAt: current?.collectionStartedAt ?? at,
        devices: {
          ...current?.devices,
          [key]: Math.max(current?.devices[key] ?? 0, at),
        },
      };
    }));
  }

  prune() {
    const at = this.now();
    if (!this.store || at < this.nextCleanupAt) return;
    this.nextCleanupAt = at + CLEANUP_INTERVAL_MS;
    this.queue(() => this.store.update(this.path, raw => retainedData(raw, at)));
  }

  async flush() { await this.pending; }

  async summary() {
    const asOf = this.now();
    if (!this.store) {
      return { configured: false, asOf, collectionStartedAt: null, collectionStatus: "unavailable", retentionDays: 30, counts: null };
    }
    await this.flush();
    const data = retainedData(await this.store.read(this.path), asOf);
    const visits = Object.values(data?.devices || {});
    return {
      configured: true,
      asOf,
      collectionStartedAt: data?.collectionStartedAt ?? null,
      collectionStatus: this.lastFailureAt == null ? "collecting" : "partial",
      retentionDays: 30,
      counts: {
        last24Hours: visits.filter(at => at >= asOf - DAY).length,
        last7Days: visits.filter(at => at >= asOf - 7 * DAY).length,
        last30Days: visits.length,
      },
    };
  }
}
