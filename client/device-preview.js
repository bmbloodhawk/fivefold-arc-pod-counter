// Device Preview is intentionally a thin shell around the real preview iframe.
// It never re-creates game UI, so Studio changes are reviewed against the same
// renderer that runs on a phone.
const STORAGE_KEY = 'fivefold-arc:device-preview';

export const DEVICE_PRESETS = [
  { id: 'desktop-game', name: 'Desktop game window', category: 'Reference', width: 860, height: 900, dpr: 1, frame: 'plain' },
  { id: 'iphone-16', name: 'iPhone 16', category: 'iOS', width: 393, height: 852, dpr: 3, frame: 'island' },
  { id: 'iphone-16-pro', name: 'iPhone 16 Pro', category: 'iOS', width: 402, height: 874, dpr: 3, frame: 'island' },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', category: 'iOS', width: 440, height: 956, dpr: 3, frame: 'island' },
  { id: 'iphone-15', name: 'iPhone 15', category: 'iOS', width: 393, height: 852, dpr: 3, frame: 'island' },
  { id: 'iphone-15-pro', name: 'iPhone 15 Pro', category: 'iOS', width: 393, height: 852, dpr: 3, frame: 'island' },
  { id: 'iphone-se-3', name: 'iPhone SE (3rd gen)', category: 'iOS', width: 375, height: 667, dpr: 2, frame: 'notch' },
  { id: 'pixel-9', name: 'Google Pixel 9', category: 'Android', width: 412, height: 915, dpr: 2.625, frame: 'hole' },
  { id: 'pixel-9-pro', name: 'Google Pixel 9 Pro', category: 'Android', width: 412, height: 915, dpr: 3.5, frame: 'hole' },
  { id: 'galaxy-s24', name: 'Samsung Galaxy S24', category: 'Android', width: 360, height: 780, dpr: 3, frame: 'hole' },
  { id: 'galaxy-s24-ultra', name: 'Samsung Galaxy S24 Ultra', category: 'Android', width: 412, height: 915, dpr: 3.5, frame: 'hole' },
  { id: 'fold-folded', name: 'Galaxy Z Fold (folded)', category: 'Android', width: 344, height: 882, dpr: 3, frame: 'hole' },
  { id: 'fold-open', name: 'Galaxy Z Fold (unfolded)', category: 'Android', width: 690, height: 829, dpr: 2.625, frame: 'hole' },
  { id: 'ipad-mini', name: 'iPad mini', category: 'Tablet', width: 744, height: 1133, dpr: 2, frame: 'tablet' },
  { id: 'ipad-pro-11', name: 'iPad Pro 11-inch', category: 'Tablet', width: 834, height: 1194, dpr: 2, frame: 'tablet' },
  { id: 'android-360', name: 'Android 360 × 800', category: 'Generic', width: 360, height: 800, dpr: 3, frame: 'plain' },
  { id: 'android-390', name: 'Android 390 × 844', category: 'Generic', width: 390, height: 844, dpr: 3, frame: 'plain' },
  { id: 'android-412', name: 'Android 412 × 915', category: 'Generic', width: 412, height: 915, dpr: 3, frame: 'plain' }
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const defaultState = { presetId: 'iphone-16', orientation: 'portrait', zoom: 'fit', frame: true, safe: true, scheme: 'system', network: 'online', count: 1, category: 'All', query: '', custom: [], slots: [] };
function loadState() { try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { return { ...defaultState }; } }

export function mountDevicePreview({ primaryFrame, getSkin }) {
  const state = loadState();
  const panel = document.createElement('section');
  panel.className = 'device-preview-panel';
  panel.innerHTML = `<div class="device-preview-heading"><div><p class="kicker">DEVICE PREVIEW</p><h2>Phone Simulator</h2><p class="helper">This is the live game renderer at the selected viewport. Choose the same device or desktop window you are checking.</p></div><span id="devicePreviewMeta" class="device-preview-meta"></span></div>
    <div class="device-preview-controls"><label>Find device<input id="deviceSearch" type="search" placeholder="Search iPhone or size"></label><label>Category<select id="deviceCategory"><option>All</option><option>Reference</option><option>iOS</option><option>Android</option><option>Tablet</option><option>Generic</option><option>Custom</option></select></label><label>Device<select id="devicePreset"></select></label><button id="deviceRotate" type="button" class="quiet">Rotate</button><label>Zoom<select id="deviceZoom"><option value="fit">Fit</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option><option value="125">125%</option></select></label><label>Views<select id="deviceCount"><option value="1">1 device</option><option value="2">2 devices</option><option value="4">4 devices</option></select></label></div>
    <div class="device-preview-toggles"><label><input id="deviceFrame" type="checkbox"> Device frame</label><label><input id="deviceSafe" type="checkbox"> Safe areas</label><label>Appearance<select id="deviceScheme"><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label><label>Network<select id="deviceNetwork"><option value="online">Online</option><option value="slow">Slow network</option><option value="offline">Offline</option></select></label></div>
    <section id="deviceComparisonSetup" class="device-comparison-setup" hidden></section>
    <details class="device-custom"><summary>Add a custom device</summary><div><label>Name<input id="customDeviceName" maxlength="40" placeholder="My phone"></label><label>Width<input id="customDeviceWidth" type="number" min="240" max="1600" value="393"></label><label>Height<input id="customDeviceHeight" type="number" min="400" max="1800" value="852"></label><label>DPR<input id="customDeviceDpr" type="number" min="1" max="5" step="0.125" value="3"></label><label>Frame<select id="customDeviceFrame"><option value="island">Dynamic Island</option><option value="notch">Notch</option><option value="hole">Camera hole</option><option value="plain">Plain</option><option value="tablet">Tablet</option></select></label><button id="saveCustomDevice" type="button">Save device</button></div></details>
    <div id="devicePreviewGrid" class="device-preview-grid" aria-live="polite"></div>`;
  primaryFrame.closest('.preview-area').insertBefore(panel, primaryFrame.closest('.preview-area').querySelector('#compareNote'));
  const $ = selector => panel.querySelector(selector);
  const allDevices = () => [...DEVICE_PRESETS, ...state.custom];
  const selected = () => allDevices().find(device => device.id === state.presetId) || DEVICE_PRESETS[0];
  // Each visible shell owns its device and orientation. The first shell stays
  // connected to the main picker so single-device use remains simple.
  function syncSlots() {
    const devices = allDevices(); const used = new Set(); const fallbacks = ['iphone-se-3', 'pixel-9', 'galaxy-s24', 'ipad-mini'];
    state.slots = Array.isArray(state.slots) ? state.slots : [];
    for (let index = 0; index < state.count; index += 1) {
      const existing = state.slots[index]; let presetId = existing?.presetId;
      if (!devices.some(device => device.id === presetId) || (index > 0 && used.has(presetId))) presetId = index === 0 ? state.presetId : fallbacks.find(id => devices.some(device => device.id === id) && !used.has(id)) || devices.find(device => !used.has(device.id))?.id || state.presetId;
      state.slots[index] = { presetId, orientation: existing?.orientation === 'landscape' ? 'landscape' : index === 0 && state.orientation === 'landscape' ? 'landscape' : 'portrait' };
      used.add(presetId);
    }
    state.slots.length = state.count; state.presetId = state.slots[0]?.presetId || state.presetId; state.orientation = state.slots[0]?.orientation || state.orientation;
  }
  const deviceForSlot = index => allDevices().find(device => device.id === state.slots[index]?.presetId) || DEVICE_PRESETS[0];
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const post = frame => { frame.classList.add('device-preview-frame'); frame.contentWindow?.postMessage({ type: 'fivefold-arc:appearance-skin', skin: { ...getSkin(), previewColorScheme: state.scheme, previewSafeBottom: Number(frame.dataset.previewSafeBottom) || 0 } }, location.origin); };
  function options() {
    const query = state.query.trim().toLowerCase();
    const devices = allDevices().filter(device => (state.category === 'All' || device.category === state.category) && `${device.name} ${device.width} ${device.height}`.toLowerCase().includes(query));
    $('#devicePreset').innerHTML = devices.map(device => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.name)} — ${device.width} × ${device.height}</option>`).join('') || '<option value="">No matching devices</option>';
    if (!devices.some(device => device.id === state.presetId)) state.presetId = devices[0]?.id || DEVICE_PRESETS[0].id;
    $('#devicePreset').value = state.presetId;
  }
  function dimensions(device, orientation) { return orientation === 'landscape' ? { width: device.height, height: device.width } : device; }
  function displayScale(width) {
    const requested = state.zoom === 'fit' ? .75 : Number(state.zoom) / 100;
    const columns = state.count === 1 || window.innerWidth <= 720 ? 1 : 2;
    const usableWidth = Math.max(220, ($('#devicePreviewGrid').clientWidth - 36 - ((columns - 1) * 22)) / columns);
    return Math.min(requested, usableWidth / (width + 20));
  }
  function createShell(frame, device, slotIndex) {
    const slot = state.slots[slotIndex]; const { width, height } = dimensions(device, slot.orientation); const shell = document.createElement('article');
    shell.className = `sim-device frame-${device.frame}${state.frame ? '' : ' no-frame'} ${slot.orientation}`;
    const scale = displayScale(width); shell.style.setProperty('--device-width', `${width}px`); shell.style.setProperty('--device-height', `${height}px`);
    shell.style.setProperty('--device-scale', String(scale)); shell.style.setProperty('--sim-layout-width', `${Math.ceil((width + 20) * scale)}px`); shell.style.setProperty('--sim-layout-height', `${Math.ceil((height + 48) * scale)}px`);
    shell.dataset.network = state.network;
    const label = document.createElement('p'); label.className = 'sim-device-label'; label.textContent = `${width} × ${height} · ${device.dpr}× DPR`;
    const screen = document.createElement('div'); screen.className = 'sim-device-screen';
    frame.className = 'exact-preview device-preview-frame'; frame.tabIndex = -1; frame.style.width = `${width}px`; frame.style.height = `${height}px`; frame.dataset.previewSafeBottom = state.safe && device.category === 'iOS' && slot.orientation === 'portrait' ? '34' : '0';
    screen.append(frame); shell.append(label, screen);
    if (state.safe) { const status = document.createElement('span'); status.className = 'sim-status'; status.textContent = '9:41'; const home = document.createElement('span'); home.className = 'sim-home'; screen.append(status, home); }
    return shell;
  }
  function renderComparisonSetup() {
    const setup = $('#deviceComparisonSetup'); setup.hidden = state.count < 2;
    if (setup.hidden) { setup.replaceChildren(); return; }
    setup.innerHTML = `<div><strong>Compare devices</strong><p>Choose the hardware and orientation for each live preview.</p></div><div class="device-comparison-slots"></div>`;
    const slots = setup.querySelector('.device-comparison-slots');
    state.slots.forEach((slot, index) => {
      const row = document.createElement('label'); row.innerHTML = `<span>Device ${index + 1}</span><select aria-label="Comparison device ${index + 1}">${allDevices().map(device => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.name)}</option>`).join('')}</select><button type="button">${slot.orientation === 'portrait' ? 'Portrait' : 'Landscape'}</button>`;
      const picker = row.querySelector('select'); const rotate = row.querySelector('button'); picker.value = slot.presetId;
      picker.addEventListener('change', () => { state.slots[index].presetId = picker.value; if (index === 0) state.presetId = picker.value; render(); });
      rotate.addEventListener('click', () => { state.slots[index].orientation = slot.orientation === 'portrait' ? 'landscape' : 'portrait'; if (index === 0) state.orientation = state.slots[index].orientation; render(); });
      slots.append(row);
    });
  }
  function render() {
    syncSlots(); const device = deviceForSlot(0); const grid = $('#devicePreviewGrid'); const oldFrames = [...grid.querySelectorAll('iframe')];
    const primary = oldFrames.find(frame => frame.id === 'exactPreview') || primaryFrame;
    oldFrames.filter(frame => frame !== primary).forEach(frame => frame.remove()); grid.replaceChildren();
    grid.dataset.count = state.count; grid.append(createShell(primary, device, 0));
    for (let index = 1; index < state.count; index += 1) { const comparisonDevice = deviceForSlot(index); const clone = document.createElement('iframe'); clone.title = `${comparisonDevice.name} synchronized app preview ${index + 1}`; clone.src = 'index.html?appearance-preview=1'; clone.addEventListener('load', () => post(clone), { once: true }); grid.append(createShell(clone, comparisonDevice, index)); }
    renderComparisonSetup(); $('#devicePreviewMeta').textContent = `${device.width} × ${device.height} CSS px · ${device.dpr}× DPR`;
    $('#deviceRotate').textContent = state.orientation === 'portrait' ? 'Rotate landscape' : 'Rotate portrait';
    save(); post(primary); grid.querySelectorAll('iframe').forEach(post);
  }
  function bind(selector, key, value = element => element.value) { $(selector).addEventListener('change', event => { state[key] = value(event.currentTarget); render(); }); }
  $('#deviceSearch').value = state.query; $('#deviceCategory').value = state.category; $('#deviceZoom').value = state.zoom; $('#deviceCount').value = state.count; $('#deviceFrame').checked = state.frame; $('#deviceSafe').checked = state.safe; $('#deviceScheme').value = state.scheme; $('#deviceNetwork').value = state.network;
  $('#deviceSearch').addEventListener('input', event => { state.query = event.currentTarget.value; options(); save(); });
  bind('#deviceCategory', 'category'); $('#devicePreset').addEventListener('change', event => { state.presetId = event.currentTarget.value; if (state.slots[0]) state.slots[0].presetId = state.presetId; render(); }); bind('#deviceZoom', 'zoom'); bind('#deviceCount', 'count', element => Number(element.value)); bind('#deviceFrame', 'frame', element => element.checked); bind('#deviceSafe', 'safe', element => element.checked); bind('#deviceScheme', 'scheme'); bind('#deviceNetwork', 'network');
  $('#deviceRotate').addEventListener('click', () => { state.orientation = state.orientation === 'portrait' ? 'landscape' : 'portrait'; if (state.slots[0]) state.slots[0].orientation = state.orientation; render(); });
  $('#saveCustomDevice').addEventListener('click', () => { const name = $('#customDeviceName').value.trim(); const width = Number($('#customDeviceWidth').value); const height = Number($('#customDeviceHeight').value); const dpr = Number($('#customDeviceDpr').value); if (!name || !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(dpr)) return; const device = { id: `custom-${Date.now()}`, name, category: 'Custom', width: clamp(width, 240, 1600), height: clamp(height, 400, 1800), dpr: clamp(dpr, 1, 5), frame: $('#customDeviceFrame').value }; state.custom.push(device); state.category = 'Custom'; state.presetId = device.id; options(); $('#deviceCategory').value = 'Custom'; render(); });
  options(); render();
  return { sync: () => panel.querySelectorAll('iframe').forEach(post) };
}
