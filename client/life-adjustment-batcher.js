export function compatibleOperationId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

export class LifeAdjustmentBatcher {
  constructor({
    delayMs = 500,
    send,
    operationId = compatibleOperationId,
    schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
    cancel = timer => globalThis.clearTimeout(timer),
  } = {}) {
    this.delayMs = delayMs;
    this.send = send;
    this.operationId = operationId;
    this.schedule = schedule;
    this.cancel = cancel;
    this.delta = 0;
    this.timer = null;
    this.generation = 0;
    this.pending = null;
  }
  add(delta) {
    this.delta += delta;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = this.schedule(() => { this.timer = null; void this.flush(); }, this.delayMs);
    return this.delta;
  }
  flush() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    if (!this.delta) return Promise.resolve(null);
    let remaining = this.delta;
    this.delta = 0;
    const generation = this.generation;
    const sendBatch = async () => {
      let result = null;
      try {
        while (remaining && generation === this.generation) {
          // Each server adjustment is limited to ±999. Preserve the full net
          // input instead of clamping it, with a separate retry ID per chunk.
          const delta = Math.sign(remaining) * Math.min(999, Math.abs(remaining));
          result = await this.send({ delta, operationId: this.operationId() });
          if (generation !== this.generation) return result;
          if (result?.blocked || result?.locked || result?.ignored || result?.local || result?.failed) {
            this.clear();
            return result;
          }
          remaining -= delta;
        }
        return result;
      } catch (error) {
        // The transport owns retries. Never replay an uncertain remainder or
        // let a late failure discard inputs from a newer table/session.
        if (generation === this.generation) this.clear();
        throw error;
      }
    };
    const pending = this.pending ? this.pending.catch(() => {}).then(sendBatch) : sendBatch();
    this.pending = pending;
    const release = () => { if (this.pending === pending) this.pending = null; };
    void pending.then(release, release);
    return pending;
  }
  clear() {
    this.generation++;
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
    this.delta = 0;
  }
}
