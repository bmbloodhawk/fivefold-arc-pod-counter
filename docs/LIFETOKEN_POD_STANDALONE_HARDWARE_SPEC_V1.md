# LifeToken Pod Standalone Hardware Spec V1

Status: concept specification  
Date: 2026-08-20  
Applies to: future standalone hardware, not the current phone-first build

## Purpose

Define a realistic first hardware direction for a dedicated LifeToken Pod device while the product remains in app validation.

This document assumes:

- the current product phase is still the connected app
- the long-term hardware goal is a personal device, one unit per player
- the desired final footprint is approximately a standard magnetic One-Touch card case
- the preferred display technology is monochrome e-paper

## Product Decision

LifeToken Pod is viable as a standalone product.

The clean path is:

1. Keep validating gameplay and table-state value in the app.
2. Design the standalone around monochrome e-paper and physical buttons.
3. Use a compact microcontroller architecture for the final hardware target.
4. Do not plan the final One-Touch-sized product around a Raspberry Pi stack.

## Size Targets

The user-specified aspirational footprint is approximately:

- width: `73 mm`
- height: `108 mm`

That size is realistic as a final hardware target, but tight for an early prototype once battery, enclosure walls, buttons, and charging hardware are included.

### Recommended Size Tiers

| Tier | Purpose | Target envelope | Notes |
| --- | --- | --- | --- |
| Tier 1 | Fast standalone prototype | `85-90 mm x 120-130 mm x 14-20 mm` | Easiest path for first physical proof |
| Tier 2 | Refined near-product prototype | `78-82 mm x 112-118 mm x 12-16 mm` | Better handheld feel, still practical |
| Tier 3 | Final aspirational target | `73 mm x 108 mm x 10-14 mm` | True One-Touch-class goal, likely custom PCB |

## Recommended Hardware Direction

### Display

Use a `3.7"` monochrome e-paper panel as the primary display direction.

Recommended class:

- `480 x 280` monochrome e-paper
- approximate panel outline: `54.9 mm x 93.3 mm`
- approximate visible display area: `47.32 mm x 81.12 mm`
- partial refresh around `0.3 s`
- full refresh around `3 s`

Why this class fits:

- it fits within the One-Touch-class envelope better than `4.2"` or `4.26"` panels
- it supports persistent always-visible state with very low standby draw
- it matches the product's glance-first use case better than a conventional LCD

Do not use color e-paper for V1 hardware direction. Refresh is too slow for a life-counter product that expects frequent updates.

### Controller

Use an `ESP32-S3`-class controller for the final hardware direction.

Recommended approach:

- bring-up and experimentation: off-the-shelf ESP32 e-paper driver board
- product-oriented prototype: compact ESP32-S3 module on a custom board

Why:

- smaller and more power-appropriate than a Raspberry Pi stack
- built-in wireless support
- better fit for a dedicated appliance with fast wake, simple UI, and long battery life

Do not treat Raspberry Pi Zero as the final architecture for the One-Touch-sized product. It may still be useful for early bench experimentation, but it is the wrong center of gravity for the long-term enclosure target.

### Connectivity

Connectivity should stay aligned with product phase:

- app and lab prototypes: Wi-Fi is acceptable
- hardware product intent: BLE should be treated as the primary live-sync target
- pairing fallback: manual create/join flow remains required

NFC stays optional and out of early hardware scope.

### Controls

Primary physical controls:

- `+1`
- `-1`
- `+5`
- `-5`
- `MODE`
- `TAX`

Secondary or protected controls:

- `RESET` as a recessed button or long-press combination
- `SETUP` as a side button or long-press combination

Rationale:

- frequent gameplay actions get dedicated direct controls
- destructive or low-frequency actions should be harder to trigger
- e-paper works best with deliberate state changes, not constant touch-heavy navigation

### Power

Recommended power direction:

- rechargeable LiPo battery
- USB-C charging
- target use: multiple Commander sessions per charge

The exact battery size should be chosen after enclosure and button stack-up are known. For the final One-Touch-class target, battery thickness is one of the main mechanical constraints.

## UI Rules For E-Paper Hardware

The standalone hardware should not try to replicate the full feel of a phone app.

It should optimize for:

- always-visible table state
- very fast life adjustments
- minimal mode switching
- persistent readability in bright indoor light

### Default Screen

The home screen remains Life Mode.

It should show:

- owner life large
- opponent life totals small
- skull markers for eliminated players
- warning state only when relevant

### Refresh Strategy

Use partial refresh for:

- life changes
- poison changes
- commander tax updates
- warning changes
- skull state changes

Use full refresh for:

- initial wake
- setup completion
- periodic cleanup to reduce ghosting
- mode changes when the layout changes substantially

### Input Model

Buttons should be the primary interaction model.

Touch input is optional. If touch is used at all, it should be limited to low-frequency actions such as setup or source selection. The main gameplay path should not depend on touch.

## Recommended Device Layout

Portrait orientation is preferred.

Suggested front-face structure:

- top band: small player row summary
- center: large owner value and mode label
- bottom band: secondary player row summary
- side or edge buttons: `MODE`, `TAX`, protected `RESET/SETUP`
- front or side large buttons: `+1`, `-1`, `+5`, `-5`

The design should read like a premium tabletop counter, not like a generic phone replacement.

## Hardware Recommendation Summary

### V1 Standalone Prototype

- enclosure target: Tier 1
- display: `3.7"` monochrome e-paper
- controller: off-the-shelf ESP32 e-paper driver board
- sync: Wi-Fi acceptable for prototype work
- buttons: direct life controls plus `MODE` and `TAX`

### Near-Product Prototype

- enclosure target: Tier 2
- display: same display class if readability remains good
- controller: ESP32-S3 module on compact custom PCB
- sync: BLE-focused implementation
- charging: integrated USB-C and battery management

### Final Aspirational Product

- enclosure target: Tier 3
- display: monochrome e-paper sized to fit the One-Touch envelope
- controller: custom compact board
- physical design: premium casework, deliberate button feel, rechargeable battery

## Risks

### Main Risks

- e-paper ghosting if refresh behavior is poorly tuned
- too many mode changes making the device feel slower than dice or a phone
- battery and button stack-up exceeding the final thickness target
- trying to fit prototype-class hardware into the final enclosure too early

### What To Avoid

- color e-paper for the core gameplay screen
- Raspberry Pi as the presumed final architecture
- touch-first interaction design
- hardware spend before the connected app proves repeated real-game value

## Next Engineering Deliverables

1. Define the device companion data contract from the current app model.
2. Produce a front-face control layout sketch for Tier 1 and Tier 3.
3. Build a bench proof using a `3.7"` monochrome e-paper panel and ESP32-class controller.
4. Validate refresh feel for life changes, poison, commander, and tax.
5. Only after that, freeze a near-product enclosure target.

## Source Notes

These current-source facts informed this specification on 2026-08-20:

- Raspberry Pi Zero 2 W is `65 mm x 30 mm` and remains in production through at least January 2030.
- Waveshare `3.7"` monochrome e-paper raw panel lists outline dimensions of `54.9 mm x 93.3 mm`, `480 x 280` resolution, and partial refresh support.
- Waveshare `4.26"` monochrome e-paper raw panel lists outline dimensions of `129.33 mm x 62.37 mm`, which exceeds the target height.
- Waveshare ESP32 e-paper driver board lists board dimensions of `29.46 mm x 48.25 mm`.

For current reference pages, see:

- https://www.raspberrypi.com/products/raspberry-pi-zero-2-w/
- https://www.waveshare.com/product/displays/e-paper/3.7inch-e-paper.htm
- https://www.waveshare.com/wiki/3.7inch_e-Paper_HAT_Manual
- https://www.waveshare.com/product/displays/e-paper/4.26inch-e-paper.htm
- https://www.waveshare.com/product/displays/e-paper-esp32-driver-board.htm
