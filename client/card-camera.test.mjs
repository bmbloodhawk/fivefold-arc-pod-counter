import assert from 'node:assert/strict';
import test from 'node:test';
import { CardCameraSession } from './card-camera.js';

test('card camera requests the rear camera and releases it when closed', async () => {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const mediaDevices = { getUserMedia: async constraints => { assert.deepEqual(constraints, { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } }); return { getTracks: () => [track] }; } };
  const video = { srcObject: null, play: async () => {} };
  const camera = new CardCameraSession(mediaDevices);
  await camera.start(video);
  assert.ok(video.srcObject);
  camera.stop(video);
  assert.equal(track.stopped, true);
  assert.equal(video.srcObject, null);
});

test('card camera captures only an in-memory frame', () => {
  const camera = new CardCameraSession();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => assert.equal(args.length, 5) }), toDataURL: () => 'data:image/jpeg;base64,local-only' };
  assert.equal(camera.capture({ videoWidth: 320, videoHeight: 448 }, canvas), 'data:image/jpeg;base64,local-only');
  assert.equal(canvas.width, 320);
  assert.equal(canvas.height, 448);
});

test('card text reading stays on-device when the browser supports it', async () => {
  const original = globalThis.TextDetector;
  globalThis.TextDetector = class { async detect() { return [{ rawValue: 'Lightning Bolt' }, { rawValue: 'Instant' }]; } };
  try { assert.deepEqual(await new CardCameraSession().readText({}), ['Lightning Bolt', 'Instant']); }
  finally { globalThis.TextDetector = original; }
});
