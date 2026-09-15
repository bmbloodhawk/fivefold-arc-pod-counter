import { createPublicKey, verify } from "node:crypto";

const CERTIFICATES_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

export class FirebaseIdTokenVerifier {
  constructor({ projectId, fetchImpl = fetch, now = () => Date.now() } = {}) {
    if (!/^[a-z0-9-]{6,63}$/.test(projectId || "")) throw new TypeError("Firebase project ID is required");
    this.projectId = projectId; this.fetchImpl = fetchImpl; this.now = now; this.certificates = null; this.expiresAt = 0;
  }

  async verify(token) {
    if (typeof token !== "string" || token.length > 12_000) throw Object.assign(new Error("Sign in is required"), { status: 401, code: "ACCOUNT_AUTH_REQUIRED" });
    const parts = token.split(".");
    if (parts.length !== 3) throw Object.assign(new Error("Your sign-in session was invalid"), { status: 401, code: "ACCOUNT_AUTH_INVALID" });
    let header; let claims;
    try { header = decode(parts[0]); claims = decode(parts[1]); } catch { throw Object.assign(new Error("Your sign-in session was invalid"), { status: 401, code: "ACCOUNT_AUTH_INVALID" }); }
    if (header?.alg !== "RS256" || typeof header.kid !== "string") throw Object.assign(new Error("Your sign-in session was invalid"), { status: 401, code: "ACCOUNT_AUTH_INVALID" });
    const certificates = await this.#certificates(); const certificate = certificates[header.kid];
    if (!certificate || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey(certificate), Buffer.from(parts[2], "base64url"))) throw Object.assign(new Error("Your sign-in session was invalid"), { status: 401, code: "ACCOUNT_AUTH_INVALID" });
    const nowSeconds = Math.floor(this.now() / 1000);
    if (claims.aud !== this.projectId || claims.iss !== `https://securetoken.google.com/${this.projectId}` || typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128 || !Number.isInteger(claims.exp) || claims.exp <= nowSeconds || !Number.isInteger(claims.iat) || claims.iat > nowSeconds + 60) throw Object.assign(new Error("Your sign-in session has expired"), { status: 401, code: "ACCOUNT_AUTH_INVALID" });
    return { providerSubject: claims.sub };
  }

  async #certificates() {
    if (this.certificates && this.expiresAt > this.now()) return this.certificates;
    const response = await this.fetchImpl(CERTIFICATES_URL);
    if (!response.ok) throw Object.assign(new Error("Sign-in verification is temporarily unavailable"), { status: 503, code: "ACCOUNT_AUTH_UNAVAILABLE" });
    const cacheControl = response.headers.get("cache-control") || ""; const seconds = Number(/max-age=(\d+)/.exec(cacheControl)?.[1] || 300);
    this.certificates = await response.json(); this.expiresAt = this.now() + Math.max(60, seconds) * 1000;
    return this.certificates;
  }
}

export function createFirebaseIdTokenVerifierFromEnv(env = process.env) {
  return env.FIREBASE_PROJECT_ID ? new FirebaseIdTokenVerifier({ projectId: env.FIREBASE_PROJECT_ID }) : null;
}
