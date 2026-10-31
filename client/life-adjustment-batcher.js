export function compatibleOperationId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

export class LifeAdjustmentBatcher {
  constructor({ delayMs = 500, send, operationId = compatibleOperationId, schedule = setTimeout, cancel = clearTimeout } = {}) { this.delayMs = delayMs; this.send = send; this.operationId = operationId; this.schedule = schedule; this.cancel = cancel; this.delta = 0; this.timer = null; }
  add(delta) { this.delta += delta; if (this.timer) this.cancel(this.timer); this.timer = this.schedule(() => { this.timer = null; void this.flush(); }, this.delayMs); return this.delta; }
  async flush() { if (!this.delta) return null; const delta = this.delta; this.delta = 0; return this.send({ delta, operationId: this.operationId() }); }
  clear() { if (this.timer) this.cancel(this.timer); this.timer = null; this.delta = 0; }
}
