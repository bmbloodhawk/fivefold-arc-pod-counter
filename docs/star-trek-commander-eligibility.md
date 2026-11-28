# Exploration Commission: reviewed commander eligibility

The local mission uses `server/static-data/star-trek-commanders.v1.json`, version
`star-trek-commanders-v1-2026-11-27`. This is a fixed reviewed list, not a live
product filter or a fuzzy name search. New card releases do not silently extend
eligibility.

## Scope reviewed on November 27, 2026

- **197 Trek-native canonical card identities** in TRK and TRC, including the
  Commander decks, welcome-deck cards, and other new-to-Magic supplemental cards
  within those sets. Different cards depicting the same character remain distinct
  identities; different treatments of one card share one Oracle identity.
- **23 Commander-legal Stardates (SDS) reskin identities**, eligible only through
  their explicitly recorded Star Trek display names.
- **8 Commander-legal Secret Lair reskin identities** from the official
  Assimilation and Lower Decks drops, again eligible only through the recorded
  Star Trek display names.
- **228 canonical identities and 423 reviewed English paper printing records**
  altogether. The JSON contains each exact name, aliases, canonical Scryfall
  Oracle ID, type line, keywords, eligible names, and reviewed printing IDs.

This includes legendary creatures, legendary Spacecraft with printed
power/toughness boxes, and the eligible legendary Vehicle Weatherlight under its
Star Trek display name. Legendary Vehicles and Spacecraft are legitimate
Commander choices under the official Commander rule change described below.

The JSON distinguishes names that establish eligibility (`eligibleNames`) from
other exact names useful only for resolving and deduplicating a card identity
(`aliases`). For example:

| Starting commander evidence | Canonical identity | Mission eligible |
| --- | --- | --- |
| Commander Spock | Commander Spock | Yes |
| Tendi, Exploring the Future | Thrasios, Triton Hero | Yes |
| Thrasios, Triton Hero | Thrasios, Triton Hero | No: no Trek display evidence |
| Rutherford, Rebuilding the Past | Silas Renn, Seeker Adept | Yes |
| Loran of the Third Path | Loran of the Third Path | No |

The two reviewed named reskins with the Partner keyword are Tendi/Thrasios and
Rutherford/Silas Renn. Canonical IDs let the mission deduplicate their order and
their alternate exact names without inventing another card identity.

## Exclusions and limits

Loran of the Third Path appears in TRC but is an unrelated canonical reprint;
it is explicitly excluded. A Star Trek product, set code, illustration, loose
character name, or fuzzy lookup suggestion alone never qualifies a card. Generic
mechanical names such as Sheoldred, the Apocalypse, Thrasios, Triton Hero, and
Weatherlight do not become eligible merely because a Star Trek reskin exists.

The current game setup records commander strings. Therefore a reskin needs its
exact approved Trek display name in the trusted starting snapshot. The reviewed
printing IDs document the canonical mapping; they do not by themselves prove
which printing a player used. The mission does not inspect or infer a printing
from an editable deck or final commander name.

English canonical names and explicit Trek display names are supported. The one
additional ASCII alias, `Vox, Child of the Collective` for `Võx, Child of the
Collective`, comes from MTGJSON's `asciiName` and maps to the same Oracle ID.
Case, surrounding whitespace, and Unicode composition may be normalized by the
exact resolver; missing words, substrings, punctuation guesses, and fuzzy matches
are not eligibility evidence. Other localized card names require a separately
reviewed list revision.

This version is not a promise to cover future cards or currently unreviewed
Secret Lair bonus cards. Existing histories without a trusted canonical starting
snapshot cannot acquire eligibility from this list after the fact.

## Sources and review method

The publisher establishes the actual Trek card names and reskin associations:

- [Wizards' Star Trek card image gallery](https://magic.wizards.com/en/products/star-trek/card-image-gallery).
  All 197 included native names and all 23 included SDS mechanical names were
  cross-checked against the gallery's supplied source data.
- [Wizards' Star Trek release notes](https://magic.wizards.com/en/news/feature/star-trek-release-notes).
  These identify TRK/TRC/SDS format legality and describe the actual card types.
- [Collecting Star Trek](https://magic.wizards.com/en/news/feature/collecting-star-trek).
  The Stardates section establishes that these are explicit Trek reimaginings of
  earlier canonical cards and explains their separate SDS set code.
- [Secret Lair: Set Phasers to Superdrop](https://magic.wizards.com/en/news/announcements/secret-lair-set-phasers-to-superdrop).
  The publisher lists each of the eight included commander reskins and its
  mechanical name. Other cards in those drops are not commander-eligible and
  are not included.
- [Edge of Eternities update bulletin, rule 903.3](https://magic.wizards.com/en/news/announcements/edge-of-eternities-update-bulletin).
  This establishes legendary Vehicle/Spacecraft commander eligibility with a
  power/toughness box; ordinary artifacts and nonlegendary spacecraft are not
  covered by that rule.

Canonical Oracle IDs, printing IDs, English flavor names, paper availability,
Commander legality, type lines, and keywords were obtained directly from the
[Scryfall API](https://scryfall.com/docs/api/cards). The reviewed queries were:

```text
(set:trk or set:trc) is:commander game:paper
set:sds is:commander game:paper
set:sld (cn:2731 or cn:2732 or cn:2733 or cn:2739 or cn:2740 or cn:2741 or cn:2742 or cn:2743) is:commander game:paper
```

Queries used `unique=prints`, followed all result pages, and grouped results by
Oracle ID. Every included card had `legalities.commander = legal`. The native
query returned 198 identities; manual review excluded Loran. The reskin lists
require an explicit nonempty Trek `flavor_name`, confirmed against the official
sources above. The resulting names and IDs are checked in; the runtime makes no
external card request.

The ASCII alias was checked against the direct
[MTGJSON TRC set file](https://mtgjson.com/api/v5/TRC.json). The TRK file was also
checked for ASCII differences. The JSON records the exact fetched API URLs and
SHA-256 hashes of their response bytes so the provenance of this particular
review can be identified without silently refreshing the list.

One publisher article has a naming discrepancy: its Lower Decks contents list
says `S.S. Cerritos, California-Class`; the actual Scryfall printing record
`2b445fb5-9680-4d39-87d6-284b08a7e145` says `U.S.S. Cerritos, California-Class`.
Only the actual printed display name is allowed in this version; the article's
shorter spelling is not added as an unsupported alias.

## Updating the list

Review publisher evidence and canonical card data again, use a new version, and
add focused tests for any changed names or identity mappings. Preserve existing
earned evidence. Do not broaden eligibility by automatically admitting every
card from a product, copying fuzzy suggestions, or treating an unrelated
mechanical name as proof of a themed printing.
