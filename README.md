# Fivefold Arc Pod Counter — test build

An installable phone-first web prototype for synced Commander pods. Each phone owns one seat, updates its own counters, and records commander damage received by that seat. Other phones receive the authoritative table state live.

## What works

- Local one-phone simulation for 1–8 players
- Connected rooms for 2–8 phones with opaque six-character join codes
- Life, poison, commander damage, energy, storm, and generic counters
- Shared active-turn flow: game-time or optional round countdown, player-driven End Turn, and a 15-second handoff undo
- Warning and lethal evaluation with commander > poison > life priority
- Atomic seat claims, private reconnect tokens, exact-version writes, and host-only reset
- Disconnected shared controls pause; offline changes are not queued or replayed
- Installable PWA shell with no accounts, chat, analytics, or stored game history

## Run on this computer

Requires Node.js 20 or newer.

```text
npm start
```

Open `http://localhost:8787`. Phones on the same Wi-Fi can use the computer's LAN address while the server is running and the firewall permits it. The app and API are served from one origin.

Run automated server tests with `npm test`. Run the adversarial live suite using the instructions in `qa/README.md`.

## Remote-house test route

The prepared `render.yaml` describes a single free Render web service. It serves both the interface and ephemeral realtime rooms over HTTPS. Deployment requires a Git repository and a Render account; account creation, provider authorization, and accepting provider terms are intentionally not performed by this project.

Important free-tier behavior: the service can sleep after inactivity and take roughly a minute to wake. Rooms are memory-only and disappear whenever the service restarts or redeploys. This is suitable for an interface test, not production.

Recommended deployment settings if entered manually:

```text
Runtime: Node
Build command: npm install --prefix server
Start command: npm start
Health check: /health
Instance type: Free
```

## Evidence boundary

Automated API and two-browser flows are passing locally. Mixed iPhone/Android behavior, mobile background reconnect, eight-player readability, setup time, battery/data use, three-hour stability, and operation on a remote home network remain unverified until the field script in `qa/TEST_PLAN.md` is run against a deployed HTTPS URL.

## Standalone hardware direction

The current product remains a phone-first validation build. A future dedicated hardware direction for LifeToken Pod is documented in [docs/LIFETOKEN_POD_STANDALONE_HARDWARE_SPEC_V1.md](/C:/Users/nibay/OneDrive/Documents/ChatGPT/APP%20for%20MTG%20life%20counter%20with%20conectivity/docs/LIFETOKEN_POD_STANDALONE_HARDWARE_SPEC_V1.md).
