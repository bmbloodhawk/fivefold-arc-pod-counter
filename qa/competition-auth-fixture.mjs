// Served ONLY by a Playwright route in isolated QA contexts. Never imported by app.
const key = 'fivefold-arc:qa-account';
export async function currentAccountToken() { return sessionStorage.getItem(key); }
export async function restoredAccountToken() { return currentAccountToken(); }
export async function googleAccountToken() { sessionStorage.setItem(key, 'qa-host'); return currentAccountToken(); }
export async function emailAccountToken(email) {
  const user = String(email).split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 35);
  sessionStorage.setItem(key, `qa-${user || 'member'}`); return currentAccountToken();
}
export async function signOutAccount() { sessionStorage.removeItem(key); }
export async function sendAccountPasswordReset() { throw new Error('Email is disabled in local QA.'); }
