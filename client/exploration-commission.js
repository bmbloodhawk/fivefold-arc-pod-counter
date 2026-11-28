const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
})[character]);
const count = (value, max) => Math.min(max, Math.max(0, Math.floor(Number(value) || 0)));

export function explorationCommissionHtml(mission, deviceTimeZone = '') {
  const started = mission?.startedAt != null;
  const timeZone = started ? mission.timeZone : deviceTimeZone;
  const objectives = [
    ['commanders', 'Command Rotation', mission?.commanderVariety, 2, 'Distinct eligible commanders across separate starting lineups and completed games.'],
    ['turns', 'Survey Record', mission?.recordedTurns, 25, 'Recorded personal turns in qualifying completed games.'],
    ['dates', 'Return Voyages', mission?.playDates, 3, 'Different play dates; they need not be consecutive.'],
  ];
  return `<h4>Exploration Commission</h4>
    <p class="exploration-intro">A Star Trek commander mission. Complete all three objectives across at least three play dates.</p>
    <ul class="exploration-objectives">${objectives.map(([id, title, value, max, detail]) => {
      const current = count(value, max);
      return `<li><div class="exploration-objective-heading"><label for="exploration-${id}">${title}</label><strong>${current}/${max}</strong></div>
        <progress id="exploration-${id}" value="${current}" max="${max}"></progress><small>${detail}</small></li>`;
    }).join('')}</ul>
    <p class="exploration-timezone">${started ? 'Play dates stay in' : 'Begin with play dates in'} <strong>${escapeHtml(timeZone || 'your named timezone')}</strong>.${started ? ' Later timezone changes do not move earlier games.' : ' This timezone will stay with this mission.'}</p>
    ${started ? '' : '<button type="button" class="secondary-action" data-begin-exploration>Begin mission</button>'}
    <p class="exploration-status" role="status">${mission?.earnedAt != null ? 'Mission complete. Exploration Commission is permanently earned.' : ''}</p>
    <details><summary>Qualifying games</summary><p>Begin before starting a game. Signed-in, verified standard Commander completions count, including wins, losses, and completed draws. Use an eligible Star Trek commander in your starting lineup. Practice, abandoned, and manually entered games do not count.</p><p>Different printings count as one card. Reversing partners or replaying an identical pair cannot fill both commander slots. Only recorded personal turns count.</p></details>`;
}

export async function startExplorationCommission({token, timeZone, fetchImpl = fetch}) {
  if (!token) throw new Error('Sign in to begin this mission.');
  if (!timeZone) throw new Error('Your browser could not identify a named timezone. Check your device timezone, then try again.');
  const response = await fetchImpl('/api/account/missions/exploration-commission/start', {
    method:'POST', headers:{authorization:'Bearer ' + token, 'content-type':'application/json'},
    body:JSON.stringify({timeZone}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'The mission could not begin. Try again.');
  return data.mission;
}

export function mountExplorationCommission(container, mission, {getToken, isCurrent = () => true,
  readTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone, fetchImpl = fetch} = {}) {
  let deviceTimeZone = '';
  try { deviceTimeZone = readTimeZone(); } catch { /* The begin action explains missing timezone support. */ }
  container.className = 'exploration-commission';
  container.innerHTML = explorationCommissionHtml(mission, deviceTimeZone);
  const button = container.querySelector('[data-begin-exploration]');
  if (!button) return;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    const status = container.querySelector('.exploration-status');
    status.textContent = 'Beginning mission…';
    try {
      const token = await getToken();
      if (!isCurrent()) return;
      const started = await startExplorationCommission({token, timeZone:deviceTimeZone, fetchImpl});
      if (!isCurrent()) return;
      container.innerHTML = explorationCommissionHtml(started);
      container.querySelector('.exploration-status').textContent = 'Mission begun. Your next qualifying game can advance it.';
    } catch (error) {
      if (isCurrent()) { status.textContent = error.message || 'The mission could not begin. Try again.'; button.disabled = false; }
    }
  });
}
