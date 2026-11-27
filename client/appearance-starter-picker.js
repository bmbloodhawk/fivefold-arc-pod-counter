import { designStarters, designStarterValues } from './appearance-design-starters.js';

export function mountStarterPicker({start}) {
  const opener = document.createElement('button'); opener.type = 'button';
  opener.className = 'rail-action'; opener.id = 'openDesignStarters'; opener.textContent = 'Browse design starters';
  document.getElementById('duplicateButton').after(opener);
  const dialog = document.createElement('dialog'); dialog.className = 'design-start-dialog'; dialog.id = 'designStartersDialog';
  const heading = document.createElement('h2'); heading.id = 'designStartersTitle'; heading.textContent = 'Choose a starting design';
  dialog.setAttribute('aria-labelledby',heading.id);
  const intro = document.createElement('p'); intro.textContent = 'Create a separate draft with its own colors, materials and counter faces.';
  const cards = document.createElement('div'); cards.className = 'design-starter-grid';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'quiet'; close.textContent = 'Close';
  close.addEventListener('click',()=>dialog.close()); dialog.append(heading,intro,cards,close); document.body.append(dialog);
  for (const recipe of designStarters) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'design-starter-card'; card.dataset.starter = recipe.id;
    const art = document.createElement('span'); art.className = 'starter-swatch'; art.setAttribute('aria-hidden','true');
    for (const color of recipe.palette.slice(0,5)) {
      const block = document.createElement('i'); block.style.backgroundColor = color; art.append(block);
    }
    const title = document.createElement('strong'); title.textContent = recipe.name;
    const detail = document.createElement('span'); detail.className = 'starter-description'; detail.textContent = recipe.description;
    const preview=document.createElement('img'); preview.alt=''; preview.className='starter-dial-preview';
    preview.width=320; preview.height=190; preview.dataset.src='assets/design-starters/'+recipe.id+'.webp';
    card.append(preview,art,title,detail); cards.append(card);
    card.addEventListener('click',()=>{ if (start({name:recipe.name,appearance:designStarterValues(recipe.id)})) dialog.close(); });
  }
  opener.addEventListener('click',()=>{
    for (const image of cards.querySelectorAll('img[data-src]')) {
      image.src=image.dataset.src; delete image.dataset.src;
    }
    dialog.showModal();
  });
}
