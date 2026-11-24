# Saved deck list and search

`client/deck-library-view.js` owns the saved-deck name matcher and list presentation. `app.js` supplies the existing collection, query, editor visibility, DOM targets and escaping function. The renderer preserves list order, labels, escaped fields and action IDs, filtered counts, empty messages and the open editor's status.

Existing app code still owns account requests, saves, editing, delegated actions and request/account race guards. Search remains local to deck and commander names, including paired commanders and Unicode normalization. No dependencies, API contracts or database structures changed. App340/cache408 includes the extracted module in the offline shell.

Verification:

- Full `npm test` passed on Node 24.19.0: server 773/773 and client 787/787, with no failures, skips or cancellations.
- All 126 existing related cases remain, with seven additional matcher/rendering cases; the focused run passed 133/133. Service-worker cache checks passed 11/11.
- An independent comparison against staging base `5e5b91b` matched 224 renderer cases and 80 matcher cases. Another 20 matcher checks passed; copied-module mutations were rejected for all-term matching, Unicode normalization, editor-status preservation and note escaping.
- Disposable Chrome ran the actual loopback app with synthetic sign-in and in-memory decks. Search, clear, no-match, edit/cancel, favorite/unfavorite, archive/restore, export and removal through the empty state passed. Search made no additional deck requests. No runtime errors were observed.
- Desktop list, scrolled list, empty and no-match screenshots plus a 390px filtered layout were reviewed. No overlap or unexpected horizontal overflow was found. This is local browser evidence; physical devices and live services were not tested.

Web guidance was checked for list rendering; this extraction required no platform change. The work remains local for review, without a push or deployment.
