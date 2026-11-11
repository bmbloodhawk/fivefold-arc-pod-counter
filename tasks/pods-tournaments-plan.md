# Pods and Tournaments implementation plan

Contract: [approved specification](../docs/PODS_AND_TOURNAMENTS_SPEC.md).
This plan intentionally preserves the unrelated existing plan and todo files.

## Ordered slices

- [x] Fresh worktree from fetched origin/main; consolidate approved rules.
- [x] Pure placement/tie/point logic and versioned multiplayer rating replay.
  - RED/GREEN: sizes 2–8, invalid orders, ties, guest exclusion, 1000/provisional,
    higher-opponent results, replay, zero-sum/bounded changes and exact event points.
- [ ] Competition persistence and identity/permission contracts.
  - Separate environment namespace/queue, actual optimistic concurrency, no hot-path I/O.
  - Fresh-context review of source capture, idempotency/outbox and erasure boundaries.
- [ ] Pod create/list/invite/join/leave/remove/admin/readmission/takeover vertical slice.
  - Authenticated API with tenant-safe DTOs, private invite preview and matching UI.
- [ ] Table setup ownership binding and durable completed-game capture.
  - Read actual starter proofs; survive three-game-cache eviction and restart.
  - Source/competition order provenance, complete/tied review and duplicate handling.
- [ ] Pod publication, chronological replay/corrections, dated history and erasure.
  - Immutable revisions, visible reason, minimal data, no private profile-award writes.
- [ ] Tournament registrations/guest identity/co-host/settings and round lifecycle.
  - Fixed round count, 2–8 table sizes, manual starts, late/early statuses.
- [ ] Suggested seating and cumulative event points.
  - Seeded random first round; both lexicographic priorities, repeat preference,
    host edits, complete rosters, exact rational points and shared final ranks.
- [ ] Optional round clock, explicit five-turn phase and verified timed-draw completion.
  - Timed endpoint/postgame integration only; no life/SSE transport changes.
- [ ] Phone-first hub navigation, contextual Table returns and invitation deep links.
  - Home actions; clean Pod ranks; dates/games/detail drill-down; guest event entry.
- [ ] All required unit/integration/restart/privacy/no-hot-path tests and full suite.
- [ ] Two independent phone-sized browser contexts, layout/accessibility/runtime checks.
- [ ] Fresh-context final review; local commits; release/rollback/physical-test handoff.

## Checkpoints

Each behavior is tested as a thin slice and checkpointed locally. No remote push.
Do not use live Firebase credentials in tests. Fixture authentication/local storage
must be explicit and confined to disposable loopback servers/emulators.

Record concrete evidence in `docs/pods-tournaments-evidence.md`, including failures,
unverified physical/live gates and any measured performance limits. A passing narrow
test is not proof of the whole feature. No skipped assertions or placeholder success.
