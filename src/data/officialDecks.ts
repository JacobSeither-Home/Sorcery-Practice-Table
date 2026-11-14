// Official preconstructed decks, bundled as card names and counts and resolved against the synced
// card pool at run time. No card data or art lives here: a list only becomes a playable deck once
// Card Sync has brought in the cards it names.
// Each list must come from an official source (product insert or Erik's Curiosa's published list).
import type { CardDef, DeckList } from '../engine';

export interface OfficialDeck { name: string; product: string; source: string; avatar: string; spellbook: [number, string][]; atlas: [number, string][]; /** Codex "Collection": the product's listed extra cards outside the two decks */ collection?: [number, string][] }
// Beta elemental precons (36 spells, 16 sites each). Transcribed on 2026-11-10 from the decklist
// images in Erik's Curiosa's announcement: https://sorcerytcg.com/news/introducing-the-beta-elemental-preconstructed-decks
// Every name was checked against the card API that day; section counts match the images' headers.
const BETA = 'Beta Preconstructed Deck';
const SRC = 'https://sorcerytcg.com/news/introducing-the-beta-elemental-preconstructed-decks';
const BETA_DECKS: OfficialDeck[] = [
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

// Gothic preconstructed decks (36 spells, 16 sites, plus the product's collection cards).
// Transcribed on 2026-11-13 from the official deck pages, supplied by Jacob as screenshots — the app
// never reads sorcerytcg.com. The four pages are:
//   https://sorcerytcg.com/decks/cmip2vh9y00kal204778yzvbd
//   https://sorcerytcg.com/decks/cmip2v28500k6l204a5bxo5oh
//   https://sorcerytcg.com/decks/cmip2vwc100khl2043cgtpae7
//   https://sorcerytcg.com/decks/cmip2w8qa002mjl04intv339z
// Which URL serves which Avatar was not recorded, so GOTHIC_SRC lists them together.
// Every name, card type and copy limit was checked against the 1,169-card API pool that day, and each
// section total was reconciled against the header counts on the pages.
const GOTHIC = 'Gothic Preconstructed Deck';
const GOTHIC_SRC = 'https://sorcerytcg.com/decks (Gothic precon deck pages)';
const GOTHIC_DECKS: OfficialDeck[] = [
  { name: 'Gothic Precon: Harbinger', product: GOTHIC, source: GOTHIC_SRC, avatar: 'Harbinger',
    spellbook: [[1, 'Aaj-kegon Ghost Crabs'], [2, 'Forsaken'], [2, 'Sea Witch'], [1, 'Static Servant'], [2, 'Willing Tribute'], [2, 'Mesmer Demon'], [2, 'Nommo Monitor'], [2, 'Bound Spirit'], [1, 'Frozen Horror'],
      [1, 'Lacuna Entity'], [1, 'Regurgitator'], [1, 'Slimy Mutants'], [1, 'Gnarled Wendigo'], [1, 'Hearkening Kraken'], [2, 'Shoggoth'], [1, 'Dormant Monstrosity'], [2, 'Ten-tonne Slug'], [1, 'Yog-Sothoth'],
      [2, 'Gift of the Frog'], [2, 'Ice Shards'], [1, 'Monstermorphosis'], [1, 'Swap'], [1, 'Abyssal Assault'], [1, 'Into the Abyss'], [1, 'Call of the Sea'],
      [1, 'Falling Star']],
    atlas: [[1, 'Accursed Tower'], [1, 'Algae Bloom'], [2, 'Croaking Swamp'], [1, 'Dark Alley'], [1, 'Deep Sea'], [1, 'Den of Evil'], [1, 'Elder Ruins'], [1, 'Peculiar Port'], [2, 'Spire'], [2, 'Stinging Kelp'], [2, 'Stream'], [1, 'Twilight Bloom']],
    collection: [[1, 'Horrible Hybrids'], [2, 'Shoggoth']] },
  { name: 'Gothic Precon: Persecutor', product: GOTHIC, source: GOTHIC_SRC, avatar: 'Persecutor',
    spellbook: [[1, 'Holy Water'], [1, 'Blade of Thorns'], [1, 'Peacemaker Arbalest'],
      [1, 'One-shot Wizard'], [1, 'Flagellant'], [1, 'Flaming Skull'], [2, 'Holy Warrior'], [1, 'Kissers of Wounds'], [2, 'Lesser Blood Demon'], [1, 'Redmane Hyena'], [2, 'Wild Fanatic'], [1, 'Intrepid Hero'],
      [1, 'Martyrs of Tomorrow'], [1, 'Màzuj Ifrit'], [1, 'Angry Mob'], [1, 'Fallen Angel'], [1, 'Flayer'], [1, 'Greater Blood Demon'], [1, 'Shackled Demon'], [2, 'Zeppelin of Zealots'], [1, 'Cherubim'], [1, 'Undesirables'],
      [2, 'Bind Evil'], [1, 'Blaze of Glory'], [2, 'Flame Strike'], [1, 'Lash'], [2, 'Trial by Fire'], [1, 'Wreathed in Righteousness'], [1, 'Release the Hounds']],
    atlas: [[1, 'Active Volcano'], [1, 'Autumn Bloom'], [1, 'Blessed Village'], [1, 'Consecrated Ground'], [2, 'Desert Bloom'], [1, 'Hillside Chapel'], [1, 'Molten Maar'], [1, 'Purgatory'], [1, 'Road to Perdition'], [2, 'Valley'], [2, 'Vast Desert'], [2, 'Wasteland']],
    collection: [[3, 'Hellhounds']] },
  { name: 'Gothic Precon: Necromancer', product: GOTHIC, source: GOTHIC_SRC, avatar: 'Necromancer',
    spellbook: [[1, 'Panpipes of Pnom'], [1, 'Corpse Catapult'],
      [1, 'Bone Jumble'], [2, 'Fowl Bones'], [1, 'Bitter Departed'], [2, 'Ignited'], [2, 'Novice Necromancer'], [1, 'Noxious Corpse'], [1, 'Khamaseen Mummy'], [1, 'Order of the Pale Worm'], [3, 'Screamer'],
      [2, 'Snallygaster'], [1, 'Stygian Archers'], [2, 'Hotwheel'], [1, 'Dreadwing'], [1, 'Master Necromancer'], [1, 'Vesper Swarm'], [1, 'Those Who Linger'], [1, 'Draconian Bonekite'], [1, 'Stitched Abomination'],
      [3, 'Bone Spear'], [1, 'Detonate'], [1, 'Carrionette'], [2, 'Kiss of Death'], [1, 'Witching Hour'], [1, 'Necronomiconcert']],
    atlas: [[1, 'Accursed Desert'], [1, 'Accursed Tower'], [1, 'Darkest Dungeon'], [1, 'Den of Evil'], [1, 'Desert Bloom'], [1, 'Dread Thicket'], [1, 'Forsaken Crypt'], [2, 'Open Mausoleum'], [1, 'Sold-out Cemetery'], [2, 'Spire'], [1, 'Twilight Bloom'], [1, 'Vast Desert'], [2, 'Wasteland']],
    collection: [[2, 'Ghoul']] },
  { name: 'Gothic Precon: Savior', product: GOTHIC, source: GOTHIC_SRC, avatar: 'Savior',
    spellbook: [[1, 'Flame of the First Ones'], [1, 'Makeshift Barricade'],
      [1, 'Eltham Townsfolk'], [2, 'Revered Revenant'], [1, 'Serava Townsfolk'], [1, 'Town Priest'], [1, 'Angel Ascendant'], [2, 'Muddy Pigs'], [2, 'Survivors of Serava'], [2, 'Virgin in Prayer'],
      [1, 'Mayor of Milborne'], [1, 'Nightwatchmen'], [1, 'Order of the White Wing'], [1, 'Rowdy Boys'], [3, 'Search Party'], [1, 'Guardian Angel'], [2, 'Monks of Kobalsa'], [2, 'Weathered Trunks'],
      [1, 'Faith Incarnate'], [1, 'Malakhim'],
      [1, 'Enduring Faith'], [1, 'Wave of Eviction'], [1, 'Baptize'], [1, 'Divine Lance'], [1, 'Holy Nova'], [2, 'Smite'], [1, 'Golden Dawn']],
    atlas: [[1, 'Algae Bloom'], [2, 'Autumn Bloom'], [2, 'Blessed Village'], [1, 'Blessed Well'], [1, 'Consecrated Ground'], [1, 'Fertile Earth'], [1, 'Forlorn Keep'], [1, 'Mudslide'], [2, 'Stream'], [2, 'Troubled Town'], [2, 'Valley']],
    collection: [[1, 'Eltham Townsfolk'], [1, 'Serava Townsfolk'], [1, 'Penitent Knight']] },
];

export const OFFICIAL_DECKS: OfficialDeck[] = [...BETA_DECKS, ...GOTHIC_DECKS];

export interface ResolvedDeck { deck: DeckList; product: string; missing: string[] }
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export function resolveOfficial(pool: Record<string, CardDef>, list: OfficialDeck[] = OFFICIAL_DECKS): ResolvedDeck[] {
  const byName = new Map<string, string>();
  for (const c of Object.values(pool)) if (c.source === 'api') byName.set(norm(c.name), c.id);
  return list.map((o) => {
    const missing: string[] = [];
    const id = (n: string) => { const v = byName.get(norm(n)); if (!v) missing.push(n); return v; };
    const expand = (rows: [number, string][]) => rows.flatMap(([k, n]) => { const v = id(n); return v ? Array(k).fill(v) : []; });
    const collection = o.collection ? expand(o.collection) : [];
    return { deck: { name: o.name, avatar: id(o.avatar) ?? '', spellbook: expand(o.spellbook), atlas: expand(o.atlas), ...(collection.length ? { collection } : {}) }, product: o.product, missing };
  });
}
export const isOfficialDeck = (name: string) => OFFICIAL_DECKS.some((d) => d.name === name);
