export function compatibleOperationId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

export class LifeAdjustmentBatcher {
  constructor({ delayMs = 500, send, operationId = compatibleOperationId, schedule = setTimeout, cancel = clearTimeout } = {}) { this.delayMs = delayMs; this.send = send; this.operationId = operationId; this.schedule = schedule; this.cancel = cancel; this.delta = 0; this.metadata = {}; this.timer = null; }
  add(delta, metadata = {}) {
    if (this.delta && JSON.stringify(this.metadata) !== JSON.stringify(metadata)) void this.flush();
    this.delta += delta; this.metadata = metadata;
    if (this.timer) this.cancel(this.timer);
    this.timer = this.schedule(() => { this.timer = null; void this.flush(); }, this.delayMs);
    return this.delta;
  }
  async flush() {
    if (this.timer) this.cancel(this.timer);
    this.timer = null;
    if (!this.delta) return null;
    const delta = this.delta; const metadata = this.metadata;
    this.delta = 0; this.metadata = {};
    return this.send({ delta, operationId: this.operationId(), ...metadata });
  }
  clear() { if (this.timer) this.cancel(this.timer); this.timer = null; this.delta = 0; this.metadata = {}; }
}
