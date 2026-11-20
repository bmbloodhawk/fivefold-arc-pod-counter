import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const handlerStart = app.indexOf("emailSignInFields.addEventListener('keydown'");
const source = app.slice(app.indexOf('let emailSignInInFlight ='), app.indexOf('function openMyProfile(')) +
  (handlerStart < 0 ? '' : app.slice(handlerStart, app.indexOf("emailSignInButton.addEventListener('click'")));

function fixture(authenticate = async () => 'fixture-token') {
  let keydown;
  const result = { attempts: 0, completions: 0 };
  const context = createContext({
    accountEmail: { value: 'player@example.invalid' }, accountPassword: { value: 'fixture-password' },
    emailSignInFields: { hidden: false, addEventListener(type, handler) { if (type === 'keydown') keydown = handler; } },
    myGamesStatus: { textContent: '' },
    async emailAccountToken(...args) { result.attempts++; return authenticate(...args); },
    async finishAccountSignIn() { result.completions++; },
  });
  runInContext(source, context);
  return {
    context, result,
    async key({ target = context.accountPassword, key = 'Enter', isComposing = false } = {}) {
      assert.equal(typeof keydown, 'function', 'email entry needs an Enter handler');
      let prevented = false;
      keydown({ key, target, isComposing, preventDefault() { prevented = true; } });
      await new Promise(setImmediate);
      return prevented;
    },
  };
}

test('Enter from either credential field submits email sign-in and prevents implicit Close', async () => {
  for (const field of ['accountEmail', 'accountPassword']) {
    const page = fixture();
    assert.equal(await page.key({ target: page.context[field] }), true);
    assert.equal(page.result.attempts, 1);
    assert.equal(page.result.completions, 1);
  }
});

test('other keys, IME composition, hidden fields, and unrelated controls keep their keyboard behavior', async () => {
  const page = fixture();
  assert.equal(await page.key({ key: 'Tab' }), false);
  assert.equal(await page.key({ isComposing: true }), false);
  assert.equal(await page.key({ target: {} }), false);
  page.context.emailSignInFields.hidden = true;
  assert.equal(await page.key(), false);
  assert.equal(page.result.attempts, 0);
});

test('Enter with missing credentials keeps the form available and explains what is missing', async () => {
  const page = fixture();
  page.context.accountPassword.value = '';
  assert.equal(await page.key(), true);
  assert.equal(page.result.attempts, 0);
  assert.equal(page.result.completions, 0);
  assert.equal(page.context.myGamesStatus.textContent, 'Enter both your email and password to sign in.');
});

test('repeated Enter while sign-in is pending sends one authentication attempt', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const page = fixture(() => pending);
  assert.equal(await page.key(), true);
  assert.equal(page.context.myGamesStatus.textContent, 'Signing in…');
  assert.equal(await page.key(), true);
  assert.equal(page.result.attempts, 1);
  assert.equal(page.result.completions, 0);
  finish('fixture-token');
  await new Promise(setImmediate);
  assert.equal(page.result.completions, 1);
});

test('Enter can retry a failed sign-in without losing the credentials', async () => {
  const page = fixture(async () => {
    if (page.result.attempts === 1) throw new Error('Sign-in unavailable. Try again.');
    return 'fixture-token';
  });
  await page.key();
  assert.equal(page.context.myGamesStatus.textContent, 'Sign-in unavailable. Try again.');
  assert.equal(page.result.completions, 0);
  assert.equal(page.context.accountEmail.value, 'player@example.invalid');
  assert.equal(page.context.accountPassword.value, 'fixture-password');
  await page.key();
  assert.equal(page.result.attempts, 2);
  assert.equal(page.result.completions, 1);
});
