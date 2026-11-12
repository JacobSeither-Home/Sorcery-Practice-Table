# Rules coverage

Sources: the Sorcery: Contested Realm rulebook, read on 2026-11-10 through a community rulebook
reader (sorcery-rulebook.vercel.app), and the Codex at https://sorcerytcg.com/codex, read on
2026-11-12 from a development workspace (one page load; the app itself never fetches it). Card
wording was checked against all 1,100 cards from GET https://api.sorcerytcg.com/api/cards on
2026-11-12. In the app, every keyword and rule term links to its exact Codex entry
(`src/engine/keywords.ts`) next to a one-line reminder in our own words.

## Changed after reading the Codex (2026-11-12)

- **Ward** (Codex "Ward") is enforced for units and sites: a card with the keyword enters with a Ward; the first damage, destruction, or targeting by an opponent's spell or ability breaks the Ward instead (simultaneous damage in a fight is all prevented). Sacrifice and the hand tools' Destroy ignore it.
- **Healing** (Codex "Healing") stops at the Avatar's maximum life; healing a minion removes damage.
- **Flooded** sites count as water sites.
- **Projectiles** (Codex "Projectile") start at the shooter's location, ignore allies there, and stop at the first unit they reach, ally or enemy; stealthed minions are not hit.
- **Tokens** (Codex "Token") are banished instead of going to the cemetery or hand.
- **"Up to two steps away"** is counted in orthogonal steps.

## Enforced by the engine (`src/engine/rules.ts`, tests in `tests/engine.test.ts`)

- 5×4 realm, Avatars start mid back row; 3 sites + 3 spells opening hand; one mulligan of up to 3
- Turn order: untap, 1 mana per site, draw from either deck (first player skips the first draw), main phase, end of turn (damage clears from your minions, mana is lost)
- Avatar ability: tap to play or draw a site. First site on the Avatar's square, later sites orthogonally next to a site you control (void or rubble)
- Mana cost and elemental threshold (counted from controlled sites, not spent)
- Minions and artifacts onto your own sites; magic resolves and goes to the cemetery
- Summoning sickness and Charge
- Move and Attack: one step plus Movement +X, no repeated locations, tap to act
- Fights are simultaneous; separate attack and defense values; damage ≥ defense kills
- Attacking a site: its controller loses life (life loss, never a death blow)
- Defend (untapped units in reach may tap, move in and join; a defended site leaves the fight; the original target may be taken out) and Intercept
- Death's door: at 0 life, immune for the rest of that turn, no life gain, next damage is a death blow
- Losing by drawing with both decks empty
- Keywords: Airborne, Burrowing, Charge, Disabled, Flood, Immobile, Lance, Landbound, Lethal, Movement, Ranged, Spellcaster, Stealth, Submerge, Voidwalk, Ward, Waterbound, plus Genesis/Deathrite through data-driven effects

## Simplified or not automated

- **Card text** is read sentence by sentence (`src/engine/phrases.ts`). Each sentence that matches a known phrase becomes an effect the engine carries out; each sentence that does not is kept as a "by hand" entry, and the cast pop-up offers the hand tools for it after the rest resolves. Hand-entered effects in Card library replace what was read. What is read today:
  - triggers: cast (magic), Genesis →, Deathrite → / "When this dies", Tap → (with an optional mana cost), "② → …" and "Once on your turn, … may …", "At the start / end of your turn, …", reactions ("Whenever a [nearby] [allied/enemy] minion dies", "Whenever this takes damage", "Whenever this attacks", "Whenever an enemy enters here"), and plain sentences on permanents as always-on abilities
  - effects: damage (target, group, Avatar, a chosen location, this site); strikes; projectiles (one, several in one direction, piercing, splash on impact); destroy / kill, banish, return to hand; tap / untap; heal, lose life, opponent loses life; draw (spell / site / card, from the bottom); discard at random; discard the top of a deck; look at the top card and maybe bottom it; gain mana; "Provides (A) and ①" (always, or this turn); "+N power" and keywords (this turn, until your next turn, or always); Movement +N; Ward a unit or this site; disable; submerge / burrow; teleport an ally; summon Foot Soldier / Skeleton / Frog / Bruin / Tawny tokens; "Can't defend / intercept"; "This site is flooded"
  - targets and groups: "[each/all/target/an/another] [other] [nearby/adjacent] [enemy/allied] [wounded] [Subtype/Keyword] unit/minion/ally/enemy/Avatar [here/nearby/adjacent/at target location/up to two steps away/on the surface] [with N or less power]", plus "a random unit at target location", "this", "your Avatar", "bearer", and "it"/"them" for the unit chosen earlier on the line
  - "You may …" parts can be skipped in the pop-up; "You may pay ① to …" costs mana when done
  - Coverage measured with `node tests/coverage.mjs cards.json` on 2026-11-12: of 1,100 cards, 154 fully automated, 85 keywords only, 44 partly automated, 817 still have at least one sentence that is resolved by hand. Of the 132 cards in the four Beta precons: 37 fully, 24 keywords only, 3 partly, 68 by hand. The remaining sentences are mostly one-off mechanics (search, copy, control change, area templates drawn on the card, "instead" replacement effects, movement rules).
  - X: the player picks the number in the pop-up (the AI uses 1)
  - These phrase rules were written from the card text shapes in the tests and general Sorcery wording, not checked against the full live card list from this workspace. Settings → Card Sync and Card library → Rules coverage show, after a sync, exactly which sentences are still by hand, grouped by ability type and by how often each wording occurs.
- **Unread sentences on the AI's cards** are logged as "not automated; resolve by hand". The AI does not play magic whose text is entirely by hand, and does not use activated abilities that are entirely by hand.
- **Static abilities** read today only change power/defense and give keywords. Static mana, threshold, cost and movement rules stay by hand.
- **Triggered abilities that need a choice** (a target, X, which deck) wait in a queue for their controller before anything else happens; ones with no choice resolve on their own.
- **Auras** are placed on a square you control, not on an intersection, and have no area effect.
- **Artifacts** can be conjured onto a site or handed to one of your units there (drop the card on the unit); a carried artifact moves with its bearer and is left where the bearer dies. Picking up and putting down afterwards is a Manual tools action. The rulebook's own rules for carrying and for who may pick up were not read; this is a table convenience, and artifact text is not applied to the bearer.
- **Damage allocation**: an attacker facing several enemies has its damage split automatically to kill the most (weakest minions first, remainder on the next in line). The rulebook lets the attacker choose the split; there is no prompt for it.
- **Void**: a unit without Voidwalk may not step into the void (the rulebook lets it and banishes it). Avatars may not enter the void.
- **Landbound** is implemented by analogy with Waterbound (disabled off land). Not verified.
- **Empty deck**: the draw step only offers decks that still have cards; a player loses when both are empty at the draw step, or when an effect draws from an empty deck.
- **Spellcaster element limits** ("only casts fire spells") are not enforced.
- **Codex links** go to the Codex index. Per-keyword ids (`sorcerytcg.com/codex/<id>`) are not filled in: `src/engine/keywords.ts` has the table.
- Undo exists only against the AI and only for moves that revealed nothing (see `src/store.ts`).
- Games against the AI and hot-seat games are saved after every move (this browser; the signed-in account too) and restored on reload. Online games are not.
- The built-in decks are the four Beta precons. Many of their cards have text the engine does not automate.

## Not verified

- Whether `api.sorcerytcg.com` allows browser requests from another origin (CORS). The API page does not say. Settings has "Import cards.json" for the case where it does not.
- The file naming in the official image folder. The API page does not document it; Art Sync matches on printing slug, card slug, or card name inside the filename and reports what it could not match.
- Online play. It uses PeerJS and its public broker to connect two browsers; it could not be exercised from the build environment.
