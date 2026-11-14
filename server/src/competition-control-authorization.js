import { competitionError, competitionId, digest } from './competition-values.js';

const input = () => competitionError('Invalid control authorization reference.', 400, 'CONTROL_INPUT');
const version = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const accountFields = ['type', 'accountKey', 'identityId', 'admissionRevision', 'abortAfter'];
const capabilityFields = ['type', 'participantId', 'abortAfter'];
const targetFields = ['kind', 'id', 'operationId', 'version', 'requestHash', 'payloadHash'];
function exactFields(value, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(field => !Object.hasOwn(value, field))
    || Object.keys(value).some(field => !required.includes(field) && !optional.includes(field))) throw input();
}
function identifier(value, prefix) {
  competitionId(value);
  if (prefix && !value.startsWith(prefix) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw input();
  return value;
}
function target(kind, id) {
  if (!['pod', 'tournament'].includes(kind)) throw input();
  identifier(id, kind === 'pod' ? 'pod_' : 'event_');
}
const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
  : value;
export const controlValueDigest = value => digest(canonical(value));

export function controlClaim(value) {
  exactFields(value, ['key', 'binding', 'operationId', 'requestHash']);
  exactFields(value.binding, ['kind', 'id', 'roomCode']); target(value.binding.kind, value.binding.id);
  identifier(value.operationId, 'claim_');
  if (!hash(value.key) || !hash(value.requestHash) || !/^[A-Z0-9]{6}$/.test(value.binding.roomCode || '')) throw input();
  return { key: value.key, binding: { kind: value.binding.kind, id: value.binding.id, roomCode: value.binding.roomCode },
    operationId: value.operationId, requestHash: value.requestHash };
}

export function controlActor(value) {
  const fields = value?.type === 'account' ? accountFields : capabilityFields;
  exactFields(value, fields, ['claim']);
  if (value.type === 'account') {
    identifier(value.identityId, 'identity_');
    if (!hash(value.accountKey) || !version(value.admissionRevision)) throw input();
  } else {
    if (value.type !== 'capability' || !value.claim) throw input();
    identifier(value.participantId);
  }
  if (!Number.isSafeInteger(value.abortAfter) || value.abortAfter < 0) throw input();
  return { ...Object.fromEntries(fields.map(field => [field, value[field]])),
    ...(value.claim ? { claim: controlClaim(value.claim) } : {}) };
}

export function controlReference(value) {
  if (!value || typeof value !== 'object') throw input();
  const actor = controlActor(Object.fromEntries(Object.entries(value).filter(([field]) => !targetFields.includes(field))));
  exactFields(value, [...Object.keys(actor), ...targetFields]); target(value.kind, value.id);
  identifier(value.operationId, 'control_');
  if (!version(value.version) || value.version < 1 || !hash(value.requestHash) || !hash(value.payloadHash)
    || actor.claim && (actor.claim.binding.kind !== value.kind || actor.claim.binding.id !== value.id)) throw input();
  return { ...actor, ...Object.fromEntries(targetFields.map(field => [field, value[field]])) };
}
export const controlReferenceDigest = value => controlValueDigest(controlReference(value));
export const sameControlReference = (left, right) => controlReferenceDigest(left) === controlReferenceDigest(right);

export function controlClaimTicket(ref, state) {
  if (!ref.claim) throw input();
  return { key: ref.claim.key, binding: structuredClone(ref.claim.binding), operationId: ref.claim.operationId, state,
    control: { operationId: ref.operationId, requestHash: ref.requestHash, payloadHash: ref.payloadHash, version: ref.version } };
}
