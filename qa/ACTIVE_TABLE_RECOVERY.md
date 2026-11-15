# Active table return after refresh

Reloading automatically reclaims the exact last active shared seat on this browser, using its existing credential and the server's current snapshot. It does not infer an active seat from the history list or claim an unreserved seat.

Existing installs must **Return to or open their table once after updating** to establish the new active marker. After that, refreshing the page returns to that seat. Merely having a table in history is insufficient because history includes seats that were deliberately left.

Explicit table invite links and Pod/tournament fragments take priority. Create, Join, local demo, registration during pending recovery, and deliberate leave/forget actions cancel automatic return. Clearing past tables also cancels a pending return. Transient recovery errors retain the target for the next online event; permanently unavailable seats clear only the automatic target.

Room-seat credentials and Pod membership remain separate: reclaiming an existing room seat does not restore revoked Pod access or alter participant linkage.

Focused tests:

```powershell
node --test client/active-table-recovery.test.mjs client/realtime-race.test.mjs
node --test --test-name-pattern='automatic.*(return|reclaim)' server/test/server.test.js server/test/counter-recovery.test.js
```

`checkActiveTableRecovery` in `qa/active-table-recovery.browser.mjs` accepts a fresh disposable two-seat fixture from the Dial browser harness, its loopback base URL, and an output directory. It tests reload, authoritative life, recovered ownership, deliberate leave, manual Return migration, delayed-navigation cancellation, and six seconds of Dial-size stability. It never reads browser credentials or targets a hosted app.

For phone validation, open/Return once, record the life total, refresh, and verify the same seat and value before making one new adjustment. Also verify that Leave followed by refresh stays Home, and that opening an explicit invite takes priority. Physical-phone and installed-PWA acceptance require separate device evidence.
