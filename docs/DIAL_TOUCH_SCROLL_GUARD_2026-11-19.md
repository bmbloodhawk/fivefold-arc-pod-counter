# Rotary touch scroll guard — November 19, 2026

The physical iPhone retest still scrolled after `91aa5d3`. Its Chromium
rotation/rim checks did not establish the remaining Safari behavior. The user
also confirmed that Rad now stays stable during Life changes, accepting that
separate fix and strongly indicating the newer JavaScript loaded. The exact
phone build and CSS were not read directly.

The worker fetch path is network-first with offline fallback. A local online
upgrade loaded App331/CSS8; an older active worker is not evidence that online
HTML is pinned. A probe's assumption that a new worker must remain waiting was
not a product failure. No worker activation, storage clearing or phone/profile
change was performed.

## Narrow compatibility trial

`client/dial-touch-guard.js` registers non-passive touchstart/touchmove handlers
on the existing rotary element before input starts. It prevents cancelable
native touch defaults for one enabled original touch and its subsequent moves.
End/cancel, multiple fingers, a mismatched identifier or disabled controls
clear ownership. A move without an original rotary start is not adopted.

The guard never adjusts counters, synthesizes pointer input or changes the
existing rotation path. It adds no body lock, geometry change, browser sniffing
or outside-button listener. Outside scrolling, menu gestures, Button controls
and their existing permission checks remain separate. This is a
standards-supported compatibility trial, not a confirmed diagnosis of the
physical Safari cause or a claim that the iPhone issue is resolved.

The [Pointer Events specification](https://www.w3.org/TR/pointerevents/)
distinguishes pointer cancellation from native panning. [Touch Events
cancelability](https://w3c.github.io/touch-events/#cancelability) permits
canceling native scrolling through non-passive cancelable touch events. The
[Safari event guide](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html)
also describes element-scoped touch cancellation; it is archived documentation,
not proof of the current phone's root cause.

## Verification and release

- Full client suite752/752; focused guard8/8 plus existing29/29, syntax/diff
  checks pass. Tests use actual Event cancellation and cover registration,
  ownership, cleanup, disabled state and non-cancelable events.
- Independent in-memory review caught all eight deliberate guard mutations.
- Browser reports distinguish native Chromium gestures from synthetic WebKit
  TouchEvent cancellation. Physical iPhone confirmation is still required.
- Native Chromium core8cases preserve four inside/rim rotations, two outside
  swipe-scrolls without counter changes, menu use and keyboard input; no page
  errors. Existing life batching makes backend request counts unsuitable as
  a duplicate-input check; exact counter deltas and pointer streams are used.
- A two-context causal probe deliberately sets local rotary touch-action:auto.
  Without the guard, native panning cancels the pointer and scrolls47→93 without
  rotating; with the guard, touchstart/move are cancelled, scroll stays47 and
  the existing pointer path changes40→41 exactly once. This models the guard's
  mechanism when CSS is not preventing panning, not the phone's exact cause.
- Windows WebKit57/57 with no page errors includes a real trusted touchstart
  from Playwright tap, cancelled by the guard, plus outside taps across all
  six tabs. Movement/identifier/lifecycle cases use browser TouchEvent objects
  with synthetic touch lists and are explicitly not native iPhone swipes.
- No server source or dependency changes. The earlier760/760 server run was
  not repeated for this client-only guard.

Evidence:
`C:/Users/nibay/.codex/visualizations/2026/11/19/01a1f5e2-6ffe-7d53-b27b-35a12dd92ee6/dial-safari-scroll`.
Initial guard red/green logs are also retained under `dial-spin-rad-flash`.

Pins: App332 / styles252 / dial CSS8 / dial JS6 / side zones2 / touch guard1 /
cache399. The new module is included in the worker shell. Only staging and the
existing feature branch are authorized; production/main remains unchanged.
Rollback is a normal scoped revert with served-asset and health verification.

Modern Web Guidance searches covered touch scrolling and custom gestures;
none specified this rotary compatibility case. The primary Touch Events and
Pointer Events sources above guide the narrow cancellation policy. Existing
responsive and accessible controls remain the baseline; no framework,
polyfill or global touch listener was added.
