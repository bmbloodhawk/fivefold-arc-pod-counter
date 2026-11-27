import { inspectImageData } from './appearance-validation.js?v=5';

const bounded = (value, min, max) => Math.max(min, Math.min(max, value));
const roles = {symbol:'Counter tab icon', thumbnail:'Library thumbnail', dial:'Counter face', seal:'Center seal'};

export function squareCrop(width, height, zoom, horizontal, vertical) {
  const size = Math.min(width, height) / bounded(zoom, 1, 12);
  return { x: (width - size) * bounded(horizontal, 0, 1), y: (height - size) * bounded(vertical, 0, 1), size };
}

function drawCrop(canvas, image, crop, round) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (round) {
    const center = canvas.width / 2;
    ctx.beginPath();
    ctx.arc(center, center, center, 0, 2 * Math.PI);
    ctx.clip();
  }
  ctx.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function encodeCrop(image, crop, round, role) {
  const canvas = document.createElement('canvas');
  const limit = role === 'dial' ? 1536 : 512;
  canvas.width = canvas.height = Math.max(1, Math.min(limit, Math.round(crop.size)));
  drawCrop(canvas, image, crop, round);
  for (let quality = 90; quality >= 42; quality -= 8) {
    const data = canvas.toDataURL('image/webp', quality / 100);
    if (data.length * .75 <= 700000) return { data, ...inspectImageData(data) };
  }
  throw new Error('This crop exceeds the artwork size limit. Zoom in or choose a smaller source.');
}

export function openAssetCrop(source, { save, returnFocus }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'studio-asset-crop';
  dialog.setAttribute('aria-labelledby', 'assetCropTitle');
  dialog.innerHTML = `<h2 id="assetCropTitle">Crop artwork</h2>
    <p class="helper" data-crop-source></p>
    <div class="asset-crop-grid"><div><canvas width="360" height="360" aria-label="Crop preview"></canvas>
    <p class="helper">Drag the image to frame it, or use the position controls.</p></div>
    <div class="asset-crop-controls">
      <label>Use as<select data-crop-role></select></label>
      <label>Copy name<input data-crop-name maxlength="40" required></label>
      <label>Zoom <output></output><input data-crop-zoom type="range" min="100" max="1200" step="1" value="100"></label>
      <label>Horizontal position <output></output><input data-crop-x type="range" min="0" max="100" step=".1" value="50"></label>
      <label>Vertical position <output></output><input data-crop-y type="range" min="0" max="100" step=".1" value="50"></label>
      <label class="crop-round"><input data-crop-round type="checkbox"> Transparent corners</label>
    </div></div>
    <p class="helper" role="status" data-crop-status></p>
    <div class="asset-crop-actions"><button type="button" data-crop-close>Done</button>
      <button type="button" class="secondary-action" data-crop-save disabled>Save crop to library</button></div>`;
  const find = selector => dialog.querySelector(selector);
  const canvas = find('canvas'), role = find('[data-crop-role]'), name = find('[data-crop-name]');
  const zoom = find('[data-crop-zoom]'), x = find('[data-crop-x]'), y = find('[data-crop-y]');
  const round = find('[data-crop-round]'), saveButton = find('[data-crop-save]'), status = find('[data-crop-status]');
  find('[data-crop-source]').textContent = 'Source artwork · ' + source.name;
  for (const [value, label] of Object.entries(roles)) role.add(new Option(label, value));
  const defaultName = () => {
    const suffix = ' · ' + roles[role.value];
    return source.name.slice(0, 40 - suffix.length).trimEnd() + suffix;
  };
  let autoName = defaultName(), lastSaved = '', retry = null, busy = false, ready = false, drag = null;
  name.value = autoName;
  const image = new Image();
  const currentCrop = () => squareCrop(image.naturalWidth, image.naturalHeight, zoom.valueAsNumber/100, x.valueAsNumber/100, y.valueAsNumber/100);
  const signature = () => JSON.stringify([role.value, name.value.trim(), zoom.value, x.value, y.value, round.checked]);
  function update() {
    if (ready) drawCrop(canvas, image, currentCrop(), round.checked);
    for (const range of [zoom, x, y]) range.parentNode.querySelector('output').textContent = Number(range.value) + '%';
    saveButton.disabled = busy || !ready || !name.value.trim() || signature() === lastSaved;
  }
  const close = find('[data-crop-close]');
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); returnFocus?.(); }, {once:true});
  role.addEventListener('input', () => {
    const old = autoName;
    autoName = defaultName();
    if (!name.value.trim() || name.value === old) name.value = autoName;
  });
  dialog.addEventListener('input', update);
  canvas.addEventListener('pointerdown', event => {
    if (busy || !ready || !event.isPrimary || event.button !== 0) return;
    const crop = currentCrop();
    drag = {id:event.pointerId, startX:event.clientX, startY:event.clientY, crop, size:canvas.getBoundingClientRect().width};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId || !drag.size) return;
    const spanX = image.naturalWidth - drag.crop.size, spanY = image.naturalHeight - drag.crop.size;
    const pixelRatio = drag.crop.size / drag.size;
    if (spanX > 0) x.value = String(100 * (drag.crop.x - (event.clientX - drag.startX) * pixelRatio) / spanX);
    if (spanY > 0) y.value = String(100 * (drag.crop.y - (event.clientY - drag.startY) * pixelRatio) / spanY);
    update();
  });
  canvas.addEventListener('lostpointercapture', () => { drag = null; });
  saveButton.addEventListener('click', async () => {
    if (saveButton.disabled) return;
    const key = signature();
    busy = true;
    for (const control of dialog.querySelectorAll('button,select,input')) control.disabled = true;
    status.textContent = 'Saving crop…';
    try {
      if (retry?.key !== key) {
        const asset = { id:'asset-' + crypto.randomUUID(), name:name.value.trim(), source:source.source,
          placement:role.value, status:'Pending', pendingUpload:true, ...encodeCrop(image, currentCrop(), round.checked, role.value) };
        retry = { key, asset };
      }
      await save(retry.asset);
      lastSaved = key;
      status.textContent = 'Saved “' + retry.asset.name + '” to the asset library for review.';
    } catch (error) {
      status.textContent = error.message || 'Unable to save the crop. Try again.';
    } finally {
      busy = false;
      for (const control of dialog.querySelectorAll('button,select,input')) control.disabled = false;
      update();
    }
  });
  image.onload = () => { ready = true; update(); };
  image.onerror = () => { status.textContent = 'The source image could not be decoded.'; };
  document.body.append(dialog);
  dialog.showModal();
  image.src = source.data;
  update();
}
