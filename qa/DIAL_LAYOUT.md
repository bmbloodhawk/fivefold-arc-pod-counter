# Shared Dial layout

The local replacement follows Google's Modern Web Guidance `fluid-scaling`
and `size-aware-styling` guides (CLI 1.0.0). It replaces the Dial-specific
fixed stacks and size/turn overrides with one component. Button presentation
keeps its existing layout.

- `client/dial-layout.css` owns available-space layout, proportions and touch targets.
- `client/dial-layout.js` aligns visible numeral ink after renders, resizes and font changes.
- `client/index.html` provides one assembly with a contained decorative face.
- Studio and Device Preview render the same game document and component.

The stage gets space left after visible controls. Its circle fits both axes,
caps at 400px and retains an 8rem readable minimum. A short/crowded or enlarged
text view scrolls. It never uniformly shrinks the text and 44px tap targets.
The ring, seal and gesture share a center. Visible numerals have a 2.2% upward
optical lift. Labels and feedback retain proportional offsets. Studio number
size changes the font size rather than scaling its centering translation;
explicit number/seal offsets remain intentional offsets.

## QA inventory

| Requirement | Check |
| --- | --- |
| All counter screens | Life, Commander, radiation, poison, energy, generic |
| Table sizes | Real loopback Commander tables with 2, 3, 4, 5, 6, 7 and 8 claimed seats; extra Casual/Custom checks |
| Available space | 320×568, 360×640, 390×844, 430×932, 768×1024, 1280×900, 740×360 |
| Shared center | Painted face, rotating seal, slider, visible number ink, labels |
| Numeric widths | Display stress: −5, 0, 9, 40, 999, 1234; no game-rule changes |
| Input | Touch plus, mouse minus, keyboard slider, clockwise drag |
| Context | Read-only inspected seat; one/partner source choices; End Turn/Undo geometry |
| Delayed feedback | Near-lethal warning after the four-second life confirmation fades; long text; elimination outcome |
| Appearance | Six collection treatments/font switching; Studio scale and explicit offsets |
| Accessibility sizing | 200% root text; readable scrolling fallback; no horizontal overflow |
| Continuous sizing | One-pixel samples around former width/height thresholds, including named-commander display stress |
| Scope | No changes to authority, counter rules, networking or persistence |

The repeatable browser script covers 294 basic size/mode combinations, 108
numeric display cases, 36 collection/font cases, actual input, and the settled
warning and elimination regressions. Additional local evidence includes turn/inspection checks,
Studio scale/offset checks, enlarged text, former-threshold samples and pixel
analysis of captured digits. A 390×844 Button screenshot and region geometry
were also compared with the untouched baseline. Another 30 cases cover two-player
Casual/Custom games across five modes and three sizes. At 320×568, crowded Commander views may scroll;
740×360 uses scrolling in every tested mode.

## Run

Normal repository tests:

```powershell
npm test
```

Browser checks use an optional Playwright installation outside the app. Set
`PLAYWRIGHT_MODULE` to that installation's `node_modules/playwright` directory
(omit if Playwright is already resolvable), and `DIAL_BROWSER_EXECUTABLE` to an
installed Chrome executable. `DIAL_QA_OUTPUT` optionally selects a local report
directory. Then run:

```powershell
node qa/run-dial-layout.mjs
```

The script owns a disposable server bound to `127.0.0.1` and fresh browser
contexts. It has no remote target, credentials, durable recovery or real account
dependency. It does not install packages, push or deploy. Service workers are
blocked during geometry tests to avoid mixing cached source versions.

These checks are local Chrome evidence. They do not prove physical phone,
mobile-browser suspension, screen-reader or production behavior. Collection
treatment checks use a synthetic valid palette; they do not certify every
user-authored skin/placement or its artwork.
