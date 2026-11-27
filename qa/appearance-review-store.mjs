// Opt-in storage for the loopback review fixture. This is never selected by the
// production server, and the fixture's default remains a private memory store.
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAppearanceValid, validateAppearanceAsset, validateAppearanceCatalog } from '../client/appearance-validation.js';
import { sameAppearanceAssetContent } from '../server/src/appearance-catalog.js';

const MAX_SNAPSHOT_BYTES = 600_000_000;
const invalid = message => new Error('Local review store: ' + message);
const stableId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id);
function validateSnapshot(value) {
  if (!value || value.schemaVersion !== 1 || Object.keys(value).some(key => !['schemaVersion', 'catalog', 'blobs'].includes(key)) || !Array.isArray(value.blobs) || value.blobs.length > 1000) throw invalid('unsupported or corrupt snapshot. Refusing to replace it with sample data.');
  assertAppearanceValid(validateAppearanceCatalog(value.catalog));
  const blobs = new Map();
  for (const blob of value.blobs) {
    assertAppearanceValid(validateAppearanceAsset(blob, { requireData: true }));
    if (blobs.has(blob.id)) throw invalid('duplicate private raster IDs in the snapshot.');
    blobs.set(blob.id, blob);
  }
  for (const metadata of value.catalog.assets) {
    const blob = blobs.get(metadata.id), raster = metadata.data ? metadata : blob;
    if (!raster) throw invalid('artwork “' + metadata.id + '” is missing its private raster bytes.');
    assertAppearanceValid(validateAppearanceAsset({ ...metadata, data: raster.data }, { requireData: true }));
    if (blob && !sameAppearanceAssetContent({ ...metadata, data: raster.data }, blob)) throw invalid('artwork “' + metadata.id + '” has conflicting metadata or pixels.');
  }
  return value;
}
function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
async function claimLock(path) {
  const lockPath = path + '.lock', token = randomUUID();
  const create = async () => {
    const handle = await open(lockPath, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.sync(); return handle; }
    catch (error) { await handle.close(); await unlink(lockPath).catch(() => {}); throw error; }
  };
  let handle;
  try { handle = await create(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let recovery;
    try { recovery = await open(path + '.reclaim', 'wx', 0o600); }
    catch { throw invalid('already open by another writer, or its lock is being recovered. Close that review process first.'); }
    try {
      let owner;
      try { owner = JSON.parse(await readFile(lockPath, 'utf8')); } catch { throw invalid('lock is corrupt. Inspect it before reopening this store.'); }
      if (processIsAlive(owner.pid)) throw invalid('already open by another writer. Close that review process first.');
      await unlink(lockPath); handle = await create();
    } finally { await recovery.close(); await unlink(path + '.reclaim').catch(() => {}); }
  }
  return async () => {
    await handle.close();
    let owner; try { owner = JSON.parse(await readFile(lockPath, 'utf8')); } catch { return; }
    if (owner.token === token) await unlink(lockPath);
  };
}
async function saveSnapshot(path, snapshot) {
  validateSnapshot(snapshot);
  const contents = JSON.stringify(snapshot);
  if (Buffer.byteLength(contents) > MAX_SNAPSHOT_BYTES) throw invalid('snapshot exceeds the local review size bound. Export a backup before continuing.');
  const temporary = path + '.tmp-' + randomUUID();
  let handle, replaced = false;
  try {
    handle = await open(temporary, 'wx', 0o600); await handle.writeFile(contents, 'utf8'); await handle.sync(); await handle.close(); handle = null;
    // Rename replaces the complete snapshot atomically; the previous file is
    // never deleted first. An interrupted temp file is not used during startup.
    await rename(temporary, path); replaced = true;
    let directory;
    try { directory = await open(dirname(path), 'r'); await directory.sync(); }
    catch (error) { if (!['EISDIR', 'EINVAL', 'EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error; }
    finally { await directory?.close(); }
  } catch (error) {
    if (replaced) error.reviewSnapshotCommitted = true;
    throw error;
  } finally { await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

export async function openAppearanceReviewStore({ path, seed }) {
  if (typeof path !== 'string' || !path.trim()) throw invalid('set an explicit STUDIO_REVIEW_STORE file path.');
  path = resolve(path);
  const publicRoot = fileURLToPath(new URL('../client/', import.meta.url)), publicRelative = relative(publicRoot, path);
  if (!isAbsolute(publicRelative) && publicRelative !== '..' && !publicRelative.startsWith('..' + sep)) throw invalid('private review data must be outside the public client directory.');
  await mkdir(dirname(path), { recursive: true });
  const release = await claimLock(path);
  let snapshot;
  try {
    let details;
    try { details = await stat(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (details) {
      if (!details.isFile() || details.size > MAX_SNAPSHOT_BYTES) throw invalid('snapshot is not a supported local file.');
      try { snapshot = validateSnapshot(JSON.parse(await readFile(path, 'utf8'))); }
      catch (error) { throw invalid('corrupt or unsupported snapshot; startup refused without changing it. ' + error.message); }
    } else {
      snapshot = { schemaVersion: 1, catalog: structuredClone(await (typeof seed === 'function' ? seed() : seed)), blobs: [] };
      await saveSnapshot(path, snapshot);
    }
  } catch (error) { await release(); throw error; }
  let tail = Promise.resolve(), closed = false;
  const mutate = action => {
    if (closed) return Promise.reject(invalid('this writer is closed.'));
    const operation = tail.then(async () => {
      const next = structuredClone(snapshot), result = action(next);
      try { await saveSnapshot(path, next); }
      catch (error) { if (error.reviewSnapshotCommitted) snapshot = next; throw error; }
      snapshot = next; return structuredClone(result);
    });
    tail = operation.catch(() => {}); return operation;
  };
  const assetId = id => { if (!stableId(id)) throw invalid('invalid private raster ID.'); };
  return {
    path,
    async read() { await tail; return structuredClone(snapshot.catalog); },
    write(catalog, { expectedRevision } = {}) {
      return mutate(next => {
        if (expectedRevision !== undefined && (next.catalog.revision ?? 0) !== expectedRevision) throw Object.assign(invalid('catalog changed; reload the saved review.'), { status: 409, code: 'APPEARANCE_CONFLICT' });
        next.catalog = structuredClone(catalog); return next.catalog;
      });
    },
    async readAsset(id) { assetId(id); await tail; return structuredClone(snapshot.blobs.find(asset => asset.id === id) || snapshot.catalog.assets.find(asset => asset.id === id && asset.data)); },
    writeAsset(id, asset, { createOnly = false } = {}) {
      assetId(id);
      return mutate(next => {
        if (asset.id !== id) throw invalid('asset ID must match its private storage key.');
        const index = next.blobs.findIndex(item => item.id === id), existing = next.blobs[index] || next.catalog.assets.find(item => item.id === id && item.data);
        if (createOnly && existing) { if (!sameAppearanceAssetContent(existing, asset)) throw invalid('this raster ID already contains different pixels. Import a new ID.'); return existing; }
        if (index < 0) next.blobs.push(structuredClone(asset)); else next.blobs[index] = structuredClone(asset);
        return asset;
      });
    },
    deleteAsset(id) { assetId(id); return mutate(next => { next.blobs = next.blobs.filter(asset => asset.id !== id); }); },
    async close() { if (closed) return; closed = true; await tail; await release(); },
  };
}
