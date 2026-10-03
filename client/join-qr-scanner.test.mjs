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
