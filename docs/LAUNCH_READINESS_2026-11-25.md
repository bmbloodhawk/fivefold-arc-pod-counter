# Fivefold Arc launch assessment

Checked November 25, 2026 (America/Los_Angeles).
Evidence JSON uses UTC. Decision: **No-go for broader public onboarding or a
production promotion in this audit.** The application is already a public alpha;
it is not newly awaiting its first public URL, and this evidence does not establish
production readiness. No remote branch, live setting, credential, account, or
production game data was changed by this work. Disposable staging protocol tests
created test tables. The unrelated primary workspace was preserved.

## Current release status

| Environment | Observed revision | Source/asset evidence |
|---|---|---|
| Public | `e988e42467391fd9ff5d8a5594616dc366c06555` | Render deploy, health200, 12/12 sampled assets match; GitHub Tests succeeded. |
| Staging | `872e5e2a61a0db14b6a3590f543e7e42060ff741` | Render deploy, health200, 12/12 sampled assets match; GitHub Tests succeeded; hosted protocol64/64. |
| Local runtime candidate | `21ab3b2c716e843fe508f6a970f1ce0d5440a513` | App352/cache427; reviewed release preparation plus both remote heads as ancestors. Not deployed. |

This SHA identifies the tested runtime-preparation commit. Documentation and test-
harness follow-ups may be descendants. Freeze the final deployment SHA at approval
time and verify health against that exact SHA; never substitute a moving branch name.

The public deployment completed independently while this audit was running; this
chat did not initiate it. Both hosted releases currently serve App351/cache426,
but their `app.js` bytes differ because the account-export fix is only on staging.
The local candidate gives that content fresh pins before any proposed promotion.
Source/marker correspondence is demonstrated for the sampled origin files, not
every existing installed client's controlling worker.

Both Render services are separate, single-instance Free Node services with
auto-deploy on their respective branches and `/health` configured. Staging/public
database targets, live Rules/IAM, every environment variable and backup state were
not read; do not treat resource separation as proof of current data isolation.
Current public and staging competition config both report enabled, with Pod deletion
and invite scanner enabled. `/health` reports `appearanceRewardsReady:true`; it does
not attest recovery checkpoint readiness.

## Release blockers

| Priority | Blocker | Evidence | Smallest safe resolution | Verification |
|---|---|---|---|---|
| P1 | Public account exports can complete after sign-out/profile change. | Fresh synthetic execution of public source produced1 stale download; staging source produced0. No real user's private data was used. | Promote the existing guarded implementation with fresh pins after staging acceptance and approval. |45 export regressions; hosted controlled-account normal/sign-out/switch cases. |
| P1 | Previously exposed service-account key remains active. | Signed-in Chrome IAM shows key ending55d6beb9 Active. Its public SPKI fingerprint matches the historical exposed credential and Google's current certificate for that exact key ID. | With approval, create a protected replacement, verify consumers on staging then production, and retire the exposed key after those checks. | Replacement provider read/write succeeds; old key disabled/deleted; every consumer uses the replacement. |
| P1 evidence gate | Current physical-phone, hosted restart and installed-phone update acceptance is missing. | Local forced-kill, desktop Chromium PWA and hosted protocol pass; no current mixed iOS/Android complete-game/restart evidence was obtained. | Execute the prepared two-phone acceptance record against the exact staged candidate, with a paper fallback. | Same seats/totals after approved restart; no forced update during play; correct second-game/reconnect behavior. |
| P2, broad onboarding gate | Support/privacy contact and retention/provider decisions are incomplete. | Terms explicitly has no dedicated contact. Retained playtest/recovery/feedback records lack an automatic TTL; scan provider is not named. Owner has not chosen public details. | Approve a name/contact and accurate inventory/retention wording; review actual rights-holder/provider uses before broad promotion/payment. | Signed-out contact access; wording checked against storage and deletion behavior; owner/qualified review recorded. |

These are gates for the next promotion/expansion. They are not a claim that every
existing alpha session is unsafe or that an unknown key has been compromised.
Scope may be narrowed to invited alpha use with an explicit direct owner contact
and accepted documented limitations; do not silently waive the phone or credential gates.

## Confirmed

- Full local suite: **1,686 passed** (818 server +868 client), no failures/skips/
  cancellations. Server tests cover the unchanged server bytes; client868 was
  repeated successfully after local ancestry reconciliation. No build, lint or
  type-check script is defined; Node serves checked-in browser assets directly.
- **64/64 hosted staging protocol checks** passed, including Commander source/tax,
  own-seat authority, contested claims/writes, reset, convergence, reclaim/stale
  rejection, setup return and a four-table tournament protocol soak. These create
  synthetic staging rooms and are not a physical tournament or OAuth test.
- Recovery review: **247 focused tests** passed, including actual child-process
  SIGKILL,20 acknowledged changes restored, old connection denied, retry applied
  once. The disposable loopback store is not hosted Firebase. Dedup retains the
  most recent100 operation IDs per seat. Optimistic display/SSE can precede durable
  HTTP confirmation; unconfirmed state may be lost. Single-process ownership remains.
- Browser emulation:24 Button cases (2/8 players,320/390 widths,six modes) and12
  actual Dial plus/minus cases passed. Two isolated Chromium contexts passed10 UI scenarios:
  create/join, life, partner damage, view-only, reload, offline/no replay, winner,
  guest-dismiss-first, second game and deliberate Leave. Zero page errors in those
  flows. Root inspected narrow Commander and390px second-game screenshots.
  Browser engine was Chrome140.0.7339.128 with Playwright1.65.1; this older desktop
  engine is not evidence for current physical mobile browsers.
- Repaired and reran the complete existing Dial browser gate: **294 size/mode,
  108 numeric and36 skin/font cases passed**, plus native input/keyboard/drag,
  settled/long warning and elimination checks, with zero page errors. Only two QA
  files changed. Exact .35px geometry and gameplay/clearance gates were retained;
  current setup, clipped-button hit targets, caption geometry, observer timing and
  hidden-number reference measurements replaced obsolete harness assumptions.
- Actual disposable Chromium two-tab worker test passed: App351/cache426 stayed
  controlling during play with new427 waiting; scoring worked, no reload/controller
  switch occurred. One remaining old tab kept the worker waiting at intermission.
  Closing all old app tabs allowed normal activation; reopen loaded App352/cache427
  and reclaimed intermission. Synthetic signed-out auth fixture; no physical device.
- **72 focused trust/account/erasure tests** passed. Root/server npm audits each
  reported0 known vulnerabilities. Targeted scans are not full secret-history or
  supply-chain certification. Public web Firebase configuration is not a service-
  account private key.
- Read-only hosted checks: developer access, authoring catalog and feedback without
  a portal key returned403 on both sites; account decks/export returned401, with
  no-store/nosniff. Public authoring HTML shells exist; catalog/diagnostic data is
  server-key protected. No new player-facing developer link was introduced.
- Account-data deletion scope matches the UI: private app records and shared
  identity redaction, not Firebase Authentication account deletion. Device activity
  has implemented30-day pruning; this does not cover every retained record.
- No open PRs were returned by the connected repository search. GitHub Tests passed
  for current main/staging; branch-protection inspection returned403. Render deploys
  on commit, so CI success is not an enforced deployment gate demonstrated here.

## Likely, but not yet verified

Firebase-backed recovery is likely available from normal startup wiring and the
account/reward readiness signal, unless the live recovery switch overrides it.
The health payload does not expose that switch or certify a recent successful
checkpoint. A real hosted save/restart/reclaim is needed to close that inference.

## Unknown

- Which consumers still use the exposed key, Rules/IAM/restrictions, full environment configuration,
  staging/public storage isolation and provider backup/retention practices.
- Current private feedback inbox contents and whether a fresh hosted feedback write
  survives reload. The audit did not have the private portal key. Previous feedback
  counts or statuses are not presented as current evidence.
- Hosted real-account export, sign-out/account-switch, email/Google sign-in and
  password-reset delivery. Synthetic local coverage does not prove these providers.
- Physical iPhone/Android safe areas/touch, suspension, Wi-Fi/cellular switching,
  longer repeated group play, installed-client upgrade and hosted restart.
- Production error/latency baseline: Render HTTP metrics returned empty data; the
  queried error-level logs returned no entries. Missing samples do not prove zero
  errors. No complete browser accessibility or performance certification is claimed.

## Post-launch improvement

For a limited invited alpha with the gates satisfied, defer a strict CSP until
Firebase popup/email/PWA compatibility is tested, broad scaling/refactoring,
automated retention cleanup until policy/deletion recovery are approved, monetization,
Leagues and a richer update notice. The full Dial harness was repaired and passed
locally during this audit; no assertion was silenced. The proposed explicit update
coordinator remains unimplemented.

## Ordered release plan

See [the four dependency-ordered tasks](../tasks/launch-readiness-2026-11-25/plan.md)
for outcomes, affected systems, acceptance, verification, risk, rollback and approval:

1. Resolve the public trust gates.
2. Publish and accept the exact staging candidate after approval.
3. Complete physical-phone/restart/update acceptance.
4. Obtain a production go/no-go decision, then deploy/monitor only if approved.

The [phone acceptance record](../qa/RELEASE_ACCEPTANCE_2026-11-25.md) is prepared,
with all physical rows explicitly marked **Not run**.

## Local changes and verification

The six-file runtime-preparation diff changes only HTML/SW release pins, README and
two recovery documents, and one reliability-probe health assertion. `app.js`,
gameplay authority, networking, scoring and appearance bytes are unchanged from
staging872. The guarded exports and saved-deck HTTP extraction were already on
staging; no new account implementation was invented here.

The existing reliability probe initially exited1 during health/assets because it
required the entire JSON object to equal `{ok:true}`; health now includes additive
metadata. Checking HTTP200 and `ok===true` repairs that false failure while retaining
all other assertions. The corrected report passed200/200 changes, duplicate
suppression, stale-owner403 and injected500 state preservation. Local sequential
two-seat acknowledgement p95 was16.47ms, not a hosted/mobile capacity measurement.
Independent review found no actionable issues; diff checks passed.

The additional two-file QA repair now completes the full Dial matrix. The original
failures are retained: obsolete setup/geometry, immediate measurement before the
warning ResizeObserver settled, and missing reference-font measurement when the
elimination screen hid the numeric ink. A focused reproduction proved the warning
cleared after the existing layout settled; the app/CSS needed no change. The final
full runner exited0, and38 focused Dial unit tests also passed. These results remain
desktop emulation rather than current physical-phone acceptance.

The primary checkout and its uncommitted/untracked work were not edited. Preparation
is isolated on `codex/launch-readiness-20261125`; nothing was pushed. Current remote
heads were rechecked and remained as recorded. No restart, credential change, data
purge, terms acceptance, payment, outreach or production smoke write occurred.

## Deployment, monitoring and rollback procedure

Before any approval request: refresh remote heads and live revisions; confirm the
reviewed source is still the intended candidate, checkpoints are healthy, and no
affected live tables are active. State the exact branch/ref action and expected
health/asset markers. A staging push auto-deploys staging; a main push auto-deploys
production. Do not trigger another manual deploy after an automatic one.

After an approved production release, check at0,5,15,30 and60minutes: `/health` exact
revision; HTML/module/worker bytes; developer/account authorization; private failed
requests/feedback; and the explicitly approved disposable public game smoke. Record
counts and unavailable samples, rather than inventing a baseline from empty metrics.
No monitoring automation or external alert delivery was created by this audit.

Stop promotion immediately for wrong release bytes, foreign-seat mutation, divergent
state after reclaim, stale private export, or repeated inability to create/join/
finish/start another game. Preserve diagnostics and physical totals. Owner approval
is required for a production rollback or live restart. Prepare a reviewed forward
fix if rollback would reintroduce the export privacy defect.

The prior public artifact is `e988e42467391fd9ff5d8a5594616dc366c06555`; the prior
staging artifact is `872e5e2a61a0db14b6a3590f543e7e42060ff741`. Recheck their availability
and record compatibility at action time. Restore the approved artifact through
Render rollback or an approved compatible Git revert; never force-reset shared
branches. Verify exact health/asset bytes and a critical flow afterward. Expected
server rollback plus checks:5–10minutes, an estimate rather than a tested recovery
time. Existing installed clients can defer updates until their old windows close.

Render documents idle sleep, ephemeral local storage, possible free-service restarts
and limited rollback history. Those constrain alpha availability; a safe client
worker cannot guarantee continuity through a server/provider interruption.
[Official Render Free documentation](https://render.com/docs/free).

Before broad promotion/payment, review actual assets, attribution, access gates and
monetization against the rights holder's current policy; the existing unofficial
terms statement is not evidence of full permission.
[Official Wizards Fan Content Policy](https://company.wizards.com/en/legal/fancontentpolicy).

## Recommended next action

Obtain approval to create a replacement for the exposed service-account key, with
the user handling secret creation/download and entry. Creation alone must not change
either hosted app or disable the old key. Verify and migrate consumers before its
retirement. Keep the app candidate local and arrange the staging/physical acceptance
window; passing tests alone do not approve a broader public launch.

Raw local evidence is under `outputs/launch-audit/`: served hashes, export baseline
comparison, full/client/protocol logs, reliability report, focused audit notes,
phone screenshots and the two-tab worker record. These are local audit artifacts,
not a public support page or new telemetry collection.

Automatic approval review rejected cleanup of the generated worker-test fixture
copy/archive with “blocked by policy” and no more specific reason. Those disposable
files remain; no user or original source file was deleted.

### Credential finding update — November 25, 2026, 23:46 Pacific

The initial in-app browser lacked access; the user's signed-in Chrome profile has
access to Fivefold Arc Playtest. IAM lists the Firebase Admin SDK account's key
`869ce1ba058238417f657bda4818a4f055d6beb9` as Active, created August25. A local,
in-memory derivation of the public key from the historical exposure matched the
public SPKI SHA-256 in Google's current certificate for that same ID. The private
key was not printed, saved again, used to sign anything, or exchanged for a token.
This confirms the previously exposed key is still active; it is not evidence
of third-party misuse. Evidence: `outputs/launch-audit/key-status-20261125.json`.

No key, permission, Render setting, deployment or live data was changed. The next
proposed step is creation of one replacement JSON key for this same service account,
under user control. It creates another credential but leaves both apps and the old
key unchanged. Protect the downloaded file; do not paste its contents into chat.
An unused replacement can be revoked without affecting either app. Any application
configuration/deployment and old-key retirement need their own approved checks.

Render restarts retain deployed environment values; saved-only credentials require
an approved deployment to take effect. Render rollback can restore an old deployment's
credential configuration, so a later recovery must retain working replacement
credentials rather than blindly restore the exposed key. Disabling/deleting a key
does not immediately invalidate access tokens already issued from it.
[Google credential-response guidance](https://docs.cloud.google.com/docs/security/compromised-credentials).
[Google key rotation](https://docs.cloud.google.com/iam/docs/key-rotation),
[Render configuration](https://render.com/docs/configure-environment-variables),
[Render rollback](https://render.com/docs/rollbacks#whats-rolled-back).
