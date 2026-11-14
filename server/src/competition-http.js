import QRCode from 'qrcode';
import { competitionError } from './competitions.js';

// Bearer account tokens or event-scoped guest capabilities; never ambient cookies.
// Invite secrets use POST bodies and browser fragments, not logged URL queries.
export async function competitionRoute({ req, url, readBody, account, domain, tables, tournaments, connectionId, appEnv }) {
  if (!url.pathname.startsWith('/api/competitions/')) return null;
  const path = url.pathname.slice('/api/competitions/'.length).split('/');
  const method = req.method;
  const supportedPodEnvironment = ['staging', 'production'].includes(appEnv);
  const podDeletionEnabled = Boolean(domain) && supportedPodEnvironment && !domain.identityStore && !domain.scopeStore;
  if (method === 'GET' && path[0] === 'config') return { status: 200, data: { enabled: Boolean(domain), podDeletionEnabled,
    podInviteScannerEnabled: Boolean(domain) && supportedPodEnvironment } };
  if (!domain) throw competitionError('Pods and tournaments are not enabled on this server.', 503, 'COMPETITIONS_DISABLED');
  const signed = () => account(req);
  const auth = async () => req.headers['x-event-token'] ? { guestToken: String(req.headers['x-event-token']) }
    : req.headers.authorization ? { accountId: await signed() } : {};
  const ok = data => ({ status: 200, data });
  const created = data => ({ status: 201, data });
  if (path.length === 1 && path[0] === 'mine' && method === 'GET') return ok(await domain.list(await signed()));
  if (path.length === 1 && path[0] === 'pods' && method === 'POST') return created(await domain.createPod(await signed(), await readBody()));
  if (path.length === 1 && path[0] === 'tournaments' && method === 'POST') return created(await tournaments.create(await signed(), await readBody()));
  if (path[0] === 'invite-preview' && method === 'POST') return ok(await domain.preview((await readBody()).token));
  if (path[0] === 'join' && method === 'POST') {
    const input = await readBody(); const { kind } = domain.parseInvite(input.token);
    if (kind === 'pod') return ok(await domain.joinPod(await signed(), input.token, input));
    return ok(await tournaments.join(req.headers.authorization ? await signed() : null, input.token, input));
  }
  if (path[0] === 'invite-qr' && method === 'POST') {
    const { token } = await readBody(); await domain.preview(token);
    const protocol = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() === 'https' ? 'https' : 'http';
    const host = String(req.headers.host || 'localhost');
    if (!/^[\w.:[\]-]+$/.test(host)) throw competitionError('Invalid host.');
    const link = `${protocol}://${host}/index.html#invite=${encodeURIComponent(token)}`;
    return ok({ link, data: await QRCode.toDataURL(link, { width: 320, margin: 2, errorCorrectionLevel: 'M' }) });
  }
  if (path[0] === 'tables') {
    if (path[1] === 'context' && method === 'GET') return ok(await tables.context(await auth(), url.searchParams.get('code'), connectionId));
    if (path[1] === 'bind' && method === 'POST') return ok(await tables.bind(await auth(), { ...(await readBody()), connectionId }));
    if (path[1] === 'claim' && method === 'POST') return ok(await tables.claim(await auth(), { ...(await readBody()), connectionId }));
    if (path[1] === 'attest-guest' && method === 'POST') return ok(await tables.attestGuest(await auth(), { ...(await readBody()), connectionId }));
    if (path[1] === 'timed-draw' && method === 'POST') return ok(await tables.timedDraw(await auth(), { ...(await readBody()), connectionId }));
  }
  const [kind, id, action, detail, subaction] = path;
  if (!['pod', 'tournament'].includes(kind) || !id) throw competitionError('Unknown competition route.', 404);
  if (kind === 'pod' && path.length === 2 && method === 'DELETE' && podDeletionEnabled) {
    return ok(await domain.deletePod(await signed(), id, await readBody()));
  }
  if (!action && method === 'GET') return ok(kind === 'pod' ? await domain.getPod(await signed(), id) : await tournaments.get(await auth(), id));
  if (action === 'invites' && method === 'GET') return ok(await domain.listInvites(await signed(), kind, id));
  if (action === 'invites' && method === 'POST') return ok(detail && subaction === 'revoke'
    ? await domain.revokeInvite(await signed(), kind, id, detail) : await domain.invite(await signed(), kind, id));
  if (action === 'members' && method === 'POST') return ok(kind === 'pod'
    ? await domain.podMemberAction(await signed(), id, await readBody()) : await tournaments.memberAction(await auth(), id, await readBody()));
  if (action === 'guests' && kind === 'tournament' && method === 'POST') return ok(await tournaments.addGuest(await auth(), id, await readBody()));
  if (action === 'guest-access' && kind === 'tournament' && method === 'POST') return ok(await tournaments.guestAccess(await auth(), id, (await readBody()).targetId));
  if (action === 'cancel-table' && kind === 'tournament' && method === 'POST') return ok(await tournaments.cancelUnplayedTable(await auth(), id, (await readBody()).assignmentId));
  if (action === 'reconcile' && method === 'POST') {
    if (kind === 'pod') await domain.getPod(await signed(), id); else await tournaments.get(await auth(), id);
    await tables.reconcile(kind, id); return ok({ captured: true });
  }
  if (action === 'history' && method === 'GET') return ok(await tables.history(await auth(), kind, id, Object.fromEntries(url.searchParams)));
  if (action === 'games' && detail) {
    if (method === 'GET') return ok(await tables.detail(await auth(), kind, id, detail));
    if (method === 'POST' && subaction === 'confirm') return ok(await tables.confirm(await auth(), kind, id, detail, await readBody()));
  }
  if (kind === 'tournament' && action === 'rounds' && method === 'POST') {
    const input = await readBody(); const actor = await auth();
    if (detail === 'prepare') return ok(await tournaments.prepareRound(actor, id, input));
    if (detail === 'seating') return ok(await tournaments.editSeating(actor, id, input));
    if (detail === 'start') return ok(await tournaments.startRound(actor, id, input));
  }
  if (kind === 'tournament' && action === 'clock' && detail && method === 'POST') return ok(await tournaments.clock(await auth(), id, detail, await readBody()));
  throw competitionError('Unknown competition route.', 404);
}
