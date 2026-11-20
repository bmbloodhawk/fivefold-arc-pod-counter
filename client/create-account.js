export function registrationFeedback(error, passwordStatus) {
  if (error?.code === 'auth/invalid-email') return { field: 'email', message: 'Enter a valid email address.' };
  if (error?.code === 'auth/email-already-in-use') return { field: 'email', message: 'This email already has an account. Sign in or reset your password.' };
  if (['auth/weak-password','auth/password-does-not-meet-requirements'].includes(error?.code)) {
    const missing = [], rules = passwordStatus?.passwordPolicy?.customStrengthOptions;
    if (passwordStatus?.meetsMinPasswordLength === false && Number.isInteger(rules?.minPasswordLength)) missing.push(`Use at least ${rules.minPasswordLength} characters.`);
    if (passwordStatus?.meetsMaxPasswordLength === false && Number.isInteger(rules?.maxPasswordLength)) missing.push(`Use no more than ${rules.maxPasswordLength} characters.`);
    for (const [requirement, message] of [
      ['containsLowercaseLetter','Add a lowercase letter.'], ['containsUppercaseLetter','Add an uppercase letter.'],
      ['containsNumericCharacter','Add a number.'], ['containsNonAlphanumericCharacter','Add a symbol allowed by the password requirements.'],
    ]) if (passwordStatus?.[requirement] === false) missing.push(message);
    return { field: 'password', message: missing.join(' ') || 'Password doesn’t meet the account requirements. Choose a longer, stronger password.' };
  }
  if (error?.code === 'auth/network-request-failed') return { field: null, message: 'We couldn’t connect. Check your connection and try again.' };
  if (error?.code === 'auth/too-many-requests') return { field: null, message: 'Too many attempts. Please wait before trying again.' };
  if (error?.code === 'auth/operation-not-allowed') return { field: null, message: 'Account creation is temporarily unavailable. Please try again later.' };
  return { field: null, message: 'We couldn’t complete account creation. Please try again.' };
}

export async function saveRegistrationPreferredName(token, name, fetchImpl = fetch) {
  const headers = { authorization: `Bearer ${token}` };
  const current = await fetchImpl('/api/account/preferences', { headers });
  if (!current.ok) throw new Error('Preferred name could not be loaded.');
  const { preferences } = await current.json();
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) throw new Error('Preferred name settings were unavailable.');
  const saved = await fetchImpl('/api/account/preferences', {
    method: 'PUT', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ ...preferences, preferredName: name }),
  });
  if (!saved.ok) throw new Error('Preferred name could not be saved.');
}

export function createAccountScreen({ root, register, complete, savePreferredName, validatePassword, onBack, onPendingChange, onBackgroundError }) {
  const get = id => root.querySelector(`#${id}`);
  const form = get('registerForm'), title = get('registerTitle'), email = get('registerEmail'), password = get('registerPassword');
  const name = get('registerDisplayName'), agreement = get('registerAgreement'), submit = get('registerSubmit'), back = get('registerBack');
  const toggle = get('registerPasswordToggle'), status = get('registerStatus'), announcer = get('registerAnnouncer');
  const fields = {
    email: { input: email, error: get('registerEmailError'), errorId: 'registerEmailError', hint: '' },
    password: { input: password, error: get('registerPasswordError'), errorId: 'registerPasswordError', hint: 'registerPasswordHelp' },
  };
  let pending = false, createdToken = null;

  function clearErrors() {
    status.hidden = true; status.textContent = ''; announcer.textContent = '';
    for (const field of Object.values(fields)) {
      field.error.hidden = true; field.error.textContent = ''; field.input.setAttribute('aria-invalid','false');
      if (field.hint) field.input.setAttribute('aria-describedby',field.hint); else field.input.removeAttribute('aria-describedby');
    }
  }
  function showError({ field: key, message, backgroundMessage = message }) {
    clearErrors();
    const field = fields[key];
    if (field) {
      field.error.textContent = message; field.error.hidden = false; field.input.setAttribute('aria-invalid','true');
      field.input.setAttribute('aria-describedby',[field.hint,field.errorId].filter(Boolean).join(' '));
    } else { status.textContent = message; status.hidden = false; announcer.textContent = message; }
    if (root.hidden) onBackgroundError?.(backgroundMessage);
    else if (field) field.input.focus();
  }
  function maskPassword() {
    password.type = 'password'; toggle.textContent = 'Show'; toggle.setAttribute('aria-label','Show password'); toggle.setAttribute('aria-pressed','false');
  }
  function setPending(value) {
    const changed = pending !== value;
    pending = value; submit.disabled = value;
    for (const input of [email,password,name,agreement,toggle]) input.disabled = value || Boolean(createdToken);
    form.setAttribute('aria-busy',String(value));
    if (value) submit.textContent = createdToken ? 'Opening account…' : 'Creating account…';
    else submit.textContent = createdToken ? 'Continue' : 'Create account';
    if (changed) onPendingChange?.(value);
  }
  async function submitRegistration(event) {
    event.preventDefault();
    if (pending || (!createdToken && !form.reportValidity())) return;
    clearErrors(); setPending(true);
    status.textContent = createdToken ? 'Opening your account…' : 'Creating your account…'; status.hidden = false; announcer.textContent = status.textContent;
    const submittedPassword = password.value, preferredName = name.value.trim();
    try {
      if (!createdToken) {
        try {
          createdToken = await register(email.value.trim(),submittedPassword);
          if (!createdToken) throw new Error('Registration did not return a session.');
        } catch (error) {
          let passwordStatus;
          if (['auth/weak-password','auth/password-does-not-meet-requirements'].includes(error?.code)) {
            try { passwordStatus = await validatePassword?.(submittedPassword); } catch { /* A policy lookup failure must still allow retry. */ }
          }
          setPending(false); showError(registrationFeedback(error,passwordStatus)); return;
        }
        password.value = ''; maskPassword();
        if (preferredName) {
          try { await savePreferredName(createdToken,preferredName); }
          catch {
            showError({ field: null, message: 'Your account was created, but your display name wasn’t saved. You can add it in Profile. Choose Continue to play.',
              backgroundMessage: 'Your account was created, but your display name wasn’t saved. Sign in to continue; you can add your name in Profile.' });
            return;
          }
        }
      }
      try { await complete(createdToken); createdToken = null; }
      catch { showError({ field: null, message: 'Your account was created, but we couldn’t finish opening it. Try Continue again, or go back to sign in.',
        backgroundMessage: 'Your account was created, but we couldn’t finish opening it. Sign in again to continue.' }); }
    } finally { setPending(false); }
  }
  form.addEventListener('submit',submitRegistration);
  toggle.addEventListener('click',() => {
    const show = password.type === 'password'; password.type = show ? 'text' : 'password'; toggle.textContent = show ? 'Hide' : 'Show';
    toggle.setAttribute('aria-label',show ? 'Hide password' : 'Show password'); toggle.setAttribute('aria-pressed',String(show));
  });
  back.addEventListener('click',() => { password.value = ''; maskPassword(); onBack(email.value.trim()); });
  for (const field of Object.values(fields)) {
    field.input.addEventListener('input',() => {
      field.error.hidden = true; field.error.textContent = ''; field.input.setAttribute('aria-invalid','false');
      if (field.hint) field.input.setAttribute('aria-describedby',field.hint); else field.input.removeAttribute('aria-describedby');
    });
    for (const type of ['blur','change','invalid']) field.input.addEventListener(type,() => {
      if (field.error.hidden) field.input.setAttribute('aria-invalid',String(field.input.matches(':user-invalid')));
    });
  }
  return {
    get pending() { return pending; },
    open(initialEmail = '') {
      if (pending) return;
      createdToken = null; email.value = initialEmail; password.value = ''; name.value = ''; agreement.checked = false;
      clearErrors(); maskPassword(); setPending(false); title.focus();
    },
  };
}
