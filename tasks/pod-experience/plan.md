# Pod experience implementation

Source: ../../SPEC-pod-experience.md (approved November 17, 2026).

Keep existing rules, account adapters and visual language. Implement invitation/membership, Table navigation and records in small verified slices. Backend pending filtering is independent of client navigation and is delegated with its own tests. Browser regressions are authored independently before client changes. Public store/activity is a separate feasibility decision; no public presence data will be exposed.

Existing tasks/plan.md and tasks/todo.md describe other unfinished work and remain untouched. This work's checklist is todo.md alongside this file.

Dependencies: pending history predicate → pending UI; existing hub/adapter close handling → Create/Join/Return; current result protocol → saved summary/correction entry. No storage migration or dependency change.

Verification: targeted regressions, actual browser RED/GREEN, full npm test, local 64-room-protocol suite, phone-width screenshots/keyboard/failure paths, independent review, preservation hashes and concrete candidate handoff. Do not deploy or change production.
