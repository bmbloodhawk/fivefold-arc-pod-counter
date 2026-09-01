# Fivefold Arc Layout Invariants

## Active-play geometry

The **Your Turn** screen is the fixed geometry anchor for active play. Changing
whose turn it is must not move the header, table summary, center emblem, mode
title, life total, seat identity, turn-action slot, life controls, custom-life
action, commander-tax action, or fixed navigation.

Turn state may only change an existing region's content, emphasis, enabled
state, or visibility. End Turn and Rescind/Undo occupy the same reserved
turn-action slot; neither may create a new layout position.

An exception requires explicit user approval and must be recorded in the code
comment beside the override and in the regression test that covers it.
