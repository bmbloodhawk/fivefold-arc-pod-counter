# Dial outside tap areas — November 19, 2026

## Approved behavior

The user requested a staging trial of transparent minus/plus tap areas outside
the Dial, following its curve from the dial's top to its bottom and extending
to the available screen edges. Minus/plus lettering is allowed; a visible
button background or border is not. The dial's current size and dynamic
sizing rules must remain unchanged. The user delegated the implementation
choice after proposing a layered alternative.

The user explicitly confirmed this applies whenever the Dial interface is in
use: Life, Commander, Radiation, Poison, Energy and Generic. The Button
interface is out of scope and must retain its existing controls and geometry.

The chosen approach derives the side regions from the dial's current rendered
bounds. The existing circle remains the rotation surface. Side tap regions
exclude the circle and its outer halo, keep the existing single-step counter
action, and retain native button names, disabled state and keyboard focus.

## Acceptance checks

- Compare dial, readout and caption geometry with frozen `aa62d13` baseline
  across phone widths, short screens, landscape, modes and player counts.
- Verify the side curves track in-place resizes, scrolling and mode/layout
  changes. The assembly sizing declaration must remain unchanged.
- Exercise actual browser hit testing on both sides of the curved boundary;
  the circle and adjacent controls must never become side tap areas.
- Each valid tap or keyboard activation makes one step. Movement, scrolling,
  cancellation, mismatched pointers and releases from a dial drag make none.
- Verify ordinary rotation, counter bounds, rapid taps, other-player VIEW ONLY,
  connection guards, and the Button interface.

## Release boundary and rollback

Only the existing feature branch and staging branch are authorized for this
release. No production/main update, service configuration change, dependency
change, seat replacement or manual table data repair is authorized or needed.
The existing persistent staging companion remains running; its original
Playwright pipe cannot be reattached from this chat's fresh kernel, so do not
claim a new guest-render observation or relaunch its owned profile.

Rollback is a normal revert of this scoped release on the feature/staging
branches followed by exact served-asset and health verification. Before this
release those branches both point to `aa62d13d8af43b096cea226f0733c41701fa2cad`.
Production/main baseline is `52017e8a2f4419915d5544663c58f269e241f1ed`.

## Evidence

Evidence directory:
`C:/Users/nibay/.codex/visualizations/2026/11/19/01a1f5e2-6ffe-7d53-b27b-35a12dd92ee6/curved-dial-zones`.

The new geometry and gesture module is `client/dial-side-zones.js`; layout
measurement remains in `client/dial-layout.js`, and all mutations still use the
existing `adjust` action. The assembly sizing CSS is unchanged. The zones
exclude a 6px halo around the circle, expose the existing minus/plus lettering
in their wider upper lobes, and follow ResizeObserver and visual-viewport
updates. Pointer capture plus an actual-position hit test prevents a release
outside the region from counting; movement over 8px, scroll and cancellation
disarm the tap. Pointer clicks are deduplicated from keyboard/AT activation.

Browser QA caught a real transient-resize regression before release: the old
visual-viewport width could extend a side region beyond the new layout width,
feeding overflow back into the viewport height and enlarging the dial. Side
bounds now clamp to the layout viewport. Meaningful red/green regressions also
cover mouse/pen release outside the region followed by a new valid tap.

- Full server suite: **760/760**, no skips or cancellations, 314.25 seconds.
- Full client suite after the final code changes: **737/737**, no skips or
  cancellations.
- Focused geometry, gesture, layout and integration checks: **26/26**.
- Independent review: no required findings; mutation checks caught deliberate
  geometry/gesture guard removals, including viewport clamping and capture.
- Runtime before/after matrix: **128 states** across Chromium and Windows
  WebKit, 2/6 players, 320/390px portrait, short screens and landscape. Dial,
  readout/captions and Button geometry match the frozen baseline within the
  browser comparison tolerance (0.5 CSS pixel). All six Dial modes have actual
  step interactions; hit maps verify the curved exclusion boundary.
- Corrected focused browser verification: **539/539**, plus **51/51** additional
  checks; zero uncaught errors. This includes native touch/mouse/keyboard steps,
  rapid taps, rotation, VIEW ONLY, real Chromium touch scrolling, offline/
  reconnect, and changed caption space/scroll following the resized circle.
- The first full browser run passed 6074 layout/hit/gesture assertions but its
  final zero-error gate found six exceptions from three synthetic pointer-ID
  probes per engine. Synthetic events do not register a native active pointer,
  so native `setPointerCapture` correctly throws. The original failed report is
  preserved. Only those synthetic guard probes stub capture in the corrected
  focused run; native pointer capture, scrolling and release recovery checks
  remain real. Windows WebKit is not physical iPhone Safari evidence.

Exact served-asset/health verification follows the staging push; see the
timestamped `served-postrelease.json` and `postrelease-smoke.json` when present.

Release pins: App329 / styles252 / dial CSS6 / dial JS5 / side zones1 /
cache396. The worker shell includes the new module and its static import graph;
no waiting-worker activation is forced during a game.

Physical iPhone acceptance remains pending until the user tests the staged
release. The earlier phone walkthrough is paused before the Energy check;
Poison1 and Life40 were physically confirmed and reached shared server state.

## Modern Web Guidance

- `form-factor-adaptation`: I placed the symbols in the wider outside lobes,
  kept transparent targets clear of the circle and other controls, and
  respected safe viewport bounds ("Leave enough space around controls so
  extended hit areas do not overlap each other or reach past the edge of the
  screen.").
- `responsive-design`: I derive the side shapes from the existing container's
  measured circle, preserving its sizing rules instead of adding device-size
  branches ("adapt to their parent container's size rather than the viewport").
- `accessibility`: I kept native button names and disabled states, added an
  explicit keyboard/AT activation route, and retained visible focus on the
  symbols ("Don't hide interactive elements from screen readers").

Primary references checked for this implementation: [CSS clipping and hit
testing](https://www.w3.org/TR/css-masking-1/#clipping-paths), [implicit pointer
capture](https://www.w3.org/TR/pointerevents3/#implicit-pointer-capture), and
[pointer cancellation](https://www.w3.org/TR/pointerevents3/#the-pointercancel-event).
