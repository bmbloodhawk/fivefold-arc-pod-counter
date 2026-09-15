const firebaseConfig = {
  apiKey: "AIzaSyBiJM1zrA0riStcpG0r5035Etijn7TTrig",
  authDomain: "fivefold-arc-playtest.firebaseapp.com",
  projectId: "fivefold-arc-playtest",
  appId: "1:595885707998:web:0845f712f199d5a4fce84f",
};

let auth;
async function firebaseAuth() {
  if (auth) return auth;
  const [{ initializeApp }, { getAuth }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js"),
  ]);
  auth = getAuth(initializeApp(firebaseConfig)); return auth;
}

export async function googleAccountToken() {
  const { GoogleAuthProvider, signInWithPopup } = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js");
  const credential = await signInWithPopup(await firebaseAuth(), new GoogleAuthProvider());
  return credential.user.getIdToken();
}

export async function currentAccountToken() {
  const user = (await firebaseAuth()).currentUser;
  return user ? user.getIdToken() : null;
}

export async function emailAccountToken(email, password, create = false) {
  const { createUserWithEmailAndPassword, signInWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js");
  const credential = create ? await createUserWithEmailAndPassword(await firebaseAuth(), email, password) : await signInWithEmailAndPassword(await firebaseAuth(), email, password);
  return credential.user.getIdToken();
}
