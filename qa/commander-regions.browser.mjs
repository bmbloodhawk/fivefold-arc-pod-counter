import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const url = new URL(process.argv[2]);
assert.equal(url.hostname, '127.0.0.1');
assert.equal((await fetch(url)).headers.get('x-studio-fixture'), 'memory');
const require = createRequire(process.env.PLAYWRIGHT_TOOLING || new URL('./package.json', import.meta.url));
const engine = process.env.STUDIO_BROWSER || 'chromium';
const browser = await require('playwright-core')[engine].launch({
  headless: true, ...(engine === 'chromium' && process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}),
});
const page = await browser.newPage({ viewport: { width: 1480, height: 940 }, serviceWorkers: 'block' });
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => dialog.type() === 'confirm' && dialog.message().startsWith('Approve') ? dialog.accept() : dialog.dismiss());
const panel = name => page.locator('#studioNavigation button[aria-controls="edit-' + name + '"]').click();

const importSample = async role => {
  const title = 'Silver cloth ' + role + ' ' + Date.now().toString(36);
  // Original test swatch: a patterned weave with two luminance levels.
  const pattern = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#b0b0b0"/><rect width="100" height="22" y="48" fill="#707070"/></svg>';
  await panel('assets');
  await page.locator('#assetFile').setInputFiles({ name: role + '.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(pattern) });
  await page.locator('#assetPlacement').selectOption(role);
  await page.locator('#assetName').fill(title);
  await page.locator('#assetSource').fill('Original synthetic browser swatch');
  await page.locator('#importAssetButton').click();
  const row = page.locator('.review-asset').filter({hasText:title});
  await row.getByRole('button', {name:'Approve artwork'}).click();
  await row.getByText(/Approved/).first().waitFor();
  return title;
};

const addOutline = async (coordinates, keyboard) => {
  const dialog = page.locator('.commander-region-dialog[open]');
  if (keyboard) {
    await dialog.locator('[data-point-tools] summary').click();
    for (const [x, y] of coordinates) {
      await dialog.locator('[data-point-x]').fill(String(x));
      await dialog.locator('[data-point-y]').fill(String(y));
      await dialog.locator('[data-place-point]').click();
    }
  } else {
    const drawing = dialog.locator('svg');
    for (const [x, y] of coordinates) {
      const box = await drawing.boundingBox();
      await drawing.click({ position: {x:box.width*x/100,y:box.height*y/100} });
    }
  }
  await dialog.locator('[data-finish-region]').click();
};

async function configure(surface, title) {
  await page.locator('[data-region-surface]').selectOption(surface);
  await page.locator('[data-open-regions]').click();
  const dialog = page.locator('.commander-region-dialog[open]');
  await dialog.locator('[data-region-art]').selectOption({label:title});
  await addOutline([[5,5],[55,5],[55,75],[5,75]], false);
  if (surface === 'background') await addOutline([[60,5],[94,5],[94,75],[60,75]], true);
  await dialog.locator('[data-save-regions]').click();
}

// Read the actual output images selected by the real renderer, not a separate preview painter.
async function waitForPixels(probe, args) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const value = await page.evaluate(probe, args);
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 70));
  }
  throw new Error('Timed out waiting for rendered commander artwork.');
}
async function sample(surface, previousUrl) {
  return waitForPixels(async ({surface,previousUrl}) => {
    const doc = document.querySelector('#exactPreview')?.contentDocument;
    if (doc?.querySelector('#gameView')?.dataset.commanderTreatment !== 'art-regions') return false;
    const background = doc.documentElement.style.getPropertyValue('--commander-region-background');
    const url = surface === 'background' ? background.match(/url\("?(blob:[^")]+)"?\)/)?.[1] : doc.querySelector('.counter-design-face img')?.src;
    if (!url?.startsWith('blob:') || url === previousUrl) return false;
    const image = doc.createElement('img');
    image.src = url;
    try { await image.decode(); } catch { return false; }
    const canvas = doc.createElement('canvas');
    canvas.width = canvas.height = 100;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image,0,0,100,100);
    const pixel = (x,y) => [...ctx.getImageData(x,y,1,1).data].slice(0,3);
    return {url,first:pixel(25,25),second:pixel(78,25),shade:pixel(25,55),outside:pixel(45,92)};
  }, {surface,previousUrl});
}
try {
  await page.goto(url.href);
  await page.locator('[data-skin="harbor-study"]').click();
  const painting = await importSample('background');
  const medallion = await importSample('dial');
  await panel('foundation');
  await page.locator('#commanderTreatment').selectOption('art-regions');
  await configure('background',painting);
  await configure('life',medallion);
  const first = await sample('background');
  assert.ok(first.first[2] > first.first[0] && first.second[0] > first.second[2], 'owner blue and red map to different regions');
  assert.deepEqual(first.outside, [176,176,176]);
  assert.ok(first.shade[2] < first.first[2], 'baked-in source detail survives inside a tinted area');
  const dial = await sample('life');
  assert.deepEqual(dial.first,first.first);
  await page.locator('#previewInspectPlayer').check();
  const whiteDial = await sample('life',dial.url);
  assert.ok(whiteDial.first[0] > whiteDial.first[2], 'viewed commander drives only the counter');
  assert.deepEqual((await sample('background')).first,first.first,'owner background is stable when selecting another seat');
  const owner = page.getByRole('group',{name:'Your commander',exact:true});
  await owner.getByLabel('Black').check();
  await owner.getByLabel('Blue').uncheck();
  await owner.getByLabel('Red').uncheck();
  async function neutralOwner(black) {
    await waitForPixels(async black => {
      const doc=document.querySelector('#exactPreview')?.contentDocument;
      const url=doc?.documentElement.style.getPropertyValue('--commander-region-background').match(/url\("?(blob:[^")]+)"?\)/)?.[1];
      if (!url) return false;
      const img=doc.createElement('img');img.src=url;
      try {await img.decode()} catch{return false}
      const canvas=doc.createElement('canvas');canvas.width=canvas.height=100;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,100,100);const [r,g,b]=ctx.getImageData(25,25,1,1).data;
      return black ? r===g&&g===b&&b<110 : r>150&&b>r&&b-r<35;
    },black);
  }
  await neutralOwner(true);
  await owner.getByLabel('Black').uncheck();
  await neutralOwner(false);
  await page.locator('#saveButton').click();
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent === 'Saved draft');
  await page.reload();await page.locator('[data-skin="harbor-study"]').click();
  const restored = await sample('background');assert.deepEqual(restored.first,first.first);
  assert.deepEqual(restored.second,first.second);assert.deepEqual(restored.outside,first.outside);
  assert.deepEqual(errors, []);
  console.log(engine + ': two outlined background regions, keyboard and pointer editing, seat-bound dial, charcoals and colorless silver, original pixels and texture, saved draft reloaded.');
} finally { await browser.close(); }
