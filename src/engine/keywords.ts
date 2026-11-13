// Short reminders for tooltips and the cast pop-up, written in our own words. The Codex on
// sorcerytcg.com is the authority: every reminder links to its Codex entry instead of restating rulings.
// Codex entry ids were read from the Codex index page (https://sorcerytcg.com/codex) on 2026-11-12.
export const CODEX_INDEX = 'https://sorcerytcg.com/codex';
export const CODEX_IDS: Record<string, string> = {
  Airborne: 'c7c182e2-629c-4e65-a9a0-97feff983a3d', Burrowing: '16ed5006-40f3-4df2-8b60-6d0b13bb35a8', Charge: '4cff66bd-45c0-452b-aaa8-18119accf443',
  Deathrite: '7bd846a2-c55b-42cc-915a-9861f2080202', Disabled: '08fff20b-76c1-45c3-b13f-989202cdacf0', Flood: '610226cf-24be-4d6b-885f-b466197672c5',
  Genesis: '22b458ed-cb2f-407d-8a66-94fae90eb77e', Immobile: '7db6da14-a5eb-4dcf-8b3b-4ba4e3ecfbeb', Lance: '091b556c-3abc-4e42-81ab-5216cf11d9ed',
  Landbound: '64a2cd57-fed4-4ace-a2e5-a5f63a3e576c', Lethal: '47a59bae-9234-404e-8299-efeec4d1c78d', Movement: '22c9d0fe-727c-4700-9375-91cc7a2f7f2b',
  Ranged: '23eb6bf6-7bc3-4665-a9de-920e1c72a862', Spellcaster: '89067d2f-058b-4c86-b3ae-3aebf1c3895a', Stealth: '8dc27cdf-47d5-4d69-8724-c30efbe94158',
  Submerge: 'aaa76e05-0cbc-4114-ad1c-411eeec89eea', Voidwalk: 'b0d18273-8870-4c0b-a8dd-1bda6e75e6bf', Ward: 'ae9b6774-aa8f-45c5-a424-d6d7e58014c3',
  Waterbound: '00c82dd7-d184-4a34-adf7-45a9bf9f3f70', Threshold: 'fc149f73-4afe-425f-9e73-e8a42fad3e71',
};
export function codexUrl(term: string): string {
  const id = CODEX_IDS[term] ?? RULE_TERMS[term]?.id;
  return id ? `${CODEX_INDEX}/${id}` : CODEX_INDEX;
}
export const KEYWORD_HELP: Record<string, { text: string; enforced: boolean }> = {
  Airborne: { text: 'On the surface it may step diagonally, only Airborne units can attack it, and only Airborne or Ranged units can intercept it. Its own attacks can be defended by anyone.', enforced: true },
  Burrowing: { text: 'Can step between the surface and underground of a land site, and between neighbouring underground locations.', enforced: true },
  Charge: { text: 'No summoning sickness: it can tap (move, attack, use tap abilities) the turn it arrives.', enforced: true },
  Deathrite: { text: 'Does something when it dies.', enforced: true },
  Disabled: { text: 'Has no abilities, does not strike or deal damage, cannot take its own steps, and loses Stealth and Ward.', enforced: true },
  Flood: { text: 'A flooded site counts as a water site as well as its own elements.', enforced: true },
  Genesis: { text: 'Does something when it enters the realm.', enforced: true },
  Immobile: { text: 'Cannot take steps. It can still attack and defend where it stands.', enforced: true },
  Lance: { text: 'Its next strike against a unit deals +1 damage and strikes first; then the lance breaks.', enforced: true },
  Landbound: { text: 'Disabled while it is not on a land location.', enforced: true },
  Lethal: { text: 'Any damage it deals to a minion kills that minion.', enforced: true },
  Movement: { text: 'May take extra steps when moving or defending.', enforced: true },
  Ranged: { text: 'Tap to shoot a projectile in a straight line; it strikes the first unit it reaches, which does not strike back.', enforced: true },
  Spellcaster: { text: 'Can cast spells. Avatars are always spellcasters. Targeted magic is measured from a spellcaster you control.', enforced: true },
  Stealth: { text: 'Until it interacts with the realm: the opponent cannot target it, defend against or intercept it, or hit it with projectiles.', enforced: true },
  Submerge: { text: 'Can step between the surface and underwater of a water site, and between neighbouring underwater locations.', enforced: true },
  Voidwalk: { text: 'Can be summoned to, enter and survive in the void; any other minion there is banished.', enforced: true },
  Ward: { text: 'Enters with a Ward. The first time it would be damaged, destroyed, or targeted by the opponent, the Ward breaks instead.', enforced: true },
  Waterbound: { text: 'Disabled while it is not on a water location.', enforced: true },
  Threshold: { text: 'The element symbols on sites you control. A card needs at least its printed threshold; threshold is not spent.', enforced: true },
};

/** Rule terms used in card text, with a one-line reminder and the Codex entry that explains them. */
export const RULE_TERMS: Record<string, { id: string; text: string }> = {
  Setup: { id: 'bc2036cd-69d3-4fab-b63b-dd094cf279c5', text: 'Each player draws 3 sites and 3 spells and may take one mulligan of up to 3 cards.' },
  'Move and Attack': { id: 'd7f6af80-0923-4ab1-88bc-11b7c694d49b', text: 'Tap a unit to take its steps (1 plus Movement +X) and, at the end, attack an enemy unit or site there.' },
  Site: { id: '5e633a96-c807-4915-be05-e83cacfcbfd6', text: 'Played with your Avatar\'s tap ability, one per turn: the first on your Avatar\'s square, later ones next to a site you control (not diagonally).' },
  Avatar: { id: 'a43c193c-02d6-4389-b791-08d3b77bde11', text: 'Your Avatar taps to play or draw a site, is always a spellcaster, and its life is your life.' },
  'Casting spells': { id: '43a73161-4f77-46b1-a23a-f916223a748c', text: 'On your turn, with enough mana and threshold: minions and artifacts go onto your own sites, auras anywhere, magic resolves and goes to the cemetery.' },
  'Main phase': { id: 'cdd8d7be-ace7-457f-9ad6-28701ccb33d6', text: 'After you draw: play a site, cast spells, move and attack, use abilities — in any order.' },
  'Start phase': { id: 'd74587ee-6256-4009-b144-9d46e9125822', text: 'Your cards untap, start-of-turn abilities happen, then you draw a spell or a site (the first player skips the first draw).' },
  Path: { id: '2ba56532-3ac0-41e8-a73f-1005cbefe8db', text: 'The locations a unit moves through; it cannot visit the same location twice in one move.' },
  'Range of motion': { id: 'baf60fbb-dcd9-4bb5-a2b4-158f8df5cbb1', text: 'Every location a unit could reach with its steps right now.' },
  Winning: { id: '48bee2d2-6d32-466f-b4fe-6c3178cb6ba4', text: 'Deal a death blow to the enemy Avatar, or the opponent has to draw from an empty deck.' },
  Target: { id: '98943611-2a6f-4756-ad9b-a7d6598e9729', text: 'Only effects that say "target" target. You must choose a legal one in the same region as the caster or source, or the spell cannot be cast. Stealth and Ward protect against targets.' },
  Collection: { id: '78ce4090-a2e1-4893-97c0-6eaafd5c5937', text: 'Extra cards outside your decks (up to 10 in constructed play). In casual play a named card can always be taken from your collection.' },
  'Look at': { id: '0f71f26a-a091-4fb2-9dcc-bcfed14f282a', text: 'Only you see the cards; put them back in any order unless the card says otherwise.' },
  'Forced movement': { id: '8ffdae56-1aef-44f7-b9af-cdcbc334a377', text: 'Movement the unit does not do itself (drag, pull, push, teleport). Immobile units can still be moved this way.' },
  Control: { id: '40fc4dfb-0290-4f9e-9f98-4ad5b28ccc8f', text: 'The owner never changes; control can. Cards always go back to their owner\'s hand, deck or cemetery.' },
  Aura: { id: '1c5c02a4-586e-4bfd-99ce-11e9230ed140', text: 'An aura sits on the corner where four squares meet and affects those four squares.' },
  Nearby: { id: '7de60b0a-855c-4bab-95a7-7e6f172ba4a0', text: 'Its own square and the eight around it, diagonals included. For units and locations, only within the same region.' },
  Adjacent: { id: '1d3363e4-3b12-46fb-99d9-f4319967f484', text: 'Its own square and the four that share an edge with it (no diagonals).' },
  Here: { id: '8e4684e4-479b-45d1-a75b-a41568ea6e6f', text: 'The location the card occupies. For a site: its surface and below it.' },
  Atop: { id: '00747d40-bcc5-405b-9f26-0a46ef6898ed', text: 'On the surface of a site (not in the void).' },
  Location: { id: '1c06ae66-10a5-4c5a-96bc-21bdcfbd2999', text: 'A square and a region together. A site has two locations: its surface and below it.' },
  Tap: { id: '4b73c89d-914a-4911-a73b-1ae905e4a398', text: 'Turn the card sideways. A tapped card cannot tap again until it untaps.' },
  Untap: { id: '28aa5f89-96ed-4d96-8276-578f65920d8b', text: 'Turn the card upright again. Your cards untap at the start of your turn.' },
  'Summoning Sickness': { id: '6d43aa10-e794-463a-a5ea-93e6f0807e00', text: 'A minion that arrived this turn cannot tap, or be tapped, to pay for abilities.' },
  Strike: { id: '8bb6e5a1-6989-4ec1-98d7-ef50283cccf6', text: 'Deal damage equal to the unit\'s power.' },
  Damage: { id: 'd54c08da-2107-484a-9f68-123bb62581b5', text: 'A minion dies when its damage reaches its power; damage clears at the end of the turn. Damage to an Avatar or site costs life.' },
  Fight: { id: '42987967-710c-48a3-b40e-1daaa47f8e91', text: 'Units strike each other at the same time; first strikes (such as Lance) go before.' },
  Defend: { id: '7bc7a52c-25dc-4c80-8608-89667ef5eed7', text: 'An untapped unit that can reach an attack may tap, move there and take the attack on itself.' },
  Intercept: { id: 'eb6018eb-554d-44af-9627-7c636cef7583', text: 'When an enemy moves without attacking, your untapped units there may tap to fight it.' },
  "Death's Door": { id: '8dd871eb-65ec-4f9a-be06-4e81e417d1a2', text: 'At 0 life you are at death\'s door: no healing, and after that turn any damage to your Avatar is a death blow.' },
  'Death Blow': { id: '2cffd099-b5f5-4af6-9ce9-966ac6d1306c', text: 'Damage to an Avatar at death\'s door (after the turn it got there). It wins the game. Losing life is not a death blow.' },
  Heal: { id: 'f980ed60-def7-4a2d-87ca-589573087481', text: 'Healing an Avatar gains life, up to its maximum. Healing a minion removes damage.' },
  Banish: { id: '703eaeda-d0ac-46ca-9103-a2f9fadf327a', text: 'Removed from the game for good; not to the cemetery.' },
  Token: { id: 'c0a4c32b-5894-4821-ae03-172b1358d5d9', text: 'Works like a card in the realm; if it would leave the realm it is banished.' },
  Summon: { id: '679db7d7-3cb3-4655-b84b-53c4bd6ed637', text: 'A minion enters the realm. When an effect summons it, you pay no mana or threshold.' },
  Kill: { id: 'f6e68ade-9736-4354-936b-e461ab73d352', text: 'The same as destroy.' },
  Destroy: { id: 'f6e68ade-9736-4354-936b-e461ab73d352', text: 'The card dies and goes to its owner\'s cemetery.' },
  Sacrifice: { id: 'b6ffd09a-c8fb-4b80-ac24-4900e8fd5ca3', text: 'Destroy one of your own cards; nothing (not even Ward) prevents it.' },
  Discard: { id: 'adee8b2b-40ba-4231-874d-df4790483730', text: 'Put a card from hand into the cemetery. You choose unless it says random.' },
  Draw: { id: 'c50821a8-cb00-4270-a252-25e5f9c077c1', text: '"A card": your choice of spellbook or atlas. "A spell": spellbook. "A site": atlas.' },
  Search: { id: 'fc2e5653-d210-4ba9-9280-57f2baeaedfd', text: 'Look through a zone for a card. Shuffle afterward if you searched a deck.' },
  Projectile: { id: 'c81c8875-ef70-4202-8c98-7ac00ece0cc6', text: 'Travels in a straight line from the shooter and stops at the first unit it reaches, ally or enemy.' },
  Bearer: { id: '7905603d-dce8-48ad-9932-7bd31ebeedce', text: 'The unit carrying the artifact.' },
  Carry: { id: '0071b464-5f55-4aaa-b959-f51ae80f902c', text: 'A carried artifact moves with the unit carrying it.' },
  'Pick Up': { id: '80001912-428c-45bc-bc04-296c848dc708', text: 'Once on your turn, a unit may pick up artifacts at its location.' },
  Drop: { id: '6f40e8ae-9b16-4a37-8401-ac5fa425cab1', text: 'Once on your turn, a unit that has not acted may put down artifacts it carries.' },
  Mana: { id: '72e711f6-ced0-4ff0-8386-e380e628f06f', text: 'Each site gives 1 mana on your turn. Unspent mana is lost.' },
  Cost: { id: 'a6a73d30-6b05-4402-b148-9eeaf88b4d0b', text: 'The mana needed to cast a spell or use an ability.' },
  Silence: { id: 'ad3816bb-9097-42bb-9231-4d9311f4a7e9', text: 'Loses its printed abilities and cannot cast spells; keeps abilities from other cards.' },
  Teleport: { id: '148ecc13-72e8-46eb-812f-2c6f3b37cd6d', text: 'Moved straight to another location without taking steps.' },
  Void: { id: '8371e6b3-dee7-4881-aa6b-063781c97be3', text: 'A square with no site. Minions there are banished unless they have Voidwalk.' },
  Rubble: { id: '1a435965-bf30-4c8e-8cd7-086e1ae44017', text: 'What a destroyed site leaves behind: a land site with no mana, controlled by nobody.' },
  'Foot Soldier': { id: '194b5249-57f1-49d6-8e41-71e734649053', text: 'A 1-power earth token minion.' },
  Skeleton: { id: '4d00cfac-df9c-417c-80c8-40bce04a46a8', text: 'A 1-power air token minion.' },
  Frog: { id: '11d10824-e4d9-4ac2-b6bd-d272dfe8ac59', text: 'A 0-power water token minion with Submerge.' },
  Wounded: { id: '65b32de9-b4a3-48e4-90ee-98cf67d4f2a6', text: 'A minion with damage this turn, or an Avatar below its maximum life.' },
  Stronger: { id: 'dcf0d619-240b-4529-b98a-0494075ea666', text: 'Compares power; strictly more (or less, for weaker).' },
  Random: { id: '49a7cb1a-443a-49f4-a5ed-a0c2a2f1b9cd', text: 'Each possible result is equally likely.' },
  Ally: { id: '040cd91a-60f2-4a12-bebc-b9bf482b9877', text: 'A unit controlled by the same player.' },
  Enemy: { id: '251c23c3-c934-4399-8edf-84fa24dcad8d', text: 'A unit controlled by the opponent.' },
  Unit: { id: '23d11ec6-41b3-42b7-9b44-23e881f7e780', text: 'Minions and Avatars.' },
  Conjure: { id: 'd5ceed50-8e0e-44da-8e18-749f179038c3', text: 'Put an artifact or aura into the realm.' },
  Dispel: { id: '52381b7c-b7bc-4f71-a21e-30f2cfa49015', text: 'An aura dies.' },
  'Lasts 3 of your turns': { id: '3315e2bf-73f5-4db2-833f-ed25d0bbd260', text: 'Count your end phases; at the third the aura is dispelled.' },
  'Activated ability': { id: 'c7f83847-8d96-4d13-a8df-a510ba603f1e', text: 'You pay its cost (tapping, mana) on your turn, in the main phase, to make it happen.' },
  'Triggered ability': { id: '511a6488-28f7-420b-80c4-fcf94993d050', text: 'Happens on its own when its condition is met (when, whenever, at …).' },
  Underground: { id: '018ccca1-61ce-47fc-8cf2-ad8c5740928b', text: 'Below the surface of a land site.' },
  Underwater: { id: 'da576642-eda0-4a44-98ed-e571f9f9a45e', text: 'Below the surface of a water site.' },
  Step: { id: '0f53b70d-d13a-4982-8c16-20bb4ab1aa9d', text: 'One move to a neighbouring location in the same region (diagonal only with Airborne).' },
  'Split power': { id: '7f64db2b-3903-4bbd-8d36-bfa53ce5faa8', text: 'Attack power / defense power. Strikes use the first, damage needed to die the second.' },
};

/** How a word in card text maps to a term above (lowercase match on whole words). */
const TERM_WORDS: [RegExp, string][] = [
  [/\btarget\b/i, 'Target'], [/\bcollection\b/i, 'Collection'], [/\blook at\b/i, 'Look at'], [/\b(drag|pull|push)/i, 'Forced movement'], [/\bcontrol\b/i, 'Control'], [/\baffected\b/i, 'Aura'],
  [/\bnearby\b|\bnear\b/i, 'Nearby'], [/\badjacent\b/i, 'Adjacent'], [/\bhere\b|\bthere\b/i, 'Here'], [/\batop\b/i, 'Atop'],
  [/\buntap/i, 'Untap'], [/\btap\b|\btaps\b|\btapped\b/i, 'Tap'], [/\bstrikes?\b/i, 'Strike'], [/\bdamage\b/i, 'Damage'],
  [/\bdefend/i, 'Defend'], [/\bintercept/i, 'Intercept'], [/death'?s door/i, "Death's Door"], [/death blow/i, 'Death Blow'],
  [/\bheal/i, 'Heal'], [/\bbanish/i, 'Banish'], [/\btokens?\b/i, 'Token'], [/\bsummon/i, 'Summon'], [/\bkill/i, 'Kill'], [/\bdestroy/i, 'Destroy'],
  [/\bsacrific/i, 'Sacrifice'], [/\bdiscard/i, 'Discard'], [/\bdraws?\b/i, 'Draw'], [/\bsearch/i, 'Search'], [/projectile|\bshoot/i, 'Projectile'],
  [/\bbearer\b/i, 'Bearer'], [/\bcarr(y|ies|ying)\b/i, 'Carry'], [/\bpick up\b/i, 'Pick Up'], [/\bdrop/i, 'Drop'], [/\bsilence/i, 'Silence'],
  [/\bteleport/i, 'Teleport'], [/\bvoid\b/i, 'Void'], [/\brubble\b/i, 'Rubble'], [/foot soldier/i, 'Foot Soldier'], [/\bskeleton/i, 'Skeleton'],
  [/\bfrogs?\b/i, 'Frog'], [/\bwounded\b/i, 'Wounded'], [/\bstrong|\bweak/i, 'Stronger'], [/\brandom/i, 'Random'], [/\ballies\b|\bally\b|\ballied\b/i, 'Ally'],
  [/\benem(y|ies)\b/i, 'Enemy'], [/\bconjur/i, 'Conjure'], [/\bdispel/i, 'Dispel'], [/lasts? \w+ of your turns/i, 'Lasts 3 of your turns'],
  [/underground|\bburrow/i, 'Underground'], [/underwater|\bsubmerge[ds]\b/i, 'Underwater'], [/\bsteps?\b/i, 'Step'],
];
export interface Explained { term: string; text: string; url: string; keyword: boolean }
/** Keywords and rule terms that appear in a piece of card text, each with its reminder and Codex link. */
export function explainTerms(text: string, keywords: string[] = []): Explained[] {
  const out: Explained[] = []; const seen = new Set<string>();
  for (const k of [...keywords, ...Object.keys(KEYWORD_HELP).filter((k) => k !== 'Threshold' && new RegExp(`\\b${k}`, 'i').test(text))]) {
    if (seen.has(k) || !KEYWORD_HELP[k]) continue; seen.add(k);
    out.push({ term: k, text: KEYWORD_HELP[k].text, url: codexUrl(k), keyword: true });
  }
  for (const [re, term] of TERM_WORDS) {
    if (seen.has(term) || !re.test(text)) continue; seen.add(term);
    out.push({ term, text: RULE_TERMS[term].text, url: `${CODEX_INDEX}/${RULE_TERMS[term].id}`, keyword: false });
  }
  return out;
}
