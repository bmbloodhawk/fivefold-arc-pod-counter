import assert from 'node:assert/strict';
import test from 'node:test';
import { JoinQrScanner, podCodeFromQr } from './join-qr-scanner.js';

test('a QR scan accepts only a pod code or a Fivefold Arc join parameter', () => {
  assert.equal(podCodeFromQr('arc7k2'), 'ARC7K2');
  assert.equal(podCodeFromQr('https://example.test/?join=ARC7K2'), 'ARC7K2');
  assert.equal(podCodeFromQr('https://example.test/?join=not-a-pod'), null);
  assert.equal(podCodeFromQr('untrusted value'), null);
});

test('the QR scanner retries without a camera-facing constraint after an Android-style invocation failure', async () => {
  const requested = [];
  const stream = { getTracks: () => [] };
  const mediaDevices = {
    async getUserMedia(constraints) {
      requested.push(constraints);
      if (requested.length === 1) {
        const error = new TypeError('Illegal invocation');
        throw error;
      }
      return stream;
    },
  };
  const video = { srcObject: null, videoWidth: 0, videoHeight: 0, play: async () => {} };
  const scanner = new JoinQrScanner({ mediaDevices, decoder: () => null, requestFrame: () => 1, cancelFrame: () => {} });

  await scanner.start(video, () => {});

  assert.deepEqual(requested, [
    { audio: false, video: { facingMode: { ideal: 'environment' } } },
    { audio: false, video: true },
  ]);
  assert.equal(video.srcObject, stream);
  scanner.stop(video);
});

test('the QR scanner retries with the default camera when rear-camera selection is overconstrained', async () => {
  const requested = [];
  const stream = { getTracks: () => [] };
  const mediaDevices = {
    async getUserMedia(constraints) {
      requested.push(constraints);
      if (requested.length === 1) {
        const error = new Error('Rear camera unavailable');
        error.name = 'OverconstrainedError';
        throw error;
      }
      return stream;
    },
  };
  const video = { srcObject: null, videoWidth: 0, videoHeight: 0, play: async () => {} };
  const scanner = new JoinQrScanner({ mediaDevices, decoder: () => null, requestFrame: () => 1, cancelFrame: () => {} });

  await scanner.start(video, () => {});

  assert.deepEqual(requested, [
    { audio: false, video: { facingMode: { ideal: 'environment' } } },
    { audio: false, video: true },
  ]);
  assert.equal(video.srcObject, stream);
  scanner.stop(video);
});

test('the QR scanner releases the camera when embedded video playback cannot start', async () => {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped += 1; } }] };
  const mediaDevices = { async getUserMedia() { return stream; } };
  const video = {
    srcObject: null,
    videoWidth: 0,
    videoHeight: 0,
    play: async () => { throw new Error('Unable to play media.'); },
  };
  const scanner = new JoinQrScanner({ mediaDevices, decoder: () => null, requestFrame: () => 1, cancelFrame: () => {} });

  await assert.rejects(() => scanner.start(video, () => {}), /Unable to play media/);

  assert.equal(stopped, 1);
  assert.equal(video.srcObject, null);
});

test('the QR scanner can read a native camera photo when live preview is unavailable', async () => {
  const imageReader = async () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]), width: 1, height: 1 });
  const scanner = new JoinQrScanner({ decoder: () => ({ data: 'arc7k2' }), imageReader });

  assert.equal(await scanner.scanImageFile({}), 'ARC7K2');
});

function mockGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

test('the default frame callbacks run with their browser receiver', async t => {
  const scheduled = [];
  const cancelled = [];
  mockGlobal(t, 'requestAnimationFrame', function (callback) {
    assert.ok(this === globalThis);
    scheduled.push(callback);
    return 7;
  });
  mockGlobal(t, 'cancelAnimationFrame', function (frame) {
    assert.ok(this === globalThis);
    cancelled.push(frame);
  });
  const stream = { getTracks: () => [] };
  const mediaDevices = { async getUserMedia() { return stream; } };
  const video = { srcObject: null, play: async () => {} };
  const scanner = new JoinQrScanner({ mediaDevices, decoder: () => null });

  await scanner.start(video, () => {});
  assert.equal(scheduled.length, 1);
  scanner.stop(video);
  assert.deepEqual(cancelled, [7]);
});

test('the photo fallback draws the image into a bounded canvas before decoding', async t => {
  let hasPhoto = false;
  const blank = new Uint8ClampedArray([0, 0, 0, 0]);
  const photoPixel = new Uint8ClampedArray([255, 255, 255, 255]);
  const canvas = {
    getContext: () => ({
      drawImage() { hasPhoto = true; },
      getImageData() { return { data: hasPhoto ? photoPixel : blank }; },
    }),
  };
  mockGlobal(t, 'document', { createElement: () => canvas });
  mockGlobal(t, 'Image', class {
    naturalWidth = 4032;
    naturalHeight = 3024;
    set src(_url) { this.onload(); }
  });
  const decoder = data => data === photoPixel ? { data: 'https://example.test/?join=ARC7K2' } : null;
  const scanner = new JoinQrScanner({ decoder });

  assert.equal(await scanner.scanImageFile(new Blob()), 'ARC7K2');
  assert.equal(canvas.width, 2048);
  assert.equal(canvas.height, 1536);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function cameraFixture() {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const video = { srcObject: null, videoWidth: 0, videoHeight: 0, play: async () => {} };
  return { stream, video, stopped: () => stopped };
}

test('the shared scanner accepts a custom QR parser for live frames and photos', async t => {
  const camera = cameraFixture(), callbacks = [], found = [], parsed = [];
  camera.video.videoWidth = 1; camera.video.videoHeight = 1;
  mockGlobal(t, 'document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) }) }) });
  const scanner = new JoinQrScanner({
    mediaDevices: { getUserMedia: async () => camera.stream }, decoder: () => ({ data: 'private-invite' }),
    parseCode: raw => { parsed.push(raw); return raw === 'private-invite' ? 'validated-pod-invite' : null; },
    requestFrame: callback => { callbacks.push(callback); return callbacks.length; }, cancelFrame() {},
    imageReader: async () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
  });
  await scanner.start(camera.video, code => found.push(code));
  callbacks[0]();
  assert.deepEqual(found, ['validated-pod-invite']);
  assert.equal(camera.stopped(), 1);
  assert.equal(camera.video.srcObject, null);
  assert.equal(await scanner.scanImageFile({}), 'validated-pod-invite');
  assert.deepEqual(parsed, ['private-invite', 'private-invite']);
});

test('Pod scanners can offer paste-link fallback without changing Table scanner defaults', async () => {
  const fallbackText = 'Paste the Pod invite link instead.';
  const noCamera = new JoinQrScanner({ mediaDevices: {}, decoder: () => null, fallbackText });
  await assert.rejects(() => noCamera.start({}, () => {}), /Paste the Pod invite link instead\./);
  const noDecoder = new JoinQrScanner({ mediaDevices: { getUserMedia() {} }, decoder: null, fallbackText });
  await assert.rejects(() => noDecoder.start({}, () => {}), /Paste the Pod invite link instead\./);
  await assert.rejects(() => noDecoder.scanImageFile({}), /Paste the Pod invite link instead\./);
  await assert.rejects(() => new JoinQrScanner({ mediaDevices: {} }).start({}, () => {}), /Enter the six-character pod code instead\./);
});

test('closing a scanner before camera permission resolves stops late tracks and never attaches them', async () => {
  const capture = deferred(), camera = cameraFixture(), frames = [];
  const scanner = new JoinQrScanner({ mediaDevices: { getUserMedia: () => capture.promise }, decoder: () => null,
    requestFrame: callback => { frames.push(callback); return 1; }, cancelFrame() {} });
  const start = scanner.start(camera.video, () => assert.fail('A closed scanner emitted a QR'));
  scanner.stop(camera.video);
  capture.resolve(camera.stream); await start;
  assert.equal(camera.stopped(), 1);
  assert.equal(camera.video.srcObject, null);
  assert.equal(frames.length, 0);
});

test('closing during a constrained camera request does not open a fallback camera', async () => {
  const capture = deferred(); let requested = 0;
  const scanner = new JoinQrScanner({ mediaDevices: { getUserMedia() { requested++; return capture.promise; } }, decoder: () => null });
  const start = scanner.start({}, () => {});
  scanner.stop(); capture.reject(new TypeError('Illegal invocation')); await start;
  assert.equal(requested, 1);
});

test('overlapping starts stop a late old stream without disturbing the current camera', async () => {
  const first = deferred(), second = deferred(), old = cameraFixture(), current = cameraFixture(); let requested = 0;
  const frames = [];
  const scanner = new JoinQrScanner({ mediaDevices: { getUserMedia() { return requested++ === 0 ? first.promise : second.promise; } }, decoder: () => null,
    requestFrame: callback => { frames.push(callback); return frames.length; }, cancelFrame() {} });
  const pendingOld = scanner.start(old.video, () => {});
  const pendingCurrent = scanner.start(current.video, () => {});
  second.resolve(current.stream); await pendingCurrent;
  first.resolve(old.stream); await pendingOld;
  assert.equal(old.stopped(), 1); assert.equal(current.stopped(), 0);
  assert.equal(old.video.srcObject, null); assert.equal(current.video.srcObject, current.stream);
  assert.equal(frames.length, 1);
  scanner.stop(current.video); assert.equal(current.stopped(), 1);
});

test('closing during video playback prevents frame scheduling and releases the stream once', async () => {
  const camera = cameraFixture(), playback = deferred(), attached = deferred(), frames = [];
  camera.video.play = () => { attached.resolve(); return playback.promise; };
  const scanner = new JoinQrScanner({ mediaDevices: { getUserMedia: async () => camera.stream }, decoder: () => null,
    requestFrame: callback => { frames.push(callback); return 1; }, cancelFrame() {} });
  const pending = scanner.start(camera.video, () => {}); await attached.promise;
  scanner.stop(camera.video); playback.resolve(); await pending;
  assert.equal(camera.stopped(), 1); assert.equal(camera.video.srcObject, null); assert.equal(frames.length, 0);
});

test('a failed old playback cannot stop a newer stream using the same video element', async () => {
  const old = cameraFixture(), current = cameraFixture(), playback = deferred(), attached = deferred(); let requests = 0;
  const video = old.video;
  video.play = () => { attached.resolve(); return playback.promise; };
  const scanner = new JoinQrScanner({ mediaDevices: { getUserMedia: async () => requests++ === 0 ? old.stream : current.stream },
    decoder: () => null, requestFrame: () => 1, cancelFrame() {} });
  const first = scanner.start(video, () => {}); await attached.promise;
  video.play = async () => {};
  await scanner.start(video, () => {});
  playback.reject(new Error('Old playback failed')); await first;
  assert.equal(old.stopped(), 1); assert.equal(current.stopped(), 0); assert.equal(video.srcObject, current.stream);
  scanner.stop(video); assert.equal(current.stopped(), 1);
});

test('closing while a photo is decoded discards its result', async () => {
  const pixels = deferred();
  const scanner = new JoinQrScanner({ decoder: () => ({ data: 'ABC123' }), imageReader: () => pixels.promise });
  const pending = scanner.scanImageFile({});
  scanner.stop(); pixels.resolve({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
  assert.equal(await pending, null);
});
