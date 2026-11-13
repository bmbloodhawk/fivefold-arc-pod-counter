const integerKey = key => /^-?0*\d{1,10}$/.test(key) && Number(key) >= -2147483648 && Number(key) <= 2147483647;

// RTDB orders integer-looking keys before strings, then uses numeric value and
// key length. New record/timeline IDs use nonnumeric prefixes to avoid ambiguity.
export function databaseKeyCompare(left, right) {
  if (left === right) return 0;
  const leftInteger = integerKey(left), rightInteger = integerKey(right);
  if (leftInteger && rightInteger) return Number(left) - Number(right) || left.length - right.length;
  if (leftInteger !== rightInteger) return leftInteger ? -1 : 1;
  return left < right ? -1 : 1;
}

const validKey = key => typeof key === 'string' && key.length > 0 && Buffer.byteLength(key, 'utf8') <= 768
  && !/[.#$\[\]/\u0000-\u001f\u007f]/u.test(key);
const invalid = message => Object.assign(new TypeError(message), { status: 400, code: 'INVALID_STORAGE_PAGE' });

export function keyPageRequest(path, options = {}) {
  if (typeof path !== 'string' || path.length > 2048 || !/^[\w-]+(?:\/[\w-]+)*\.json$/.test(path)) {
    throw invalid('A page requires a relative record-collection JSON path.');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)
    || Object.keys(options).some(key => !['limit', 'cursor', 'direction'].includes(key))) {
    throw invalid('Use only limit, cursor and direction for a record page.');
  }
  const { limit = 50, cursor = null, direction = 'asc' } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('Page limit must be 1–100.');
  if (cursor !== null && !validKey(cursor)) throw invalid('Invalid record-page cursor.');
  if (!['asc', 'desc'].includes(direction)) throw invalid('Page direction must be asc or desc.');
  // Range boundaries are inclusive. Reserve the boundary plus a lookahead row;
  // a deleted boundary still leaves enough rows to decide whether another exists.
  const maximumEntries = limit + 1 + (cursor === null ? 0 : 1);
  const query = new URLSearchParams({ orderBy: JSON.stringify('$key') });
  query.set(direction === 'asc' ? 'limitToFirst' : 'limitToLast', String(maximumEntries));
  if (cursor !== null) query.set(direction === 'asc' ? 'startAt' : 'endAt', JSON.stringify(cursor));
  return { path: `${path}?${query}`, limit, cursor, direction, maximumEntries };
}

export function keyPageResult(value, request) {
  if (value !== null && typeof value !== 'object') throw new Error('Storage returned an invalid key collection.');
  const entries = Object.entries(value || {}).filter(([, item]) => item != null);
  if (entries.length > request.maximumEntries) throw new Error('Storage returned a page beyond the requested bound.');
  if (entries.some(([key]) => !validKey(key))) throw new Error('Storage returned an invalid collection key.');
  const sign = request.direction === 'asc' ? 1 : -1;
  entries.sort(([left], [right]) => sign * databaseKeyCompare(left, right));
  for (let index = 1; index < entries.length; index++) {
    if (databaseKeyCompare(entries[index - 1][0], entries[index][0]) === 0) throw new Error('Ambiguous numeric collection keys are unsupported.');
  }
  const rows = entries.filter(([key]) => {
    if (request.cursor === null) return true;
    const comparison = databaseKeyCompare(key, request.cursor);
    if (comparison === 0 && key !== request.cursor) throw new Error('Ambiguous numeric collection keys are unsupported.');
    return sign * comparison > 0;
  });
  const items = rows.slice(0, request.limit).map(([key, item]) => ({ key, value: item }));
  return { items, nextCursor: rows.length > request.limit ? items.at(-1).key : null };
}
