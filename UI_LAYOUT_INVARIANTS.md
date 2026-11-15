# Fivefold Arc Layout Invariants

## Active-play geometry

The **Your Turn** screen is the fixed geometry anchor for active play. Changing
whose turn it is must not move the header, table summary, center emblem, mode
title, life total, seat identity, turn-action slot, life controls, custom-life
action, commander-tax action, or counter navigation.

Turn state may only change an existing region's content, emphasis, enabled
state, or visibility. End Turn and Rescind/Undo occupy the same reserved
turn-action slot; neither may create a new layout position.

An exception requires explicit user approval and must be recorded in the code
comment beside the override and in the regression test that covers it.

## Shared Dial layout

The approved fluid Dial replaces its fixed navigation/action stack. Controls
stay in document flow; the remaining stage space sizes one shared assembly,
capped at 400px. Very short or zoomed views scroll with a readable minimum
rather than shrinking essential controls. Turn changes still retain the same
reserved End Turn/Undo slot and must not move the other regions.

The ring, seal and gesture surface share the assembly center. The visible
number is lifted by 2.2% of its diameter; mode and context labels sit 28% above
and 27% below center. All counter modes and the live Studio/Device Preview
renderer use `client/dial-layout.css` and `client/dial-layout.js`.

`qa/dial-layout.browser.mjs` checks real browser geometry and input. Optical
correction is also covered by `client/dial-layout.test.mjs`.
