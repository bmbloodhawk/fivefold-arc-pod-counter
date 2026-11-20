# Compact commander-tax popup — phone layout

The phone user confirmed Krenko's initial cast count0/next tax+0, then requested less explanatory text and a two-commander popup that fits typical phone portrait screens. The local change was committed before the requested computer restart. Remaining checks were completed after resuming; production is outside this release's scope.

## Change

- Remove the decorative chess mark and general rules paragraph from this popup.
- Hide the claimed-seat/live-sync explanation for the user's real seat. Retain concise inspected-player `Read only` and local `SIMULATED` context.
- Show each full commander name once, with independent cast count and next tax on a compact metadata line.
- Put Cast from command zone and Undo cast beside each other with at least44px targets. Reduce only popup spacing; retain native dialog scrolling when content needs it.
- Keep ownership, connection/locked-state checks, zero-count Undo, source validation, escaping, transport and retries unchanged.

Pins: App333 / styles253 / cache400. Dial CSS8 / dial JS6 / side zones2 / touch guard1 are unchanged.

## Verification completed before restart

- Full client suite752/752 pass, no skips/cancellations. JavaScript syntax and git diff checks pass. Server source is unchanged; server suite was not rerun.
- Independent source review approved the four client files, including permission guards, escaped text, native scroll fallback and coherent asset pins.
- Root visually inspected the two candidate Chromium screenshots.
- Browser QA13/13 completed Chromium checks pass with zero page errors: independent A1/B2 casts and derived tax+2/+4, Undo back to0, other counters unchanged, zero-count Undo disabled, Done/Escape close and return focus, inspected-player read-only context with no cast controls.
- Two named commanders in local Chromium:390×664 has408.06px dialog height and no internal overflow (scroll/client406px);320×568 has416.31px dialog height and no internal overflow (scroll/client414px). All five controls meet44px in both axes.
- Frozen baseline required194px internal scrolling at390×664 and409px at320×568. This is local browser evidence, not a physical iPhone pass or proof for most phones.

Evidence directory: `C:/Users/nibay/.codex/visualizations/2026/11/20/01a1f7bd-07ac-75e2-b886-a2a265eb17f0/commander-tax-compact`.

## Verification after restart

- `combined-report.json` records41 passing browser checks,3 corrected test expectations preserved, and0 unresolved failures/page errors. Coverage includes single/unnamed/valid60-character names, counts up to999/tax1998, inspected read-only context, SIMULATED casts/undo, disconnected controls, completed-game UI exclusion, and short/landscape scrolling with reachable Done.
- Windows WebKit two-commander height408.06px at390×664 and416.19px at320×568, with no internal overflow and at least44px controls. Cast/Undo remain independent; ordinary counters stay unchanged. Root visually inspected WebKit320 and the long-name/high-count Chromium320 screenshots.
- WebKit pointer-open/Done returning focus to BODY also occurs on the frozen159740e baseline. Keyboard-open Done/Escape restores the opener. This is preserved native behavior, not a new focus regression.
- The local simulation check uses a staged saved-demo entry because the existing native demo entry is hidden by CSS; that entry's discoverability was not certified. An initial long-name fixture was rejected by existing60-character validation and corrected to valid input. Existing completion UI transitions to intermission and hides the tax entry; the original overstrict expectation was retained and qualified.
- All disposable local Chrome/WebKit contexts and servers are closed; `cleanup-after-resume.json` confirms port50993 has no listener. The same normal persistent Browser Test/P2 profile was restored to ES7KUY with no gameplay actions, counters and commander values preserved, and remains alive. See `companion-recovery-after-restart.json`.
- Independent release preflight confirmed source review, unchanged server/dependencies, and exact remote refs. `served-baseline.json` matches staging159740e15/15 and production52017e84/4; both health endpoints return200. PowerShell reads hit a browser-verification page, while ordinary Node fetch succeeds; no user-agent spoofing, challenge bypass or service configuration change was used.

The authorized release targets only the existing feature and staging branches. `verify-served.mjs` records the immutable release SHA and exact served hashes in `served-postrelease.json`; it must pass before release completion is claimed. Physical iPhone fit remains pending. Cache400 does not prove worker activation; do not force activation or clear storage. Production/main remains52017e8.

Rollback after any later staging release is a normal scoped revert of this commit, with exact served verification. No data migration, manual repair, guest seat replacement or gameplay action is part of this change.

## Modern Web Guidance

- `dialog`: preserve the native dialog and dismissal, and scope backdrop scroll containment to this popup; do not lock html/body (`Don't lock scrolling with overflow: hidden or position: fixed on html or body`).
- `css-layout`: use flexible grid action columns and wrapping names/metadata; preserve overflow scrolling rather than clip content (`Do NOT use overflow: hidden to mask layout issues`).
