// Official preconstructed decks, bundled as card names and counts and resolved against the synced
// card pool at run time. No card data or art lives here: a list only becomes a playable deck once
// Card Sync has brought in the cards it names.
// Each list must come from an official source (product insert or Erik's Curiosa's published list).
import type { CardDef, DeckList } from '../engine';

export interface OfficialDeck { name: string; product: string; source: string; avatar: string; spellbook: [number, string][]; atlas: [number, string][] }
// Beta elemental precons (36 spells, 16 sites each). Transcribed on 2026-11-10 from the decklist
// images in Erik's Curiosa's announcement: https://sorcerytcg.com/news/introducing-the-beta-elemental-preconstructed-decks
// Every name was checked against the card API that day; section counts match the images' headers.
const BETA = 'Beta Preconstructed Deck';
const SRC = 'https://sorcerytcg.com/news/introducing-the-beta-elemental-preconstructed-decks';
export const OFFICIAL_DECKS: OfficialDeck[] = [
  { name: 'Beta Precon: Air (Sparkmage)', product: BETA, source: SRC, avatar: 'Sparkmage',
    spellbook: [[1, 'Sling Pixies'], [2, 'Snow Leopard'], [2, 'Cloud Spirit'], [2, 'Dead of Night Demon'], [2, 'Spectral Stalker'], [2, 'Headless Haunt'], [1, 'Kite Archer'], [2, 'Midnight Rogue'], [2, 'Plumed Pegasus'],
      [1, 'Spire Lich'], [2, 'Apprentice Wizard'], [1, 'Gyre Hippogriffs'], [1, 'Skirmishers of Mu'], [1, 'Roaming Monster'], [1, 'Nimbus Jinn'], [1, 'Grandmaster Wizard'], [1, 'Highland Clansmen'],
      [3, 'Lightning Bolt'], [2, 'Blink'], [1, 'Teleport'], [2, 'Chain Lightning'], [1, 'Raise Dead'], [1, 'Thunderstorm'], [1, 'Lucky Charm']],
    atlas: [[3, 'Gothic Tower'], [3, 'Dark Tower'], [3, 'Lone Tower'], [2, 'Mountain Pass'], [2, 'Updraft Ridge'], [1, 'Observatory'], [1, 'Planar Gate'], [1, 'Cloud City']] },
  { name: 'Beta Precon: Earth (Geomancer)', product: BETA, source: SRC, avatar: 'Geomancer',
    spellbook: [[2, 'Wild Boars'], [2, 'Land Surveyor'], [2, 'Scent Hounds'], [3, 'Belmotte Longbowmen'], [3, 'Cave Trolls'], [2, 'Autumn Unicorn'], [1, 'Slumbering Giantess'], [1, 'Pudge Butcher'], [2, 'House Arn Bannerman'],
      [1, 'Dalcean Phalanx'], [2, 'Amazon Warriors'], [1, 'Wraetannis Titan'], [1, 'King of the Realm'], [1, 'Mountain Giant'],
      [2, 'Overpower'], [1, 'Divine Healing'], [1, 'Border Militia'], [2, 'Bury'], [1, 'Cave-In'], [1, 'Craterize'], [1, 'Entangle Terrain'], [1, 'Siege Ballista'], [1, 'Rolling Boulder'], [1, 'Payload Trebuchet']],
    atlas: [[3, 'Humble Village'], [3, 'Rustic Village'], [3, 'Simple Village'], [2, 'Vantage Hills'], [2, 'Quagmire'], [1, 'Bedrock'], [1, 'Holy Ground'], [1, 'Sinkhole']] },
  { name: 'Beta Precon: Fire (Flamecaller)', product: BETA, source: SRC, avatar: 'Flamecaller',
    spellbook: [[2, 'Raal Dromedary'], [2, 'Pit Vipers'], [1, 'Lava Salamander'], [2, 'Rimland Nomads'], [2, 'Sacred Scarabs'], [2, 'Wayfaring Pilgrim'], [1, 'Colicky Dragonettes'], [3, 'Ogre Goons'], [1, 'Quarrelsome Kobolds'],
      [1, 'Clamor of Harpies'], [1, 'Petrosian Cavalry'], [2, 'Sand Worm'], [1, 'Hillock Basilisk'], [1, 'Askelon Phoenix'], [1, 'Infernal Legion'], [1, 'Escyllion Cyclops'],
      [2, 'Firebolts'], [1, 'Mad Dash'], [1, 'Blaze'], [1, 'Heat Ray'], [2, 'Minor Explosion'], [1, 'Fireball'], [1, 'Incinerate'], [1, 'Cone of Flame'], [1, 'Major Explosion'], [1, 'Wildfire']],
    atlas: [[4, 'Arid Desert'], [4, 'Red Desert'], [4, 'Remote Desert'], [2, 'Shifting Sands'], [1, 'Vesuvius'], [1, 'Cornerstone']] },
  { name: 'Beta Precon: Water (Waveshaper)', product: BETA, source: SRC, avatar: 'Waveshaper',
    spellbook: [[1, 'Sedge Crabs'], [2, 'Swamp Buffalo'], [1, 'Porcupine Pufferfish'], [2, 'Tide Naiads'], [1, 'Swan Maidens'], [2, 'Polar Bears'], [2, 'Coral-Reef Kelpie'], [1, 'Brobdingnag Bullfrog'], [2, 'Deep-Sea Mermaids'],
      [1, 'Guile Sirens'], [1, 'Tufted Turtles'], [2, 'Sea Serpent'], [2, 'Pirate Ship'], [2, 'Anui Undine'], [1, 'Seirawan Hydra'], [1, 'Diluvian Kraken'],
      [2, 'Riptide'], [2, 'Drown'], [2, 'Ice Lance'], [1, 'Font of Life'], [1, 'Stormy Seas'], [1, 'Wrath of the Sea'], [1, "Mariner's Curse"], [1, 'Flood'], [1, 'Sunken Treasure']],
    atlas: [[3, 'Autumn River'], [3, 'Spring River'], [3, 'Summer River'], [3, 'Undertow'], [2, 'Floodplain'], [1, 'Maelström'], [1, 'Island Leviathan']] },
];

export interface ResolvedDeck { deck: DeckList; product: string; missing: string[] }
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export function resolveOfficial(pool: Record<string, CardDef>, list: OfficialDeck[] = OFFICIAL_DECKS): ResolvedDeck[] {
  const byName = new Map<string, string>();
  for (const c of Object.values(pool)) if (c.source === 'api') byName.set(norm(c.name), c.id);
  return list.map((o) => {
    const missing: string[] = [];
    const id = (n: string) => { const v = byName.get(norm(n)); if (!v) missing.push(n); return v; };
    const expand = (rows: [number, string][]) => rows.flatMap(([k, n]) => { const v = id(n); return v ? Array(k).fill(v) : []; });
    return { deck: { name: o.name, avatar: id(o.avatar) ?? '', spellbook: expand(o.spellbook), atlas: expand(o.atlas) }, product: o.product, missing };
  });
}
export const isOfficialDeck = (name: string) => OFFICIAL_DECKS.some((d) => d.name === name);
