import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const dialStyles = fs.readFileSync(new URL('./dial-layout.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('dial taps and dragging keep separate accessible input routes', () => {
  assert.match(index, /id="dialControls"[^>]*role="group"[^>]*aria-label="Dial counter controls"/);
  assert.match(index, /id="dialGesture"[^>]*role="slider"[^>]*tabindex="0"/);
  assert.match(app, /#gameView \.dial-gesture\{position:absolute;z-index:1;overflow:visible;transform-origin:50% 50%\}/);
  assert.match(app, /event\.target\.closest\('\[data-delta\]'\)/);
  assert.match(app, /dom\.dialControls\.addEventListener\('pointerup',[\s\S]*?\.dial-step\[data-delta\][\s\S]*?void adjust\(Number\(button\.dataset\.delta\)\)/);
  assert.match(app, /dom\.dialGesture\.addEventListener\('keydown'/);
});

test('side tap zones show restrained plus and minus affordances without changing their labels', () => {
  assert.match(index, /dial-step-minus[^>]*aria-label="Decrease counter by one"><span class="dial-step-label" aria-hidden="true">−<\/span>/);
  assert.match(index, /dial-step-plus[^>]*aria-label="Increase counter by one"><span class="dial-step-label" aria-hidden="true">\+<\/span>/);
  assert.match(dialStyles, /\.dial-step-label \{[\s\S]*font-size: 1\.5rem;[\s\S]*opacity: \.48;/);
  assert.match(dialStyles, /\.dial-step:not\(:disabled\):active \.dial-step-label,[\s\S]*\.dial-step:focus-visible \.dial-step-label \{[\s\S]*opacity: 1;/);
});

test('rendering a Dial simulation reads the saved interface style without invoking it', () => {
  assert.match(app, /dom\.dialControls\.hidden = freezeGameControls \|\| interfaceStyle !== 'dial';/);
  assert.match(app, /localStorage\.getItem\(INTERFACE_STYLE_KEY\) === 'button' \? 'button' : 'dial'/);
  assert.doesNotMatch(app, /interfaceStyle\(\)/);
});

test('Dial uses one shared assembly and no screen-size or turn-specific positioning rules', () => {
  const assembly = index.slice(index.indexOf('<div class="dial-assembly">'), index.indexOf('<section id="sourcePanel"'));
  for (const part of ['counter-sigil', 'counter-readout', 'dialControls', 'lifeChangeIndicator', 'statusMessage', 'lethalMark']) assert.ok(assembly.includes(part), part);
  assert.match(index, /href="dial-layout\.css\?v=2"/);
  assert.match(app, /dialLayout\.update\(\)/);
  assert.doesNotMatch(dialStyles, /@media[^\{]*(?:width|height)|data-your-turn/);
  assert.doesNotMatch(styles, /--dial-center-y|--dial-tax-height|--dial-side-seat-stack|--dial-source-height/);
});

test('the tracked mode label is centered by its visible lettering', () => {
  assert.match(index, /<p class="counter-mode"><span id="modeTitle">LIFE<\/span><\/p>/);
  assert.match(styles, /\.counter-mode > #modeTitle \{ margin-right: -\.16em; margin-left: \.16em; \}/);
  assert.match(dialStyles, /\.counter-readout \.counter-mode \{[\s\S]*transform: translate\(-50%, -50%\)/);
});
