# Handoff notes (state on 2026-11-10)

For whoever picks this up next. Read with `docs/RULES_COVERAGE.md`.

## Where things are

| Piece | File | Notes |
|---|---|---|
| Rules engine | `src/engine/rules.ts` | Pure functions over `GameState`. `check(s, a)` explains illegality, `apply(s, a)` returns a new state, `legalActions(s)` enumerates. `actor(s)` says whose decision it is (pending defend/intercept, mulligan, or the active player). |
| Types | `src/engine/types.ts` | `Action` union is the whole input surface, including `manual` ops. |
| Card normalization | `src/engine/cards.ts` | `normalizeApiCards` (tolerant, reports unknown fields), `effectsFromText` (the small rules-text reader), `makeCard`. |
| AI | `src/ai/ai.ts` | Easy: random. Medium: one-ply greedy on `evaluate`. Hard: beam search over its own turn (`planTurn`, width 5, depth 9) in several determinized worlds; each finished turn is scored by `afterReply`, which plays the opponent's greedy turn. `aiActions` removes spells the engine cannot resolve. |
| Store | `src/store.ts` | zustand. Game loop, AI scheduling, online link, art job, settings. `buildPool` = API cards + custom cards (+ effect overlays). |
| Sign-in and saved data | `src/cloud/cloud.ts` | Supabase project `sorcery-practice-table` (org JacobSeither-ForFun). Gate in `src/ui/App.tsx`. `?local` skips sign-in under `npm run dev` only. |
| Official decks | `src/data/officialDecks.ts` | Name lists resolved against the synced pool. Only the four Beta precons so far. |
| Art | `src/data/artSync.ts` | Streaming zip reader, per-card variants keyed `cardId|variant`. |
| UI | `src/ui/Table.tsx`, `Screens.tsx`, `CardFace.tsx`, `styles.css` | |

## How to check work

- `npm test` (34 tests: engine, AI legality, art matching, official lists, text reader).
- `node tests/arena.mjs 8 50` plays the tiers against each other on the fixture decks. Last run: medium beat easy 8/8, hard beat easy 8/8, hard beat medium 7/8.
- UI: `npm run dev`, open `http://localhost:5173/?local`, Settings → Import cards.json. Headless Chromium via Python Playwright works in the cloud workspace for screenshots and drag tests.
- The workspace shell cannot reach api.sorcerytcg.com or the Pages site. The built-in browser on Jacob's machine can (he has allowed api.sorcerytcg.com, sorcerytcg.com and the Pages origin).

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

## Open items, roughly by value

1. Card text automation. The effect vocabulary (`Effect` in types.ts) is small: damage, heal, draw, mana, destroy; triggers cast, genesis, deathrite. Useful next ops, judging by text frequency: "deal N damage to each …", strike effects, tap abilities ("Tap → …" appears on 63 cards), site rules such as conditional mana/threshold, tokens.
2. Rules gaps listed in RULES_COVERAGE.md (Ward, Flood, auras on intersections, carried artifacts, entering the void, attacker-chosen damage split, spellcaster element limits).
3. AI: it treats unautomated spells as unplayable and values minions by stats and keywords only. It does not use tap abilities. `evaluate` weights were set by hand and checked only with the arena script.
4. Untested on real hardware: online play (PeerJS), touch devices, the full 3.3 GB art load, account sync across two devices.
5. Supabase Auth "Site URL" may still be the default; confirmation-email links depend on it.
6. No undo, no deck generator, no second administrator screen.
