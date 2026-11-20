# Dial spin and navigation label fixes — November 19, 2026

The user confirmed that the outside minus/plus buttons work and resize with
the dial. They then reported screen scrolling when spinning from the dial's
side artwork and Rad flashing Radiation during Life/damage changes. They
clarified that top/bottom starts with horizontal movement work and that the
problem occurs when vertical screen scrolling takes priority. The touch
starts on the circular artwork, not in the outside button regions.

## Diagnosed causes and scoped fixes

Native Chromium touch probes reproduced two gesture problems. The visible
5px outer shadow fell outside the rotary input circle, leaving a gap before
the side buttons' 6px exclusion boundary. A touch there hit the scrollable
counter stage. Separately, starting a spin while partly scrolled added
`body.dial-dragging { overflow: hidden }`, clipping the overflow and clamping
scrollY85/47 to0 before the finger moved.

A transparent circular `::before` extends the existing gesture's hit surface
by6px without changing its rectangle, artwork, centre, optical readout or
symbol positions. Removing the drag-time overflow property preserves the
page's scroll position. The gesture retains `touch-action: none`, pointer
capture and the existing20-degree step behavior. Outside buttons retain their
vertical scrolling and cancelled-swipe behavior. No rotary JavaScript or side
button geometry/gesture binding changed.

The navigation issue predates the outside-button changes: the first shared
state listener renders Rad, then a later appearance listener restores the
captured initial HTML containing Radiation. The skin-reset callback now
normalizes each restored label through the existing `counterModeLabel` helper
in the same synchronous callback. Button still shows Radiation; startup with
no active game and skin-removal paths are covered.

## Verification and release boundary

- Full client suite: **744/744**, no skips or cancellations.
- Navigation regression:4/4, related14/14; removing normalization restores
  three failing cases. Eight Chromium/Windows WebKit runtime scenarios now
  show zero painted full-label flashes and zero page errors, including default,
  slow catalog, published and delayed failed-skin paths. Button keeps its full
  label. Baseline default WebKit sometimes collapsed the stale write before
  paint; delayed paths exposed painted frames. Raw before evidence is retained.
- Gesture source regression and native before/after evidence are in the
  evidence directory. The source contract is not treated as native touch proof.
- Native short-screen regression checks pass16/16: side artwork/rim starts
  rotate without page movement while outside-button swipes still scroll and
  do not step a counter. Adjacent-control hit testing across56states/792points
  matches the same page with the new hit halo disabled;4/4 outside-menu
  dismissals leave counters unchanged. Pre-existing beveled/cut button corners
  hit their parent containers equally in both comparisons and are not new
  interceptions. Additional bidirectional checks are recorded separately.
- Extended native Chromium matrix:56actual dial/rim rotations pass (left/right
  vertical and top/bottom horizontal, at top and partly scrolled),16outside
  swipes still scroll without counter changes, and2VIEW ONLY cases are inert.
  Eight bottom-shadow probes land on the neighbouring turn control, which
  correctly retains priority and leaves counters/scroll unchanged. The first
  broad spin expectation flagged these as misses; raw results are retained
  and the protected-control classification is explicit rather than claiming
  82rotations. No product change was made for this harness qualification.
- Existing server source, dependencies, connection policies, counters,
  lifecycle and account logic are unchanged. The earlier760/760 server run
  remains the owning server evidence; it was not repeated for this UI-only fix.
- Physical iPhone confirmation remains pending after staging reload.

Evidence:
`C:/Users/nibay/.codex/visualizations/2026/11/19/01a1f5e2-6ffe-7d53-b27b-35a12dd92ee6/dial-spin-rad-flash`.

Pins: App331 / styles252 / dial CSS8 / dial JS6 / side zones2 / cache398.
Only the existing feature/staging branches are authorized. Production/main
remains outside scope. Rollback is a scoped normal revert of this release
followed by served-asset, health and read-only table verification.

## Modern Web Guidance

I searched custom touch/scroll gesture guidance; no guide directly specified
a rotary dial. I kept the existing responsive/accessibility contract and
checked the [Pointer Events touch-action rules](https://www.w3.org/TR/pointerevents/latest/#the-touch-action-css-property):
the browser decides native panning from the initial hit surface, so the rim
must belong to the existing non-panning rotary surface before the gesture
starts. Changing a scroll policy after native panning begins cannot take the
gesture back.
