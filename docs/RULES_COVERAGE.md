# Rules coverage

Sources: the official rulebook PDF on Google Drive (SorceryRulebook.pdf, file last modified 2026-10-12; its own
cover and colophon say "October 2024"), read on 2026-11-14 through Google Drive. Page numbers cited in the code
(`pNN`) are that text's. The 2026-11-13 audit cited a different local copy whose page numbers differ; where the two
disagreed, the claim was checked against the text above and the Codex. Earlier work used a community rulebook
reader (2026-11-10). And the Codex at https://sorcerytcg.com/codex, read on
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

## Changed 2026-11-14 (tests in `tests/rulebook.test.ts`)

- **API null defense**: a minion with `defense: null` takes its printed power (p7, p23); 38 minions entered with 0 before.
- **Four regions** (p13, p34 "Region"; Codex "Region"): surface, underground, underwater, void. Adjacent, nearby and targets stay in one region (p15, p35). Avatars never leave the surface (p5). Voidwalk steps from the void straight to a subsurface it can live in (Codex "Voidwalk"); Burrowing + Submerge step between underground and underwater next door (Codex "Submerge").
- **Movement step by step** (p21, p28): declared steps resolve in order, an illegal step is skipped, only repeating a step is refused, every square passed counts as entered, the attack target is checked when the attack resolves. "Moves freely" steps cost nothing (p34). "As if the top and bottom edges were connected" (Codex "As If Connected"). Forward-only and sideways-only movers.
- **Storyline order** (p31): competing triggers go on non-active player first; a player picks the order of their own.
- **End phase**: damage leaves both players' minions (p16).
- **Mana** follows sources gained or lost mid-turn (Codex "Mana"). The rulebook text (p17) says a lost site's mana stays; the Codex, being newer, is followed.
- **Fights with several enemies** (p23; Codex "Fight"): the attacker's player splits the strike in a prompt (default: kill the weakest first).
- **Projectiles** (p34): when several units are where it lands, the shooter picks; projectiles stay in their region.
- **Which spellcaster casts** (p17): a cast can name its caster and happens where it stands. Limited spellcasters ("Fire Spellcaster", "Earth and Water", "Non-fire", "Non-Ordinary", "is a Water Spellcaster") keep their limit (p34; Codex "Spellcaster").
- **Evil** (Codex "Evil", "Ward"): Undead, Demons and Monsters; they can't be warded. Persecutor's brand makes an enemy Evil to that player's cards only.
- **Stealth** ends on any interaction (Codex "Interact"): striking, dealing damage, casting, activating an ability; and when disabled.
- **Deathrite** resolves before the card reaches the cemetery (p32; Codex "Deathrite").
- **Bodies of water / spans of land** (p12; Codex): a contiguous cluster sharing borders.
- **Split power** compares by the average of its two numbers, rounded down (Codex "Split Power").
- **Can't be modified** (Codex): no gained or lost abilities, marks or stat changes; "except by Wards".
- **Ongoing effects** (Codex "Ongoing Effect"): "Until your next turn, …" left behind by an ability; "You control all Mortals".
- **At rest** (Codex "At Rest"): the moving unit and its defenders are not at rest while the move resolves.
- **Ability thresholds** ("(A)(A)(A) — …", p18) are required.
- **Either/or** ("A, or B", "gains or loses N power"): the player picks one in the pop-up.
- **Follow-up actions**: a step right after a ranged strike; a ranged strike from a square on the path just taken.
- **Costs**: discard a card/spell/site, tap the bearer and another ally here, tap a unit here, sacrifice a minion here, break Stealth, additional discard on cast; casting-location rules (outer column, corner void, submerged, allied site with an enemy) and costs that depend on the square.
- **Release**: units disabled "until an adjacent Spellcaster taps to release" get a release action.

## Enforced by the engine (`src/engine/rules.ts`, tests in `tests/engine.test.ts` and `tests/rulebook.test.ts`)

- 5×4 realm, Avatars start mid back row; 3 sites + 3 spells opening hand; one mulligan of up to 3
- Turn order: untap, 1 mana per site, draw from either deck (first player skips the first draw), main phase, end of turn (damage clears from all minions, mana is lost)
- Avatar ability: tap to play or draw a site. First site on the Avatar's square, later sites orthogonally next to a site you control (void or rubble)
- Mana cost and elemental threshold (counted from controlled sites, not spent)
- Minions and artifacts onto your own sites; magic resolves and goes to the cemetery
- Summoning sickness and Charge
- Move and Attack: one step plus Movement +X, resolved step by step, no repeated steps, tap to act
- Fights are simultaneous; separate attack and defense values; damage ≥ defense kills
- Attacking a site: its controller loses life (life loss, never a death blow)
- Defend (untapped units in reach may tap, move in and join; a defended site leaves the fight; the original target may be taken out) and Intercept
- Death's door: at 0 life, immune for the rest of that turn, no life gain, next damage is a death blow
- Losing by drawing with both decks empty
- Keywords: Airborne, Burrowing, Charge, Disabled, Flood, Immobile, Lance, Landbound, Lethal, Movement, Ranged, Spellcaster, Stealth, Submerge, Voidwalk, Ward, Waterbound, plus Genesis/Deathrite through data-driven effects

## General systems added 2026-11-13 (one each, shared by every card that uses the wording)

- **Targets** (Codex "Target"): only effects that say "target" target; Stealth and Ward protect against targets only; the caster or source must be in the same region; Stealth also blocks attacks. A choice without the word ("an ally") is made when the effect resolves and is not a target.
- **Choosing cards from a zone**: one effect and one pop-up control for search, look at the top / bottom N, reveal, return from the cemetery, summon or cast from a zone, and the opponent's hand. Cards are filtered by type, subtype, rarity, keyword, cost, name or "another copy of this card"; the rest go to the bottom, top, or are shuffled.
- **The collection** (Codex "Collection"): a deck can list up to 10 cards outside its decks (Decks screen); they are a hidden zone in the game. A card that names a specific card can always fetch it (casual play).
- **Movement** (Codex "Forced Movement", "Teleport"): teleport, drag or the unit's own step, to a chosen nearby / adjacent location or site, to this card or the caster, one step toward / away, a random site or void, or to a chosen unit. Immobile stops steps, not forced movement.
- **Auras** (Codex "Casting Auras"): conjured anywhere on an intersection and occupying the four squares around it; "here" and "affected" mean those squares; "Lasts N of your turns" is counted at the end of each of your turns.
- **Conditions**: while Warded, in your back row, on Death's Door, you control (another) X, you lost life this turn, there are dead X, atop a site type, during enemy / your turns, in the void, adjacent to an allied X, no enemies here, more life than the opponent.
- **Reactions**: a unit dies (nearby / here / of a side or subtype), this takes damage, this attacks, a unit enters (non-Airborne etc.), this kills (Codex "Kill Credit"), a spell is cast; "each turn" triggers.
- **Casting rules**: conditional cost reductions, casting from the cemetery (and banishing), "May be cast by any ally / an allied X".
- **Protections**: can't be targeted / damaged by magic, attacked, moved by force, destroyed, banished; can't untap / attack / defend; immune to element damage, Lethal or damage; sites and minions that keep units out.
- **Control** (Codex "Ownership and Control"): gaining control of a unit, permanently or this turn; the owner never changes.
- **Illegal moves** are refused with a "Not allowed" message: the reason, a one-line reminder of the rule and a link to its Codex entry.

## Simplified or not automated

- **Card text** is read sentence by sentence (`src/engine/phrases.ts`). Each sentence that matches a known phrase becomes an effect the engine carries out; each sentence that does not is kept as a "by hand" entry, and the cast pop-up offers the hand tools for it after the rest resolves. Hand-entered effects in Card library replace what was read. What is read today:
  - triggers: cast (magic), Genesis →, Deathrite → / "When this dies", Tap → (with an optional mana cost), "② → …" and "Once on your turn, … may …", "At the start / end of your turn, …", reactions ("Whenever a [nearby] [allied/enemy] minion dies", "Whenever this takes damage", "Whenever this attacks", "Whenever an enemy enters here"), and plain sentences on permanents as always-on abilities
  - effects: damage (target, group, Avatar, a chosen location, this site); strikes; projectiles (one, several in one direction, piercing, splash on impact); destroy / kill, banish, return to hand; tap / untap; heal, lose life, opponent loses life; draw (spell / site / card, from the bottom); discard at random; discard the top of a deck; look at the top card and maybe bottom it; gain mana; "Provides (A) and ①" (always, or this turn); "+N power" and keywords (this turn, until your next turn, or always); Movement +N; Ward a unit or this site; disable; submerge / burrow; teleport an ally; summon Foot Soldier / Skeleton / Frog / Bruin / Tawny tokens; "Can't defend / intercept"; "This site is flooded"; sacrifice-cost abilities ("Sacrifice this → …"); destroy a site (Rubble); damage prevention ("takes no / 1 less damage [from units with 4 or more power / fire spells / Demons …]", "the first time … each turn"); power that counts ("+1 power for each adjacent site / Ward / dead Beast / copy nearby"); losing keywords ("All other minions lose Airborne"); "Minions here are Spellcasters"; break Wards; fully heal; discard a card of your choice; "Dies / Untaps / Gains Stealth at the end of your turn"; sleep until hurt; "Doesn't strike back while defending"; "May be summoned to any site"; corner sites; the Beta Avatars' second abilities (damage from the (A) cast this turn; banish dead fire minions for a projectile; Rubble after an earth site and replacing Rubble; flood near water, tap, skip the next untap)
  - targets and groups: "[each/all/target/an/another] [other] [nearby/adjacent] [enemy/allied] [wounded] [Subtype/Keyword] unit/minion/ally/enemy/Avatar [here/nearby/adjacent/at target location/up to two steps away/on the surface] [with N or less power]", plus "a random unit at target location", "this", "your Avatar", "bearer", and "it"/"them" for the unit chosen earlier on the line
  - "You may …" parts can be skipped in the pop-up; "You may pay ① to …" costs mana when done
  - Coverage measured with `node tests/coverage.mjs cards.json` on 2026-11-14: of 1,169 cards, 391 fully automated, 88 keywords only, 58 partly automated, 632 still have at least one sentence resolved by hand. Precon decks (cards still needing hand work / distinct cards): Beta Air 1/33 (Lucky Charm), Earth 2/33 (Mountain Giant; Craterize's picture area), Fire 4/33 (Fireball, Cone of Flame, Major Explosion pictures; Wildfire), Water 2/33 (Sunken Treasure, Island Leviathan), Gothic Harbinger 6/40, Persecutor 2/43 (picture areas), Savior 2/40, Necromancer 19/41. On 2026-11-13 the eight decks had 124 such cards.
  - X: the player picks the number in the pop-up (the AI uses 1)
  - These phrase rules were written from the card text shapes in the tests and general Sorcery wording, not checked against the full live card list from this workspace. Settings → Card Sync and Card library → Rules coverage show, after a sync, exactly which sentences are still by hand, grouped by ability type and by how often each wording occurs.
- **Unread sentences on the AI's cards** are logged as "not automated; resolve by hand". The AI does not play magic whose text is entirely by hand, and does not use activated abilities that are entirely by hand.
- **Static abilities** read today only change power/defense and give keywords. Static mana, threshold, cost and movement rules stay by hand.
- **Triggered abilities that need a choice** (a target, X, which deck) wait in a queue for their controller before anything else happens; ones with no choice resolve on their own.
- **Auras** with a shape other than 2×2 ("Conjure atop the border of a site", walls) are placed as 2×2.
- **Area templates printed as pictures** ("in the area of effect:") are not in the card text, so those spells stay by hand.
- **Artifacts** can be conjured onto a site or handed to one of your units there (drop the card on the unit); a carried artifact moves with its bearer and is left where the bearer dies. Picking up and putting down afterwards is a Manual tools action. The rulebook's own rules for carrying and for who may pick up were not read; this is a table convenience, and artifact text is not applied to the bearer.
- **Void**: a unit without Voidwalk may not step into the void on its own (the rulebook lets it and banishes it). Forced movement into the void banishes it. Avatars never enter the void.
- **Landbound** is implemented by analogy with Waterbound (disabled off land). Not verified.
- **Empty deck**: the draw step only offers decks that still have cards; a player loses when both are empty at the draw step, or when an effect draws from an empty deck.
- **Oversized units** (Mountain Giant, Yog-Sothoth) occupy one square here; the Codex "Oversized Units" rules are not built.
- **Random outcomes** are not rerolled for Lucky Charm.
- **No primary source in the October 2024 rulebook** for "Protected from …" or D6 damage; Outerbound has a Codex entry but is not built yet. Those cards stay by hand.
- Undo exists only against the AI and only for moves that revealed nothing (see `src/store.ts`).
- Games against the AI and hot-seat games are saved after every move (this browser; the signed-in account too) and restored on reload. Online games are not.
- The built-in decks are the four Beta precons and the four Gothic precons (with their collection cards); the lists are names only, resolved against the synced pool.

## Not verified

- Whether `api.sorcerytcg.com` allows browser requests from another origin (CORS). The API page does not say. Settings has "Import cards.json" for the case where it does not.
- The file naming in the official image folder. The API page does not document it; Art Sync matches on printing slug, card slug, or card name inside the filename and reports what it could not match.
- Online play. It uses PeerJS and its public broker to connect two browsers; it could not be exercised from the build environment.
