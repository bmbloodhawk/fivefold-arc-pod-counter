# Vertical scrolling in the game menu

The user reported left/right movement in the phone's three-dot game menu and asked to disable it. The existing menu specified `overflow-y:auto`, so its computed horizontal overflow was also `auto`. Touch gestures were already limited to `pan-y`.

The scoped change explicitly uses `overflow-x:hidden` and `overscroll-behavior-x:none` on `.game-menu`. Vertical scrolling and its existing touch behavior remain. No menu content, sizing, actions, caption geometry or game authority is changed. Pins: styles252 / cache394; App327 / dial CSS5 / dial JS4 remain from the caption-stability release.

Baseline actual Chrome/WebKit host and guest menus at320/390 had no horizontal scroll range or overflowing visible controls. A long local appearance option did not reproduce intrinsic-width overflow either. The physical Safari movement is therefore not reproduced in emulation; only the implicit horizontal policy is confirmed. The change addresses that policy directly. Physical phone confirmation remains required.

## Modern Web Guidance

I checked `overflow-clipping-control` and kept vertical scrolling instead of applying whole-container `overflow:clip`: "clip completely disables scrolling". The menu uses an explicit horizontal axis rule and retains `overflow-y:auto`; no clipping-margin feature is needed.

Client checks pass726/726. Bounded browser checks pass43/43 across eight host/guest Chrome/WebKit320/390 states: every control fits and is keyboard-reachable without horizontal movement, vertical scrolling reaches the bottom, and an outside touch closes the menu without adjusting life. Three WebKit navigation-only diagnostic network messages were recorded separately; no errors occurred during settled menu interactions. Existing Escape behavior is unchanged. This Windows WebKit runtime does not support the overscroll-X property; it validates `overflow-x:hidden`, vertical access and fitting, while physical Safari bounce still needs phone confirmation.

Browser evidence is under `menu-horizontal-20261119`; client and served checks are under `menu-scroll-20261119`. Staging only. Production is excluded. A scoped revert restores the prior horizontal policy without changing records.
