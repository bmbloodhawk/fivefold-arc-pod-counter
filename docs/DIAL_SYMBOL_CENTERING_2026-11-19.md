# Dial symbol centering — November 19, 2026

The user requested moving the outside minus/plus symbols onto the dial's
vertical centreline, halfway across each horizontal gap between the actual
dial border and the corresponding safe screen edge. This supersedes the upper
lobe symbol placement in the initial curved-area release `9663529`.

Only symbol presentation changes. Both curved tap paths, their bounds, the
gesture binding, dial sizing, all six Dial counter actions and the Button
interface remain unchanged. Wider upper lobes still provide the same touch
area even though the symbols have moved to mid-height.

Symbols are noninteractive, aria-hidden siblings of the native buttons. This
keeps glyphs outside the buttons' clip paths without expanding the clickable
region. Button accessible names, disabled state and keyboard activation remain.
The font is capped at the gap width on narrow layouts; centring uses the actual
dial border, not the 6px touch clearance. Position measurements update through
the existing layout observer. Scoped state selectors preserve active/focus
feedback despite the stronger base selector needed for published skins.

Validation: **739/739 client tests**, **28/28 focused checks**, syntax and diff
checks pass. Meaningful red/green tests cover both midpoint coordinates and
unclipped sibling positioning. Browser QA also caught native keyboard focus
opacity staying at0.48; equally scoped state selectors restore opacity1.
The unchanged server suite passed760/760 in the preceding release and was not
rerun for this presentation-only follow-up.

Evidence lives at
`C:/Users/nibay/.codex/visualizations/2026/11/19/01a1f5e2-6ffe-7d53-b27b-35a12dd92ee6/dial-symbol-centering`.
Its browser report records matched baseline geometry, exact symbol positions,
native taps/focus/VIEW ONLY, Button references and screenshots. Its targeted
run passed **1,377/1,377 checks across 64 states**, with zero uncaught page
errors in Chromium and Windows WebKit. Frozen `9663529` circle/readout/curved
tap bounds and paths match; all six Dial tabs, four viewport sizes, native
steps, glyph visibility, focus/active opacity, inspection guards, Button
references and in-place390→320→390 resizing passed. Independent review found
no required issues. Physical iPhone
appearance and comfort remain for the user to confirm after a normal reload.

Release pins: App330 / styles252 / dial CSS7 / dial JS6 / side zones2 /
cache397. The staging release is authorized; production remains outside scope.
Exact served-asset checks and fresh-page smoke evidence follow deployment.

## Modern Web Guidance

I used the existing form-factor and accessibility guidance to keep glyphs
within the available gap, preserve the native named buttons, and give the
decorative siblings `pointer-events: none`. Curved touch targets continue to
follow the measured dial, while the visual symbols use their requested centre
positions. No new platform dependency or device-specific layout branch was
introduced.
