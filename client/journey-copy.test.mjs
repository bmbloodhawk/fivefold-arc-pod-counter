import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const app = await readFile(new URL('app.js', root), 'utf8');
const styles = await readFile(new URL('styles.css', root), 'utf8');

test('joining keeps optional commander setup out of the primary claim path', () => {
  assert.match(html, /Commander details \(optional — set later\)/);
  assert.match(html, /Claim this seat/);
  assert.doesNotMatch(html, /Preview join locally/);
});

test('joining explains the claimed-seat boundary and normalizes the join code', () => {
  assert.match(html, /id="joinSeatClaim"/);
  assert.match(app, /This phone will control only \$\{seat\}/);
  assert.match(app, /toUpperCase\(\)\.replace\(\/\[\^A-Z0-9\]\/g, ''\)/);
});

test('the host lobby makes sharing the primary next setup action', () => {
  assert.match(app, /Share code \$\{state\.podCode\}/);
});

test('saved tables and QR links return players to a pod without sharing seat credentials', () => {
  assert.match(html, /id="savedTables"/);
  assert.match(html, /Show join QR/);
  assert.match(html, /id="joinQrImage"/);
  assert.match(app, /SAVED_TABLES_KEY/);
  assert.match(app, /searchParams\.set\('join', state\.podCode\)/);
  assert.match(app, /join-qr\.svg/);
  assert.doesNotMatch(html, /reclaimToken/);
});

test('seat connection state remains a compact symbol at every pod size', () => {
  assert.doesNotMatch(styles, /seat-state::before \{ content: attr\(title\)/);
  assert.match(app, /stateSymbol = isWaiting \? '○' : isOffline \? '×'/);
});
