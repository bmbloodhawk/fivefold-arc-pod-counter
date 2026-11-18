# Pod game credit and creation retry — staging follow-up

The user authorized fixing both confirmed Pod findings, beginning with returning-member game credit, testing the candidate, and publishing it to staging. Production remains unchanged. This follows the completed handoff integration and read-only Pod review at `8d5f3e7930925fb551bfc94dd4a97190d8e494de`.

## Changes

- `f44c210`: Table context requires both the participant ID and current seat ownership proof before reporting a member linked. A returning member who rejoins a freed seat as a guest is relinked by the existing account-restoration flow before the next game starts. A game already sealed as guest remains guest; earlier completion identities and ratings are preserved.
- `466dc51`: Optional Pod creation request IDs now reserve one account-scoped creation intent in the private legacy directory. The same canonical name/display name and retry ID return the current Pod, including after a lost storage response or process/domain restart. Different details with the same key return `409 POD_CREATE_RETRY_CONFLICT`. A new form/key still creates a separate Pod. Replay does not restore departed membership, alter renamed aliases/roles, reset history, or revive a deleted Pod or erased account.
- A nonfunctional HTML comment identifies this bundle during deployment verification. Runtime frontend imports and cache versions are unchanged.

Receipts contain opaque IDs, a canonical payload hash and creation time. They share the conditional directory write with initial alias/membership creation, remain private, and are removed with identity erasure. There is no migration, historical credit repair, duplicate-Pod cleanup or live-record rewrite in this release.

## Verification before staging

- Returning-credit regressions first failed on stale-proof reporting, then passed. The four new cases cover restored ownership, unchanged credentials, a different account with the same name, and the sealed-guest boundary. The related targeted run passed 35 tests.
- Creation retry regressions first reproduced duplicate creation and missing validation. All 16 final cases pass: canonical input, per-account isolation, new intents, conflicting reuse, key boundaries, independent conditional REST adapters, interruptions before/after directory reservation and scope commit, preserved played history/ownership/alias, departed membership, deleted Pod and erased account.
- Full app suites passed: **667 server and 408 client tests**, zero failed/skipped. Local room protocol: **64 passed**. Dependency audit: zero known vulnerabilities. Syntax and whitespace checks passed. Independent review found no blocking issue.
- Phone-sized Chrome used real app handlers and loopback conditional REST storage with a simulated identity-provider boundary. A returning Nico left a completed game, rejoined the freed seat as a guest on a fresh browser context, restored his account, played the next game, and received **2/10 rated games** after host confirmation. Earlier sealed history is covered by the domain regressions.
- Actual UI creation committed on the server while its first response was dropped. Retrying the form returned the same Pod and left one list entry; opening a new form deliberately created a second Pod. No unhandled JavaScript errors occurred.

## QR report and sign-in

Private Pod membership requires sign-in. Opening its invite preview does not. The rendered QR decoded exactly to the displayed invite; anonymous camera-style navigation reached the preview and **Sign in to join**. Local real-handler QR generation with the exact production and staging Host headers preserved **arc** in both domain names.

The user's original failed URL is unknown; the possible “are” spelling was recalled from memory. No hardcoded typo was found or reproduced, and this release makes no QR behavior change. Generated-domain checks are local fixtures, not evidence from that original QR or a physical phone camera. A read-only public check reached the invite entry page, but did not validate an actual private invite.

## Boundaries and rollout

The retry guarantee covers the deployed default legacy competition store. Native partitioned creation is an unreleased opt-in path and retains its prior behavior. Keyed native recovery or explicit key rejection is a release gate before enabling native creation for users. The existing legacy in-flight creation/account-erasure race across separate records is unchanged; the tests establish the closed-account retry fence, not a new cross-record transaction guarantee.

Staging only: `https://fivefold-arc-pod-counter-staging.onrender.com/`. Render's dashboard was under maintenance during preparation. Verify this release's unique served HTML marker/hash and health, then run the 64 deployed room protocol checks with fresh synthetic staging tables. These do not substitute for real provider sign-in, physical-phone/Safari checks, or a signed-in end-to-end Pod test on Render.

Rollback code target: `8d5f3e7930925fb551bfc94dd4a97190d8e494de`, after staging games are safely finished. Receipt fields are additive. Rolling back code does not authorize deleting records, reverting shared history, or changing production. Preserve the prior integration worktree, original workspace edits and dependency junctions.

Detailed logs, sanitized browser results, screenshots, deployment proof and preservation hashes are in this chat's `pod-fixes` evidence directory. Final deployment verification is recorded in the workspace handoff after the push.
