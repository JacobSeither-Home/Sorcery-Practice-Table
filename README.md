# Sorcery Practice Table

**Play it here: https://jacobseither-home.github.io/Sorcery-Practice-Table/** (sign-in required; access is by invitation)

**Unofficial fan project, not affiliated with Erik's Curiosa.** Free, non-commercial, for practice and teaching a few friends.
Sorcery: Contested Realm is a trademark of Erik's Curiosa Limited. See their Community Use & Copyright Policy: https://sorcerytcg.com/community-use

## Run

```
npm install
npm run dev        # local table at http://localhost:5173 (sign-in required)
                   # http://localhost:5173/?local skips sign-in for development; nothing is saved to an account
npm test           # rules engine + AI tests
npm run build      # static site in dist/
```

## Sources and rules this repo follows

- Card data comes only from the official public API, `GET https://api.sorcerytcg.com/api/cards`, on a manual **Card Sync** click. It is stored in the browser and diffed against the previous copy. Nothing syncs on load.
- No scraping of sorcerytcg.com or curiosa.io.
- Card art is never in this repo and never hosted. **Art Sync** reads a folder or zip on the user's own disk (the official public image folder is linked from api.sorcerytcg.com) and caches it in the browser.
- Rules reminders link to the Codex at sorcerytcg.com/codex instead of restating rulings.
- The app ships with no cards. Official precon decks are bundled as card names and counts only (`src/data/officialDecks.ts`) and become playable after Card Sync. Placeholder cards exist only as test fixtures in `tests/fixtures/`.

## Layout

- `src/engine/` rules engine, no UI dependencies (`rules.ts`, `cards.ts`, `phrases.ts` card-text reader, `types.ts`)
- `src/ai/` Easy / Medium / Hard opponent
- `src/data/` card sync, art sync, decks, official precon lists
- `src/net/` online play (moves only)
- `src/feedback/` wishlist + problem reports
- `src/ui/` React table; `CastModal.tsx` is the spell-casting pop-up for card abilities and the hand tools
- `tests/` vitest; `tests/fixtures/practiceSet.ts` holds made-up cards used only by tests; `node tests/arena.mjs` pits the AI tiers against each other
- `docs/HANDOFF.md` how the pieces fit, what is verified, and what is open
- `docs/RULES_COVERAGE.md` what the engine enforces and what is simplified
- `src/cloud/` sign-in, access list, saved data across devices (Supabase project `sorcery-practice-table`)
- `supabase/migrations/` the database tables and access rules, as applied
- `.github/workflows/pages.yml` builds and publishes to GitHub Pages on every push to `main`
