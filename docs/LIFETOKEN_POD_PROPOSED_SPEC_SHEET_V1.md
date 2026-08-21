# LifeToken Pod Proposed Spec Sheet V1

Status: proposed concept sheet  
Date: 2026-08-20  
Product phase: app validation now, standalone hardware later

## Product

LifeToken Pod is a personal connected Commander counter designed to show:

- your own life total large
- the rest of the pod small
- warning and lethal states at a glance
- commander-tax and mode changes through direct physical controls

The intended value is simple:

`Know the table state without stopping the game.`

## Intended Form Factor

- class: personal tabletop device
- orientation: portrait
- final aspirational footprint: `73 mm x 108 mm`
- target thickness: `10-14 mm`
- target feel: premium hard-case accessory, similar in presence to a magnetic One-Touch card holder

## Prototype Size Recommendation

For the first dedicated hardware prototype, use a slightly larger body:

- prototype footprint: `85-90 mm x 120-130 mm`
- prototype thickness: `14-20 mm`

This keeps the first build realistic while preserving the intended final direction.

## Display

- type: monochrome e-paper
- recommended class: `3.7"` `480 x 280`
- approximate panel outline: `54.9 mm x 93.3 mm`
- approximate active area: `47.32 mm x 81.12 mm`
- behavior: always-visible screen, low idle power, partial refresh support

## Processing And Control

- controller class: `ESP32-S3`
- first bench path: off-the-shelf ESP32 e-paper driver board
- product path: custom compact board using ESP32-S3-class module

## Connectivity

- current prototype and lab work: Wi-Fi acceptable
- intended hardware sync target: BLE
- fallback pairing requirement: manual create/join flow
- NFC: optional, not required for first hardware phase

## Primary Physical Controls

- `+1`
- `-1`
- `+5`
- `-5`
- `MODE`
- `TAX`

## Protected Or Secondary Controls

- `RESET` by recessed button or long press
- `SETUP` by side button or long press

## Core On-Device Screens

- Life
- Poison
- Commander
- Energy
- Storm
- Generic

Life remains the home screen.

## Default Life Screen Behavior

The screen should prioritize:

- large owner life total
- small opponent life totals
- clear skull marker for eliminated players
- minimal clutter
- warning state only when relevant

## Power

- rechargeable battery: LiPo class
- charge port: USB-C
- target usage: multiple Commander sessions per charge

## Enclosure Direction

- front: e-paper dominant face
- side or edge buttons for lower-frequency functions
- front or edge direct-action buttons for life changes
- durable shell with deliberate button feel
- no dependency on a phone once the standalone version exists

## Things This Spec Avoids

- color e-paper
- touch-first gameplay
- Raspberry Pi as the final compact architecture
- hardware complexity before the connected app proves table value

## Recommended Build Sequence

1. Finish validating the connected app experience.
2. Build a bench proof with `3.7"` monochrome e-paper and ESP32-class control.
3. Validate refresh feel and readability in actual Commander games.
4. Freeze the near-product enclosure target.
5. Only then design toward the final One-Touch-sized enclosure.
