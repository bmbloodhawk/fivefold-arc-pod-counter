# Compact commander-tax popup — local restart checkpoint

The phone user confirmed Krenko's initial cast count0/next tax+0, then requested less explanatory text and a two-commander popup that fits typical phone portrait screens. This change is local only; no staging push or production release occurred before the requested computer restart.

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

The user requested a computer restart during remaining browser checks. Pending: WebKit; single/unnamed/long-name commanders; SIMULATED/offline/completed states; short/landscape layouts. Resume from `report.json`; do not claim these checks passed. All owned disposable QA browsers and local server are closed; `cleanup.json` confirms port50993 has no listener. The persistent staging companion was untouched. Staging remains159740e; production/main remains52017e8. Before release, finish pending local checks, verify the exact remote refs, use the already authorized staging scope and verify served assets/health. Ordinary HTTP reads returned403 browser-verification pages during this chat; this is not proof of an application failure. No challenge bypass or service configuration change was attempted.

Rollback after any later staging release is a normal scoped revert of this commit, with exact served verification. No data migration, manual repair, guest seat replacement or gameplay action is part of this change.

## Modern Web Guidance

- `dialog`: preserve the native dialog and dismissal, and scope backdrop scroll containment to this popup; do not lock html/body (`Don't lock scrolling with overflow: hidden or position: fixed on html or body`).
- `css-layout`: use flexible grid action columns and wrapping names/metadata; preserve overflow scrolling rather than clip content (`Do NOT use overflow: hidden to mask layout issues`).
