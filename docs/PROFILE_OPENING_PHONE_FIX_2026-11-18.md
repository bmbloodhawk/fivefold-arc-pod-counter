# Stable profile opening — physical-test follow-up

PROFILE-OPEN-01 was reported during the guided iPhone Safari test, after sign-in and session restoration passed. The user saw several fast screens every time My profile opened. Preferred-name save testing was paused.

Base: staging143ff30f567e909d0d97e5c6c109b2280741c9a5. Target: staging only, App321/cache386. Production remains52017e8a2f4419915d5544663c58f269e241f1ed.

## Confirmed cause and change

The reused dialog opened before preparing its profile state. Old sign-in fields could remain visible during the history request. Settings/account actions then appeared while preferences were pending, before the final Overview hid them. Reopening from Settings exposed those controls again. Chrome and WebKit reproduced these awaited, visible states; this is separate from unproven physical keyboard/viewport effects.

Prepare a neutral My profile/loading/Close view before opening. Hide authentication and Settings controls throughout token/history/preferences loading, clear the old password and reveal the finished tabs together. Focus the profile heading once on entry, leaving native dialog dismissal and subsequent user focus intact.

Each profile request owns its account epoch, request attempt and open dialog. Check ownership after token, response and JSON waits and before handling failures. Close, Cancel and entering Sign in retire old profile work. A queued old Close event must not retire an already reopened dialog. Failed authenticated reads keep a clear profile error with Close; reopening retries normally.

The same flow exposed an existing selected-tab marker defect: toggling aria-current created an empty value, while the highlight expected page. Set the selected tab to aria-current=page and remove the marker from other tabs. No CSS/layout or radiation behavior changed.

## Verification

- 21 new actual-source profile tests cover loading frames, focus, normal tabs, stale account/overlapping reads, Close/Cancel, queued events, JSON boundaries and failure/fallback paths.
- Pre-fix source replay:17 expected failures,4 passing existing behaviors. Selected-tab regression separately failed before its one-line fix.
- Full client suite:631 passed, zero failures/skips. Focused profile/email suite:26 passed. No server code changed; the prior758-test server result belongs to the preceding release.
- Real local Chrome and WebKit checks passed45 assertions at390px and320px, using isolated fixture accounts and controlled history/preferences delays. They are engine checks, not a physical-device retest. Screenshots and release verification are recorded under profile-opening-20261118 in the external evidence folder.
- Physical iPhone verification remains pending until the user refreshes staging and repeats opening/closing the profile.

## Modern Web Guidance

- dialog: I kept native showModal and native dismissal rather than adding a focus trap or custom focus restoration: “DO use dialog.showModal() when opening from script” and “DON'T write code to return focus on close.”
- accessibility: I focus the existing profile heading outside the tab order once, without moving focus when data finishes: “Manage focus correctly to and from updated content.” The static-heading pattern is supported by the W3C dialog guidance.

Staging rollback base:143ff30f567e909d0d97e5c6c109b2280741c9a5. Preserve records and unrelated original-workspace changes.
