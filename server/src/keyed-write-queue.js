// FIFO per Table, with a fixed number of independent Tables writing at once.
// This bounds in-flight work, not the backlog. No admitted job is discarded.
export class KeyedWriteQueue {
  #lanes = new Map();
  #ready = [];
  #pending = new Set();
  #active = 0;
  #concurrency;

  constructor({ concurrency = 8 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('Write concurrency must be 1–32.');
    this.#concurrency = concurrency;
  }

  enqueue(key, operation) {
    if (typeof key !== 'string' || !key) throw new Error('A write key is required.');
    if (typeof operation !== 'function') throw new Error('A write function is required.');
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    this.#pending.add(promise);
    // Retain the caller's rejection while keeping flush and ignored diagnostics safe.
    promise.then(() => this.#pending.delete(promise), () => this.#pending.delete(promise));
    let lane = this.#lanes.get(key);
    if (!lane) {
      lane = { key, jobs: [] };
      this.#lanes.set(key, lane); this.#ready.push(lane);
    }
    lane.jobs.push({ operation, resolve, reject });
    this.#pump();
    return promise;
  }

  async flush() { await Promise.allSettled([...this.#pending]); }

  #pump() {
    while (this.#active < this.#concurrency && this.#ready.length) {
      const lane = this.#ready.shift(), job = lane.jobs.shift();
      this.#active++;
      const finish = () => {
        this.#active--;
        if (lane.jobs.length) this.#ready.push(lane);
        else this.#lanes.delete(lane.key);
        this.#pump();
      };
      Promise.resolve().then(job.operation).then(
        value => { finish(); job.resolve(value); },
        error => { finish(); job.reject(error); },
      );
    }
  }
}
