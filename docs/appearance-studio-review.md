# Appearance Studio desktop review

The [custom skin authoring guide](appearance-custom-skins.md) covers the later desktop pass, its example designs and the local design review.

## Open the local review

From this worktree run `node qa/appearance-studio-local.mjs 8792` and open [the desktop Studio](http://127.0.0.1:8792/review). The fixture holds two sample skins in memory. Restarting the process restores the samples. The application's usual entry remains **Developer tools → Appearance Studio**.

1. Select **Ember archive**, the approved sample. Choose **Use expanded controls** to try the new visual treatments as a draft. Under **Colors & mood**, enter a six-digit accent and compare it with the saved source.
2. Choose **Save draft**. The library now has an editable copy alongside the approved source. **Skin name & presets** contains the name, source policy, and starting palettes.
3. Choose a **Device** and **Scene** above the game surface. **Preview settings** contains pod size, counter mode, orientation, multi-device display, and the external preview.
4. Open **Review & publish**. Color and asset findings include a correction. **Run preflight** measures the renderer. **Publish skin** requires a saved draft, eligible source, and explicit confirmation. In this fixture all changes stay on this computer.

Existing approved skins and unversioned drafts use their released renderer. Renaming or duplicating an old skin preserves that version. Opting into expanded controls creates an editable visual revision that can be compared with its original before saving.

The built-in **Neutral Arc** entry shows the native game. **Start editable neutral draft** opens the Neutral Studio palette. An editable skin can use its own card sizes, typography and surfaces. Compare with Neutral Arc to see the default game.

## Changes and evidence

| Area | Previously | Current behavior and local evidence |
| --- | --- | --- |
| Desktop authoring | A long form competed with the game frame for space. | The skin library, section editor and actual game preview have separate panes. At narrow widths the section picker and Editor/Preview shortcuts keep the same functions reachable. Keyboard tests cover every editing area. |
| Saved skins | Saving an approved record could alter its public appearance. One catalog used `neutral` for an existing skin. | The native reference has its own reserved identity. Saving an approved design forks a draft. Undo, Redo, scoped reset, recovered edits, comparison and historical versions are tested. A stale tab can preserve its work as a separate draft. |
| Public catalog | A whole-catalog write mixed drafts, approvals and global settings. | Draft save, restore, asset approval and publication have distinct server paths. The server checks schema, revision, approved data and source policy. Conditional Firebase writes have adapter coverage. The active player and table appearance selectors remain in the game. |
| Renderer | Studio and normal play applied visual fields independently. | The app and isolated Studio frame share the cosmetic renderer. Its versioned styles retain the original presentation of existing skins. New drafts can use the expanded controls. Phone and desktop presets set the actual iframe dimensions. The external view uses a scoped temporary preview session. The loopback review link opens on this computer. |
| Artwork | Imported files gave little indication of use or publication state. | Assets have a stable ID, role, verified raster metadata, usage, approval and fallback. SVG uploads rasterize in the browser. Reference checks include saved versions. Existing inline assets and separate blob storage are both supported. |
| Accessibility | Some checks inferred layout from labels or reported success without measuring. | Review shows blocking issues, warnings and optional polish separately. Actual token pairs include frosted buttons, small labels and selected navigation. The browser measures 94 renderer scenarios. Changed geometry must pass current measurements before Studio publication. |

Portable backups include image bytes. The 8 MiB request limit applies to compact catalog metadata. Artwork has a separate per-file limit. The dry run lists how many imported skins will become drafts and how many artwork files will be pending. Existing approved records and pixels are protected. Restore requires confirmation. A Chromium round trip restored a backup larger than 9 MB through nine separate image uploads. The next export contained all nine original image payloads, and every image decoded successfully.

A read-only compatibility check used the older local catalog with two saved skins and eleven embedded images. A metadata-only draft save ran in memory. Both original skin records and every image record compared equal afterward. The source file hash also matched its initial value.

The release comparison used native Neutral Arc, the legacy Ember sample, and a legacy fixture with custom icon art, two overlays and per-mode placement. Measured geometry and computed styles matched the previous release. Legacy skins retain their original placement when switching counter modes mid-game. Expanded skins apply the placement for the newly selected mode.

Two independent browser clients joined the same local room. A guest kept their personal skin while the host changed the table appearance. Choosing to follow the table restored the host's skin. The server rejected a draft as a host offer and enforced seat ownership during a life change.

## Implementation map

- `client/appearance-workspace.js`, `appearance-workspace.css`, and `appearance-studio.html` own the desktop layout, section navigation and keyboard access. `appearance-studio.js` connects the controls to the draft and live preview.
- `client/appearance-studio-drafts.js` owns draft transitions, comparison, source-aware section reset and policy display. `appearance-studio-backups.js` checks portable restore limits and protects approval states. `appearance-studio-assets.js` displays asset records and usage.
- `client/appearance-validation.js` and `appearance-readability.js` validate named data at the input boundary. `renderer-bridge.js` and `renderer-theme.css` map those fields to the real game surface. Native Neutral skips custom styles.
- `server/src/appearance-studio-boundary.js`, `appearance-catalog.js` and the protected routes in `app.js` handle persistence, asset validation, access and explicit publication.

## Local verification on November 23, 2026

The complete project suite passed 800 server tests and 850 client tests, with zero failures or skips. The browser lifecycle check passed 19 flows, including restoring a saved version across renderer generations and recovering from a stale save. Seven artwork and desktop layout checks passed independently in Chromium and desktop WebKit. Both engines also covered all nine sections at five window sizes, including narrow-phone and 200%-equivalent reflow.

## Repeat the checks

Run `npm test` from the worktree root for the complete server and client suites. Browser checks use a disposable loopback fixture and Playwright. Set `PLAYWRIGHT_TOOLING` to a package.json whose installation includes `playwright-core`. `CHROME_PATH` selects a local Chromium executable. `STUDIO_REPORT_DIR` directs evidence to a folder outside the repository. Each workflow that changes sample data should start with a fresh fixture process.

- `qa/appearance-studio-lifecycle.mjs` exercises save, recovery, stale writes, backups and publication.
- `qa/appearance-studio-artwork.mjs` covers precise palette entry, desktop fit, interrupted import retry, pending/approved art, renderer effects and saved usage. Set `STUDIO_BROWSER=webkit` for the desktop WebKit run.
- `qa/appearance-studio-responsive.mjs` covers keyboard navigation and narrow-window reflow.
- `qa/appearance-studio-renderer.mjs` checks fixture states and dimensions, fallback, preflight and isolation.
- `qa/appearance-baseline-compare.mjs` compares normal game controls on two separately served loopback builds.
- `qa/appearance-sharing.browser.mjs` uses two independent Chromium clients and the local room server to verify host offers, personal overrides, availability and ownership.

## Verification limits

The 94-screen Chromium preflight passed for the reference fixture. Moving a control outside safe bounds failed 45 screens and blocked the publication request. Editing or resetting invalidates prior measurements. The Studio performs browser geometry checks. The protected publish endpoint independently checks the saved record, token limits, artwork and access policy.

A Chromium axe-core scan of all nine editing sections reported no violations under the selected WCAG A/AA rules. Keyboard and reflow checks also ran in desktop WebKit. Screen-reader announcements with assistive technology still require manual verification.

Browser measurements establish CSS viewport geometry and renderer behavior on this computer. Physical touch placement, readability across a table, real iPhone Safari, live multiplayer and deployed storage still need their own checks. An abandoned upload or failed cleanup can leave an unreferenced private image blob. Retrying the same interrupted import reuses its ID. Removal commits the catalog update first so no visible record points to a deleted image.
