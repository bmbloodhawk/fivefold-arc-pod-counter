# Limited single-server pilot implementation

Goal: finish the local candidate and verification, then obtain the missing authorized
hosted/device evidence. This goal supersedes the assessment-only finish line. Keep
the larger scaling roadmap and all unfinished work intact. No production access,
deployment, commit, branch/worktree change, or removal/movement of existing files.

## 1. Diagnose and fix small-load response delay

- [x] Freeze the starting source fingerprints and preserve current dirty files.
- [x] Reproduce with disposable local fixtures; separate queue wait, storage round trip,
      response consumption and event-loop delay. Explain the demonstrated cause.
- [x] Add a failing behavioral regression; make the smallest measured fix.
- [x] Verify acknowledgement durability, frozen retry ordering, full event/recovery
      persistence and immediate SSE feedback. Retain 250 ms life HTTP p95, 2 s
      convergence and 5 s confirmation gates; disclose all misses.
- [x] Run active 8/16-client three-round scenarios without automatic busy retries.

The atomic event/recovery implementation passed 39 focused tests, including an
actual SIGKILL/restart, and independent read-only review found no actionable hole.
Gated 8/16-client runs passed: life-during-results HTTP p95 127.75/127.79 ms;
maximum measured SSE arrival 32.70/33.79 ms. Earlier misses remain preserved.
See `docs/COUNTER_ATOMIC_PERSISTENCE.md` and the implementation evidence directory.
The current-tree regression preserves the known C5 import failure (511 pass/one
failure). Earlier candidate artifacts passed 505 server + 172 client tests. They
are superseded by the subsequently reproduced and fixed invite-restoration race.

## 2. Prepare a complete local release artifact

- [x] Name exact complete source and test inputs; preserve and explicitly inventory
      the excluded unfinished scaling slice, without modifying or hiding its tests.
- [x] Assemble local artifacts with input/ZIP hashes and a reviewable diff, without
      another Git checkout. Candidate-01/02 passed their normal 677-test suites.
- [x] Verify private ACLs, guests, setup/reclaim/intermission, result confirmation,
      duplicates/corrections/standings, timed draws, flag-off erasure and restart.
- [x] Review phone-size browser behavior: 63 assertions, zero page/server errors,
      separate screenshots and active local cache hash proof. Physical installed-phone
      update compatibility remains an external gate.
- [ ] Verify the final candidate-04 normal suite and exact preservation/integrity.
      The frozen artifact's sidecar status and logs record the later result, rather
      than modifying its input documents after the freeze.

## 3. External release gates (not yet authorized/performed)

- [x] Prepare the proposed read-only staging preflight, later isolated staging/device
      checks, monitoring, stop conditions and compatible rollback in
      `docs/PODS_AND_TOURNAMENTS_PILOT_HANDOFF.md`.
- [x] Read-only staging preflight approved; user also requested public comparison.
      Both are one-instance Free Node services with different database targets;
      staging has higher stream budgets and a blank actual health-check path.
- [x] Preserve the exact Commander entry fix already deployed on both sites and
      assign fresh app296/cache359 versions. Seven targeted browser assertions and
      current local active-worker hash proof pass. Candidate-03 remains preserved.
- [ ] After candidate-04 verification, request separate approval for its exact
      staging publication/configuration and disposable hosted testing. Existing
      permission still forbids commits, deployment and hosted changes.
- [ ] Verify hosted auth, isolated storage/conditional writes, recovery/erasure and
      candidate asset bytes on the approved environment using disposable data.
- [ ] Obtain iPhone Safari plus Android Chrome background/reclaim, play/finish,
      intermission, timed guest draw and active-worker evidence.
- [ ] Finish the readiness audit after required hosted/device evidence.

Local evidence: `.local/pilot-launch-implementation/`. The current tree's unfinished
game-store import failure must remain reported. No launch-ready or completion claim
until the candidate and required hosted/device evidence are actually verified.
