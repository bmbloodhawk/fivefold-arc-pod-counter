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
