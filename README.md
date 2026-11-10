# Sorcery Practice Table

**Unofficial fan project, not affiliated with Erik's Curiosa.** Free, non-commercial, for practice and teaching a few friends.
Sorcery: Contested Realm is a trademark of Erik's Curiosa Limited. See their Community Use & Copyright Policy: https://sorcerytcg.com/community-use

## Run

```
npm install
npm run dev        # local table at http://localhost:5173
npm test           # rules engine + AI tests
npm run build      # static site in dist/
```

## Sources and rules this repo follows

- Card data comes only from the official public API, `GET https://api.sorcerytcg.com/api/cards`, on a manual **Card Sync** click. It is stored in the browser and diffed against the previous copy. Nothing syncs on load.
- No scraping of sorcerytcg.com or curiosa.io.
- Card art is never in this repo and never hosted. **Art Sync** reads a folder or zip on the user's own disk (the official public image folder is linked from api.sorcerytcg.com) and caches it in the browser.
- Rules reminders link to the Codex at sorcerytcg.com/codex instead of restating rulings.
- The built-in "Practice" cards are original placeholders written for this app; they are not Sorcery cards.

## Layout

- `src/engine/` rules engine, no UI dependencies (`rules.ts`, `cards.ts`, `types.ts`)
- `src/ai/` Easy / Medium / Hard opponent
- `src/data/` card sync, art sync, decks, practice set
- `src/net/` online play (moves only)
- `src/feedback/` wishlist + problem reports
- `src/ui/` React table
- `tests/` vitest
- `docs/RULES_COVERAGE.md` what the engine enforces and what is simplified
- `supabase/migrations/0001_wishlist.sql` table for shared feedback (optional, not applied anywhere)
