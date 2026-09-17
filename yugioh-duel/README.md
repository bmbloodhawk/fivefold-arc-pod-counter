# Fivefold Arc Duel

Standalone two-phone Yu-Gi-Oh! tabletop Duel tracker. It is intentionally separate from the Fivefold Arc Commander application.

## Run locally

```text
npm --prefix yugioh-duel start
```

Open `http://localhost:8790` on the host phone or computer. A second phone on the same Wi-Fi can open the host computer's LAN address on port `8790`.

## First slice

- two claimed Duelist seats, 8,000 starting LP, and six-character join codes;
- player-owned LP changes with confirmed shared state;
- an attributed LP log and visible correction entries;
- Draw through End phase tracking and undo for the latest phase advancement;
- Single Duel or best-of-three Match state, declared Duel outcomes, and a next-Duel reset that preserves Match score.

Each claimed phone stores a private reclaim credential locally so it can take its own seat back after a refresh or server restart. The server stores only a hash of that credential and restores every seat as unclaimed/read-only until its original phone reclaims it. Locally, state uses a file. The free hosted route uses the existing Fivefold Arc Firebase credentials and only writes beneath `yugioh-duel/rooms`, never the MTG room paths.

This is a tabletop aid. It does not connect to third-party games, validate decks, enforce card rules, or replace organizer/judge procedures.

For a private hosted test, follow [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md), share [PRIVACY.md](PRIVACY.md) with testers, and run [PRIVATE_TEST_SCRIPT.md](PRIVATE_TEST_SCRIPT.md) on two physical phones.
