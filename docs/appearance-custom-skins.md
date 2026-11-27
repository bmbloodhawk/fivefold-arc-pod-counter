# Custom skins in the desktop Appearance Studio

Open the [local design review](http://127.0.0.1:8793/review) on the computer running the review server. The initial library has three original example drafts alongside the native reference and the earlier catalog samples. **Browse design starters** makes a separate editable design. The thumbnail on each card shows its actual rendered dial.

To reopen it after restarting Windows, run [the local review launcher](../qa/start-appearance-design-review.cmd). Saved records and artwork live under the current Windows account in `%LOCALAPPDATA%\Fivefold Arc\Appearance Studio\custom-skins-review.json`.

## A first edit

1. Open **Rose Window** to see the original glass artwork on the dial, player cards and header. Use **Duplicate skin** if you want to keep this example as a reference.
2. Click **Pick a part**, then click a player card in the game. Change its fill or border under **Controls & cards**. The part list also works from the keyboard. **Copy surface style** and **Merge copied style** carry matching overrides onto another surface.
3. Open **Counter faces & icons**, choose Radiation, and change just its face, markings or artwork. New Neutral drafts start with the game's six original navigation icons. Each counter can keep its original icon or use an explicit replacement.
4. Use **Scene** to see another player's turn, an elimination or a game dialog. **Compare** shows the saved source. Each override can inherit again. **Reset section**, **Undo** and **Redo** also retain the source relationship.
5. Use **Validate** for contrast and asset findings. **Run preflight** measures real controls and text in 200 configurations. **Save draft** stores the edit in this local review. **Export catalog** downloads a portable backup with the original artwork. The protected application's developer catalog has its own explicit publication workflow.

## Dial centers

Neutral Arc’s six phone-reviewed engravings are the baseline for Life, Commander, Radiation, Poison, Energy and Generic. A skin using the built-in seal inherits the active counter’s engraving in its own palette. Under **Counter faces & icons**, **Center emblem** lets you use that counter’s engraving, keep a supplied seal, or hide it when your own artwork carries the design.

For two independent images, choose **Outer ring artwork** and **Center artwork**. **Outer ring only** crops an opening for the center. **Whole face behind center** keeps the entire rotating instrument visible behind a transparent, stationary center. Night Watch uses this for its star charts.

## What an author controls

| Visible part | Editable appearance |
| --- | --- |
| Playfield | Flat, linear or radial fill, gradient direction and center, background art shade, printed pattern and its color, size and opacity, frame and corner details. Optional slow edge lights have adjustable color, opacity and cycle. Reduced-motion mode renders them still. |
| Materials on 13 surfaces | Gameplay app header, player cards, readout, turn bar, turn actions, life controls, commander tools, counter navigation, game menu, ordinary gameplay dialogs, form fields, lobby/intermission and results. Each exposes the applicable fill, text roles, border color/style/width, four corner radii, texture and shadow. |
| Type | Global and per-role family, weight, case, tracking, line height, slant and shadow. Supported roles also have size controls. The main counter number keeps the native optical fitter and its existing bounded number scale. Seven font choices include locally bundled Cinzel, Roboto Condensed and Literata. |
| Each of six counters | Independent accent, number ink, backing color, light/dark caption plate, face construction, edge markings, center seal and navigation icon. Vetted dial art has independent scale and opacity. The live number, counter name, and accessible navigation label still come from the game. |
| Table composition | Separate Button and Dial layouts. Bounded component offsets, scale, gutters, row spacing and playfield width. Name/number order, player text alignment, active-turn and owner markers, selected navigation, adjustment edges and feedback frames. Active and owned seats follow the real table state. |
| Game moments | Separate tints and edge rules for your turn, someone else's turn, lobby, warning, elimination, completed game and offline table. The game decides which moment is active. |
| Artwork | Backgrounds, symbols, buttons, dial faces, seals, thumbnails and legacy overlays, plus seven targeted artwork slots for the turn bar, navigation, player card, counter panel, table title, counter dialogs and result heading. Crop, fit, scale, position and opacity keep art behind the real content. |
| Drafts and comparison | Separate native reference, safe fork from an approved or older skin, original comparison, duplicate, rename, Undo/Redo, per-area reset, history restore, backup review and explicit save. Stored historical drafts retain their renderer generation. |

The embedded frame runs the same game HTML, styles, layout code, icons and renderer as normal play. Its players, totals and game moments are local fixtures. The handset frame and guides are optional overlays under **Preview settings**. They start hidden so the author can see the complete game viewport. The Studio works at narrow widths, while its primary authoring layout is the three-pane desktop browser.

## Sample designs

- **Field Notes** uses warm paper, ruled cards, an ink-colored counter, Literata and a light plate behind dial captions.
- **Night Circuit** uses a plotting grid, technical monospaced totals, a faceted dial and restrained moving edge lights.
- **Rose Window** uses plum glass, woven lines, engraved Cinzel type and illuminated rings. Its saved local example includes two optimized crops of one original generated illustration. The portable starter works in any catalog without depending on these local asset IDs.

The three local font files total 162,988 bytes. The installed game caches all three for offline use. They supply upright Latin variable weights 400–700. Other writing systems use the fallback stack. Choosing italic on these faces uses browser slant. Source attribution and original licenses are in [the font directory](../client/assets/fonts/SOURCES.md).

## Validation and compatibility

The same versioned allowlist validates saved drafts, imported backups and preview payloads. The renderer accepts application-owned CSS values and raster artwork in allowed roles. Loading an older authored skin preserves its existing icon policy. Starting from Neutral uses the game originals, including the exact Radiation SVG.

The geometry check covers both control layouts, all six counters and two to eight seats on 320 × 700 and 393 × 852 viewports. Additional checks cover dialogs, long names and four-digit totals, offline and end states, plus three larger sizes. Failures identify the screen and affected target. Changed geometry invalidates an earlier result. A 42-pixel native menu close action and 30-pixel native seat-reorder controls retain their existing bounds. The two curved dial side areas have intentionally overlapping bounding rectangles.

Controls protect game values, player choices, host authority, source identities, account and purchase flows, earned artwork, disabled states and gameplay commands. Approval for artwork and permission to distribute an owned or earned design remain separate checks. Imported copies of unrecognized approved records return as drafts. Newly imported artwork returns for review. A raster image can contain very bright or dark details, so art layered under text still needs visual judgment.

These checks use local Chromium and WebKit, emulated phone-sized viewports, and disposable local game sessions. Physical iPhone touch, readability from across a table, live service storage and production deployment require their own verification.

## Local verification

| Check | Result |
| --- | --- |
| Project tests | All 806 server and 897 client tests passed. |
| Native table plus three example skins | All four passed 200 fixture screens each in Chromium and WebKit, for 1,600 screen checks. Deliberately shrinking End Turn to 85% blocked local publication on 92 screens in each engine. The draft survived. |
| Original artwork and rights | Two local clients exercised host sharing, personal overrides and earned access. Newly authored free skins cannot publish artwork reserved for an earned pack. |
| Existing catalog | The local historical catalog's two skins and eleven inline images stayed byte-for-byte intact through the compatibility check. |
| Existing renderer | All 144 prior/current navigation captures matched exactly, including Radiation. The cold and post-resize comparison found differences only in the automatically fitted number or caption on 38 of 144 measurements. The earlier build also changed its measurements between frames. A separate Windows WebKit Studio/game comparison found up to a quarter CSS pixel of difference in the Button-layout number position. Exact numeral and caption pixel parity remains unverified. |
| Desktop authoring | Both browser engines exercised mouse and keyboard picking, editing, material copy, saving, backup export and reopening. An axe-core scan of nine expanded editing panes, the starter chooser and the part picker returned zero automated violations in the selected WCAG A/AA rules. |
| Storage and offline | Nine local-store checks covered crash recovery, writer conflicts, corrupt-file refusal and durable artwork. After installing the game shell, a disconnected Chromium session reopened the game and loaded all three bundled fonts and their local notices. |

## Repeat the checks

Run `npm test` at the worktree root. Browser scripts use a local Playwright installation. Set `PLAYWRIGHT_TOOLING` to its package.json, `CHROME_PATH` to a Chromium executable if required, and `STUDIO_REPORT_DIR` to an evidence directory.

For automated browser checks, launch `qa/appearance-studio-local.mjs` on a spare port. With `STUDIO_DESIGN_REVIEW=1` and `STUDIO_DESIGN_REVIEW_ART=1`, the disposable process includes all three examples and the local artwork. Give each test that saves a new in-memory fixture. The review at port 8793 is for the author.

The custom design, counter design, surface materials, artwork, font, baseline parity, preflight, lifecycle, responsive, exact renderer and two-client sharing scripts are under [qa](../qa). They cover real rendering, sample designs, irreversible boundaries on a disposable catalog, comparison with the previous release candidate, and recovery after interrupted saves.
