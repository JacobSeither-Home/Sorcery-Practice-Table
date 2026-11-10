// TEST FIXTURES ONLY. Not shipped in the app.
// Placeholder cards. These are ORIGINAL placeholder cards written for this app so that the
// table works before a Card Sync and so that tests have fixtures. They are not Sorcery cards and
// carry no Erik's Curiosa names, text, or art.
import { makeCard } from '../../src/engine/cards';
import type { CardDef, DeckList, Effect } from '../../src/engine/types';

const c = (name: string, type: CardDef['type'], cost: number, th: Partial<CardDef['thresholds']>, atk: number, def: number, keywords: string[], rules: string, effects: Effect[] = [], extra: Partial<CardDef> = {}) =>
  makeCard({ id: 'practice:' + name.toLowerCase().replace(/[^a-z]+/g, '-'), name, type, cost, thresholds: th as CardDef['thresholds'], attack: atk, defense: def, keywords, rules, effects, source: 'practice', typeline: `Practice ${type}`, ...extra });

export const PRACTICE_CARDS: CardDef[] = [
  c('Hearth Warden', 'Avatar', 0, {}, 1, 1, [], 'Tap: Play or draw a site.', [], { life: 20 }),
  c('Tide Seer', 'Avatar', 0, {}, 1, 1, [], 'Tap: Play or draw a site.', [], { life: 20 }),
  c('Cinder Field', 'Site', 0, { fire: 1 }, 0, 0, [], ''),
  c('Stone Terrace', 'Site', 0, { earth: 1 }, 0, 0, [], ''),
  c('Mill Pond', 'Site', 0, { water: 1 }, 0, 0, [], ''),
  c('Gale Ridge', 'Site', 0, { air: 1 }, 0, 0, [], ''),
  c('Ember Runner', 'Minion', 1, { fire: 1 }, 2, 2, ['Charge'], 'Charge'),
  c('Ash Archer', 'Minion', 2, { fire: 1 }, 2, 2, ['Ranged'], 'Ranged 1'),
  c('Kiln Brute', 'Minion', 3, { fire: 1 }, 4, 4, [], ''),
  c('Pyre Drake', 'Minion', 5, { fire: 2 }, 5, 5, ['Airborne'], 'Airborne'),
  c('Burrow Mole', 'Minion', 2, { earth: 1 }, 2, 2, ['Burrowing'], 'Burrowing'),
  c('Root Stalker', 'Minion', 2, { earth: 1 }, 2, 2, ['Stealth'], 'Stealth'),
  c('Granite Guard', 'Minion', 3, { earth: 1 }, 2, 5, [], ''),
  c('Hill Giant', 'Minion', 6, { earth: 2 }, 7, 7, [], ''),
  c('Reed Lurker', 'Minion', 2, { water: 1 }, 2, 2, ['Submerge'], 'Submerge'),
  c('Venom Eel', 'Minion', 3, { water: 1 }, 1, 3, ['Lethal'], 'Lethal'),
  c('Tide Caller', 'Minion', 3, { water: 1 }, 2, 3, ['Spellcaster', 'Genesis'], 'Spellcaster\nGenesis → Draw a spell.', [{ on: 'genesis', op: 'draw', n: 1, who: 'controller', deck: 'spellbook' }]),
  c('Deep Leviathan', 'Minion', 6, { water: 2 }, 6, 6, ['Submerge'], 'Submerge'),
  c('Wind Sprite', 'Minion', 1, { air: 1 }, 1, 1, ['Airborne'], 'Airborne'),
  c('Sky Courier', 'Minion', 2, { air: 1 }, 2, 2, ['Movement'], 'Movement +1'),
  c('Cloud Lancer', 'Minion', 3, { air: 1 }, 3, 3, ['Lance'], 'Lance'),
  c('Storm Roc', 'Minion', 5, { air: 2 }, 4, 4, ['Airborne', 'Movement'], 'Airborne, Movement +1'),
  c('Firebolt', 'Magic', 2, { fire: 1 }, 0, 0, [], 'Deal 3 damage to target nearby unit.', [{ on: 'cast', op: 'damage', n: 3, who: 'target', range: 'nearby' }]),
  c('Mend', 'Magic', 1, { earth: 1 }, 0, 0, [], 'Gain 3 life.', [{ on: 'cast', op: 'heal', n: 3, who: 'controller' }]),
  c('Insight', 'Magic', 2, { water: 1 }, 0, 0, [], 'Draw two spells.', [{ on: 'cast', op: 'draw', n: 2, who: 'controller', deck: 'spellbook' }]),
  c('Gust Strike', 'Magic', 1, { air: 1 }, 0, 0, [], 'Deal 2 damage to target nearby unit.', [{ on: 'cast', op: 'damage', n: 2, who: 'target', range: 'nearby' }]),
  c('Unmake', 'Magic', 4, {}, 0, 0, [], 'Destroy target adjacent minion.', [{ on: 'cast', op: 'destroy', who: 'target', range: 'adjacent' }]),
  c('Old Lantern', 'Artifact', 1, {}, 0, 0, [], 'Genesis → Gain 1 mana.', [{ on: 'genesis', op: 'mana', n: 1, who: 'controller' }]),
  c('Chalk Circle', 'Aura', 2, {}, 0, 0, [], 'No automated effect. Use it to practice the manual tools.'),
];

const id = (name: string) => PRACTICE_CARDS.find((x) => x.name === name)!.id;
const rep = (name: string, n: number) => Array(n).fill(id(name));

export const PRACTICE_DECKS: DeckList[] = [
  {
    name: 'Practice: Hearth & Stone', avatar: id('Hearth Warden'),
    atlas: [...rep('Cinder Field', 8), ...rep('Stone Terrace', 8)],
    spellbook: [...rep('Ember Runner', 4), ...rep('Ash Archer', 3), ...rep('Kiln Brute', 3), ...rep('Pyre Drake', 2), ...rep('Burrow Mole', 3), ...rep('Root Stalker', 3),
      ...rep('Granite Guard', 3), ...rep('Hill Giant', 2), ...rep('Firebolt', 4), ...rep('Mend', 2), ...rep('Unmake', 1), ...rep('Old Lantern', 2)],
  },
  {
    name: 'Practice: Tide & Gale', avatar: id('Tide Seer'),
    atlas: [...rep('Mill Pond', 8), ...rep('Gale Ridge', 8)],
    spellbook: [...rep('Wind Sprite', 4), ...rep('Sky Courier', 3), ...rep('Cloud Lancer', 3), ...rep('Storm Roc', 2), ...rep('Reed Lurker', 3), ...rep('Venom Eel', 3),
      ...rep('Tide Caller', 3), ...rep('Deep Leviathan', 2), ...rep('Gust Strike', 4), ...rep('Insight', 2), ...rep('Unmake', 1), ...rep('Chalk Circle', 2)],
  },
];
