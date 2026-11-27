import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { rehearseRewardAccess } from './studio-release-rehearsal.js';
import { materializeAppearanceSkin } from './appearance-artwork-payload.js';
import { checkedRelease, releaseError, validDigest } from './studio-release-package.js';
import { appearanceAssetReferences } from '../../client/appearance-validation.js';

// File storage belongs to the single-process desktop Studio. Hosted instances
// share immutable blobs and use Firebase's conditional update for the index.
export function studioReleaseStorage({ directory, ledger, namespace }) {
  const firebase = typeof ledger?.accessToken === 'function';
  const prefix = 'appearance-studio/releases-v1/' + namespace + '/';
  const memory = new Map();
  let pending = Promise.resolve();
  async function read(key) {
    if (firebase) return ledger.read(prefix + key + '.json');
    if (!directory) return memory.get(key) ?? null;
    try {
      return await readFile(join(directory, namespace, key + '.json'), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  async function write(key, value) {
    if (firebase) return ledger.write(prefix + key + '.json', value);
    if (!directory) {
      memory.set(key, value);
      return;
    }
    const path = join(directory, namespace, key + '.json');
    await mkdir(dirname(path), { recursive: true });
    const tmp = path + '.' + randomUUID() + '.tmp';
    await writeFile(tmp, value, { mode: 0o600 });
    await rename(tmp, path);
  }
  return {
    read,
    write,
    update(fn) {
      const mutate = (text) => JSON.stringify(fn(text ? JSON.parse(text) : {}));
      if (firebase) return ledger.update(prefix + 'index.json', mutate);
      const result = pending.then(async () => write('index', mutate(await read('index'))));
      pending = result.catch(() => {});
      return result;
    },
  };
}

export function createHostedStudioReleases({
  environment,
  ledger,
  accountHistory,
  accountVerifier,
  fetchImpl,
}) {
  if (!['staging', 'public'].includes(environment))
    throw new TypeError('Unknown hosted Studio release environment');
  const durable = ['accessToken', 'read', 'write', 'update'].every(
    (method) => typeof ledger?.[method] === 'function'
  );
  const redemption =
    typeof accountHistory?.studioSkinChoices === 'function' && typeof accountVerifier?.verify === 'function';
  // A hosted service has no local release directory. A missing dependency still
  // permits reviewing a package without creating a temporary release for players.
  const registry = createStudioReleases({ environment, ledger: durable ? ledger : undefined, fetchImpl });
  if (durable && redemption) return registry;
  const writeUnavailable = !durable
    ? 'Release changes need durable storage configured on this service.'
    : 'Release changes need player sign-in and reward redemption configured on this service.';
  const unavailable = async () => {
    throw releaseError(writeUnavailable, 503);
  };
  return {
    ...registry,
    activate: unavailable,
    withdraw: unavailable,
    status: async (id) => ({ ...(await registry.status(id)), writeUnavailable }),
    proof: async (_lane, id, digest) => ({ id, digest, verified: false }),
  };
}

export function createStudioReleases({ environment, directory, ledger, now = Date.now, fetchImpl = fetch }) {
  if (!['local', 'staging', 'public'].includes(environment))
    throw new TypeError('Unknown Studio release environment');
  const stores = Object.fromEntries(
    (environment === 'local' ? ['staging', 'public'] : [environment]).map((lane) => [
      lane,
      studioReleaseStorage({
        directory,
        ledger,
        namespace: (environment === 'local' ? 'rehearsal-' : '') + lane,
      }),
    ])
  );
  const activeLane = environment === 'public' ? 'public' : 'staging';
  const cache = new Map();
  function getStore(lane) {
    const value = Object.hasOwn(stores, lane) && stores[lane];
    if (!value) throw releaseError('Open the Studio on the target service to apply this release.', 409);
    return value;
  }
  async function index(lane) {
    return JSON.parse((await getStore(lane).read('index')) || '{}');
  }
  async function version(lane, digest) {
    if (!validDigest(digest)) throw releaseError('Invalid release version.');
    const text = await getStore(lane).read('versions/' + digest);
    if (!text) throw releaseError('This version is unavailable here.', 404);
    return checkedRelease(JSON.parse(text));
  }
  async function hydrated(envelope) {
    if (cache.has(envelope.digest)) return cache.get(envelope.digest);
    const { skin, assets } = envelope.body;
    const result = await materializeAppearanceSkin(skin, { assets });
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    cache.set(envelope.digest, result);
    return result;
  }
  async function proof(lane, id, digest) {
    const current = (await index(lane))[id]?.at(-1);
    return { id, digest, verified: Boolean(current && current.digest === digest) };
  }
  async function verifyStage(id, digest) {
    if (environment === 'local') return (await proof('staging', id, digest)).verified;
    const url = new URL(
      '/api/skin-release-proof/' + encodeURIComponent(id) + '/' + digest,
      'https://fivefold-arc-pod-counter-staging.onrender.com'
    );
    const response = await fetchImpl(url, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.verified === true && data.id === id && data.digest === digest;
  }
  async function activate(lane, envelope, expected) {
    const store = getStore(lane);
    checkedRelease(envelope);
    const {
      digest,
      body: { skin, rewardRule },
    } = envelope;
    if (expected !== null && !validDigest(expected)) throw releaseError('Refresh the current version first.');
    if (lane === 'public' && !(await verifyStage(skin.id, digest)))
      throw releaseError('Stage and check this exact version before promoting it.', 409);
    await hydrated(envelope);
    await rehearseRewardAccess(envelope.body);
    // Register a complete immutable blob before the active pointer can change.
    // The JSON string also preserves empty arrays during an RTDB round trip.
    await store.write('versions/' + digest, JSON.stringify(envelope));
    const time = now();
    const assetIds = [...new Set(appearanceAssetReferences(skin).map((ref) => ref.id))];
    await store.update((current) => {
      const history = current[skin.id] || [],
        previous = history.at(-1);
      if (previous?.digest === digest) return current;
      if ((previous?.digest ?? null) !== expected)
        throw releaseError('Another editor changed the active release. Refresh before continuing.', 409);
      if (history.length >= 256 || (!previous && Object.keys(current).length >= 128))
        throw releaseError('The release history is full.', 409);
      const incoming = new Set(assetIds);
      const shared = Object.entries(current).some(
        ([id, versions]) =>
          id !== skin.id && versions.some((row) => row.assetIds.some((asset) => incoming.has(asset)))
      );
      if (shared)
        throw releaseError(
          'A different premium skin reserved this artwork. Refresh and choose independent assets.',
          409
        );
      const activation = {
        digest,
        name: skin.name,
        activatedAt: Math.max(time, previous?.activatedAt ?? 0),
        rewardRule,
        assetIds,
      };
      return { ...current, [skin.id]: [...history, activation] };
    });
    return proof(lane, skin.id, digest);
  }
  async function withdraw(lane, id, expected) {
    if (!/^skin-[A-Za-z0-9_-]{1,75}$/.test(id || '') || !validDigest(expected)) {
      throw releaseError('Select the active version to withdraw.');
    }
    const time = now();
    await getStore(lane).update((current) => {
      const history = current[id] || [],
        previous = history.at(-1);
      if (!previous?.digest && history.at(-2)?.digest === expected) return current;
      if (previous?.digest !== expected)
        throw releaseError('This release changed. Refresh before withdrawing it.', 409);
      return {
        ...current,
        [id]: [
          ...history,
          {
            digest: null,
            name: previous.name,
            activatedAt: Math.max(time, previous.activatedAt),
            assetIds: [],
          },
        ],
      };
    });
    return { id, withdrawn: true };
  }
  async function rewardSkins() {
    const records = Object.entries(await index(activeLane));
    return records
      .filter(([, history]) => history.at(-1)?.digest)
      .map(([id, history]) => {
        const last = history.at(-1);
        return {
          skin: { id, name: last.name },
          loadSkin: async () =>
            cache.get(last.digest) ?? (await hydrated(await version(activeLane, last.digest))),
          rewardRule: last.rewardRule,
          activatedAt: last.activatedAt,
          rewardHistory: history
            .slice(0, -1)
            .map((row, i) => ({
              rewardRule: row.rewardRule,
              activatedAt: row.activatedAt,
              retiredAt: history[i + 1].activatedAt,
            }))
            .filter((row) => row.rewardRule),
        };
      });
  }
  async function reservedSkins() {
    return Object.entries(await index(activeLane)).map(([id, history]) => ({
      id,
      reservedAssetIds: [...new Set(history.flatMap((row) => row.assetIds))],
    }));
  }
  async function status(id) {
    const lanes = {};
    for (const lane of Object.keys(stores)) {
      const rows = (await index(lane))[id] || [];
      lanes[lane] = rows.map(({ digest, name, activatedAt }) => ({ digest, name, activatedAt })).reverse();
    }
    return { environment, lanes };
  }
  return {
    environment,
    activeLane,
    status,
    activate,
    withdraw,
    proof,
    version,
    hydrated,
    rewardSkins,
    reservedSkins,
  };
}
