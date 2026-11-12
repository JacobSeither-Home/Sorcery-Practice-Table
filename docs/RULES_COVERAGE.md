# Rules coverage

Source used for the rules: the Sorcery: Contested Realm rulebook, read on 2026-11-10 through a
community rulebook reader (sorcery-rulebook.vercel.app). It was **not** checked against
sorcerytcg.com or the Codex, because this project does not fetch those pages automatically.
The reader's page cut off before the Ward, Landbound and Voidwalk entries.

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
- Keywords: Airborne, Burrowing, Charge, Disabled, Immobile, Lance, Landbound, Lethal, Movement, Ranged, Spellcaster, Stealth, Submerge, Voidwalk, Waterbound, plus Genesis/Deathrite through data-driven effects

## Simplified or not automated

- **Card text** is read sentence by sentence (`src/engine/phrases.ts`). Each sentence that matches a known phrase becomes an effect the engine carries out; each sentence that does not is kept as a "by hand" entry, and the cast pop-up offers the hand tools for it after the rest resolves. Hand-entered effects in Card library replace what was read. What is read today:
  - triggers: cast (magic), Genesis →, Deathrite →, Tap → (with an optional mana cost before it), "② → …" and "Once on your turn, … may …" (once per turn), "At the start / end of your turn, …", and plain sentences on permanents as always-on (static) abilities
  - effects: deal N damage to a target / a group / an Avatar; "… takes N damage"; destroy / kill, banish, return to owner's hand; tap / untap; gain or heal life, lose life, opponent loses life; draw N spells / sites / cards (cards: the player picks the deck); gain mana (circled numbers), including the "only copy" towers; opponent discards at random; "+N power" (this turn, or always for static text); gaining keywords (this turn or always)
  - targets: "target [nearby/adjacent] [enemy/allied] unit/minion/Avatar/ally/enemy [here/nearby/adjacent]"; groups: "each/all [other] [enemy/allied] units/minions/allies/enemies [here/nearby/adjacent]"; "this minion", "your Avatar", "bearer"
  - X: the player picks the number in the pop-up (the AI uses 1)
  - These phrase rules were written from the card text shapes in the tests and general Sorcery wording, not checked against the full live card list from this workspace. Settings → Card Sync and Card library → Rules coverage show, after a sync, exactly which sentences are still by hand, grouped by ability type and by how often each wording occurs.
- **Unread sentences on the AI's cards** are logged as "not automated; resolve by hand". The AI does not play magic whose text is entirely by hand, and does not use activated abilities that are entirely by hand.
- **Static abilities** read today only change power/defense and give keywords. Static mana, threshold, cost and movement rules stay by hand.
- **Triggered abilities that need a choice** (a target, X, which deck) wait in a queue for their controller before anything else happens; ones with no choice resolve on their own.
- **Ward** is displayed but not enforced (no definition was available from the source above).
- **Flood** is not applied to sites.
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
