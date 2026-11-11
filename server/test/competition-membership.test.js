import assert from 'node:assert/strict';
import test from 'node:test';
import { Competitions } from '../src/competitions.js';
import { MemoryAccountHistoryStore } from '../src/account-history.js';

function fixture() {
  let sequence = 0; let time = 1000;
  const store = new MemoryAccountHistoryStore();
  const service = new Competitions({ store, now: () => time, createId: () => `id${++sequence}` });
  return { store, service, advance: ms => { time += ms; } };
}
async function twoMembers(f) {
  const pod = await f.service.createPod('a', { name: 'Friday group', displayName: 'A' });
  const invite = await f.service.invite('a', 'pod', pod.id);
  const member = await f.service.joinPod('b', invite.token, { displayName: 'B' });
  return { pod: await f.service.getPod('a', pod.id), member, invite };
}

test('Pods are private; multiple memberships and ownership do not cross tenant boundaries', async () => {
  const f = fixture(); const { pod } = await twoMembers(f);
  const other = await f.service.createPod('b', { name: 'Other group', displayName: 'B' });
  assert.equal((await f.service.list('b')).pods.length, 2);
  assert.equal((await f.service.list('a')).pods.length, 1);
  await assert.rejects(() => f.service.getPod('c', pod.id), { status: 403 });
  await assert.rejects(() => f.service.getPod('a', other.id), { status: 403 });
  assert.equal(pod.members.length, 2);
  assert.equal(pod.members.every(member => member.rating === 1000 && member.provisional), true);
});

test('private preview exposes only Pod/inviter, and joining requires explicit signed-in opt in', async () => {
  const f = fixture(); const { pod, invite } = await twoMembers(f);
  const preview = await f.service.preview(invite.token);
  assert.deepEqual(Object.keys(preview).sort(), ['expiresAt', 'id', 'inviter', 'kind', 'name']);
  assert.equal(preview.inviter, 'A');
  assert.equal('members' in preview, false);
  await assert.rejects(() => f.service.joinPod(null, invite.token, { displayName: 'Guest' }), { status: 401 });
  const repeat = await f.service.joinPod('b', invite.token, { displayName: 'B' });
  assert.equal(repeat.members.length, 2);
  assert.equal((await f.service.getPod('a', pod.id)).members.length, 2);
});

test('any active member invites; expiry, revocation, and inactive inviters invalidate links', async () => {
  const f = fixture(); const { pod } = await twoMembers(f);
  const invite = await f.service.invite('b', 'pod', pod.id);
  await f.service.joinPod('c', invite.token, { displayName: 'C' });
  await f.service.revokeInvite('b', 'pod', pod.id, invite.id);
  await assert.rejects(() => f.service.preview(invite.token), { status: 404 });
  const expires = await f.service.invite('b', 'pod', pod.id);
  f.advance(8 * 86_400_000);
  await assert.rejects(() => f.service.preview(expires.token), { status: 404 });
  const inactive = await f.service.invite('c', 'pod', pod.id);
  await f.service.podMemberAction('c', pod.id, { action: 'leave' });
  await assert.rejects(() => f.service.preview(inactive.token), { status: 404 });
});

test('voluntary return preserves member identity, whereas admin removal requires a fresh admin invite', async () => {
  const f = fixture(); const { pod } = await twoMembers(f);
  const b = pod.members.find(member => member.name === 'B');
  const memberInvite = await f.service.invite('b', 'pod', pod.id);
  await f.service.joinPod('c', memberInvite.token, { displayName: 'C' });
  const cInvite = await f.service.invite('c', 'pod', pod.id);
  await f.service.podMemberAction('b', pod.id, { action: 'leave' });
  const returned = await f.service.joinPod('b', cInvite.token, { displayName: 'B' });
  assert.equal(returned.me, b.id);
  await f.service.podMemberAction('a', pod.id, { action: 'remove', targetId: b.id });
  await assert.rejects(() => f.service.joinPod('b', cInvite.token, { displayName: 'B' }), { status: 403 });
  // A pre-removal link is not a targeted readmission authorization.
  const staleAdmin = await f.service.invite('a', 'pod', pod.id);
  await f.service.joinPod('b', staleAdmin.token, { displayName: 'B' });
  await f.service.podMemberAction('a', pod.id, { action: 'remove', targetId: b.id });
  await assert.rejects(() => f.service.joinPod('b', staleAdmin.token, { displayName: 'B' }), { status: 403 });
  const freshAdmin = await f.service.invite('a', 'pod', pod.id);
  assert.equal((await f.service.joinPod('b', freshAdmin.token, { displayName: 'B' })).me, b.id);
});

test('admin changes require an admin; vacancy takeover is atomic and is not a response to absence', async () => {
  const f = fixture(); const { pod } = await twoMembers(f);
  const b = pod.members.find(member => member.name === 'B');
  await assert.rejects(() => f.service.podMemberAction('b', pod.id, { action: 'takeover' }), { status: 409 });
  await assert.rejects(() => f.service.podMemberAction('b', pod.id, { action: 'admin', targetId: b.id, enabled: true }), { status: 403 });
  const link = await f.service.invite('b', 'pod', pod.id);
  await f.service.joinPod('c', link.token, { displayName: 'C' });
  await f.service.podMemberAction('a', pod.id, { action: 'leave' });
  const outcomes = await Promise.allSettled([
    f.service.podMemberAction('b', pod.id, { action: 'takeover' }),
    f.service.podMemberAction('c', pod.id, { action: 'takeover' }),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  const current = await f.service.getPod('b', pod.id);
  assert.equal(current.members.filter(member => member.role === 'admin' && member.status === 'active').length, 1);
  assert.equal(current.audit.at(-1).action, 'admin_takeover');
});

test('erasure closes identity before redaction; a delayed name/index write cannot resurrect it', async () => {
  const f = fixture(); const { pod } = await twoMembers(f);
  const b = pod.members.find(member => member.name === 'B');
  const identity = await f.service.identity('b');
  await f.service.eraseAccount('b');
  await assert.rejects(() => f.service.identity('b', 'Restored name'), { status: 403 });
  await assert.rejects(() => f.service.setAlias(identity, pod.id, b.id, 'Resurrected'), { status: 403 });
  await assert.rejects(() => f.service.getPod('b', pod.id), { status: 403 });
  const current = await f.service.getPod('a', pod.id);
  assert.equal(current.members.find(member => member.id === b.id).name, 'Deleted member');
  assert.equal(JSON.stringify([...f.store.values.values()]).includes('"name":"B"'), false);
  assert.equal(current.members.find(member => member.id === b.id).rating, 1000);
});

test('erased admins do not block takeover, and reusing an invite does not demote an active admin', async () => {
  const f = fixture(); const { pod, invite } = await twoMembers(f);
  await f.service.joinPod('a', invite.token, { displayName: 'A' });
  assert.equal((await f.service.getPod('a', pod.id)).role, 'admin');
  await f.service.eraseAccount('a');
  await assert.rejects(() => f.service.joinPod('c', invite.token, { displayName: 'C' }), { status: 404 });
  assert.equal((await f.service.podMemberAction('b', pod.id, { action: 'takeover' })).role, 'admin');
});

test('public DTOs never expose account IDs, identity IDs, invite hashes or guest credentials', async () => {
  const f = fixture(); const { pod } = await twoMembers(f);
  const dto = JSON.stringify(await f.service.getPod('a', pod.id));
  assert.equal(/accountId|identityId|tokenHash|secretHash|ownerHash/.test(dto), false);
  await assert.rejects(() => f.service.createPod('x', { name: '<script>\n', displayName: 'X' }), { status: 400 });
  await assert.rejects(() => f.service.createPod('x', { name: 'x'.repeat(81), displayName: 'X' }), { status: 400 });
});

test('admins use the leave flow for their own membership, rather than accidentally removing themselves', async () => {
  const f = fixture(); const { pod } = await twoMembers(f);
  await assert.rejects(() => f.service.podMemberAction('a', pod.id, { action: 'remove', targetId: pod.me }), { status: 400 });
  assert.equal((await f.service.getPod('a', pod.id)).role, 'admin');
});

test('only an active admin can rename a Pod without changing its memberships or ratings', async () => {
  const f = fixture(); const { pod } = await twoMembers(f);
  await assert.rejects(() => f.service.podMemberAction('b', pod.id, { action: 'rename', name: 'Changed' }), { status: 403 });
  const updated = await f.service.podMemberAction('a', pod.id, { action: 'rename', name: 'Friday friends' });
  assert.equal(updated.name, 'Friday friends'); assert.deepEqual(updated.members, pod.members);
  assert.equal(updated.audit.at(-1).action, 'pod_renamed');
  await assert.rejects(() => f.service.podMemberAction('a', pod.id, { action: 'rename', name: '<bad>' }), { status: 400 });
});

test('issued invitations can be managed after reopening; members see their own and admins see all', async () => {
  const f = fixture(); const { pod, invite } = await twoMembers(f);
  const own = await f.service.invite('b', 'pod', pod.id);
  const memberList = await f.service.listInvites('b', 'pod', pod.id);
  assert.deepEqual(memberList.invites.map(row => row.id), [own.id]);
  const adminList = await f.service.listInvites('a', 'pod', pod.id);
  assert.equal(adminList.invites.length, 2);
  assert.equal(/secretHash|token|identityId|accountId/.test(JSON.stringify(adminList)), false);
  await assert.rejects(() => f.service.listInvites('c', 'pod', pod.id), { status: 403 });
  await assert.rejects(() => f.service.revokeInvite('b', 'pod', pod.id, invite.id), { status: 403 });
  await f.service.revokeInvite('a', 'pod', pod.id, own.id);
  assert.equal((await f.service.listInvites('b', 'pod', pod.id)).invites[0].status, 'revoked');
  await assert.rejects(() => f.service.preview(own.token), { status: 404 });
  f.advance(8 * 86_400_000);
  assert.equal((await f.service.listInvites('a', 'pod', pod.id)).invites.find(row => row.id === invite.id).status, 'expired');
  const readScope = f.service.readScope.bind(f.service); let erased = false;
  f.service.readScope = async (...args) => { const scope = await readScope(...args); if (!erased) { erased = true; await f.service.eraseAccount('b'); } return scope; };
  await assert.rejects(() => f.service.listInvites('b', 'pod', pod.id), { status: 403 });
});
