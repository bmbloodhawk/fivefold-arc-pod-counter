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
  assert.match(app, /bindDialSideTaps\(dom\.dialControls, delta => \{ void adjust\(delta\); \}\)/);
  assert.match(app, /dom\.dialGesture\.addEventListener\('keydown'/);
  assert.match(app, /bindDialTouchGuard\(dom\.dialGesture\)/);
});

test('side tap zones show restrained plus and minus affordances without changing their labels', () => {
  assert.match(index, /dial-step-minus[^>]*aria-label="Decrease counter by one"><\/button>/);
  assert.match(index, /dial-step-plus[^>]*aria-label="Increase counter by one"><\/button>/);
  for (const [side, symbol] of [['minus', '−'], ['plus', '+']]) {
    assert.ok(index.includes(`<span class="dial-step-label dial-step-${side}-label" aria-hidden="true">${symbol}</span>`));
    assert.ok(dialStyles.includes(`#gameView[data-interface-style="dial"] .dial-step-${side}:not(:disabled):active ~ .dial-step-${side}-label`));
    assert.ok(dialStyles.includes(`#gameView[data-interface-style="dial"] .dial-step-${side}:focus-visible ~ .dial-step-${side}-label`));
  }
  assert.match(dialStyles, /#gameView\[data-interface-style="dial"\] \.dial-step-label \{[\s\S]*pointer-events: none;[\s\S]*font-size: min\(1\.5rem, var\(--dial-side-label-gap\)\);[\s\S]*opacity: \.48;/);
  assert.match(dialStyles, /\.dial-step-plus:focus-visible ~ \.dial-step-plus-label \{[\s\S]*opacity: 1;/);
});

test('rendering a Dial simulation reads the saved interface style without invoking it', () => {
  assert.match(app, /dom\.dialControls\.hidden = freezeGameControls \|\| interfaceStyle !== 'dial';/);
  assert.match(app, /localStorage\.getItem\(INTERFACE_STYLE_KEY\) === 'button' \? 'button' : 'dial'/);
  assert.doesNotMatch(app, /interfaceStyle\(\)/);
});

test('Dial uses one shared assembly and no screen-size or turn-specific positioning rules', () => {
  const assembly = index.slice(index.indexOf('<div class="dial-assembly">'), index.indexOf('<section id="sourcePanel"'));
  for (const part of ['counter-sigil', 'counter-readout', 'dialControls', 'lifeChangeIndicator', 'statusMessage', 'lethalMark']) assert.ok(assembly.includes(part), part);
  assert.match(index, /href="dial-layout\.css\?v=12"/);
  assert.match(app, /dialLayout\.update\(\)/);
  assert.doesNotMatch(dialStyles, /@media[^\{]*(?:width|height)|data-your-turn/);
  assert.doesNotMatch(styles, /--dial-center-y|--dial-tax-height|--dial-side-seat-stack|--dial-source-height/);
});

test('the tracked mode label is centered by its visible lettering', () => {
  assert.match(index, /<p class="counter-mode"><span id="modeTitle">LIFE<\/span><\/p>/);
  assert.match(styles, /\.counter-mode > #modeTitle \{ margin-right: -\.16em; margin-left: \.16em; \}/);
  assert.match(dialStyles, /\.counter-readout \.counter-mode \{[\s\S]*transform: translate\(-50%, -50%\)/);
});

test('the visible Dial rim belongs to the existing drag surface without locking page overflow', () => {
  assert.match(dialStyles, /#gameView\[data-interface-style="dial"\] \.dial-gesture::before \{[^}]*inset: -6px;[^}]*border-radius: 50%;[^}]*pointer-events: auto;/);
  const draggingRule = dialStyles.match(/body\.dial-dragging \{([^}]+)\}/)?.[1] || '';
  assert.doesNotMatch(draggingRule, /overflow\s*:\s*hidden/);
});
