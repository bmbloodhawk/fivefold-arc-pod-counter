import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountScreen, registrationFeedback, saveRegistrationPreferredName } from './create-account.js';

function element(value = '') {
  const events = new Map(), attributes = new Map();
  return { value, hidden: false, disabled: false, checked: false, textContent: '', type: 'password', dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, handler) { events.set(type, handler); },
    fire(type, event = {}) { return events.get(type)?.({ target: this, preventDefault() {}, ...event }); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    focus() { this.focused = true; }, matches() { return false; },
  };
}
function fixture(overrides = {}) {
  const nodes = Object.fromEntries(['registerForm','registerTitle','registerEmail','registerPassword','registerDisplayName',
    'registerAgreement','registerEmailError','registerPasswordError','registerStatus','registerAnnouncer',
    'registerSubmit','registerBack','registerPasswordToggle'].map(id => [id, element()]));
  nodes.registerForm.reportValidity = () => Boolean(nodes.registerEmail.value && nodes.registerPassword.value && nodes.registerAgreement.checked);
  const root = { hidden: false, querySelector: selector => nodes[selector.slice(1)] };
  const calls = { registrations: 0, completions: 0, names: [], backs: [], pending: [], backgroundErrors: [] };
  const screen = createAccountScreen({ root,
    register: async () => { calls.registrations++; return 'local-token'; },
    complete: async () => { calls.completions++; },
    savePreferredName: async (token, name) => { calls.names.push({ token, name }); },
    onBack: email => calls.backs.push(email),
    onPendingChange: pending => calls.pending.push(pending),
    onBackgroundError: message => calls.backgroundErrors.push(message),
    ...overrides,
  });
  screen.open('player@example.invalid');
  nodes.registerPassword.value = 'fixture-password'; nodes.registerDisplayName.value = ' River '; nodes.registerAgreement.checked = true;
  return { nodes, root, screen, calls, submit: () => nodes.registerForm.fire('submit') };
}

test('known registration failures explain the reported cause without exposing raw provider messages', () => {
  for (const [code, field, words] of [
    ['auth/invalid-email','email',/valid email/], ['auth/email-already-in-use','email',/Sign in or reset/],
    ['auth/network-request-failed',null,/connection/], ['auth/too-many-requests',null,/wait/],
    ['auth/operation-not-allowed',null,/temporarily unavailable/], ['unrecognized',null,/try again/i],
  ]) {
    const feedback = registrationFeedback({ code, message: 'private provider detail' });
    assert.equal(feedback.field, field); assert.match(feedback.message, words);
    assert.doesNotMatch(feedback.message, /private provider detail/);
  }
});
test('password feedback uses only requirements actually reported as missing', () => {
  const feedback = registrationFeedback({ code: 'auth/weak-password' }, {
    meetsMinPasswordLength: false, containsUppercaseLetter: false, containsNumericCharacter: true,
    passwordPolicy: { customStrengthOptions: { minPasswordLength: 9 } },
  });
  assert.equal(feedback.field, 'password'); assert.match(feedback.message, /at least 9 characters/);
  assert.match(feedback.message, /uppercase/); assert.doesNotMatch(feedback.message, /12|number/);
  assert.doesNotMatch(registrationFeedback({ code: 'auth/weak-password' }).message, /\d/);
});
test('saving an optional preferred name preserves the account’s other preferences', async () => {
  const preferences = { preferredName: null, defaultPlayerCount: 7, defaultRoundLimitMinutes: 9, interfaceStyle: 'button', personalSkinId: null, usePersonalSkin: false };
  const requests = [];
  await saveRegistrationPreferredName('local-token','River',async (url, options = {}) => {
    requests.push({ url, options }); return { ok: true, json: async () => ({ preferences }) };
  });
  assert.equal(requests.length, 2); assert.equal(requests[1].options.method, 'PUT');
  assert.deepEqual(JSON.parse(requests[1].options.body), { ...preferences, preferredName: 'River' });
  assert.equal(requests[1].options.headers.authorization, 'Bearer local-token');
});
test('a failed preferences read never writes a replacement set of defaults', async () => {
  let requests = 0;
  await assert.rejects(() => saveRegistrationPreferredName('local-token','River',async () => { requests++; return { ok: false }; }));
  assert.equal(requests, 1);
});
test('unchecked agreement never reaches account creation', async () => {
  const page = fixture(); page.nodes.registerAgreement.checked = false;
  await page.submit(); assert.equal(page.calls.registrations, 0);
});
test('registration uses the entered details, saves the optional name, then completes existing sign-in', async () => {
  const page = fixture(); await page.submit();
  assert.equal(page.calls.registrations, 1); assert.equal(page.calls.completions, 1);
  assert.deepEqual(page.calls.names, [{ token: 'local-token', name: 'River' }]);
  assert.equal(page.nodes.registerPassword.value, ''); assert.deepEqual(page.calls.pending, [true,false]);
});
test('a blank optional name makes no preference write', async () => {
  const page = fixture(); page.nodes.registerDisplayName.value = '  '; await page.submit();
  assert.equal(page.calls.names.length, 0); assert.equal(page.calls.completions, 1);
});
test('pending registration blocks repeat submits and keeps the submitted fields stable', async () => {
  let resolve, attempts = 0;
  const waiting = new Promise(done => { resolve = done; });
  const page = fixture({ register: () => { attempts++; return waiting; } });
  const attempt = page.submit();
  assert.equal(page.screen.pending, true); assert.equal(page.nodes.registerSubmit.disabled, true);
  assert.equal(page.nodes.registerPassword.disabled, true); assert.match(page.nodes.registerSubmit.textContent, /Creating account/);
  await page.submit(); assert.equal(attempts, 1);
  resolve('local-token'); await attempt; assert.equal(page.screen.pending, false);
});
test('a failed attempt retains details and enables a retry', async () => {
  let attempts = 0;
  const page = fixture({ register: async () => { if (++attempts === 1) throw { code: 'auth/network-request-failed' }; return 'local-token'; } });
  await page.submit(); assert.equal(page.nodes.registerPassword.value, 'fixture-password');
  assert.equal(page.nodes.registerEmail.value, 'player@example.invalid'); assert.equal(page.nodes.registerDisplayName.value, ' River ');
  assert.equal(page.nodes.registerAgreement.checked, true); assert.equal(page.nodes.registerSubmit.disabled, false);
  assert.match(page.nodes.registerStatus.textContent, /connection/); await page.submit();
  assert.equal(attempts, 2); assert.equal(page.calls.completions, 1);
});
test('field errors focus the rejected field and only describe visible errors', async () => {
  const page = fixture({ register: async () => { throw { code: 'auth/email-already-in-use' }; } });
  await page.submit(); assert.equal(page.nodes.registerEmail.getAttribute('aria-invalid'), 'true');
  assert.equal(page.nodes.registerEmail.getAttribute('aria-describedby'), 'registerEmailError');
  assert.equal(page.nodes.registerEmail.focused, true);
  page.nodes.registerEmail.value = 'other@example.invalid'; page.nodes.registerEmail.fire('input');
  assert.equal(page.nodes.registerEmailError.hidden, true); assert.equal(page.nodes.registerEmail.getAttribute('aria-invalid'), 'false');
  assert.equal(page.nodes.registerEmail.getAttribute('aria-describedby'), null);
});
test('a password failure can report the actual current provider policy without a hardcoded minimum', async () => {
  const page = fixture({ register: async () => { throw { code: 'auth/weak-password' }; },
    validatePassword: async () => ({ meetsMinPasswordLength: false, passwordPolicy: { customStrengthOptions: { minPasswordLength: 10 } } }),
  });
  await page.submit(); assert.match(page.nodes.registerPasswordError.textContent, /at least 10 characters/);
  assert.equal(page.nodes.registerPassword.getAttribute('aria-describedby'), 'registerPasswordHelp registerPasswordError');
});
test('a policy lookup failure still leaves a useful password error and a retry', async () => {
  const page = fixture({ register: async () => { throw { code: 'auth/weak-password' }; }, validatePassword: async () => { throw new Error('unavailable'); } });
  await page.submit(); assert.match(page.nodes.registerPasswordError.textContent, /requirements/);
  assert.equal(page.nodes.registerSubmit.disabled, false);
});
test('a display-name save failure does not recreate an already-created account', async () => {
  const page = fixture({ savePreferredName: async () => { throw new Error('unavailable'); } });
  await page.submit(); assert.equal(page.calls.registrations, 1); assert.equal(page.calls.completions, 0);
  assert.match(page.nodes.registerStatus.textContent, /account was created/i); assert.equal(page.nodes.registerSubmit.textContent, 'Continue');
  await page.submit(); assert.equal(page.calls.registrations, 1); assert.equal(page.calls.completions, 1);
});
test('an app-completion failure offers Continue without submitting another registration', async () => {
  let completions = 0, finish;
  const page = fixture({ complete: async () => { if (++completions === 1) throw new Error('unavailable'); await new Promise(resolve => { finish = resolve; }); } });
  await page.submit(); assert.equal(page.calls.registrations, 1); assert.equal(page.nodes.registerSubmit.textContent, 'Continue');
  assert.match(page.nodes.registerStatus.textContent, /account was created/i);
  const continuation = page.submit(), pendingLabel = page.nodes.registerSubmit.textContent;
  finish(); await continuation; assert.equal(pendingLabel, 'Opening account…');
  assert.equal(page.calls.registrations, 1); assert.equal(completions, 2);
});
test('Show/Hide and Back clear the password and preserve the email for sign-in', () => {
  const page = fixture(); page.nodes.registerPasswordToggle.fire('click'); assert.equal(page.nodes.registerPassword.type, 'text');
  page.nodes.registerBack.fire('click'); assert.equal(page.nodes.registerPassword.value, '');
  assert.equal(page.nodes.registerPassword.type, 'password'); assert.deepEqual(page.calls.backs, ['player@example.invalid']);
});
test('Back during creation never drops a successful account session', async () => {
  let resolve;
  const page = fixture({ register: () => new Promise(done => { resolve = done; }) });
  const attempt = page.submit(); page.nodes.registerBack.fire('click'); page.root.hidden = true;
  assert.equal(page.nodes.registerPassword.value, ''); resolve('local-token'); await attempt;
  assert.equal(page.calls.completions, 1); assert.equal(page.screen.pending, false);
});
test('an error after leaving the screen does not steal focus and is reported to sign-in', async () => {
  let reject;
  const page = fixture({ register: () => new Promise((resolve, fail) => { reject = fail; }) });
  const attempt = page.submit(); page.nodes.registerBack.fire('click'); page.root.hidden = true;
  reject({ code: 'auth/invalid-email' }); await attempt;
  assert.equal(page.nodes.registerEmail.focused, undefined); assert.match(page.calls.backgroundErrors[0], /valid email/);
});
test('a name-save error after Back directs the player to sign-in rather than a hidden Continue button', async () => {
  let resolve;
  const page = fixture({ register: () => new Promise(done => { resolve = done; }), savePreferredName: async () => { throw new Error('unavailable'); } });
  const attempt = page.submit(); page.nodes.registerBack.fire('click'); page.root.hidden = true;
  resolve('local-token'); await attempt;
  assert.match(page.calls.backgroundErrors[0], /account was created/i);
  assert.match(page.calls.backgroundErrors[0], /Sign in to continue/);
  assert.doesNotMatch(page.calls.backgroundErrors[0], /Choose Continue/);
});
