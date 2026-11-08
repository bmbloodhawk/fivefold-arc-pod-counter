/** Requests a screen wake lock only while a visible game needs one. */
export class GameWakeLock {
  constructor({ navigatorRef = globalThis.navigator, documentRef = globalThis.document } = {}) {
    this.navigator = navigatorRef;
    this.document = documentRef;
    this.sentinel = null;
    this.wanted = false;
    this.requesting = false;
    this.retryAfterRequest = false;
    this.document?.addEventListener?.('visibilitychange', () => { void this.#update(); });
  }

  get supported() { return typeof this.navigator?.wakeLock?.request === 'function'; }
  get active() { return Boolean(this.sentinel && !this.sentinel.released); }

  sync({ active, enabled }) {
    const wanted = Boolean(active && enabled);
    if (wanted === this.wanted) return;
    this.wanted = wanted;
    return this.#update();
  }

  #shouldHold() {
    return this.wanted && this.document?.visibilityState === 'visible' && this.supported;
  }

  async #update() {
    if (!this.#shouldHold()) {
      const sentinel = this.sentinel;
      this.sentinel = null;
      if (sentinel && !sentinel.released) {
        try { await sentinel.release(); } catch { /* The browser controls the screen lock. */ }
      }
      return;
    }
    if (this.active) return;
    if (this.requesting) {
      this.retryAfterRequest = true;
      return;
    }

    this.requesting = true;
    try {
      const sentinel = await this.navigator.wakeLock.request('screen');
      if (this.#shouldHold()) this.sentinel = sentinel;
      else await sentinel.release();
    } catch {
      // Battery settings and browser policy can deny this optional request.
    } finally {
      this.requesting = false;
      const retry = this.retryAfterRequest;
      this.retryAfterRequest = false;
      if (retry && !this.active) void this.#update();
    }
  }
}
