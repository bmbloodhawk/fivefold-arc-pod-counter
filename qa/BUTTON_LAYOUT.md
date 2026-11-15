# Shared Button circle and readout

Button keeps its existing header, top/flanking cards, source controls, End Turn,
four adjustment buttons, custom-life action, commander tax and navigation.
The assembly retains the previous flow footprint; artwork and text use one
stage center. Artwork may extend behind other regions. Text uses the measured
clear gap between cards and the first action, capped to the artwork's size.

The shared anchors place the mode at 22%, visible numeral ink at 47.8%, and
context at 77% of the protected frame. Numeral size accounts for actual ink,
long values, authored scale/offset and label clearance. Warning/preview text
may use a wider band only when cards leave that band clear. Button artwork
stays static; Dial artwork keeps its input rotation. Existing authored skin
and Studio transforms compose with the shared geometry.

The outer Button layout still has its existing responsive thresholds and
scrolling behavior. The circle diameter follows rendered stage width up to
400px. Protected text follows actual available space, so its size can change
when an existing outer rule changes that space. This does not make the entire
Button layout free of responsive thresholds.

## Run

Use the project's existing dependencies and an external optional Playwright
installation, as described in [Dial QA](DIAL_LAYOUT.md). No packages are added
by the QA scripts. Set `PLAYWRIGHT_MODULE` if needed, and set
`BUTTON_BROWSER_EXECUTABLE` to the installed Chrome executable. Then run:

```powershell
node --test client/*.test.mjs
node qa/run-button-layout.mjs
node qa/run-dial-layout.mjs
```

`BUTTON_QA_OUTPUT` selects a local artifact directory. `BUTTON_QA_PLAYERS=8`
restricts the run to one table size. `BUTTON_QA_BASELINE` can point to the
captured before-matrix JSON to compare surrounding card/control rectangles.
Without it, the report explicitly records that no baseline comparison ran.

The Button runner owns a disposable 127.0.0.1 server and fresh browser profiles.
It checks all 2–8 players, eight sizes and six modes (336 cases), visible ink
anchors, text/card/action collisions, 44px adjustment targets and page errors.
It records initial fixed-navigation overlap separately and verifies the
counter view after the existing required scroll. It does not call that an
initial viewport-fit pass. Geometry tests block service workers to avoid
mixing cached source versions. No remote target or real account is used.

Additional local review evidence covers actual correction batching, touch and
keyboard input, custom life, inspection, End Turn/Undo, all three elimination
causes, long warnings, font/collection fixtures, first-open traces, resize
samples, authored transforms, delayed layout application, and Edge/Firefox/
WebKit runtime checks. Display-only negative/large values test geometry;
actual nonpositive life follows the elimination flow.

## Review boundaries

- Some existing short/wide Button views require scrolling to clear the fixed
  navigation. Their approved surrounding geometry is preserved.
- At 1920px with eight players, the existing viewport-based flank-card widths
  occupy the stage center. A readable centered result there requires a card-
  width or placement decision; matched before/after evidence is retained.
- The local server's existing `X-Frame-Options: DENY` blocks native Studio
  embedding. Studio wiring was tested with that header removed only in an
  owned local response fixture. No server/security source was changed.
- Browser-engine/viewport evidence does not certify physical phones or every
  possible user-authored skin placement. Phone review remains separate.

The bounded service-worker policy is preserved; local asset-version changes
keep its complete offline graph consistent. These local checks do not
authorize a push, deployment or production release.
