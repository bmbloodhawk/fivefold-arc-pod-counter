# Account export session guards

A deck summary or account export could finish after sign-out or an account switch and download the retired account's private data. Delayed token results could also start requests after retirement, and delayed failures could replace the new account's status.

Both export functions now capture the existing profile epoch before requesting a token and recheck it after every asynchronous boundary. Retired results and failures return without creating a download or reaching the UI error handler. Current-account export content, filenames, errors and object-URL cleanup retain their previous behavior. This does not revoke a download that already completed or add cross-tab cancellation.

Verification:

- Exact current-source diagnostics at base `9fc1d1d` reproduced 12 stale private downloads across sign-out/switch and token/response/JSON delays; two normal controls passed. A disposable local browser also reproduced a stale deck download after actual UI sign-out.
- The new regression suite initially had 13 passing controls and 32 expected failures. All 45 now pass, including both deck JSON stages, account JSON, stale-error suppression, normal contents/filenames and URL cleanup. The focused account read/save/reset run passed 95/95.
- Full `npm test` passed: server 799/799 and client 832/832, totaling 1,631 tests with no failures, skips or cancellations. The four code/test files stayed byte-identical during the run.
- Independent copied tests passed 45/45 and rejected all seven deliberate mutations: omitted JSON guards, omitted stale-error guards and epoch capture after the token request. Source hashes were preserved; no actionable review findings remain.
- Four local browser checks passed for current deck/account downloads and delayed responses after actual UI sign-out. Synthetic identities and in-memory API data were used. Service workers were blocked for the final session-race checks; cache references are covered by the automated suite. Existing dialog/status screenshots were reviewed. No physical-device or live-provider evidence is claimed.

App347/cache416 coordinate the client release references. The earlier server-deck extraction remains a separate local commit. No new dependency, authentication policy, backend API or data structure was added.

I checked asynchronous-response topics and the broad JavaScript/security guides in Modern Web Guidance; none prescribed a change for this existing profile-epoch mechanism, so no new platform API was applied.

The fix remains local for review. Nothing has been pushed or deployed.
