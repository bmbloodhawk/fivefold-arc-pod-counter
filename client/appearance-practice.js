const colors = { W:'White', U:'Blue', B:'Black', R:'Red', G:'Green' };
const ticketPattern = /^[A-Za-z0-9_-]{32}$/;
const ticketRequest = {credentials:'omit', cache:'no-store', redirect:'error', referrerPolicy:'no-referrer'};
const checkEvery = 10_000;
const offlineGrace = 30_000;

function monitorTicket(path, expiresAt, verifiedAt, {pause, resume, end}) {
  let lastVerified = verifiedAt, paused = false, closed = false, pending;
  let graceTimer, expiryTimer, interval;
  const listeners = new AbortController();
  function finish(message) {
    if (closed) return;
    closed = true;
    clearTimeout(graceTimer); clearTimeout(expiryTimer); clearInterval(interval);
    listeners.abort(); pending?.abort();
    end(message);
  }
  function checkTime() {
    if (Date.now() >= expiresAt) {
      finish('This practice link has expired. Create a new phone test in the desktop Studio.');
    } else if (!closed && !paused && Date.now() - lastVerified >= offlineGrace) {
      paused = true;
      pause();
    }
  }
  function scheduleGrace() {
    clearTimeout(graceTimer);
    graceTimer = setTimeout(checkTime, Math.max(0, lastVerified + offlineGrace - Date.now()));
  }
  async function verify() {
    checkTime();
    if (closed || pending || document.hidden) return;
    const request = new AbortController();
    pending = request;
    const timeout = setTimeout(()=>request.abort(), 7_000);
    try {
      const response = await fetch(path+'/status', {...ticketRequest,signal:request.signal});
      if (closed) return;
      if (response.status === 404 || response.status === 410) {
        finish('This practice link has ended. Create a new phone test in the desktop Studio.');
        return;
      }
      if (!response.ok) return;
      const status = await response.json();
      if (closed || status.expiresAt !== expiresAt) return;
      checkTime();
      if (closed) return;
      lastVerified = Date.now();
      scheduleGrace();
      if (paused) { paused = false; resume(); }
    } catch {
      // A sleeping phone, lost Wi-Fi or unavailable desktop can reconnect
      // without losing the in-memory table. The local grace timer still runs.
    } finally {
      clearTimeout(timeout);
      pending = null;
    }
  }
  const listen = (target, name, callback, capture=false) =>
    target.addEventListener(name,callback,{capture,signal:listeners.signal});
  const guardInput = event => {
    if (!event.target.closest?.('main,dialog')) return;
    checkTime();
    if (!paused && !closed) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!closed) void verify();
  };
  for (const name of ['pointerdown','keydown','submit','click']) listen(document,name,guardInput,true);
  listen(document, 'visibilitychange', verify);
  for (const name of ['online','focus','pageshow']) listen(window,name,verify);
  expiryTimer = setTimeout(checkTime,Math.max(0,expiresAt-Date.now()));
  interval = setInterval(verify,checkEvery);
  scheduleGrace();
  checkTime();
}

function practiceOptions(skin, game) {
  const dialog = document.createElement('dialog');
  dialog.className = 'practice-options';
  dialog.setAttribute('aria-labelledby','practiceTitle');
  dialog.innerHTML = `<h2 id="practiceTitle">Practice table</h2>
    <p data-practice-name></p>
    <label>Interface <select data-practice-style><option value="dial">Dial</option><option value="button">Button</option></select></label>
    <label>Commander seat <select data-practice-seat></select></label>
    <fieldset data-practice-commander><legend>Commander colors</legend></fieldset>
    <label class="practice-check"><input type="checkbox" data-practice-partner> Partner commander</label>
    <fieldset data-practice-colleague><legend>Partner colors</legend></fieldset>
    <div class="practice-actions"><button type="button" data-practice-reset>Restart practice</button>
      <button type="button" data-practice-done>Back to table</button></div>`;
  const find = selector => dialog.querySelector(selector);
  find('[data-practice-name]').textContent = skin.name;
  const seat = find('[data-practice-seat]'), style = find('[data-practice-style]'), partner = find('[data-practice-partner]');
  const groups = [find('[data-practice-commander]'),find('[data-practice-colleague]')];
  for (const group of groups) for (const [value,labelText] of Object.entries(colors)) {
    const label = document.createElement('label'), box = document.createElement('input');
    label.className = 'practice-color';
    box.type = 'checkbox'; box.value = value;
    label.append(box,document.createTextNode(labelText)); group.append(label);
  }
  function renderColors() {
    const player = game.snapshot().seats.find(item=>item.id===seat.value);
    if (!player) return;
    const identities = player.identities;
    partner.checked = identities.length > 1;
    groups[1].hidden = !partner.checked;
    groups.forEach((group,index)=>group.querySelectorAll('input').forEach(box=>{box.checked=(identities[index] || []).includes(box.value);}));
  }
  const applyColors = () => {
    const selected = groups.slice(0, partner.checked ? 2 : 1)
      .map(group=>[...group.querySelectorAll('input:checked')].map(box=>box.value));
    game.changeColors(seat.value,selected);
    renderColors();
  };
  for (const group of groups) group.addEventListener('change',applyColors);
  partner.addEventListener('change',applyColors);
  seat.addEventListener('change',renderColors);
  style.addEventListener('change',()=>game.changeStyle(style.value));
  find('[data-practice-done]').addEventListener('click',()=>dialog.close());
  find('[data-practice-reset]').addEventListener('click',async()=>{ dialog.close(); await game.start(skin); });
  document.body.append(dialog);
  function open() {
    const current = game.snapshot();
    seat.replaceChildren(...current.seats.map(item=>new Option(item.name + (item.id===current.owner ? ' (you)' : ''),item.id)));
    seat.value = current.inspected; style.value = current.style; renderColors(); dialog.showModal();
  }
  return {dialog,open};
}

export async function openPractice(ticket, game) {
  const main = document.querySelector('main'), field = document.getElementById('gameView');
  const launcher = document.getElementById('moreButton');
  const link = document.createElement('link'); link.rel='stylesheet'; link.href='./appearance-practice.css'; document.head.append(link);
  const notice = document.createElement('section'); notice.className='practice-notice'; notice.setAttribute('role','status');
  notice.textContent='Opening practice table…'; main.after(notice);
  function hideTable(message, status) {
    main.inert = true; main.hidden = true;
    for (const modal of document.querySelectorAll('dialog[open]')) modal.close();
    notice.hidden = false; notice.textContent = message;
    document.documentElement.dataset.releasePractice = status;
  }
  const end = message => hideTable(message,'closed');
  try {
    if (!ticketPattern.test(ticket)) throw new Error('invalid');
    const path = '/api/studio-playtests/'+ticket;
    const response = await fetch(path,ticketRequest);
    if (!response.ok) throw new Error('unavailable');
    const {skin,digest,expiresAt} = await response.json();
    if (!skin?.id || !/^[0-9a-f]{64}$/.test(digest) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('expired');
    const verifiedAt = Date.now();
    await game.start(skin);
    if (expiresAt <= Date.now()) throw new Error('expired');
    const options = practiceOptions(skin,game);
    document.documentElement.dataset.releasePractice = 'ready';
    for (const child of main.children) if (child !== field) child.inert = true;
    const localDialogs = ['customLifeDialog','commanderSourceDialog','commanderTaxDialog','radiationDialog'];
    for (const id of localDialogs) document.getElementById(id).inert = false;
    document.getElementById('lobbyControls').inert = true;
    document.getElementById('gameMenu').inert = true;
    notice.hidden = true; main.hidden = false; main.inert = false;
    launcher.textContent = 'Practice';
    launcher.setAttribute('aria-label','Practice options'); launcher.setAttribute('aria-haspopup','dialog');
    launcher.removeAttribute('aria-expanded');
    launcher.addEventListener('click',event=>{event.stopImmediatePropagation();options.open();},true);
    // These controls use the game's local adapter; reports, profiles, sign-in
    // and room management stay unreachable from the practice table.
    const allowed = 'button[data-delta],button[data-mode],button[data-seat],#endTurnButton,#undoTurnButton,#undoEliminationButton,#customLifeButton,#viewCommanderDamageButton,#commanderTaxQuickButton,#moreButton,[data-inline-source-choice],.selected-source-button,#dialGesture';
    field.addEventListener('click',event=>{
      const action = event.target.closest('button,a,input,select,[role="button"]');
      if (action && !action.matches(allowed)) { event.preventDefault(); event.stopImmediatePropagation(); }
    },true);
    monitorTicket(path,expiresAt,verifiedAt,{
      pause: () => hideTable('Practice paused. Reconnect to the computer running the desktop Studio to continue this table.','paused'),
      resume: () => { notice.hidden = true; main.hidden = false; main.inert = false; document.documentElement.dataset.releasePractice = 'ready'; },
      end,
    });
  } catch {
    end('This practice link is unavailable or has expired. Create a new phone test in the desktop Studio.');
  }
}
