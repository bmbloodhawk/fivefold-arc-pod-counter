import { createHash } from 'node:crypto';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function competitionError(message, status = 400, code = 'COMPETITION_INPUT') {
  return Object.assign(new Error(message), { status, code });
}
export function cleanText(value, label, max = 80) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}<>]/u.test(value)) throw competitionError(`${label} must be printable text.`);
  const text = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!text || Array.from(text).length > max) throw competitionError(`${label} must contain 1–${max} characters.`);
  return text;
}
export function competitionId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw competitionError('Invalid competition identifier.');
  return id;
}
