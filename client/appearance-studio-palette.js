// A keyboard editor for the same six palette tokens as the native swatches.
export function parsePaletteColor(value) {
  const hex = String(value).trim().replace(/^#/,'');
  return /^[a-f0-9]{6}$/i.test(hex) ? '#' + hex.toLowerCase() : null;
}

export function mountPaletteInputs() {
  const grid = document.querySelector('#edit-foundation .color-grid'), pairs = [];
  for (const label of [...grid.querySelectorAll('label')]) {
    const color = label.querySelector('input[type=color]');
    if (!color) continue;
    const name = label.textContent.trim();
    const field = document.createElement('div'); field.className = 'palette-field';
    const controls = document.createElement('div'); controls.className = 'palette-values';
    const hex = document.createElement('input'); hex.type = 'text'; hex.id = color.id + 'Hex';
    hex.setAttribute('aria-label',name + ' hex color'); hex.spellcheck = false; hex.autocomplete = 'off'; hex.maxLength = 12;
    const message = document.createElement('small'); message.id = hex.id + 'Help'; message.hidden = true;
    message.textContent = 'Use six digits, such as #d8ae61.'; hex.setAttribute('aria-describedby',message.id);
    label.before(field); label.htmlFor = color.id; controls.append(color,hex); field.append(label,controls,message);
    const sync = () => { hex.value = color.value.toUpperCase(); hex.removeAttribute('aria-invalid'); message.hidden = true; };
    function commit() {
      const parsed = parsePaletteColor(hex.value);
      if (!parsed) { hex.setAttribute('aria-invalid','true'); message.hidden = false; return; }
      if (color.value.toLowerCase() !== parsed) { color.value = parsed; color.dispatchEvent(new Event('input',{bubbles:true})); }
      sync();
    }
    hex.addEventListener('change',commit);
    hex.addEventListener('keydown',event=>{
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { event.preventDefault(); sync(); }
    });
    color.addEventListener('input',sync); pairs.push(sync); sync();
  }
  return () => pairs.forEach(sync=>sync());
}
