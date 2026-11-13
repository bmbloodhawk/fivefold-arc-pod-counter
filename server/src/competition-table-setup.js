import { randomBytes } from 'node:crypto';
import { competitionError, digest } from './competition-values.js';
import { coordinateCompetitionWrites } from './competition-write-coordinator.js';
import { CompetitionControlStore } from './competition-control-store.js';
import { controlActor, controlClaim, controlReference, controlReferenceDigest, sameControlReference } from './competition-control-authorization.js';

const root = ref => `competitions-v2/groups/${ref.id}`;
const conflict = () => competitionError('Stored Table setup authorization is inconsistent.', 503, 'CONTROL_AUTHORIZATION_CONFLICT');
const pending = () => competitionError('The host must finish linking this Table.', 409, 'TABLE_SETUP_PENDING');
const cancelled = () => competitionError('This unfinished Table setup was cancelled. Review and try again.', 409, 'CONTROL_AUTHORIZATION_CANCELLED');
const sameBinding = (a, b) => a?.kind === b?.kind && a?.id === b?.id && a?.roomCode === b?.roomCode;
function checkedGuard(guard) {
  if (typeof guard !== 'function') throw new TypeError('Table setup requires a genuine synchronous Room guard.');
  return () => {
    const result = guard();
    if (result?.then) { void Promise.resolve(result).catch(() => undefined); throw new TypeError('A Table setup guard must be synchronous.'); }
  };
}

// One recoverable setup spans a group operation and the existing Table claim.
// Account CAS or the guest's exact reserved head decides; helpers never decide
// for a live caller. No RoomService hook or life-mutation callback is installed.
export class CompetitionTableSetup {
  constructor({ store, accounts, claims, now = Date.now } = {}) {
    if (!store?.read || !store?.update || !store?.page || !accounts?.resolve || !claims?.reserve || typeof now !== 'function') {
      throw new TypeError('Table setup requires conditional control, account and claim storage.');
    }
    this.store = coordinateCompetitionWrites(store); this.accounts = accounts; this.claims = claims; this.now = now;
    this.control = new CompetitionControlStore({ store: this.store,
      resolveAuthorization: ref => this.resolve(ref), finishAuthorization: ref => this.retire(ref) });
  }

  prepare({ actor, participantId, tableClaim, operationId }) {
    const claimId = `claim_${randomBytes(18).toString('base64url')}`;
    const claim = controlClaim({ key: tableClaim.key, binding: tableClaim.binding, operationId: claimId,
      requestHash: digest({ operationId, claimId, key: tableClaim.key, binding: tableClaim.binding, intent: tableClaim.intent || null }) });
    return controlActor({ ...(actor || { type: 'capability', participantId, abortAfter: this.now() + 30000 }), claim });
  }

  async #terminal(ref) {
    const receipt = await this.store.read(`${root(ref)}/operations/${ref.operationId}.json`);
    if (!receipt) return null;
    if (receipt.version !== ref.version || receipt.requestHash !== ref.requestHash || receipt.payloadHash !== ref.payloadHash
      || receipt.authorization !== controlReferenceDigest(ref) || !['committed', 'cancelled'].includes(receipt.outcome)) throw conflict();
    const head = await this.store.read(`${root(ref)}/head.json`);
    return head?.version >= ref.version ? receipt : null;
  }

  async #stub(ref, { validatePayload = true } = {}) {
    const head = await this.store.read(`${root(ref)}/head.json`);
    if (head?.version >= ref.version) {
      const terminal = await this.#terminal(ref);
      if (!terminal) throw conflict();
      if (terminal.outcome === 'cancelled') throw cancelled();
      return { head, terminal };
    }
    if (head?.version !== ref.version - 1 || head.kind !== ref.kind || !head.pending?.authorization
      || !sameControlReference(head.pending.authorization, ref) || head.pending.operationId !== ref.operationId
      || head.pending.requestHash !== ref.requestHash || head.pending.payloadHash !== ref.payloadHash) throw conflict();
    if (ref.claim && validatePayload) {
      let changes; try { changes = JSON.parse(head.pending.json).changes; } catch { throw conflict(); }
      if (!changes?.some(row => row.section === 'tables' && row.key === ref.claim.key && row.value?.roomCode === ref.claim.binding.roomCode
        && (ref.type === 'account' || row.value.hostId === ref.participantId))) throw conflict();
    }
    return { head, pending: head.pending };
  }

  async admit(value, { guard } = {}) {
    const ref = controlReference(value);
    if (!ref.claim) return this.accounts.admit(ref);
    const genuineGuard = checkedGuard(guard), state = await this.#stub(ref);
    if (state.terminal) return 'committed';
    if (ref.type === 'account') {
      if (await this.accounts.admit(ref) === 'committed') return 'committed';
    } else {
      if (state.pending.decision === 'cancelled') throw cancelled();
      if (state.pending.decision === 'committed') return 'committed';
    }
    await this.claims.reserve(ref.claim.key, ref.claim.binding, { ...ref.claim, authorization: ref, guard: genuineGuard,
      ...(ref.type === 'account' ? { accountKey: ref.accountKey, identityId: ref.identityId } : {}) });
    return 'pending';
  }

  async commit(value, { guard } = {}) {
    const ref = controlReference(value);
    if (!ref.claim) return this.accounts.commit(ref, { guard });
    const genuineGuard = checkedGuard(guard), state = await this.#stub(ref);
    if (state.terminal) return 'committed';
    if (ref.type === 'account') return this.accounts.commit(ref, { guard: genuineGuard });
    if (!await this.claims.reserved(ref.claim.key, ref.claim.binding, ref.claim.operationId)) throw pending();
    const head = await this.store.update(`${root(ref)}/head.json`, current => {
      if (current?.version !== ref.version - 1 || !current.pending?.authorization || !sameControlReference(current.pending.authorization, ref)) throw cancelled();
      if (current.pending.decision === 'cancelled') throw cancelled();
      if (current.pending.decision === 'committed') return current;
      if (current.pending.decision !== 'pending' || current.pending.applied !== 0) throw conflict();
      genuineGuard();
      return { ...current, pending: { ...current.pending, decision: 'committed' } };
    });
    return head.pending.decision;
  }

  async resolve(value, { cancel = false } = {}) {
    const ref = controlReference(value);
    if (!ref.claim) return this.accounts.resolve(ref, { cancel });
    let state;
    if (ref.type === 'account') state = await this.accounts.resolve(ref, { cancel });
    else {
      const terminal = await this.#terminal(ref);
      if (terminal) return terminal.outcome;
      let observed = await this.#stub(ref, { validatePayload: false });
      if (observed.terminal) return observed.terminal.outcome;
      if (observed.pending.decision === 'pending' && (cancel || this.now() >= ref.abortAfter)) {
        const head = await this.store.update(`${root(ref)}/head.json`, current => {
          if (current?.version >= ref.version) return current;
          if (current?.version !== ref.version - 1 || !current.pending?.authorization || !sameControlReference(current.pending.authorization, ref)) throw conflict();
          if (current.pending.decision !== 'pending') return current;
          return { ...current, pending: { ...current.pending, decision: 'cancelled' } };
        });
        if (head.version >= ref.version) {
          const finished = await this.#terminal(ref); if (!finished) throw conflict(); return finished.outcome;
        }
        observed = { pending: head.pending };
      }
      state = observed.pending.decision;
    }
    if (!['pending', 'committed', 'cancelled'].includes(state)) throw conflict();
    if (state !== 'cancelled') return state;
    // The authoritative cancellation wins before touching the claim. Preserve a
    // different owner and record its generation as an explicit supersession.
    const proof = await this.claims.settleErasure({ ...ref.claim, state: 'pending' });
    if (!proof) throw conflict();
    const type = proof.operationId === ref.claim.operationId && proof.state === 'cancelled' && sameBinding(proof.binding, ref.claim.binding)
      ? 'owned' : proof.state === 'ready' && sameBinding(proof.binding, ref.claim.binding) ? 'reused' : 'superseded';
    return { state: 'cancelled', claimOutcome: { ...proof, type } };
  }

  async retire(value) {
    const ref = controlReference(value);
    if (!ref.claim) return this.accounts.retire(ref);
    const receipt = await this.#terminal(ref);
    if (!receipt) throw pending();
    if (ref.type === 'account' && await this.accounts.resolve(ref) !== receipt.outcome) throw conflict();
    if (receipt.outcome === 'committed') {
      await this.claims.publish(ref.claim.key, ref.claim.binding, { operationId: ref.claim.operationId, state: 'committed' });
      const claim = await this.claims.inspect(ref.claim.key);
      if (claim?.state !== 'ready' || !sameBinding(claim.binding, ref.claim.binding)) throw pending();
    } else {
      const proof = receipt.claimOutcome, current = await this.claims.inspect(ref.claim.key);
      if (!proof || proof.key !== ref.claim.key || !['owned', 'reused', 'superseded'].includes(proof.type)
        || !Number.isSafeInteger(proof.generation) || proof.generation < 0 || !/^[a-f0-9]{64}$/.test(proof.recordHash || '')
        || !current || current.generation < proof.generation
        || current.generation === proof.generation && current.recordHash !== proof.recordHash) throw pending();
    }
    if (ref.type === 'account') await this.accounts.retire(ref, { claimVerified: true });
  }
}
