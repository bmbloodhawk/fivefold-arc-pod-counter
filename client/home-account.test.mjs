import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('async function signOut()'), app.indexOf('function openSignIn('));

function accountFixture(signOutAccount = async () => {}) {
  const element = () => ({ hidden: false, disabled: false, textContent: '' });
  const context = createContext({
    accountSignedInStatus: element(), homeSignOutButton: element(), homeAccountMessage: element(),
    signInButton: element(), myGamesButton: element(), myDecksButton: element(), signOutButton: element(),
    myGamesStatus: element(), myGamesDialog: { open: false }, myDecksDialog: { open: false },
    homeAccountSignedIn: false, signOutInFlight: false,
    selectedDeckId: 'saved-deck', setupDecks: ['saved-deck'], savedDecks: ['saved-deck'],
    resetAwardProfile() {}, clearAccountAppearance() {}, competitionHub: { authChanged() {} },
    signOutAccount,
  });
  runInContext(source, context);
  return {
    context,
    render: signedIn => context.renderHomeAccount(signedIn),
    signOut: () => context.signOut(),
  };
}

test('Home initially shows signed-out status and a visible disabled sign-out button', () => {
  const status = html.match(/<p\b[^>]*id="accountSignedInStatus"[^>]*>[^<]*<\/p>/)?.[0];
  const button = html.match(/<button\b[^>]*id="homeSignOutButton"[^>]*>[^<]*<\/button>/)?.[0];
  assert.ok(status && button, 'Home needs both account status and sign out');
  assert.doesNotMatch(status, /\bhidden\b/);
  assert.match(status, />Signed out<\/p>/);
  assert.doesNotMatch(button, /\bhidden\b/);
  assert.match(button, /\bdisabled\b/);
});

test('guest and signed-in Home keep account status and sign out visible', () => {
  const account = accountFixture();
  for (const signedIn of [false, true, false]) {
    account.render(signedIn);
    const view = account.context;
    assert.equal(view.accountSignedInStatus.hidden, false);
    assert.equal(view.accountSignedInStatus.textContent, signedIn ? 'Signed in' : 'Signed out');
    assert.equal(view.homeSignOutButton.hidden, false);
    assert.equal(view.homeSignOutButton.disabled, !signedIn);
    assert.equal(view.signInButton.hidden, signedIn);
    assert.equal(view.myGamesButton.disabled, !signedIn);
    assert.equal(view.myDecksButton.disabled, !signedIn);
  }
});

test('signing out waits for completion, blocks repeats, then restores guest Home', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  let calls = 0;
  const account = accountFixture(() => { calls++; return pending; });
  account.render(true);
  const attempt = account.signOut();
  assert.equal(account.context.accountSignedInStatus.textContent, 'Signed in');
  assert.equal(account.context.homeSignOutButton.textContent, 'Signing out…');
  assert.equal(account.context.homeSignOutButton.disabled, true);
  assert.equal(account.context.signOutButton.disabled, true);
  account.render(true);
  assert.equal(account.context.homeSignOutButton.disabled, true, 'account refresh cannot unlock a pending sign-out');
  await account.signOut();
  assert.equal(calls, 1);
  finish();
  await attempt;
  assert.equal(account.context.accountSignedInStatus.textContent, 'Signed out');
  assert.equal(account.context.homeSignOutButton.textContent, 'Sign out');
  assert.equal(account.context.homeSignOutButton.disabled, true);
  assert.equal(account.context.signOutButton.disabled, false);
  assert.equal(account.context.signInButton.hidden, false);
  assert.equal(account.context.homeAccountMessage.hidden, true);
});

test('failed sign-out stays signed in, shows a Home error, and allows retry', async () => {
  let calls = 0;
  const account = accountFixture(async () => {
    if (++calls === 1) throw new Error('Connection unavailable. Try again.');
  });
  account.render(true);
  await account.signOut();
  assert.equal(account.context.accountSignedInStatus.textContent, 'Signed in');
  assert.equal(account.context.homeSignOutButton.disabled, false);
  assert.equal(account.context.homeSignOutButton.textContent, 'Sign out');
  assert.equal(account.context.homeAccountMessage.hidden, false);
  assert.equal(account.context.homeAccountMessage.textContent, 'Connection unavailable. Try again.');
  assert.equal(account.context.myGamesStatus.textContent, account.context.homeAccountMessage.textContent);
  assert.equal(account.context.selectedDeckId, 'saved-deck');
  await account.signOut();
  assert.equal(calls, 2);
  assert.equal(account.context.accountSignedInStatus.textContent, 'Signed out');
  assert.equal(account.context.homeAccountMessage.hidden, true);
});
