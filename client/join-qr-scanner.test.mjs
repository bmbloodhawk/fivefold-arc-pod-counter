import assert from 'node:assert/strict';
import test from 'node:test';
import { podCodeFromQr } from './join-qr-scanner.js';

test('a QR scan accepts only a pod code or a Fivefold Arc join parameter', () => {
  assert.equal(podCodeFromQr('arc7k2'), 'ARC7K2');
  assert.equal(podCodeFromQr('https://example.test/?join=ARC7K2'), 'ARC7K2');
  assert.equal(podCodeFromQr('https://example.test/?join=not-a-pod'), null);
  assert.equal(podCodeFromQr('untrusted value'), null);
});
