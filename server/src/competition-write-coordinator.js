// Coordinate competition writes within this process. Database conditional writes
// still arbitrate other processes; different documents never share a queue.
const coordinatedStores = new WeakMap();

export function coordinateCompetitionWrites(store) {
  if (coordinatedStores.has(store)) return coordinatedStores.get(store);
  const pending = new Map();
  const coordinated = {
    read: (...args) => store.read(...args),
    ...(typeof store.page === 'function' ? { page: (...args) => store.page(...args) } : {}),
    update(path, change) {
      const previous = pending.get(path) || Promise.resolve();
      const result = previous.then(() => store.update(path, change));
      // A failed operation must release its place without rejecting the next one.
      const settled = result.then(() => undefined, () => undefined);
      pending.set(path, settled);
      void settled.then(() => { if (pending.get(path) === settled) pending.delete(path); });
      return result;
    },
  };
  coordinatedStores.set(store, coordinated);
  coordinatedStores.set(coordinated, coordinated);
  return coordinated;
}
