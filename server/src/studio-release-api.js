import { randomBytes } from 'node:crypto';
import { rehearseRewardAccess } from './studio-release-rehearsal.js';
import QRCode from 'qrcode';
import {
  buildSkinRelease,
  checkedRelease,
  MAX_RELEASE_BYTES,
  releaseError,
  validDigest,
} from './studio-release-package.js';
import { checkAppearanceRevision, isRestrictedAppearanceSource } from './appearance-studio-boundary.js';
import { appearanceAssetReferences } from '../../client/appearance-validation.js';

const idPattern = /^skin-[A-Za-z0-9_-]{1,75}$/;
const ticketPattern = /^[A-Za-z0-9_-]{32}$/;
export function createStudioReleaseApi({
  registry,
  catalog,
  restrictedSkins,
  startPhoneShare,
  listPhoneNetworks,
}) {
  const tickets = new Map();
  let startingTickets = 0;
  async function reserved() {
    return [...restrictedSkins, ...(await registry.reservedSkins())];
  }
  async function build({ id, revision }) {
    const snapshot = await catalog.read();
    checkAppearanceRevision(revision, snapshot);
    const row = snapshot.skins.find((item) => item.id === id);
    return buildSkinRelease(row, snapshot, (key) => catalog.readAsset(key), await reserved());
  }
  async function checkTarget(envelope) {
    const { skin, assets } = envelope.body;
    const snapshot = await catalog.read(),
      row = snapshot.skins.find((item) => item.id === skin.id);
    if (
      row &&
      (row.status === 'Approved' || isRestrictedAppearanceSource(row, snapshot, { rewardRelease: true }))
    ) {
      throw releaseError('This skin ID is already reserved for a different catalog release.');
    }
    const locked = [
      ...(await reserved()),
      ...snapshot.skins.filter((x) => isRestrictedAppearanceSource(x, snapshot)),
    ];
    const blocked = new Set(
      locked
        .filter((x) => x.id !== skin.id)
        .flatMap((x) => x.reservedAssetIds || appearanceAssetReferences(x).map((ref) => ref.id))
    );
    if (assets.some((asset) => blocked.has(asset.id)))
      throw releaseError('This version uses artwork reserved for a different skin.');
  }
  function prune() {
    for (const [token, session] of tickets)
      if (session.expiresAt <= Date.now()) {
        session.stop?.();
        tickets.delete(token);
      }
  }
  return async function route({ req, url, parts, authorize, readBody, origin }) {
    if (req.method === 'GET' && parts[1] === 'skin-release-proof' && parts.length === 4) {
      if (registry.environment !== 'staging' || !idPattern.test(parts[2]) || !validDigest(parts[3]))
        throw releaseError('Unknown release.', 404);
      const result = await registry.proof('staging', parts[2], parts[3]);
      return { status: result.verified ? 200 : 404, data: result };
    }
    if (
      req.method === 'GET' &&
      parts[1] === 'studio-playtests' &&
      (parts.length === 3 || (parts.length === 4 && parts[3] === 'status'))
    ) {
      prune();
      const session = ticketPattern.test(parts[2]) && tickets.get(parts[2]);
      if (!session) throw releaseError('This playtest ended. Start a new one in the Studio.', 404);
      if (parts.length === 4) return { status: 200, data: { expiresAt: session.expiresAt } };
      return {
        status: 200,
        data: { skin: session.skin, digest: session.digest, expiresAt: session.expiresAt },
      };
    }
    authorize();
    const action = parts[3];
    if (req.method === 'GET' && action === 'status') {
      const id = url.searchParams.get('skin') || '';
      if (id && !idPattern.test(id)) throw releaseError('Choose a saved custom skin.');
      return {
        status: 200,
        data: {
          ...(await registry.status(id)),
          ...(registry.environment === 'local' && listPhoneNetworks
            ? { networks: listPhoneNetworks().map(({ name, address }) => ({ name, address })) }
            : {}),
        },
      };
    }
    if (req.method === 'GET' && action === 'version' && parts.length === 6) {
      return { status: 200, data: await registry.version(parts[4], parts[5]) };
    }
    if (req.method !== 'POST' || parts.length !== 4) throw releaseError('Unsupported release action.', 404);
    const input = await readBody(MAX_RELEASE_BYTES + 4096);
    if (action === 'prepare') return { status: 200, data: await build(input) };
    if (action === 'render-check') {
      const envelope = checkedRelease(input.release);
      await checkTarget(envelope);
      return {
        status: 200,
        data: { skin: await registry.hydrated(envelope), accounts: await rehearseRewardAccess(envelope.body) },
      };
    }
    if (action === 'inspect') {
      const envelope = checkedRelease(input.release);
      await checkTarget(envelope);
      return {
        status: 200,
        data: {
          digest: envelope.digest,
          name: envelope.body.skin.name,
          skinId: envelope.body.skin.id,
          images: envelope.body.assets.length,
        },
      };
    }
    if (action === 'withdraw') {
      return { status: 200, data: await registry.withdraw(input.lane, input.id, input.expected) };
    }
    if (action === 'activate') {
      const envelope = checkedRelease(input.release);
      await checkTarget(envelope);
      if (!['staging', 'public'].includes(input.lane)) throw releaseError('Choose a release destination.');
      return { status: 200, data: await registry.activate(input.lane, envelope, input.expected) };
    }
    if (action === 'stop-playtest') {
      const session = tickets.get(input.ticket);
      session?.stop?.();
      tickets.delete(input.ticket);
      return { status: 200, data: { ended: true } };
    }
    if (action === 'playtest') {
      prune();
      if (tickets.size + startingTickets >= 8)
        throw releaseError('End an active playtest before opening another.', 409);
      const release = checkedRelease(input.release);
      startingTickets++;
      let share;
      try {
        await checkTarget(release);
        const ticket = randomBytes(24).toString('base64url');
        const expiresAt = Date.now() + 60 * 60 * 1000;
        const path = '/index.html?appearance-preview=1&practice-release=' + ticket;
        const session = { skin: await registry.hydrated(release), digest: release.digest, expiresAt };
        let shareOrigin = origin;
        if (input.wifi && registry.environment === 'local') {
          if (!startPhoneShare) throw releaseError('Wi-Fi sharing is unavailable on this host.');
          share = await startPhoneShare({ origin, ticket, expiresAt, networkAddress: input.networkAddress });
          session.stop = share.stop;
          shareOrigin = share.origin;
        }
        const link = new URL(path, shareOrigin).href;
        const qr = await QRCode.toDataURL(link, { width: 280, margin: 2 });
        tickets.set(ticket, session);
        return {
          status: 201,
          data: {
            ticket,
            url: link,
            expiresAt,
            digest: release.digest,
            qr,
          },
        };
      } catch (error) {
        share?.stop();
        throw error;
      } finally {
        startingTickets--;
      }
    }
    throw releaseError('Unknown release action.', 404);
  };
}
