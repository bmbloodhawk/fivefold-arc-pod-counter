# Shared seat-order renderer

The lobby and next-game player lists now use `client/seat-order.js`. The caller supplies players, roster order, readiness, host permissions, name/HTML helpers and action callbacks. The renderer owns only row markup and click binding; existing app handlers still read the current order and perform mutations and error handling.

This is a behavior-preserving extraction. Stable seat labels, arrow boundaries, readiness text, escaped names and host-only removal stay the same. The module is included in the offline shell with App338/cache406. No dependency was added.

Validation:

- Full `npm test`: server 773/773 and client 772/772; no failures or skips.
- Direct renderer coverage replaces the copied-function harness. All 48 independent baseline/output comparisons matched; inverting the host-removal guard failed two tests.
- Disposable localhost host/guest browser checks passed lobby/intermission reordering, readiness, permissions and the numeric removal callback. Browser error logs were empty. This is desktop browser evidence, not a new physical-phone certification.

The change remains local until a separately authorized push/release.
