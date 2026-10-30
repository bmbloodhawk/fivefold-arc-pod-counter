import assert from 'node:assert/strict';
import test from 'node:test';
import { clearLastActiveTable, readLastActiveTable, saveLastActiveTable, startupTableTarget } from './active-table-recovery.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('a newer successfully active table replaces the QR table as the only reload target', () => {
  const localStorage = storage();
  saveLastActiveTable(localStorage, { code: 'QR0001', seatId: 0, updatedAt: 100 });
  saveLastActiveTable(localStorage, { code: 'NEW222', seatId: 2, updatedAt: 200 });

  assert.deepEqual(readLastActiveTable(localStorage), { code: 'NEW222', seatId: 2, updatedAt: 200 });
  assert.deepEqual(startupTableTarget({ queryJoinCode: '', localStorage }), { kind: 'reclaim', code: 'NEW222', seatId: 2 });
});

test('a fresh QR target takes priority over automatic reclaim', () => {
  const localStorage = storage();
  saveLastActiveTable(localStorage, { code: 'OLD111', seatId: 0, updatedAt: 100 });

  assert.deepEqual(startupTableTarget({ queryJoinCode: 'QR0001', localStorage }), { kind: 'join', code: 'QR0001' });
});

test('explicit leave clears the automatic reclaim target', () => {
  const localStorage = storage();
  saveLastActiveTable(localStorage, { code: 'NEW222', seatId: 2, updatedAt: 200 });
  clearLastActiveTable(localStorage);

  assert.equal(readLastActiveTable(localStorage), null);
  assert.equal(startupTableTarget({ queryJoinCode: '', localStorage }), null);
});
