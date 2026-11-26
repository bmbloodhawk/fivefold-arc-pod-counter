# Fivefold Arc: next release tasks

Prepared November 25, 2026 (America/Los_Angeles). This plan preserves the older
`tasks/plan.md` and `tasks/todo.md`; their broader persistence/update designs are
not completed merely because a narrower recovery implementation now exists.

Local runtime candidate: `21ab3b2c716e843fe508f6a970f1ce0d5440a513`, App352,
worker cache427. It includes both audited branch heads without changing their
gameplay bytes. It has not been published. Recheck both remote heads before any
push; a newer head invalidates a blind promotion.

## 1. Resolve the public trust gates

- **Outcome:** establish credential status, an approved operator/contact, and
  honest retention/provider wording for the actual release scope.
- **Why now:** signed-in IAM and public-key comparison confirm the previously
  exposed service-account key remains active; users lack a direct help/privacy contact outside a
  connected game. Broad acquisition must not outrun those basics.
- **Files/systems:** Google Cloud IAM and Firebase/Render configuration (read-only
  initially), `client/privacy.html`, `client/terms.html`, home Help entry if approved.
- **Acceptance:** provider evidence identifies the old key as disabled/deleted and
  confirms the replacement is used in each environment, without copying secrets;
  owner approves a public operator name/contact and retained-data inventory.
  Review actual assets/access model against current rights-holder/provider terms
  before broad promotion or payment; do not infer legal permission from a disclaimer.
- **Verification:** authorized key metadata inspection and normal provider-backed
  staging read/write; signed-out reachability of the approved contact; focused
  account/legal checks. The initial in-app Cloud attempt lacked access; signed-in
  Chrome subsequently showed the exposed key Active, with its identity confirmed
  by public-key fingerprint comparison. No access was expanded or credential changed.
- **Risk:** credential changes can stop Firebase auth/storage; unsupported retention
  promises can mislead users. Source inspection does not establish live Rules/IAM.
- **Rollback/recovery:** prepare replacement credentials and a staging validation
  before retiring a possibly active key. Do not restore an exposed key. Revert
  inaccurate draft copy locally; approve any data cleanup independently.
- **Approval:** read-only investigation/local drafts are authorized. Changing
  credentials, access, privacy settings, deletion policy, or publishing wording
  requires explicit approval. Do not invent an operator or publish an email.

## 2. Publish and accept the exact staging candidate

- **Outcome:** the export-session protection and fresh version pins run together
  on staging, preserving current artwork and existing gameplay.
- **Why now:** public source `e988e42` downloads a synthetic stale account export
  after profile retirement; staged source `872e5e2` suppresses it. Both currently
  use App351/cache426 despite different app bytes, so promotion needs fresh pins.
- **Files/systems:** isolated candidate branch, GitHub staging branch/CI, Render
  staging service `srv-dbipl9gu01pc73djsj40`. Production is excluded from this task.
- **Acceptance:** rebase/reconcile if heads moved; stage exactly the reviewed
  runtime candidate; GitHub tests pass; `/health.revision` matches; HTML App352,
  worker427 and sampled module bytes match; 64 hosted protocol checks pass;
  controlled staging-account export/sign-out/switch and feedback save/reload pass.
- **Verification:** read-only served-byte hashes plus hosted protocol suite and
  disposable staging UI checks. Existing hosted 64/64 and 12/12 hashes prove
  `872e5e2`, not the unpublished candidate or authenticated provider flows.
- **Risk:** deploy disconnects staging streams; older installed clients may keep
  their prior worker until closed. Never test in an existing player's table.
- **Rollback/recovery:** after owner approval, restore staging `872e5e2` artifact
  if needed, then recheck exact bytes and health; preserve test records for diagnosis.
- **Approval:** obtain explicit approval immediately before pushing staging, because
  the branch auto-deploys and changes a live service. No force-push, provider terms,
  environment change, real-account deletion or production action is included.

## 3. Complete physical-phone and installed-update acceptance

- **Outcome:** demonstrate the actual phone/network/restart/update boundary rather
  than infer it from Node tests or desktop emulation.
- **Why now:** current evidence does not cover a complete mixed-device session on
  this candidate or hosted recovery following a controlled restart.
- **Files/systems:** `qa/RELEASE_ACCEPTANCE_2026-11-25.md`, `qa/STAGING_RUNBOOK.md`,
  private staging Diagnostics, physical iPhone Safari/PWA and Android Chrome/PWA.
- **Acceptance:** create/join, own-seat life and partner damage, lethal/finish,
  guest-dismiss-first, ready/start a second game, background for at least 30s,
  refresh, network switch/reconnect, and no replay all pass; observed peer convergence
  meets the existing two-second field target after connectivity returns. A waiting
  worker must leave active play/controller intact and update only after all old
  app windows close at a safe boundary. Both seats/totals recover after a confirmed
  saved checkpoint and an explicitly approved staging restart.
- **Verification:** record exact revision, phones/OS/browser versions, app/controller
  cache markers, saved/live versions, timing and failures using the prepared form.
  Keep physical counters or paper ready. Historical phone checks are supporting
  context, not acceptance of this candidate.
- **Risk:** restart interrupts every staging table; mobile suspension and provider
  failures can lose unconfirmed changes. Do not promise seamless availability.
- **Rollback/recovery:** stop at the first mismatch, preserve diagnostics, use the
  paper totals and the last confirmed checkpoint; do not reset another table.
- **Approval:** user participation is required for physical devices; check other
  active staging tables and obtain explicit approval before the live restart.

## 4. Make the go/no-go decision, then release and monitor

- **Outcome:** one approved revision, a bounded alpha audience, verified release
  markers, and a monitored first hour with a ready compatible rollback.
- **Why now:** a healthy endpoint and passing tests do not approve public release.
- **Files/systems:** release assessment, GitHub main/CI, production Render service
  `srv-da0h43dbedkc73aoriu0`, private feedback/Diagnostics and health/asset checks.
- **Acceptance:** tasks 1–3 have recorded evidence appropriate to the agreed audience;
  all current blockers are resolved or explicitly accepted for a limited alpha;
  owner approves the exact revision/action/risk/rollback; health/assets then match;
  a disposable public create/join/play/finish/new-game smoke and feedback intake
  succeed; first-hour checks at 0, 5, 15, 30 and 60 minutes show no new critical failure.
- **Verification:** follow the monitoring and rollback procedure in
  `docs/LAUNCH_READINESS_2026-11-25.md`. Record failed/missing samples honestly.
  The current Render HTTP metrics response is empty; it is not a measured baseline.
- **Risk:** restarting production disconnects active streams, installed clients
  can remain on old cached releases, and rollback to today's public build restores
  its known export race. Checkpoint/source compatibility matters more than SHA age.
- **Rollback/recovery:** stop promotion on a wrong revision/asset, ownership/state
  mismatch, private-data exposure, or repeated critical-flow failure; preserve
  evidence and obtain owner approval for rollback. Previous public artifact is
  `e988e42467391fd9ff5d8a5594616dc366c06555`; estimate 5–10 minutes for redeploy and
  server checks, unmeasured and excluding deferred installed-client updates.
- **Approval:** explicit production publication approval is mandatory. No paid plan,
  payment activation, outreach, terms acceptance, automatic rollback, credential
  change, data purge or account/privacy setting change is included.
