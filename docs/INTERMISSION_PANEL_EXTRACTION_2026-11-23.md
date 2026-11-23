# Next-game panel presentation

`client/intermission-panel.js` renders next-game readiness, setup controls, invitations, the roster and tournament completion wording from explicit state, connection status and presentation inputs. It reuses the shared seat-order renderer.

`renderTurnFlow` still decides whether postgame is visible and retains stale-dialog guards, tournament navigation, clocks, elimination and all game mutations. Existing app callbacks continue to own requests and errors. The extraction preserves existing labels, host permissions, roster membership checks, ready/offline/pending behavior and capacity rules.

Most panel cases now import the renderer directly. Two tournament cases retain coordinator integration; the invitation-expansion/request-race tests remain intact. The new module is included in the offline shell with App339/cache407, without a dependency change.

Local host/guest browser verification preserved the previous panel text and exercised readiness, host-only Start, confirmation and return to editable setup. Independent comparisons matched the original DOM fields, roster HTML, action bindings and state; an inverted offline guard was rejected by the tests. This is local desktop browser evidence, not physical-phone certification.

Full `npm test` passed: server 773/773 and client 780/780, with no failures or skips. Six local browser checks and all 17 independent baseline comparisons passed. The cleanup is kept local for review; only the preceding seat-order extraction was authorized for staging publication.
