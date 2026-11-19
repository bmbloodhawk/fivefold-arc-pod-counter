# Saved deck library — Add deck and search

Requested during the guided iPhone Safari test. Base:5d1f93ab957eff50916605f282b1d1ccfed85e26. Staging only; production remains52017e8a2f4419915d5544663c58f269e241f1ed. Release pins:App322/styles250/cache388.

## User flow

- My decks starts with the saved list, Add deck and Search decks. The editor is hidden in initial HTML.
- Add deck opens a clean one-commander editor. Edit opens the selected saved deck. The header Close action remains available.
- Cancel clears the current draft and returns to the same filtered library. Native Close/Escape preserves an unfinished editor and draft; reopening resumes it. Drafts are not newly persisted across page reloads.
- An owned successful save returns to the library and refreshes the results. Failed saves remain editable. A newer or changed draft is never closed/cleared by an older response.
- Search filters locally by saved deck name or commander, including either partner. It ignores case/outer whitespace, supports multiple terms, and excludes private notes as search criteria. Clearing restores all decks, including archived entries. Existing favorite/archive/restore/remove/export actions remain available on matching cards.
- Search lives outside the editor form. Search/Enter cannot implicitly close the dialog or save a deck. The dedicated editor form submits through the existing save handler. Search typing disables autocorrection/capitalization.

## Implementation boundaries

No backend, account-provider, game, Pod, tournament, radiation or production changes. Add/Edit/Cancel retire the old save and commander-lookup contexts; draft-only reset leaves saved collections and Table selectors intact. Account cleanup also clears the search, editor view and private results. List reads own their generation/account and cannot enable an active newer save. Explicit canceled sign-in still reports its error while preserving the draft.

The always-enabled header Close control receives focus when returning to the library, so a loading-disabled Add button cannot drop focus to the page. Long saved text and no-match search messages wrap within the phone viewport. The earlier profile-heading outline fix remains intact.

## Verification

34 new actual-source tests were RED before implementation. The full client suite passes665 tests;84 focused library/save/privacy/read tests pass. A mutation removing save retirement fails the same-valued replacement-editor regression. Existing race assertions remain in place; legacy fixtures were updated for actual library/editor state and the old editor-first layout assertion now requires library-first.

Actual Chrome/WebKit phone-size checks passed82 unique assertions, covering Add/Edit/Cancel/Save, search/Enter/clear/no-match/partners, filtered actions, Close/Escape draft resume, delayed accepted save versus a newer draft, account isolation, and narrow-screen layout. A legal120-character unbroken name reproduced horizontal overflow; scoped text wrapping fixes it at390px and320px. Screenshots and served-file verification are recorded in the external deck-library-20261118 evidence folder. Physical iPhone confirmation of these new controls remains pending.

## Modern Web Guidance

I retained native modal behavior and used a dedicated AJAX editor form: “DO use dialog.showModal() when opening from script”; “DON'T nest <form> elements inside other <form> elements”; “DO prevent default navigation on form submit for AJAX (e.preventDefault()).” Search uses a visible label and native search region without sharing the editor's submit/close path.

Staging rollback base:5d1f93ab957eff50916605f282b1d1ccfed85e26, preserving records and unrelated original-workspace changes.
