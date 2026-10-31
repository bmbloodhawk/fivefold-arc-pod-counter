/** Keeps a visible active game's screen awake without treating support as required. */
export class GameWakeLock {
  constructor({ navigatorRef = globalThis.navigator, documentRef = globalThis.document } = {}) {
    this.navigator = navigatorRef;
    this.document = documentRef;
    this.sentinel = null;
    this.wanted = false;
    this.document?.addEventListener?.('visibilitychange', () => { void this.#onVisibilityChange(); });
  }

  get supported() { return Boolean(this.navigator?.wakeLock?.request); }
  get active() { return Boolean(this.sentinel && !this.sentinel.released); }

  async sync({ active, enabled }) {
    this.wanted = Boolean(active && enabled);
    if (!this.wanted || this.document?.visibilityState === 'hidden' || !this.supported) return this.#release();
    if (this.active) return;
    try {
      const sentinel = await this.navigator.wakeLock.request('screen');
      if (!this.wanted || this.document?.visibilityState === 'hidden') { await sentinel.release(); return; }
      this.sentinel = sentinel;
      sentinel.addEventListener?.('release', () => { if (this.sentinel === sentinel) this.sentinel = null; });
    } catch {
      // Battery settings and browser policy may reject this optional request.
      this.sentinel = null;
    }
  }

  async #onVisibilityChange() {
    if (this.document?.visibilityState === 'visible' && this.wanted) await this.sync({ active: true, enabled: true });
  }

  async #release() {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel && !sentinel.released) await sentinel.release().catch(() => {});
  }
}
