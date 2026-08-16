import assert from 'node:assert/strict';

const baseUrl = (process.env.QA_BASE_URL || '').replace(/\/$/, '');
export const enabled = Boolean(baseUrl);

async function request(path, { method = 'GET', connectionId, body, expected = 200, raw = false } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(connectionId ? { 'x-connection-id': connectionId } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }
  if (raw) return { status: response.status, body: payload };
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${text}`);
  return payload;
}

export async function newConnection() {
  return request('/api/connections', { method: 'POST', expected: 201 });
}

export async function createPodWithConnection(connectionId, {
  playerCount,
  startingLife = 40,
  commanderCount = 1,
  name,
  expected = 201,
  raw = false,
}) {
  const result = await request('/api/rooms', {
    method: 'POST', connectionId, expected, raw,
    body: { playerCount, startingLife, commanderCount, ...(name === undefined ? {} : { name }) },
  });
  if (raw) return result;
  return {
    podId: result.snapshot.code,
    connectionId,
    reclaimToken: result.reclaimToken,
    snapshot: result.snapshot,
  };
}

export async function createPod({ playerCount, startingLife = 40, commanderCount = 1, name, expected = 201, raw = false }) {
  const connection = await newConnection();
  const result = await createPodWithConnection(connection.connectionId, {
    playerCount, startingLife, commanderCount, name, expected, raw,
  });
  if (raw) return { ...result, connectionId: connection.connectionId };
  return result;
}

export async function claimSeat(podId, seatId, { commanderCount, name, expected = 200, raw = false } = {}) {
  const connection = await newConnection();
  const result = await request(`/api/rooms/${podId}/claim`, {
    method: 'POST', connectionId: connection.connectionId, expected, raw,
    body: { seatId, ...(commanderCount === undefined ? {} : { commanderCount }), ...(name === undefined ? {} : { name }) },
  });
  return { ...result, connectionId: connection.connectionId };
}

export async function reclaimSeat(podId, seatId, reclaimToken, { commanderCount, name, expected = 200, raw = false } = {}) {
  const connection = await newConnection();
  const result = await request(`/api/rooms/${podId}/claim`, {
    method: 'POST', connectionId: connection.connectionId, expected, raw,
    body: { seatId, reclaimToken, ...(commanderCount === undefined ? {} : { commanderCount }), ...(name === undefined ? {} : { name }) },
  });
  return { ...result, connectionId: connection.connectionId };
}

export async function snapshot(podId) {
  return (await request(`/api/rooms/${podId}`)).snapshot;
}

export async function mutate(podId, connectionId, mutation, { expected = 200, raw = false } = {}) {
  return request(`/api/rooms/${podId}/me`, {
    method: 'PATCH', connectionId, expected, raw, body: mutation,
  });
}

// Commander casts are absolute, owner-scoped values. Keeping the protocol
// shape here prevents UI-style top-level maps or increment commands from
// leaking into behavioral tests.
export async function setCommanderCastCounts(
  podId,
  connectionId,
  baseVersion,
  commanderCastCounts,
  options = {},
) {
  return mutate(podId, connectionId, { baseVersion, commanderCastCounts }, options);
}

export async function resetPod(podId, connectionId, baseVersion, { expected = 200 } = {}) {
  return request(`/api/rooms/${podId}/reset`, {
    method: 'POST', connectionId, expected, body: { baseVersion },
  });
}

export async function openSnapshotStream(podId, connectionId) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/rooms/${podId}/events?connectionId=${encodeURIComponent(connectionId)}`, {
    headers: { accept: 'text/event-stream' }, signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  async function next(eventName = 'snapshot', timeoutMs = 3000) {
    const timeout = setTimeout(() => controller.abort(new Error('SSE event timeout')), timeoutMs);
    try {
      while (true) {
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const type = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
          const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (type === eventName) return JSON.parse(data);
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('SSE stream ended before expected event');
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    next,
    async close() {
      controller.abort();
      try { await reader.cancel(); } catch { /* already aborted */ }
    },
  };
}

// Minimal dependency-free SSE reader. It resolves with the next named event and
// aborts its fetch, making it suitable for snapshot convergence assertions.
export async function nextEvent(podId, connectionId, eventName = 'snapshot', timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('SSE event timeout')), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/rooms/${podId}/events?connectionId=${encodeURIComponent(connectionId)}`, {
      headers: { accept: 'text/event-stream' }, signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('SSE stream ended before expected event');
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const type = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
        const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (type === eventName) return JSON.parse(data);
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
