import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

const BOUNDS = Object.freeze([1, 5, 10, 25, 50, 100, 150, 200, 250, 500, 1000, 2000, 5000]);
function histogram() {
  let count = 0, maxMs = 0, counts = Array(BOUNDS.length + 1).fill(0);
  return {
    add(duration) {
      const ms = Math.max(0, duration); count++; maxMs = Math.max(maxMs, ms);
      const bucket = BOUNDS.findIndex(bound => ms <= bound); counts[bucket < 0 ? BOUNDS.length : bucket]++;
    },
    take() {
      const result = { count, upperBoundsMs: BOUNDS, counts, maxMs: Number(maxMs.toFixed(2)) };
      count = 0; maxMs = 0; counts = Array(BOUNDS.length + 1).fill(0); return result;
    },
  };
}

// Numeric, fixed-size staging diagnostics. Never retain keys, payloads or errors.
// No extra storage request, body read, retry, scheduling delay or altered receipt.
export function monitorCounterWrites(ledger, { appEnv = 'production', logger = console, clock = () => performance.now(), intervalMs = 60000 } = {}) {
  if (appEnv !== 'staging' || typeof ledger?.writeQueue?.enqueue !== 'function' || typeof ledger.writeWithRetry !== 'function') {
    return { enabled: false, emit: () => null, stop() {} };
  }
  const queue = ledger.writeQueue, originalEnqueue = queue.enqueue, originalWrite = ledger.writeWithRetry, originalFetch = ledger.fetch;
  const timings = { queueWait: histogram(), jobWork: histogram(), storageWork: histogram(), writeFetchHeaders: histogram() };
  let pending = 0, active = 0, peakPending = 0, failedJobs = 0, failedStorageOperations = 0;
  let statuses = { ok: 0, rateLimited: 0, serverError: 0, otherHttpError: 0, networkError: 0 };
  let windowStart = clock(), stopped = false;

  function trackedEnqueue(key, operation) {
    // Preserve the queue's original synchronous input validation.
    if (typeof key !== 'string' || !key || typeof operation !== 'function') return originalEnqueue.call(this, key, operation);
    const admitted = clock(); pending++; peakPending = Math.max(peakPending, pending);
    try {
      return originalEnqueue.call(this, key, async () => {
        const began = clock(); active++; timings.queueWait.add(began - admitted);
        try { return await operation(); }
        catch (error) { failedJobs++; throw error; }
        finally { timings.jobWork.add(clock() - began); active--; pending--; }
      });
    } catch (error) { pending--; throw error; }
  }
  async function trackedWrite(...args) {
    const began = clock();
    try { return await originalWrite.apply(this, args); }
    catch (error) { failedStorageOperations++; throw error; }
    finally { timings.storageWork.add(clock() - began); }
  }
  async function trackedFetch(url, options) {
    let tracked = false;
    try {
      const path = new URL(url).pathname;
      tracked = ['PUT', 'PATCH'].includes(options?.method) && (path === '/.json' || path.startsWith('/recovery/') || path.startsWith('/playtests/'));
    } catch { /* Invalid requests retain fetch's original error. */ }
    if (!tracked) return originalFetch.call(this, url, options);
    const began = clock();
    try {
      const response = await originalFetch.call(this, url, options);
      if (response.ok) statuses.ok++;
      else if (response.status === 429) statuses.rateLimited++;
      else if (response.status >= 500) statuses.serverError++;
      else statuses.otherHttpError++;
      return response;
    } catch (error) { statuses.networkError++; throw error; }
    finally { timings.writeFetchHeaders.add(clock() - began); }
  }
  queue.enqueue = trackedEnqueue; ledger.writeWithRetry = trackedWrite;
  if (typeof originalFetch === 'function') ledger.fetch = trackedFetch;

  function emit() {
    const ended = clock();
    const row = { event: 'staging_counter_write_window', entryPoint: 'server_boot', windowId: randomUUID(),
      windowMs: Number(Math.max(0, ended - windowStart).toFixed(2)),
      gauges: { pending, active, waiting: pending - active, peakPending }, failedJobs, failedStorageOperations,
      writeStatuses: statuses, timings: Object.fromEntries(Object.entries(timings).map(([name, value]) => [name, value.take()])) };
    windowStart = ended; peakPending = pending; failedJobs = 0; failedStorageOperations = 0;
    statuses = { ok: 0, rateLimited: 0, serverError: 0, otherHttpError: 0, networkError: 0 };
    try { logger.log(JSON.stringify(row)); } catch { /* Telemetry cannot break a save. */ }
    return row;
  }
  const timer = setInterval(emit, intervalMs); timer.unref();
  return { enabled: true, emit, stop() {
    if (stopped) return; stopped = true; clearInterval(timer); emit();
    if (queue.enqueue === trackedEnqueue) queue.enqueue = originalEnqueue;
    if (ledger.writeWithRetry === trackedWrite) ledger.writeWithRetry = originalWrite;
    if (ledger.fetch === trackedFetch) ledger.fetch = originalFetch;
  } };
}
