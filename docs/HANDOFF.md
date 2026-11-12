# Handoff notes (state on 2026-11-12)

For whoever picks this up next. Read with `docs/RULES_COVERAGE.md`.

## Where things are

| Piece | File | Notes |
|---|---|---|
| Rules engine | `src/engine/rules.ts` | Pure functions over `GameState`. `check(s, a)` explains illegality, `apply(s, a)` returns a new state, `legalActions(s)` enumerates. `actor(s)` says whose decision it is (pending defend/intercept, mulligan, or the active player). |
| Types | `src/engine/types.ts` | `Action` union is the whole input surface, including `manual` ops. |
| Card normalization | `src/engine/cards.ts` | `normalizeApiCards` (tolerant, reports unknown fields), `effectsFromText` (calls the phrase reader), `makeCard`. |
| Card-text reader | `src/engine/phrases.ts` | `readRules` splits text into lines (trigger prefix) and sentences, matches each against `RULES`; unknown sentences become `op: 'manual'` effects. `analyzeCards` is the coverage report (status per card, ability types, most common unread wordings). New card sets work without code changes when their wording matches existing rules. |
| Abilities in the engine | `src/engine/rules.ts` | `resolve()` carries out effects; `fire()` runs triggers or queues them (`state.queue`, resolved with the `trigger` action); `ability` action for Tap → / once-per-turn abilities (`state.used`); `bonus()` adds unit `mods` and static abilities to `power`, `defenseOf`, `has`. Choices travel as `choices[effectIndex]`. |
| Cast pop-up | `src/ui/CastModal.tsx` | Opens for any card with text, for activated abilities (✦ Abilities button, or the selected unit's buttons) and for queued triggers. Second step "resolve by hand" offers the hand tools for unread sentences. Labels in `src/ui/abilityText.ts`. |
| After a sync | `src/data/coverage.ts` | Coverage report, wishlist entry with a Claude Code prompt for cards newly not fully automated (once per card, `coverage:reported`), cards folder (cards.json, cards-text.csv, coverage.md via the folder picker; downloads elsewhere). `uploadCatalog` in `cloud.ts` writes `public.card_catalog`. |
| Saved game | `src/store.ts` | `serializeGame` after every move to IndexedDB `game:current` (cards it uses included), restored in `init`; in the account blob as `game`, newest copy wins on sign-in. |
| AI | `src/ai/ai.ts` | Easy: random. Medium: one-ply greedy on `evaluate`. Hard: beam search over its own turn (`planTurn`, width 5, depth 9) in several determinized worlds; each finished turn is scored by `afterReply`, which plays the opponent's greedy turn. `aiActions` removes spells the engine cannot resolve. |
| Store | `src/store.ts` | zustand. Game loop, AI scheduling, online link, art job, settings. `buildPool` = API cards + custom cards (+ effect overlays). |
| Sign-in and saved data | `src/cloud/cloud.ts` | Supabase project `sorcery-practice-table` (org JacobSeither-ForFun). Gate in `src/ui/App.tsx`. `?local` skips sign-in under `npm run dev` only. |
| Official decks | `src/data/officialDecks.ts` | Name lists resolved against the synced pool. Only the four Beta precons so far. |
| Art | `src/data/artSync.ts` | Streaming zip reader, per-card variants keyed `cardId|variant`. |
| UI | `src/ui/Table.tsx`, `Screens.tsx`, `CardFace.tsx`, `styles.css` | Void backdrop canvas `VoidBackdrop.tsx`. Pace multiplier `pace.ts` (`settings.pace` scales springs, CSS `--pace`, AI delay, toasts). Opponent callout (`useHerald` in Table.tsx) is a diff of the previous and next state. Long-press / right-click opens `Inspector`. Layouts: >1100 three columns, 820–1100 no right rail, ≤820 strips above/below the board, short landscape puts hand and actions in a right column. |

## How to check work

- `npm test` (64 tests: engine, Codex rules, card-text reading, abilities and triggers, AI legality, art matching, official lists).
- `node tests/arena.mjs 8 50` plays the tiers against each other on the fixture decks. Last run: medium beat easy 8/8, hard beat easy 8/8, hard beat medium 7/8.
- UI: `npm run dev`, open `http://localhost:5173/?local`, Settings → Import cards.json. Headless Chromium via Python Playwright works in the cloud workspace for screenshots and drag tests. Under `npm run dev` the store is on `window.__store`; a script can `import('/tests/fixtures/practiceSet.ts')`, set `pool`, and call `newGame` to get a board without a Card Sync.
- The cloud workspace's environment allows api.sorcerytcg.com and sorcerytcg.com (added 2026-11-12). Keep requests to the card API to a single download per working session (the API allows 30 per minute and asks consumers to keep their own copy); keep the file outside the repository (card text is never committed).
- `node tests/coverage.mjs <cards.json> [out-dir]`: coverage of the reader against a card list.

## Facts verified against the live API on 2026-11-10

- `GET /api/cards` is the only documented endpoint. It answered a browser request from the Pages origin, so Card Sync works in the browser.
- 1,100 cards, 3,088 printings. Top-level keys `id, name, slug, engine, printings`. Types: Minion 489, Site 208, Magic 202, Artifact 129, Aura 38, Avatar 34.
- Printing slugs look like `004-13_treasures_of_britain-b-s` (set code, name, product letter, finish letter). Finishes: Standard, Foil, Rainbow.
- Keywords present: Airborne, Burrowing, Charge, Deathrite, Disabled, Flood, Genesis, Immobile, Lance, Landbound, Lethal, Movement, Ranged, Spellcaster, Stealth, Submerge, Voidwalk, Ward, Waterbound.
- 30 of 34 Avatars start with "Tap → Play or draw a site." and add their own ability, which is not automated.

## Rules source limits

The engine was written from the rulebook as read through a community reader, not from sorcerytcg.com. Ward, Landbound and Voidwalk definitions were cut off there. Codex ids for keyword links are not filled in (`src/engine/keywords.ts`).

## Project rules that shaped decisions

- Card data only from the public API, on a manual sync. No fetching from curiosa.io or sorcerytcg.com by the app. Curiosa refuses automated readers (robots), so the Gothic precon lists (Savior, Harbinger, Necromancer, Persecutor) were not read; they need to arrive as text.
- The Beta lists were transcribed from the decklist images on the announcement page Jacob linked; names were checked against the API.
- Art is never committed or hosted. It is read from the user's disk into IndexedDB.
- Supabase and GitHub are Jacob's personal accounts, not the AMR work ones.

## Picking up new cards (a new set, or wording the reader does not know)

1. In the app: Card Sync (signed in). It writes every card to `public.card_catalog` and, when cards arrive that are not fully automated, adds a wishlist entry whose details are a ready-made Claude Code prompt.
2. In Claude Code: read the catalog with the Supabase tools, e.g. `select name, type, rules, unmatched from public.card_catalog where status in ('partial','manual')`, and the wishlist entry (`public.wishlist`, title starting "Card rules to implement").
3. Add phrase rules in `src/engine/phrases.ts` for the most common unread wordings (Card library → Rules coverage lists them), a new op in `resolve()` only when none fits, a test per phrase, then update `docs/RULES_COVERAGE.md`.

## Open items, roughly by value

1. Card text: 763 of 1,100 cards still have a sentence resolved by hand (611 of them only one) (`node tests/coverage.mjs <cards.json> <out-dir>` writes shapes.tsv and open.tsv). Biggest groups left: search/look at, "instead" replacement and damage prevention ("takes no damage from …"), area templates drawn on the card ("in the area of effect:" — the shape is an image, not text), control changes, forced movement (drag, push, step toward), conditional power ("+1 power for each …", "while …"), spell-casting permissions ("May be cast by any ally"), and the four Beta Avatars' own abilities.
2. Rules gaps listed in RULES_COVERAGE.md (Ward, Flood, auras on intersections, carried artifacts, entering the void, attacker-chosen damage split, spellcaster element limits).
3. AI: it treats unautomated spells as unplayable and values minions by stats and keywords only. It does not use tap abilities. `evaluate` weights were set by hand and checked only with the arena script.
4. Untested on real hardware: online play (PeerJS), touch devices, the full 3.3 GB art load, account sync across two devices.
5. Supabase Auth "Site URL" may still be the default; confirmation-email links depend on it.
6. No deck generator, no second administrator screen. Online games are not saved or resumable.
