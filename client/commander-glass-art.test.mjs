import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGlassPigments, createCommanderGlassArtwork } from './commander-glass-art.js';

const ruby = [192,27,43,255], amber = [234,165,32,255], green = [29,141,61,255];
const sapphire = [21,119,201,255], amethyst = [124,41,169,255];
const pigments = [amber, sapphire, amethyst, ruby, green];

test('preserves the source composite, unpainted materials, opacity and specular glints', async () => {
  const materials = [[64,64,63,255], [156,138,110,255], [206,213,220,255], [9,9,14,255], [253,247,242,255], [210,12,8,0]];
  const source = Uint8ClampedArray.from([...materials, ...pigments].flat());
  const paint = await prepareGlassPigments(source);
  const original = source.slice();
  const out = new Uint8ClampedArray(source.length);
  await paint(['W','U','B','R','G'], out);
  assert.deepEqual(out.slice(0, materials.length * 4), source.slice(0, materials.length * 4));
  const fiveColor = Array.from({ length: 5 }, (_, i) => {
    const offset = (i + materials.length) * 4;
    return [...out.slice(offset,offset + 4)];
  });
  assert.deepEqual(fiveColor.filter((_, i) => i !== 2), [amber,sapphire,ruby,green]);
  assert.ok(fiveColor[2][0] < 60);
  assert.equal(fiveColor[2][0], fiveColor[2][1]);
  assert.equal(fiveColor[2][1], fiveColor[2][2]);
  await paint(['U'], out);
  assert.deepEqual(out.slice(0, materials.length * 4), source.slice(0, materials.length * 4));
  assert.notDeepEqual(out.slice(materials.length * 4), source.slice(materials.length * 4));
  assert.deepEqual(source, original);
  assert.equal(await prepareGlassPigments(source.slice(0, materials.length * 4)), null);
});

test('onyx retains its engraved relief and remains distinct from colorless silver and white', async () => {
  const source = Uint8ClampedArray.from([[74,25,99,255], amethyst, [172,86,200,255], [80,69,89,255]].flat());
  const paint = await prepareGlassPigments(source);
  const render = async colors => {
    const pixels = new Uint8ClampedArray(source.length);
    await paint(colors, pixels);
    return pixels;
  };
  const onyx = await render(['B']), silver = await render([]), white = await render(['W']);
  for (const same of [['G','B'], [...'WUBRG']]) assert.deepEqual(await render(same), onyx);
  for (let i = 0; i < onyx.length; i += 4) {
    assert.equal(onyx[i], onyx[i + 1]);
    assert.equal(onyx[i + 1], onyx[i + 2]);
    assert.equal(onyx[i + 3], source[i + 3]);
  }
  assert.ok(onyx[0] < onyx[4] && onyx[4] < onyx[8]);
  assert.ok(onyx[4] + 65 < silver[4] && onyx[4] + 85 < white[4]);
});

test('paints distinct commander palettes with dark-to-light relief within a single pane', async () => {
  const source = Uint8ClampedArray.from([...pigments, [16,51,126,128], [31,99,241,128]].flat());
  const paint = await prepareGlassPigments(source);
  const outputs = new Set();
  for (let mask = 0; mask < 32; mask++) {
    const selected = [...'WUBRG'].filter((_, index) => mask & (1 << index));
    const out = new Uint8ClampedArray(source.length);
    await paint(selected, out);
    outputs.add(out.join(','));
    const dark = out.slice(-8,-5), light = out.slice(-4,-1);
    assert.ok(light.every((value, i) => value > dark[i]));
    assert.equal(out.at(-1), 128);
    assert.equal(out.at(-5), 128);
    if (mask === 0) assert.ok(Math.max(...light) - Math.min(...light) < 24);
  }
  assert.equal(outputs.size, 32);
  const first = new Uint8ClampedArray(source.length), second = first.slice();
  await paint(['U','R'], first);
  await paint(['R','U','R'], second);
  assert.deepEqual(first, second);
});

test('the materializer never loads URL artwork from outside the checked skin', async () => {
  const doc = {createElement: assert.fail};
  for (const source of ['', null, 'https://example.test/pane.webp', 'blob:test', 'data:image/svg+xml;base64,UE5H']) {
    assert.equal(await createCommanderGlassArtwork(doc, source), null);
  }
});

test('cancellation between paint strips leaves later pixels untouched', async t => {
  const source = new Uint8ClampedArray(32769 * 4);
  for (let i = 0; i < source.length; i += 4) source.set(ruby, i);
  const controller = new AbortController();
  const paint = await prepareGlassPigments(source, controller.signal);
  let elapsed = 0;
  t.mock.method(performance, 'now', () => elapsed += 10);
  const output = new Uint8ClampedArray(source.length);
  const painting = paint(['U'], output);
  controller.abort();
  await assert.rejects(painting, { name: 'AbortError' });
  assert.notDeepEqual(output.slice(0, 4), source.slice(0, 4));
  assert.deepEqual(output.slice(-4), source.slice(-4));
});
