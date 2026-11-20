import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf("forgotPasswordButton.addEventListener('click'"),
  app.indexOf("createAccountButton.addEventListener('click'"));

function fixture(send = async () => {}) {
  let click;
  const requests = [];
  const context = createContext({
    forgotPasswordButton: { disabled: false, addEventListener(type, handler) { click = handler; } },
    accountEmail: { value: 'player@example.invalid', focused: false, focus() { this.focused = true; } },
    myGamesStatus: { textContent: '' },
    async sendAccountPasswordReset(email) { requests.push(email); return send(email); },
  });
  runInContext(source, context);
  return { context, requests, click: () => click() };
}

test('empty email gets guidance and focus without requesting a reset', async () => {
  const page = fixture();
  page.context.accountEmail.value = '';
  await page.click();
  assert.equal(page.requests.length, 0);
  assert.equal(page.context.accountEmail.focused, true);
  assert.equal(page.context.myGamesStatus.textContent, 'Enter the email address for your account first.');
  assert.equal(page.context.forgotPasswordButton.disabled, false);
});

test('a pending reset shows progress and blocks another request', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const page = fixture(() => pending);
  const attempt = page.click();
  assert.equal(page.context.myGamesStatus.textContent, 'Sending reset email…');
  assert.equal(page.context.forgotPasswordButton.disabled, true);
  await page.click();
  assert.equal(page.requests.length, 1);
  finish();
  await attempt;
  assert.equal(page.context.myGamesStatus.textContent, 'Password-reset email sent. Check your inbox and spam folder.');
  assert.equal(page.context.forgotPasswordButton.disabled, false);
});

test('successful reset leaves the action available without changing the email', async () => {
  const page = fixture();
  await page.click();
  assert.deepEqual(page.requests, ['player@example.invalid']);
  assert.equal(page.context.forgotPasswordButton.disabled, false);
  assert.equal(page.context.accountEmail.value, 'player@example.invalid');
  assert.equal(page.context.myGamesStatus.textContent, 'Password-reset email sent. Check your inbox and spam folder.');
});

test('a failed reset shows the error and permits a retry with fresh progress feedback', async () => {
  const page = fixture(async () => {
    if (page.requests.length === 1) throw new Error('Reset unavailable. Try again.');
  });
  await page.click();
  assert.equal(page.context.myGamesStatus.textContent, 'Reset unavailable. Try again.');
  assert.equal(page.context.forgotPasswordButton.disabled, false);
  assert.equal(page.context.accountEmail.value, 'player@example.invalid');
  const retry = page.click();
  assert.equal(page.context.myGamesStatus.textContent, 'Sending reset email…');
  assert.equal(page.context.forgotPasswordButton.disabled, true);
  await retry;
  assert.equal(page.requests.length, 2);
  assert.equal(page.context.forgotPasswordButton.disabled, false);
  assert.equal(page.context.myGamesStatus.textContent, 'Password-reset email sent. Check your inbox and spam folder.');
});
