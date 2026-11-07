import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRealtimeServer, RoomService } from '../server/src/app.js';

const sampleCount = 200;
const ackTargetMs = 500;
const peerTargetMs = 2_000;
let phase = 'server startup';

class ProbeRoomService extends RoomService {
  beforeFanout = null;
  slowFanout = false;
  failAdjustment = false;

  adjustOwnSeat(...args) {
    if (this.failAdjustment) throw new Error('Injected loopback adjustment failure');
    this.applyStartedAt = performance.now();
    return super.adjustOwnSeat(...args);
  }

  broadcast(room) {
    this.beforeFanout?.(room.version, performance.now());
    if (this.slowFanout) {
      setTimeout(() => super.broadcast(room), peerTargetMs + 100);
      return;
    }
    super.broadcast(room);
  }
}

function percentiles(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const at = fraction => Math.round(sorted[Math.ceil(fraction * sorted.length) - 1] * 100) / 100;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

async function releaseAssets(baseUrl) {
  async function text(path) {
    const response = await fetch(baseUrl + path);
    assert.equal(response.status, 200, 'Expected asset could not be fetched');
    return response.text();
  }
  const [html, worker] = await Promise.all([text('/'), text('/sw.js')]);
  const app = html.match(/src="(app\.js\?v=\d+)"/)?.[1];
  const styles = html.match(/href="(styles\.css\?v=\d+)"/)?.[1];
  const cache = worker.match(/const CACHE = '(fivefold-arc-v\d+)'/)?.[1];
  assert.ok(app && styles && cache, 'Expected versioned app, stylesheet and cache');
  const appSource = await text(`/${app}`);
  const realtime = appSource.match(/from '\.\/(realtime\.js\?v=\d+)'/)?.[1];
  const batcher = appSource.match(/from '\.\/(life-adjustment-batcher\.js\?v=\d+)'/)?.[1];
  assert.ok(realtime && batcher, 'Expected versioned realtime and life batching modules');
  await Promise.all([realtime, batcher, styles].map(path => text(`/${path}`)));
  for (const path of [app, realtime, batcher, styles]) assert.ok(worker.includes(`'./${path}'`), 'Worker shell asset differs from entry');
  return { app, styles, realtime, batcher, cache };
}

async function main() {
  const service = new ProbeRoomService();
  const staticDir = fileURLToPath(new URL('../client/', import.meta.url));
  const { server } = createRealtimeServer({ service, staticDir, appEnv: 'staging', feedbackPortalKey: '' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  // The existing QA adapter reads this once at import. Always override any remote target.
  process.env.QA_BASE_URL = baseUrl;
  const deadline = setTimeout(() => { server.close(); server.closeAllConnections(); }, 15_000);
  let stream;
  try {
    const { createPod, claimSeat, reclaimSeat, openSnapshotStream, roomAction, snapshot } = await import('./blackbox/adapter.mjs');
    phase = 'health and versioned assets';
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    const assets = await releaseAssets(baseUrl);
    phase = 'table setup and initial stream';
    const host = await createPod({ playerCount: 2 });
    const peer = await claimSeat(host.podId, 1);
    await roomAction(host.podId, host.connectionId, 'start-game', { baseVersion: peer.snapshot.version });
    const adjust = (body, connectionId = host.connectionId) => roomAction(host.podId, connectionId, 'adjust', body, { raw: true });
    stream = await openSnapshotStream(host.podId, peer.connectionId);
    let current = await stream.next();
    const activity = () => ({ ...service.developerActivity(), openStreams: service.streamKeepalives.size });
    const online = activity();
    assert.equal(online.openStreams, 1);

    async function measure(body) {
      let confirmedAt;
      const version = current.version + 1;
      service.beforeFanout = (actualVersion, at) => { if (actualVersion === version) confirmedAt = at; };
      const startedAt = performance.now();
      const [ack, received] = await Promise.all([
        adjust(body).then(response => ({ response, at: performance.now() })),
        stream.next('snapshot', 5_000).then(state => ({ state, at: performance.now() })),
      ]);
      assert.equal(ack.response.status, 200, 'Valid adjustment failed');
      assert.equal(ack.response.body.snapshot.version, version, 'Version did not advance once');
      assert.equal(received.state.seats[0].counters.life, current.seats[0].counters.life + body.delta, 'Peer life differs from accepted adjustment');
      assert.deepEqual(received.state, ack.response.body.snapshot, 'Peer snapshot differs from HTTP confirmation');
      assert.ok(Number.isFinite(confirmedAt) && confirmedAt >= startedAt && confirmedAt <= received.at, 'Missing or out-of-order server timestamp');
      current = received.state;
      return {
        requestToAck: ack.at - startedAt,
        serverApplyToConfirmation: confirmedAt - service.applyStartedAt,
        confirmationToSseReceipt: received.at - confirmedAt,
        requestToSseReceipt: received.at - startedAt,
      };
    }

    phase = '200 accepted adjustments and peer convergence';
    const timings = [];
    let body;
    for (let index = 0; index < sampleCount; index += 1) {
      body = { counter: 'life', delta: index % 2 === 0 ? -1 : 1, operationId: randomUUID() };
      timings.push(await measure(body));
    }
    phase = 'same-operation replay';
    const duplicate = await adjust(body);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.deduplicated, true);
    assert.deepEqual(await snapshot(host.podId), current);

    phase = 'induced slow fanout';
    service.slowFanout = true;
    const delayed = await measure({ ...body, delta: -1, operationId: randomUUID() });
    service.slowFanout = false;
    assert.ok(delayed.confirmationToSseReceipt >= peerTargetMs, 'Injected delay did not cross the peer target');

    phase = 'stream disconnect and authoritative reclaim';
    await stream.close();
    for (let retries = 0; retries < 50 && service.streamKeepalives.size; retries += 1) await sleep(20);
    const disconnected = activity();
    assert.equal(disconnected.openStreams, 0);
    assert.equal(disconnected.activePlayers, online.activePlayers);
    const missed = await adjust({ ...body, delta: 1, operationId: randomUUID() });
    assert.equal(missed.status, 200);
    const reclaimStart = performance.now();
    const replacement = await reclaimSeat(host.podId, 1, peer.reclaimToken);
    stream = await openSnapshotStream(host.podId, replacement.connectionId);
    const recovered = await stream.next();
    const reclaimMs = performance.now() - reclaimStart;
    assert.deepEqual(recovered, await snapshot(host.podId), 'Reclaim did not restore authoritative state');
    assert.equal(recovered.seats[0].counters.life, missed.body.snapshot.seats[0].counters.life);
    phase = 'stale authority and injected server failure';
    const rejected = await adjust({ ...body, operationId: randomUUID() }, peer.connectionId);
    assert.equal(rejected.status, 403, 'Old seat authority was not revoked');
    service.failAdjustment = true;
    const failed = await adjust({ ...body, operationId: randomUUID() });
    assert.equal(failed.status, 500);
    assert.deepEqual(await snapshot(host.podId), recovered);

    const latencyMs = Object.fromEntries(Object.keys(timings[0]).map(name => [name, percentiles(timings.map(sample => sample[name]))]));
    console.log(JSON.stringify({
      environment: 'loopback protocol probe, sequential, two seats',
      generatedAt: new Date().toISOString(),
      health: health.status,
      assets,
      activity: { online, disconnected, reclaimed: activity() },
      adjustments: { baseline: { attempted: sampleCount, confirmedAndDelivered: timings.length }, deduplicated: 1, deliberateOldOwnerRejection: rejected.status, injectedFailure: failed.status },
      latencyMs,
      referenceComparison: { ackP95Under500Ms: latencyMs.requestToAck.p95 < ackTargetMs },
      injectedDelay: { requestToAckMs: Math.round(delayed.requestToAck), confirmationToSseReceiptMs: Math.round(delayed.confirmationToSseReceipt), crossedTwoSecondReference: true },
      reclaim: { attempted: 1, matchedAuthoritativeState: 1, ms: Math.round(reclaimMs * 100) / 100 },
      resources: { combinedServerAndProbeRssMiB: Math.round(process.memoryUsage.rss() / 1_048_576) },
      unmeasured: ['browser paint and layout', 'installed service worker state', 'device and carrier recovery', 'external dependencies', 'production saturation'],
    }, null, 2));
  } finally {
    clearTimeout(deadline);
    await stream?.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}

main().catch(() => {
  console.error(`Loopback reliability probe failed during ${phase}. Run the black-box suite locally to isolate the failing step.`);
  process.exitCode = 1;
});
