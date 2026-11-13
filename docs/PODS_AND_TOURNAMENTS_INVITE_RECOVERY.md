# Preserve private invite entry during account restoration

Local browser testing found two related invite races. While a saved account was
restoring, a second invite preview could replace a name typed since the request
started, or reset the event's account/guest choice. In another ordering, restoration
could supersede an already-submitted acceptance: the server joined successfully
but the phone stayed on the invite screen. The natural reproduction occurred when
a returning Pod member accepted a fresh invitation after admin takeover.

`client/competition-ui.js` now reads the current same-invite form immediately before
rendering a refreshed preview. It preserves the latest name, including an intentional
empty value, and the selected guest entry. During an acceptance already in progress,
the restored-account notification leaves that submission in charge of navigation.
Explicit account changes still invalidate old requests. Existing escaping, private
membership checks and exactly-once join request IDs remain in place.

The regression helper `restoredInviteRaceFlow` in
`qa/competition-browser-checks.mjs` uses ordinary form input and held synthetic auth,
preview and join responses. It reproduced the failure against candidate-02, then
passed both editing and submitting orderings for Pods and Tournaments after the fix.
It checks current form values, request counts/status and the resulting joined view;
it does not read account tokens or browser credentials. The helper also waits for an
organizer-attested guest save before reviewing a round, avoiding a test-induced stale
version conflict. Server version-conflict protection was not relaxed.

The complete post-fix loopback browser pass contains 63 assertions (61 distinct labels;
the restore cases run for both group types), no page/server errors, and separately
reviewed screenshots at 320, 390 and 1024 pixel widths. It covers membership/readmission,
private invitations, guests, recovery/intermission, correction retries, timed draws,
standings and independent Pods. All 172 client unit tests also passed. Evidence is
under `.local/pilot-launch-implementation/`, including `invite-restore-red.json`,
`invite-restore-green.json`, `browser-final.json` and `browser-final/` screenshots.

The first invite-fix proof used app `v294` and worker cache `fivefold-arc-v357`.
The subsequently authorized hosted comparison found those identifiers already in use
by staging, plus a Commander entry fix already deployed on both sites. Candidate-04
preserves that exact fix and now uses app `v296`, competition UI `v2`, realtime `v88`,
model/CSS `v1` and worker cache `fivefold-arc-v359`. Seven additional local browser
checks cover the preserved Commander behavior. Only cache identifiers/asset URLs changed in the
worker; its activation policy is unchanged. A fresh isolated local installation and a
subsequent normal document were controlled by this worker. Cached app/UI SHA-256
hashes matched the source and no private API response was cached. The initial install
page was not controlled immediately; a registration alone is not activation evidence.

The current cache/hash proof is `local-worker-proof-359.json`; the older proof remains
as historical evidence. These are Chrome viewport and loopback fixture results, not iPhone/Android, real
OAuth/Firebase, installed-phone upgrade or hosted-release evidence. Those gates remain
required. Candidate-01/02 and their failed attempts are retained as superseded evidence.
