import { STUDIO_REWARD_LIMIT } from './studio-reward-rule.js';

export function mountStudioRewardEditor({getDraft, change, headers}) {
  const block = document.createElement('section');
  block.className = 'inspector-block';
  block.id = 'studioRewardEditor';
  block.innerHTML = `<h3>Achievement unlock</h3>
    <label>Find an achievement<input type="search" id="rewardSearch" placeholder="Search by name or requirement"></label>
    <label>Game achievement<select id="rewardAchievement"></select></label>
    <button type="button" class="secondary-action" id="addRewardAchievement">Add requirement</button>
    <p class="helper" role="status" data-rule-state></p>
    <ul data-reward-steps></ul>
    <details><summary>Test player progress</summary>
      <fieldset><legend>Achievements earned by this test player</legend><div data-test-steps></div></fieldset>
      <p aria-live="polite" data-player-preview></p>
    </details>`;
  document.querySelector('#publicationControls').before(block);
  const search = block.querySelector('#rewardSearch');
  const picker = block.querySelector('#rewardAchievement');
  const add = block.querySelector('#addRewardAchievement');
  const state = block.querySelector('[data-rule-state]');
  let catalog = [], appliedKey, loaded = false, loading = false, error = '';
  const checked = new Set();
  const selections = () => getDraft()?.rewardRule?.allOf || [];
  function showPreview() {
    const ids = selections(), count = ids.filter(id => checked.has(id)).length;
    block.querySelector('[data-player-preview]').textContent = ids.length
      ? `${count} of ${ids.length} achievements earned · ${count === ids.length ? 'Unlocked' : 'Locked'}`
      : 'Add a requirement to test the unlock.';
  }
  function renderPicker() {
    const ids = selections(), query = search.value.trim().toLowerCase();
    const matches = catalog.filter(row => !ids.includes(row.id) && (row.title + ' ' + row.detail).toLowerCase().includes(query));
    const options = matches.map(row => new Option(row.title, row.id));
    picker.replaceChildren(...(options.length ? options : [new Option(loaded ? 'No matching achievement' : 'Load achievements', '')]));
    add.disabled = !loaded || ids.length >= STUDIO_REWARD_LIMIT || !options.length;
    picker.disabled = !loaded || !options.length;
    picker.title = catalog.find(row => row.id === picker.value)?.detail || '';
  }
  function update(ids) {
    if (ids.length) getDraft().rewardRule = {allOf: ids};
    else delete getDraft().rewardRule;
    change();
    render();
  }
  function render() {
    const ids = selections(), key = getDraft()?.id;
    if (key !== appliedKey) { appliedKey = key; checked.clear(); }
    document.querySelector('#publicationControls').hidden = ids.length > 0;
    renderPicker();
    const list = block.querySelector('[data-reward-steps]'), scenario = block.querySelector('[data-test-steps]');
    list.replaceChildren(); scenario.replaceChildren();
    for (const id of ids) {
      const row = catalog.find(item => item.id === id);
      const entry = document.createElement('li'), title = document.createElement('span'), remove = document.createElement('button');
      title.textContent = row?.title || id;
      remove.type = 'button'; remove.className = 'quiet'; remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + title.textContent);
      remove.onclick = () => { checked.delete(id); update(ids.filter(value => value !== id)); };
      entry.append(title, ' ', remove); list.append(entry);
      const label = document.createElement('label'), check = document.createElement('input');
      check.type = 'checkbox'; check.checked = checked.has(id);
      check.onchange = () => { if (check.checked) checked.add(id); else checked.delete(id); showPreview(); };
      label.append(check, ' ' + title.textContent); scenario.append(label);
    }
    state.textContent = error || (ids.length ? 'Players must earn all requirements. Earlier owners keep access when you update the rule.'
      : 'Add a requirement to make this an achievement skin.');
    showPreview();
  }
  async function load() {
    if (loaded || loading) return;
    loading = true;
    try {
      const response = await fetch('/api/appearance-studio/achievements', {headers});
      if (!response.ok) throw new Error('Open the protected Studio to choose game achievements.');
      const data = await response.json();
      catalog = data.achievements; loaded = true; error = '';
    } catch (e) { error = e.message; }
    finally { loading = false; render(); }
  }
  block.addEventListener('focusin', () => { void load(); });
  search.oninput = renderPicker;
  picker.onchange = () => { picker.title = catalog.find(row => row.id === picker.value)?.detail || ''; };
  add.onclick = () => {
    const ids = selections(), id = picker.value;
    if (catalog.some(row => row.id === id) && !ids.includes(id) && ids.length < STUDIO_REWARD_LIMIT) update([...ids, id]);
  };
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting) && headers['x-feedback-portal-key']) void load();
  });
  observer.observe(block);
  render();
  return render;
}
