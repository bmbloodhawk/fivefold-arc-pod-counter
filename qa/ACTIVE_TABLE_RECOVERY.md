# Active table return after refresh

Reloading automatically reclaims the last active shared seat on this browser, using its existing credential and the server's current snapshot. It never claims an unreserved seat.

On the first upgrade, if the new marker is absent, the page migrates the most recently used valid seat across the historical active-table marker and saved table history. It ignores recovery-only placeholders and invalid seat metadata. If the newest real target has lost its credential, it stays Home rather than choosing an older different table. No initial manual Return is required.

Once the new marker exists, it is authoritative. Deliberate Leave, Clear, Create, Join or local demo writes a null marker, which prevents historical entries from reopening later. Explicitly returning to a saved table makes that seat active again.

Explicit table invite links and Pod/tournament fragments take priority. Create, Join, local demo, registration during pending recovery, and deliberate leave/forget actions cancel automatic return. Clearing past tables also cancels a pending return. Transient recovery errors retain the target for the next online event; permanently unavailable seats clear only the automatic target.

Room-seat credentials and Pod membership remain separate: reclaiming an existing room seat does not restore revoked Pod access or alter participant linkage.

Focused tests:

```powershell
node --test client/active-table-recovery.test.mjs client/realtime-race.test.mjs
node --test --test-name-pattern='automatic.*(return|reclaim)' server/test/server.test.js server/test/counter-recovery.test.js
```

`checkActiveTableRecovery` in `qa/active-table-recovery.browser.mjs` accepts a fresh disposable two-seat fixture from the Dial browser harness, its loopback base URL, and an output directory. It tests reload, authoritative life, recovered ownership, first-upgrade migration without Return, deliberate-leave tombstones, delayed-navigation cancellation, and six seconds of Dial-size stability. It never reads browser credentials or targets a hosted app.

For phone validation, refresh the existing shared table and verify the same seat and value before making one new adjustment. Also verify that Leave followed by refresh stays Home, and that opening an explicit invite takes priority. Physical-phone and installed-PWA acceptance require separate device evidence.
