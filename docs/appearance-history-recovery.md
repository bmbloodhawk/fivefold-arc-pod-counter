# Older Commander skin credit

`legacy-commander-v1` restores only the six achievement skins. Original saved
games, profile preferences, decks, invitation grants and ordinary award pacing
stay intact. Proofs come from retained server completion recaps and checkpoints;
commander names and client-provided counters cannot establish the game format.
Unverifiable and casual results receive no Commander credit.

Deploy the notice reader before applying the recovery. Use the existing private
server Firebase connection, never a public administrator endpoint. Keep all
account backups, evidence and reports outside the repository.

1. Export a private `account-history` backup and the retained diagnostic entries
   matching the saved source room/completion references. The evidence file is an
   array of `{gameId, recap, checkpoints}` records.
2. Dry-run the pilot with `node scripts/recover-appearance-history.mjs --account
   <account-id> --evidence <private-json> --audit-dir <private-directory>`.
3. Add `--apply` only after reviewing the plan. The operator backs up that
   account, uses its progression ETag transaction, and checks persisted awards,
   access, notice persistence, idempotence and preservation of existing results.
4. Use `--all --pilot <account-id> --pilot-verification <verified-report>` with
   the same evidence/audit options. Every remaining account receives its own
   backup and transaction; a failed run can resume without duplicate awards.

Recovered evidence is held separately from displayed game history, so totals do
not double. Future Commander saves include it. Removing an older saved game
removes its derived evidence and future credit while retaining earned rewards.
Accounts without enough games still receive their verified historical credit.

One notice lists all newly restored skins when the player opens their profile.
Closing it acknowledges its durable ID. Profile reads never consume it; failed
acknowledgements retry, and a session never repeats a notice it already showed.
Other achievement markers stay independent.

Rollback uses `AccountHistory.rollbackAppearanceRecovery(accountId,
'legacy-commander-v1')` through the same private connection. It removes only
that run's derived evidence, notice and tagged awards, preserving subsequent
ordinary games and awards. Rolling back code alone leaves the additive data safe.
