# Table title and saved-commander identity

The physical iPhone Safari walkthrough reached a two-player staging Commander game. The user reported Krenko showing White/Black and the table title containing the commander name/colors off center. The user subsequently updated their commander; the live table changed from Krenko/WB at version3 to Krenko/R at version4. No agent repaired that table data.

This follow-up addresses the explicit title request and a separately reproduced color-transfer defect. Base: `183f3bdcb623f9edbefddf9dfab42c760b1739bc`. Pins: App325 / styles251 / dial CSS3 / cache391. Staging only; production main remains `52017e8a2f4419915d5544663c58f269e241f1ed`.

## Behavior and scope

- The game header shows only the table label/code. The commander name and header identity strip are removed from markup, DOM bindings and render updates. Player identity tiles and counter colors remain.
- Dial mode uses symmetric 44px side tracks around a flexible title track. The menu remains44x44 on the right; decorative marks stay inside the title track. The title centers independently of the menu and commander-name length. Button mode retains its existing centered layout with the simpler header content.
- Saved-deck selection in Create/Join now uses the supplied commander colors, including an explicitly empty identity, ahead of previous field colors. Previous colors survive a count rerender or same-name update only when the final commander name is unchanged. A different name without supplied colors stays unresolved for the existing lookup path.

## Confirmed diagnosis

The live card lookup returned Krenko/R while the original table snapshot stored WB. Rendering correctly reflected that stored value. The original phone sequence that introduced WB is not proven.

An isolated real-browser reproduction separately confirmed the client defect: select saved Tymna/WB, then saved Krenko/R. The prior renderer prioritized the previous field colors and produced Krenko with Confirmed:WB; actual Create and Join request bodies contained WB. The fix prevents that reproduced transfer. A local server isolation check kept P1/R unchanged when P2 joined with WB/UG; inputs and snapshots are copied, and no shared-seat recoloring was found on that tested server path.

The header's Dial override used a space-between flex row, placing the title at the left. Baseline Chrome measurements at390/320/844 widths showed title offsets of about−117/−82/−282px from viewport center. Removing only the commander name would not fix that layout rule.

## Verification

Seven new actual-source identity regressions initially produced5failures/2passes. All seven now pass. Full client suite714/714 and card-index4/4 pass, with no failures/skips/cancellations. The one existing dial CSS pin assertion was updated from2to3. No header regex-only tests were added; browser measurements and screenshots cover the visible request. Syntax and diff checks pass.

Independent review has no actionable findings. Restoring the old color-priority expression in memory fails five of seven regressions. No backend/dependency change, existing-record repair, original-workspace cleanup or production deployment is included. Unchanged slow backend suites were not rerun; no build/lint/typecheck command exists for this static client.

Actual Chrome/WebKit verification passes157unique checks (164executions include7repeated valid menu checks),with zero page errors. Create and Join both submit Krenko/R after switching from saved Tymna/WB; a two-commander Join also preserves separate U/UR identities. Dial titles center within1px at390x844,320x700 and844x390 with one/two long commander names. Button mode390/320 remains centered. Menus open/close,44pxmenu targets and ornaments fit, and40life/read-only controls remain correct. Before/after screenshots were inspected with no header overlap or horizontal overflow observed.

Evidence folders under the existing external evidence root: `identity-transfer-20261119`, `game-header-20261119`, and the live companion observations in `phone-multiplayer-20261119`. Final browser/release results live there. Physical title retesting remains pending.

## Modern Web Guidance

I used explicit grid tracks for the centered title and menu, with `minmax(0, 1fr)` for the flexible center (`css-layout`: "Use `fr` for proportional track distribution and `minmax(min, max)` for flexible-but-bounded tracks"). This keeps the title centered without absolute text positioning or overflow clipping.

## Staging release and rollback

The user's existing authorization covers routine confirmed fixes and staging deployment. Verify13served staging assets, adding the changed dial stylesheet to the previous12-file check. Compare production's original four assets/main with the unchanged baseline. Rollback is a scoped revert of these two commits on staging, retaining records.

The original Browser Test companion must remain connected between physical checkpoints. A staging deployment may briefly reconnect it; verify the current table and both40life totals afterward. Do not start another game, change counters/turn/setup, delete records or silently repair identity data. After release, the next physical checkpoint is refreshing Safari and confirming a centered table-only title; the first40→39 life-sync test remains unperformed.
