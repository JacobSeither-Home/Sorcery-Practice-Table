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

- **Card text beyond keywords** is automated only for (a) effect entries added in Card library, and (b) a few sentences read straight from the text when that sentence is the card's whole text: "Deal N damage to target [nearby/adjacent] unit/minion", "Destroy/Kill target [nearby/adjacent] minion", "Draw a/N spell(s)/site(s)", "Gain N life", alone or after "Genesis →" / "Deathrite →". Checked against the API on 2026-11-10, nearly every one of the ~1,100 card texts is unique, so most cards (all 34 Avatars' extra abilities, most sites, artifacts and auras) are resolved with Manual tools. Manual actions are marked in the log.
- **Ward** is displayed but not enforced (no definition was available from the source above).
- **Flood** is not applied to sites.
- **Auras** are placed on a square you control, not on an intersection, and have no area effect.
- **Artifacts** sit on a site; units do not carry them.
- **Damage allocation**: an attacker facing several enemies has its damage split automatically to kill the most (weakest minions first, remainder on the next in line). The rulebook lets the attacker choose the split; there is no prompt for it.
- **Void**: a unit without Voidwalk may not step into the void (the rulebook lets it and banishes it). Avatars may not enter the void.
- **Landbound** is implemented by analogy with Waterbound (disabled off land). Not verified.
- **Empty deck**: the draw step only offers decks that still have cards; a player loses when both are empty at the draw step, or when an effect draws from an empty deck.
- **Spellcaster element limits** ("only casts fire spells") are not enforced.
- **Codex links** go to the Codex index. Per-keyword ids (`sorcerytcg.com/codex/<id>`) are not filled in: `src/engine/keywords.ts` has the table.
- No undo.
- The built-in decks are the four Beta precons. Many of their cards have text the engine does not automate.

## Not verified

- Whether `api.sorcerytcg.com` allows browser requests from another origin (CORS). The API page does not say. Settings has "Import cards.json" for the case where it does not.
- The file naming in the official image folder. The API page does not document it; Art Sync matches on printing slug, card slug, or card name inside the filename and reports what it could not match.
- Online play. It uses PeerJS and its public broker to connect two browsers; it could not be exercised from the build environment.
