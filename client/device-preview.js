// Device Preview is intentionally a thin shell around the real preview iframe.
// It never re-creates game UI, so Studio changes are reviewed against the same
// renderer that runs on a phone.
const STORAGE_KEY = 'fivefold-arc:device-preview';

export const DEVICE_PRESETS = [
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
const defaultState = { presetId: 'iphone-16', orientation: 'portrait', zoom: 'fit', frame: true, safe: true, scheme: 'system', network: 'online', count: 1, category: 'All', query: '', custom: [] };
function loadState() { try { return { ...defaultState, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; } catch { return { ...defaultState }; } }

export function mountDevicePreview({ primaryFrame, getSkin }) {
  const state = loadState();
  const panel = document.createElement('section');
  panel.className = 'device-preview-panel';
  panel.innerHTML = `<div class="device-preview-heading"><div><p class="kicker">DEVICE PREVIEW</p><h2>Phone Simulator</h2><p class="helper">Live app renderer — iPhone-first viewport review.</p></div><span id="devicePreviewMeta" class="device-preview-meta"></span></div>
    <div class="device-preview-controls"><label>Find device<input id="deviceSearch" type="search" placeholder="Search iPhone or size"></label><label>Category<select id="deviceCategory"><option>All</option><option>iOS</option><option>Android</option><option>Tablet</option><option>Generic</option><option>Custom</option></select></label><label>Device<select id="devicePreset"></select></label><button id="deviceRotate" type="button" class="quiet">Rotate</button><label>Zoom<select id="deviceZoom"><option value="fit">Fit</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option><option value="125">125%</option></select></label><label>Views<select id="deviceCount"><option value="1">1 device</option><option value="2">2 devices</option><option value="4">4 devices</option></select></label></div>
    <div class="device-preview-toggles"><label><input id="deviceFrame" type="checkbox"> Device frame</label><label><input id="deviceSafe" type="checkbox"> Safe areas</label><label>Appearance<select id="deviceScheme"><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label><label>Network<select id="deviceNetwork"><option value="online">Online</option><option value="slow">Slow network</option><option value="offline">Offline</option></select></label></div>
    <details class="device-custom"><summary>Add a custom device</summary><div><label>Name<input id="customDeviceName" maxlength="40" placeholder="My phone"></label><label>Width<input id="customDeviceWidth" type="number" min="240" max="1600" value="393"></label><label>Height<input id="customDeviceHeight" type="number" min="400" max="1800" value="852"></label><label>DPR<input id="customDeviceDpr" type="number" min="1" max="5" step="0.125" value="3"></label><label>Frame<select id="customDeviceFrame"><option value="island">Dynamic Island</option><option value="notch">Notch</option><option value="hole">Camera hole</option><option value="plain">Plain</option><option value="tablet">Tablet</option></select></label><button id="saveCustomDevice" type="button">Save device</button></div></details>
    <div id="devicePreviewGrid" class="device-preview-grid" aria-live="polite"></div>`;
  primaryFrame.closest('.preview-area').insertBefore(panel, primaryFrame.closest('.preview-area').querySelector('#compareNote'));
  const $ = selector => panel.querySelector(selector);
  const allDevices = () => [...DEVICE_PRESETS, ...state.custom];
  const selected = () => allDevices().find(device => device.id === state.presetId) || DEVICE_PRESETS[0];
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const post = frame => { frame.classList.add('device-preview-frame'); frame.contentWindow?.postMessage({ type: 'fivefold-arc:appearance-skin', skin: { ...getSkin(), previewColorScheme: state.scheme } }, location.origin); };
  function options() {
    const query = state.query.trim().toLowerCase();
    const devices = allDevices().filter(device => (state.category === 'All' || device.category === state.category) && `${device.name} ${device.width} ${device.height}`.toLowerCase().includes(query));
    $('#devicePreset').innerHTML = devices.map(device => `<option value="${escapeHtml(device.id)}">${escapeHtml(device.name)} — ${device.width} × ${device.height}</option>`).join('') || '<option value="">No matching devices</option>';
    if (!devices.some(device => device.id === state.presetId)) state.presetId = devices[0]?.id || DEVICE_PRESETS[0].id;
    $('#devicePreset').value = state.presetId;
  }
  function dimensions(device) { return state.orientation === 'landscape' ? { width: device.height, height: device.width } : device; }
  function createShell(frame, device) {
    const { width, height } = dimensions(device); const shell = document.createElement('article');
    shell.className = `sim-device frame-${device.frame}${state.frame ? '' : ' no-frame'} ${state.orientation}`;
    shell.style.setProperty('--device-width', `${width}px`); shell.style.setProperty('--device-height', `${height}px`);
    shell.style.setProperty('--device-scale', state.zoom === 'fit' ? 'var(--fit-scale)' : String(Number(state.zoom) / 100));
    shell.dataset.network = state.network;
    const label = document.createElement('p'); label.className = 'sim-device-label'; label.textContent = `${device.name} · ${width} × ${height} · ${device.dpr}×`;
    const screen = document.createElement('div'); screen.className = 'sim-device-screen';
    frame.className = 'exact-preview device-preview-frame'; frame.tabIndex = -1; frame.style.width = `${width}px`; frame.style.height = `${height}px`;
    screen.append(frame); shell.append(label, screen);
    if (state.safe) { const status = document.createElement('span'); status.className = 'sim-status'; status.textContent = '9:41'; const home = document.createElement('span'); home.className = 'sim-home'; shell.append(status, home); }
    return shell;
  }
  function render() {
    const device = selected(); const grid = $('#devicePreviewGrid'); const oldFrames = [...grid.querySelectorAll('iframe')];
    const primary = oldFrames.find(frame => frame.id === 'exactPreview') || primaryFrame;
    oldFrames.filter(frame => frame !== primary).forEach(frame => frame.remove()); grid.replaceChildren();
    grid.dataset.count = state.count; grid.append(createShell(primary, device));
    for (let index = 1; index < state.count; index += 1) { const clone = document.createElement('iframe'); clone.title = `${device.name} synchronized app preview ${index + 1}`; clone.src = 'index.html?appearance-preview=1'; clone.addEventListener('load', () => post(clone), { once: true }); grid.append(createShell(clone, device)); }
    $('#devicePreviewMeta').textContent = `${device.width} × ${device.height} CSS px · ${device.dpr}× DPR`;
    $('#deviceRotate').textContent = state.orientation === 'portrait' ? 'Rotate landscape' : 'Rotate portrait';
    save(); post(primary); grid.querySelectorAll('iframe').forEach(post);
  }
  function bind(selector, key, value = element => element.value) { $(selector).addEventListener('change', event => { state[key] = value(event.currentTarget); render(); }); }
  $('#deviceSearch').value = state.query; $('#deviceCategory').value = state.category; $('#deviceZoom').value = state.zoom; $('#deviceCount').value = state.count; $('#deviceFrame').checked = state.frame; $('#deviceSafe').checked = state.safe; $('#deviceScheme').value = state.scheme; $('#deviceNetwork').value = state.network;
  $('#deviceSearch').addEventListener('input', event => { state.query = event.currentTarget.value; options(); save(); });
  bind('#deviceCategory', 'category'); bind('#devicePreset', 'presetId'); bind('#deviceZoom', 'zoom'); bind('#deviceCount', 'count', element => Number(element.value)); bind('#deviceFrame', 'frame', element => element.checked); bind('#deviceSafe', 'safe', element => element.checked); bind('#deviceScheme', 'scheme'); bind('#deviceNetwork', 'network');
  $('#deviceRotate').addEventListener('click', () => { state.orientation = state.orientation === 'portrait' ? 'landscape' : 'portrait'; render(); });
  $('#saveCustomDevice').addEventListener('click', () => { const name = $('#customDeviceName').value.trim(); const width = Number($('#customDeviceWidth').value); const height = Number($('#customDeviceHeight').value); const dpr = Number($('#customDeviceDpr').value); if (!name || !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(dpr)) return; const device = { id: `custom-${Date.now()}`, name, category: 'Custom', width: clamp(width, 240, 1600), height: clamp(height, 400, 1800), dpr: clamp(dpr, 1, 5), frame: $('#customDeviceFrame').value }; state.custom.push(device); state.category = 'Custom'; state.presetId = device.id; options(); $('#deviceCategory').value = 'Custom'; render(); });
  options(); render();
  return { sync: () => panel.querySelectorAll('iframe').forEach(post) };
}
