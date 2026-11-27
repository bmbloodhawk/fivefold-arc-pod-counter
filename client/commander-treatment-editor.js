import { counterArtStrengthLimit } from './counter-design.js?v=5';
import { mountRegionEditor } from './commander-region-editor.js';

const colors = [
  ['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green']
];

export function mountCommanderTreatmentEditor({ getDraft, getAssets, change, preview }) {
  const section = document.createElement('section');
  section.className = 'inspector-block commander-treatment-editor';
  section.innerHTML = `<h3>Commander identity</h3>
    <label>Table treatment<select id="commanderTreatment">
      <option value="">Use skin colors</option>
      <option value="art-regions">Artwork regions</option>
      <option value="prismatic-glass">Prismatic glass</option>
    </select></label>
    <div class="commander-preview-controls" hidden>
      <p>Try a commander color identity in the preview. At a table, the skin uses each player’s chosen commander colors.</p>
      <div data-role="owner"></div>
      <label class="preview-identity-switch"><input type="checkbox" id="previewPartner"> Add a partner commander</label>
      <div data-role="partner" hidden></div>
      <label class="preview-identity-switch"><input type="checkbox" id="previewInspectPlayer"> View another seat</label>
      <div data-role="inspected" hidden></div>
    </div>`;
  const select = section.querySelector('#commanderTreatment');
  const controls = section.querySelector('.commander-preview-controls');
  const regionMount = document.createElement('div');
  controls.before(regionMount);
  const renderRegions = mountRegionEditor({ mount: regionMount, getDraft, getAssets, change });
  const partner = section.querySelector('#previewPartner');
  const inspected = section.querySelector('#previewInspectPlayer');

  function colorGroup(role, name, initial) {
    const mount = section.querySelector(`[data-role="${role}"]`);
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = name;
    group.append(legend);
    const inputs = colors.map(([code, text]) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = code;
      input.checked = initial.includes(code);
      label.append(input, text);
      group.append(label);
      return input;
    });
    mount.append(group);
    return () => inputs.filter(input => input.checked).map(input => input.value);
  }

  const ownerColors = colorGroup('owner', 'Your commander', ['U', 'R']);
  const partnerColors = colorGroup('partner', 'Your partner commander', ['G']);
  const inspectedColors = colorGroup('inspected', 'Other seat’s commander', ['W', 'B']);
  controls.addEventListener('change', () => {
    section.querySelector('[data-role="partner"]').hidden = !partner.checked;
    section.querySelector('[data-role="inspected"]').hidden = !inspected.checked;
    preview({
      previewCommanderColors: ownerColors(),
      ...(partner.checked ? { previewPartnerColors: partnerColors() } : {}),
      ...(inspected.checked ? { previewInspectedColors: inspectedColors() } : {})
    });
  });

  const render = () => {
    select.value = getDraft()?.commanderTreatment || '';
    controls.hidden = !select.value;
    renderRegions();
  };
  select.addEventListener('change', () => {
    const skin = getDraft();
    if (select.value) skin.commanderTreatment = select.value;
    else delete skin.commanderTreatment;
    if (select.value !== 'prismatic-glass') {
      for (const [key, mode] of Object.entries(skin.counterDesign?.modes || {})) {
        const limit = counterArtStrengthLimit(skin, key);
        if (mode.artOpacity > limit) mode.artOpacity = limit;
      }
    }
    render();
    change();
  });
  const palette = document.querySelector('#edit-foundation > section');
  palette.after(section);
  return render;
}
