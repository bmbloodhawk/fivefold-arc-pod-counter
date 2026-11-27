const base = '/api/appearance-studio/releases/';
const modes = ['life', 'commander', 'radiation', 'poison', 'energy', 'generic'];
const sizes = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
];

async function inspectScreens(skin, renderFixture, onProgress) {
  const frame = document.createElement('iframe');
  frame.title = 'Release screen checks';
  frame.inert = true;
  frame.tabIndex = -1;
  frame.className = 'studio-release-check-frame';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The game preview did not open.')), 12000);
      frame.addEventListener(
        'load',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      frame.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('Could not open the game renderer.'));
        },
        { once: true }
      );
      frame.src = '/index.html?appearance-preview=1';
      document.body.append(frame);
    });
    let count = 0;
    for (const size of sizes)
      for (const interfaceStyle of ['button', 'dial'])
        for (const mode of modes) {
          onProgress('Checking ' + size.width + ' px · ' + interfaceStyle + ' · ' + mode);
          const results = await renderFixture(
            frame,
            { ...skin, interfaceStyle, previewMode: mode, previewState: 'turn', previewPlayers: 4 },
            size
          );
          const failed = results.filter((check) => !check.pass);
          if (failed.length)
            throw new Error(
              size.width + ' px ' + interfaceStyle + ' ' + mode + ' — ' + failed.map((f) => f.label).join(', ')
            );
          count++;
        }
    return count;
  } finally {
    frame.remove();
  }
}

export function mountStudioReleaseEditor({ mount, headers, prepareDraft, renderFixture, getSelectedId }) {
  const panel = document.createElement('section');
  panel.className = 'inspector-block studio-release';
  panel.id = 'studioReleaseEditor';
  panel.innerHTML = `<h3>Skin release</h3>
    <div class="release-actions"><button type="button" data-action="prepare">Prepare saved skin</button>
    <label class="release-file">Open release file<input type="file" accept=".json,application/json" data-file></label>
    <button type="button" data-action="history">Show selected skin’s release history</button></div>
    <p data-version>No version selected.</p><p data-destination></p>
    <details><summary>Move a version between environments</summary><p>Download the version here. Open the file in the staging Studio, run its release checks, then stage it. Open the same file in the public Studio to promote the tested version. To roll back, open an earlier version from history and repeat the checks.</p></details>
    <div data-tools hidden>
      <div class="release-actions"><button type="button" data-action="download">Download version</button>
      <button type="button" data-action="checks">Run release checks</button></div>
      <div class="release-actions"><button type="button" data-action="play">Open practice preview</button>
      <button type="button" data-action="phone">Phone QR</button></div>
      <label data-networks hidden>Phone network<select data-network></select></label>
      <div data-session hidden><a target="_blank" rel="noopener noreferrer" data-link>Open playable table</a>
        <img width="180" height="180" data-qr alt="Scan to playtest this version"><button type="button" data-action="stop">End playtest</button></div>
      <div class="release-actions"><button type="button" data-action="staging">Stage version</button>
      <button type="button" data-action="public">Promote tested version</button></div>
    </div><div data-history-tools hidden>
      <p data-history-status></p><label data-previous hidden>Release history<select data-history></select></label>
      <button type="button" data-action="restore" hidden>Open version from history</button>
      <div class="release-actions"><button type="button" data-action="withdraw-staging" hidden>Withdraw from staging</button>
      <button type="button" data-action="withdraw-public" hidden>Withdraw from public</button></div>
    </div><p data-result role="status" aria-live="polite"></p>`;
  mount.after(panel);
  const get = (q) => panel.querySelector(q),
    action = (name) => get('[data-action="' + name + '"]');
  let release,
    info,
    infoId,
    checked,
    busy = false,
    session,
    source,
    stale = false,
    draftId;
  let draftState,
    draftChange = 0;
  const selectedId = () => getSelectedId?.() ?? draftState?.selectedId;
  const validId = (id) => /^skin-[A-Za-z0-9_-]{1,75}$/.test(id || '');
  const changedMessage = 'The draft changed. Prepare the saved skin again before running release checks.';
  function note(message) {
    get('[data-result]').textContent = message;
  }
  async function request(path, body) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message || 'Could not complete the release action.');
    return data;
  }
  const status = (id) => request('status?skin=' + encodeURIComponent(id));
  async function refresh() {
    info = await status(infoId);
    draw();
  }
  const destination = (lane) =>
    info.environment === 'local'
      ? 'the ' + lane + ' rehearsal on this computer'
      : lane === 'public'
        ? 'the public game'
        : 'the staging game';
  function draw() {
    get('[data-tools]').hidden = !release;
    get('[data-version]').textContent = release
      ? release.body.skin.name +
        ' · ' +
        release.digest.slice(0, 12) +
        ' · ' +
        release.body.assets.length +
        ' images' +
        (stale ? ' · edited since preparation' : '')
      : 'No version selected.';
    const local = info?.environment === 'local';
    get('[data-destination]').textContent = [
      local ? 'Local rehearsal on this computer' : info ? 'Release destination: ' + info.environment : '',
      info?.writeUnavailable,
    ]
      .filter(Boolean)
      .join(' · ');
    const network = get('[data-network]'),
      savedAddress = network.value;
    const choices = local ? info.networks || [] : [];
    network.replaceChildren(...choices.map(({ name, address }) => new Option(name + ' · ' + address, address)));
    if (choices.some((row) => row.address === savedAddress)) network.value = savedAddress;
    get('[data-networks]').hidden = choices.length < 2;
    network.disabled = busy;
    for (const btn of panel.querySelectorAll('button')) btn.disabled = busy;
    action('history').disabled = busy || !validId(selectedId());
    get('[data-file]').disabled = busy;
    const history = get('[data-history]'),
      previous = history.value;
    history.replaceChildren();
    history.disabled = busy;
    const states = [];
    for (const lane of ['staging', 'public']) {
      const rows = info?.lanes?.[lane];
      const active = rows?.[0];
      action(lane).hidden = !rows;
      action(lane).disabled =
        busy ||
        stale ||
        Boolean(info?.writeUnavailable) ||
        !release ||
        checked !== release.digest ||
        rows?.[0]?.digest === release.digest;
      action(lane).textContent =
        lane === 'staging'
          ? local
            ? 'Rehearse staging'
            : 'Stage version'
          : local
            ? 'Rehearse public promotion'
            : 'Promote tested version';
      const withdraw = action('withdraw-' + lane);
      withdraw.hidden = !active?.digest;
      withdraw.disabled = busy || stale || Boolean(info?.writeUnavailable);
      withdraw.textContent = local ? 'Rehearse ' + lane + ' withdrawal' : 'Withdraw from ' + lane;
      if (active)
        states.push(
          (active.name || infoId) +
            ' · ' +
            lane +
            ' · ' +
            (active.digest ? 'active ' + active.digest.slice(0, 10) : 'withdrawn')
        );
      for (const [i, row] of (rows || []).entries()) {
        if (!row.digest) continue;
        const value = lane + '/' + row.digest;
        if ([...history.options].some((o) => o.value === value)) continue;
        history.add(new Option(lane + ' · ' + row.digest.slice(0, 10) + (i === 0 ? ' · active' : ''), value));
      }
    }
    get('[data-history-status]').textContent = states.join(' / ');
    get('[data-history-tools]').hidden = !states.length;
    if ([...history.options].some((o) => o.value === previous)) history.value = previous;
    get('[data-previous]').hidden = action('restore').hidden = !history.length;
    for (const key of ['download', 'checks', 'play', 'phone']) action(key).disabled = busy || stale;
    get('[data-session]').hidden = !session;
  }
  async function select(value, where, assertCurrent = () => {}) {
    assertCurrent();
    const id = value.body.skin.id;
    const nextInfo = await status(id);
    assertCurrent();
    if (session && session.digest !== value.digest) await stop();
    assertCurrent();
    release = value;
    info = nextInfo;
    infoId = id;
    source = where;
    checked = null;
    stale = false;
    draftId = id;
    note('Version ready for checks and phone review.');
  }
  async function work(fn) {
    if (busy) return;
    busy = true;
    draw();
    try {
      await fn();
    } catch (e) {
      note(e.message || 'Release failed.');
    } finally {
      busy = false;
      draw();
    }
  }
  const click = (name, fn) => action(name).addEventListener('click', () => void work(fn));
  click('history', async () => {
    const id = selectedId();
    if (!validId(id)) throw new Error('Select a custom skin in the Studio first.');
    const assertCurrent = () => {
      if (selectedId() !== id) throw new Error('The selected skin changed. Open its release history again.');
    };
    const nextInfo = await status(id);
    assertCurrent();
    if (release && release.body.skin.id !== id) {
      await stop();
      assertCurrent();
      release = null;
      source = null;
      checked = null;
      stale = false;
    }
    info = nextInfo;
    infoId = id;
    const hasHistory = Object.values(info.lanes).some((rows) => rows.length);
    note(
      hasHistory
        ? 'Choose a saved version to open.'
        : info.writeUnavailable || 'This skin has no releases in this environment.'
    );
  });
  click('prepare', async () => {
    const input = await prepareDraft(),
      revision = draftChange;
    const assertCurrent = () => {
      if (draftChange !== revision || (draftState && (draftState.dirty || draftState.selectedId !== input.id)))
        throw new Error(changedMessage);
    };
    assertCurrent();
    const value = await request('prepare', input);
    await select(value, 'draft', assertCurrent);
  });
  get('[data-file]').addEventListener(
    'change',
    () =>
      void work(async () => {
        const field = get('[data-file]'),
          file = field.files[0];
        field.value = '';
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) throw new Error('Choose a release file under 8 MiB.');
        const value = JSON.parse(await file.text());
        await request('inspect', { release: value });
        await select(value, 'file');
      })
  );
  click('download', async () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(release)], { type: 'application/json' }));
    link.download =
      release.body.skin.name.replace(/[^\p{L}\p{N}-]+/gu, '-') +
      '-' +
      release.digest.slice(0, 12) +
      '.fivefold-skin.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 30000);
    note('Release file downloaded.');
  });
  click('checks', async () => {
    const candidate = release;
    const assertCurrent = () => {
      if (stale || release !== candidate) throw new Error(changedMessage);
    };
    checked = null;
    const result = await request('render-check', { release: candidate });
    assertCurrent();
    const count = await inspectScreens(result.skin, renderFixture, (message) => {
      assertCurrent();
      note(message);
    });
    assertCurrent();
    checked = candidate.digest;
    note(count + ' game screens passed. Reward checks passed: ' + result.accounts.join(', ') + '.');
  });
  async function stop() {
    if (!session) return;
    await request('stop-playtest', { ticket: session.ticket });
    session = null;
    get('[data-link]').removeAttribute('href');
    get('[data-qr]').removeAttribute('src');
  }
  for (const key of ['play', 'phone'])
    click(key, async () => {
      if (
        key === 'phone' &&
        info?.environment === 'local' &&
        !window.confirm(
          'Share this skin on your trusted local network for up to one hour? Only this practice table and its artwork will be available.'
        )
      )
        return;
      const networkAddress = key === 'phone' && !get('[data-networks]').hidden && get('[data-network]').value;
      await stop();
      session = await request('playtest', {
        release,
        wifi: key === 'phone',
        ...(networkAddress ? { networkAddress } : {}),
      });
      if (stale || session.digest !== release.digest) {
        await stop();
        throw new Error(changedMessage);
      }
      get('[data-link]').href = session.url;
      get('[data-qr]').src = session.qr;
      get('[data-qr]').hidden = key !== 'phone';
      note(
        key === 'phone'
          ? 'Scan on your phone. End playtest closes the link.'
          : 'Your practice table is ready. Open the playable table.'
      );
    });
  click('stop', async () => {
    await stop();
    note('Playtest ended.');
  });
  for (const lane of ['staging', 'public'])
    click(lane, async () => {
      const scope = destination(lane);
      if (
        !window.confirm(
          'Activate ' +
            release.body.skin.name +
            ' (' +
            release.digest.slice(0, 12) +
            ') in ' +
            scope +
            '? Existing owners keep access.'
        )
      )
        return;
      const result = await request('activate', {
        lane,
        release,
        expected: info.lanes[lane][0]?.digest ?? null,
      });
      if (!result.verified) throw new Error('Activation was not confirmed.');
      await refresh();
      note('Verified ' + release.digest.slice(0, 12) + ' in ' + scope + '.');
    });
  for (const lane of ['staging', 'public'])
    click('withdraw-' + lane, async () => {
      const id = infoId,
        active = info.lanes[lane]?.[0],
        scope = destination(lane);
      if (stale || !active?.digest || (!release && selectedId() !== id))
        throw new Error('Open the active skin’s history again.');
      if (
        !window.confirm(
          'Withdraw ' +
            (active.name || id) +
            ' (' +
            active.digest.slice(0, 12) +
            ') from ' +
            scope +
            '? Players lose access until a version is restored. Previously earned unlocks carry forward.'
        )
      )
        return;
      await request('withdraw', { id, lane, expected: active.digest });
      const next = await status(id);
      if (infoId === id) info = next;
      if (next.lanes[lane]?.[0]?.digest !== null)
        throw new Error('Withdrawal was not confirmed. Review the current release history.');
      note('Verified withdrawal from ' + scope + '.');
    });
  click('restore', async () => {
    const choice = get('[data-history]').value,
      id = infoId;
    const assertCurrent = () => {
      if (infoId !== id) throw new Error('The selected skin changed. Open its release history again.');
    };
    const version = await request('version/' + choice);
    assertCurrent();
    if (version.body.skin.id !== id)
      throw new Error('This version belongs to a different skin. Open history again.');
    await select(version, 'history', assertCurrent);
  });
  document.addEventListener('studio:draft-state', ({ detail }) => {
    const changedId = detail.selectedId !== draftState?.selectedId;
    if (detail.dirty || (draftState && changedId)) draftChange++;
    draftState = detail;
    if (!release && infoId && detail.selectedId !== infoId) {
      info = null;
      infoId = null;
    }
    if (release && source === 'draft' && (detail.selectedId !== draftId || detail.dirty)) {
      stale = true;
      checked = null;
      draw();
    } else if (changedId) draw();
  });
  draw();
}
