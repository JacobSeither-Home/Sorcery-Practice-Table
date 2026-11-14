// Rulebook and Codex behaviours, pinned. Started as the 2026-11-13 audit's probes (each asserted a defect);
// a probe is inverted to assert the rule once its defect is fixed. Page numbers are the October 2024 rulebook
// (SorceryRulebook.pdf on Google Drive, modified 2026-10-12); Codex entries are cited by name.
import { describe, expect, it } from 'vitest';
import { PRACTICE_CARDS, PRACTICE_DECKS } from './fixtures/practiceSet';
import type { CardDef, GameState, PlayerId, Unit } from '../src/engine/types';
import { makeCard } from '../src/engine/cards';
import { apply, check, createGame, legalActions, targetsFor, cell, regionOf } from '../src/engine/rules';

const cards: Record<string, CardDef> = Object.fromEntries(PRACTICE_CARDS.map((c) => [c.id, c]));
const id = (name: string) => PRACTICE_CARDS.find((c) => c.name === name)!.id;
const T = (name: string, type: CardDef['type'], extra: Partial<CardDef> = {}) => {
  const c = makeCard({ name, type, ...extra }); cards[c.id] = c; return c.id;
};
function start(first: PlayerId = 0): GameState {
  let s = createGame(cards, [PRACTICE_DECKS[0], PRACTICE_DECKS[1]], 42, first);
  s = apply(s, { t: 'mulligan', cards: [] });
  return apply(s, { t: 'mulligan', cards: [] });
}
function site(s: GameState, p: PlayerId, c: number, name = p === 0 ? 'Cinder Field' : 'Mill Pond') {
  const k = `${p}t${Object.keys(s.inst).length}`; s.inst[k] = id(name);
  // a site put down by hand during setup is not "gained mid-turn": count it in the turn's income so it adds no mana
  if (s.sites[c]?.owner !== p && s.players[p].income !== undefined) s.players[p].income! += 1;
  s.sites[c] = { inst: k, owner: p };
}
function unit(s: GameState, p: PlayerId, c: number, cardId: string, o: Partial<Unit> = {}): string {
  const k = `${p}u${Object.keys(s.inst).length}`; s.inst[k] = cardId; const uid = `u${s.nextId++}`;
  s.units[uid] = { id: uid, inst: k, owner: p, c, r: 'surface', tapped: false, damage: 0, enteredTurn: 0, avatar: false, stealthLost: false, lance: false, ...o };
  return uid;
}
function give(s: GameState, p: PlayerId, cardId: string): string {
  const k = `${p}x${Object.keys(s.inst).length}`; s.inst[k] = cardId; s.players[p].hand.push(k); return k;
}

describe('AUDIT: end phase', () => {
  it('clears damage from both players\' minions (p16 End Phase step 2: "Players remove all damage")', () => {
    let s = start(0);
    const mine = unit(s, 0, cell(2, 3), id('Kiln Brute'), { damage: 2 });
    const theirs = unit(s, 1, cell(2, 0), id('Kiln Brute'), { damage: 2 });
    s = apply(s, { t: 'endTurn' });
    expect(s.units[mine].damage).toBe(0);      // active player's: cleared
    expect(s.units[theirs].damage).toBe(0);    // opponent's too
  });
});

describe('AUDIT: storyline order', () => {
  it('puts the non-active player\'s competing trigger first (p31 Triggered Abilities)', () => {
    let s = start(0);
    const watcher = T('Watcher', 'Minion', {
      attack: 2, defense: 2,
      effects: [{ on: 'dies', op: 'damage', n: 1, who: 'target', range: 'any', ev: { minion: true }, targets: true }],
    });
    site(s, 0, cell(2, 3)); site(s, 1, cell(2, 2), 'Mill Pond');
    unit(s, 0, cell(2, 3), watcher);          // active player's watcher
    unit(s, 1, cell(2, 2), watcher);          // non-active player's watcher
    const victim = unit(s, 1, cell(2, 2), id('Wind Sprite'));
    s = apply(s, { t: 'manual', op: 'destroy', unit: victim });
    expect(s.queue?.length).toBe(2);
    expect(s.queue![0].by).toBe(1);           // the non-active player's goes first
  });
});

describe('AUDIT: regions', () => {
  it('keeps underground and underwater apart (p13, p15: four regions; Codex "Region")', () => {
    const s = start(0);
    site(s, 0, cell(2, 2), 'Cinder Field');   // land
    site(s, 1, cell(3, 2), 'Mill Pond');      // water, adjacent
    unit(s, 0, cell(2, 2), id('Burrow Mole'), { r: 'under' });
    unit(s, 1, cell(3, 2), id('Reed Lurker'), { r: 'under' });
    const eel = Object.values(s.units).find((u) => u.owner === 1 && u.r === 'under')!.id;
    const bolt = cards[id('Firebolt')];
    const hits = targetsFor(s, 0, bolt, 0, [{ c: cell(2, 2), r: 'under' }]);
    expect(regionOf(s, s.units[eel])).toBe('underwater');
    expect(hits).not.toContain(eel);          // p15: not adjacent across regions; p35 Target: same region
  });

  it('puts void-dwelling units in the void region (p13, p35 "Void")', () => {
    const s = start(0);
    site(s, 0, cell(2, 2), 'Cinder Field');
    const walker = T('Void Walker', 'Minion', { attack: 2, defense: 2, keywords: ['Voidwalk'] });
    const inVoid = unit(s, 1, cell(2, 1), walker);   // cell(2,1) has no site
    expect(regionOf(s, s.units[inVoid])).toBe('void');
    const bolt = cards[id('Firebolt')];
    const hits = targetsFor(s, 0, bolt, 0, [{ c: cell(2, 2), r: 'surface' }]);
    expect(hits).not.toContain(inVoid);       // not targetable from the surface
  });
});

describe('AUDIT: movement', () => {
  it('takes the legal steps of a declared path and skips an illegal one (p21)', () => {
    let s = start(0);
    site(s, 0, cell(2, 3)); site(s, 0, cell(2, 2), 'Cinder Field');
    const u = unit(s, 0, cell(2, 3), id('Sky Courier'));  // Movement +1 => 2 steps
    const r = check(s, { t: 'move', unit: u, path: [{ c: cell(2, 2), r: 'surface' }, { c: cell(2, 1), r: 'surface' }] });
    expect(r.ok).toBe(true);                  // cell(2,1) is void: that step will be skipped
    s = apply(s, { t: 'move', unit: u, path: [{ c: cell(2, 2), r: 'surface' }, { c: cell(2, 1), r: 'surface' }] });
    expect(s.units[u].c).toBe(cell(2, 2));    // took the first step only
    expect(check(s, { t: 'move', unit: unit(s, 0, cell(2, 2), id('Kiln Brute')), path: [{ c: cell(2, 1), r: 'surface' }] }).ok).toBe(false); // nothing legal: refused, with the reason
  });

  it('fires "enters" for squares passed through (p28: entered even momentarily)', () => {
    let s = start(0);
    const sentry = T('Sentry', 'Minion', {
      attack: 1, defense: 1,
      effects: [{ on: 'enters', op: 'damage', n: 1, who: 'target', range: 'any', ev: { side: 'enemy', minion: true, range: 'here' }, targets: true }],
    });
    for (const c of [cell(2, 3), cell(2, 2), cell(2, 1)]) site(s, 0, c, 'Cinder Field');
    unit(s, 1, cell(2, 2), sentry);           // sits on the square passed through
    const u = unit(s, 0, cell(2, 3), id('Sky Courier'));
    s = apply(s, { t: 'move', unit: u, path: [{ c: cell(2, 2), r: 'surface' }, { c: cell(2, 1), r: 'surface' }] });
    expect(s.units[u].c).toBe(cell(2, 1));
    expect(s.queue?.length ?? 0).toBe(1);     // the sentry saw it pass
  });

  it('allows coming back to a location; only repeating a step is refused (p21)', () => {
    const s = start(0);
    for (const c of [cell(2, 3), cell(1, 3), cell(1, 2), cell(2, 2)]) site(s, 0, c, 'Cinder Field');
    const u = unit(s, 0, cell(2, 3), id('Sky Courier'), { mods: [{ atk: 0, def: 0, move: 2, from: 'test' }] });
    // a 4-step loop back to the start repeats no step
    const loop = [cell(1, 3), cell(1, 2), cell(2, 2), cell(2, 3)].map((c) => ({ c, r: 'surface' as const }));
    expect(check(s, { t: 'move', unit: u, path: loop }).ok).toBe(true);
    const back = [cell(1, 3), cell(2, 3), cell(1, 3)].map((c) => ({ c, r: 'surface' as const })); // repeats the step 2,3 -> 1,3
    expect(check(s, { t: 'move', unit: u, path: back }).ok).toBe(false);
  });
});

describe('damage allocation', () => {
  it('the attacker\'s controller splits its strike among several enemies (p23 Multiple Combatants; Codex "Fight")', () => {
    let s = start(0);
    site(s, 0, cell(2, 3)); site(s, 1, cell(2, 2), 'Mill Pond');
    const atk = unit(s, 0, cell(2, 3), id('Pyre Drake'));        // 5 power, Airborne
    const weak = unit(s, 1, cell(2, 2), id('Wind Sprite'));      // 1/1 Airborne
    const tough = unit(s, 1, cell(2, 2), id('Storm Roc'));       // 4/4 Airborne
    s = apply(s, { t: 'move', unit: atk, path: [{ c: cell(2, 2), r: 'surface' }], attack: { unit: weak } });
    expect(s.pending?.kind).toBe('defend');
    s = apply(s, { t: 'respond', units: [tough] });
    expect(s.pending?.kind).toBe('allocate');                    // the attacker's player chooses
    expect(s.pending?.by).toBe(0);
    expect(check(s, { t: 'allocate', split: { [weak]: 1, [tough]: 3 } }).ok).toBe(false); // must add up to 5
    s = apply(s, { t: 'allocate', split: { [weak]: 0, [tough]: 5 } }); // all on the Roc; the Sprite gets 0
    expect(s.pending).toBe(null);
    expect(s.units[weak]).toBeDefined();
    expect(s.units[tough]).toBeUndefined();
  });
  it('a single enemy takes the whole strike with no prompt', () => {
    let s = start(0);
    site(s, 0, cell(2, 3)); site(s, 1, cell(2, 2), 'Mill Pond');
    const atk = unit(s, 0, cell(2, 3), id('Pyre Drake'));
    const weak = unit(s, 1, cell(2, 2), id('Storm Roc'), { tapped: true });
    s = apply(s, { t: 'move', unit: atk, path: [{ c: cell(2, 2), r: 'surface' }], attack: { unit: weak } });
    expect(s.pending).toBe(null);
    expect(s.units[weak]).toBeUndefined();
  });
});

describe('AUDIT: mana', () => {
  it('follows mana sources lost mid-turn (Codex "Mana"; the Oct 2024 rulebook p17 said otherwise)', () => {
    let s = start(0);
    for (const c of [cell(2, 3), cell(1, 3), cell(3, 3)]) site(s, 0, c, 'Cinder Field');
    s.players[0].mana = 3;
    const quake = T('Quake', 'Magic', { cost: 0, effects: [{ on: 'cast', op: 'destroySite', who: 'atTarget', range: 'any' }] });
    const inst = give(s, 0, quake);
    s = apply(s, { t: 'cast', inst, choices: [{ cell: cell(1, 3) }] });
    expect(s.sites[cell(1, 3)]!.inst).toBe(null);                // destroyed, now rubble
    expect(s.players[0].mana).toBe(2);                           // one source fewer
  });
});

describe('AUDIT: keyword edges', () => {
  it('does not ward an Evil minion (Codex "Ward", "Evil")', () => {
    let s = start(0);
    site(s, 0, cell(2, 3));
    const evil = T('Evil Thing', 'Minion', { attack: 2, defense: 2, subtypes: ['Evil'] });
    const u = unit(s, 0, cell(2, 3), evil);
    const bless = T('Bless', 'Magic', { cost: 0, effects: [{ on: 'cast', op: 'grant', who: 'target', range: 'any', keyword: 'Ward', until: 'permanent' }] });
    const inst = give(s, 0, bless);
    s = apply(s, { t: 'cast', inst, choices: [{ target: u }] });
    expect(s.units[u].ward ?? false).toBe(false);
  });

  it('loses Stealth when the minion uses an activated ability (p34 "Stealth"; Codex "Interact")', () => {
    let s = start(0);
    site(s, 0, cell(2, 3));
    const sneak = T('Sneak', 'Minion', {
      attack: 2, defense: 2, keywords: ['Stealth'],
      effects: [{ on: 'tap', op: 'mana', n: 1, who: 'controller' }],
    });
    const u = unit(s, 0, cell(2, 3), sneak);
    s = apply(s, { t: 'ability', src: { unit: u }, fx: 0 });
    expect(s.units[u].stealthLost).toBe(true);
  });

  it('lets a Voidwalk minion step from the void straight to a subsurface it can live in (p35, Codex "Voidwalk")', () => {
    const s = start(0);
    site(s, 0, cell(2, 2), 'Cinder Field');                      // land site next to the void
    const walker = T('Walker', 'Minion', { attack: 2, defense: 2, keywords: ['Voidwalk', 'Burrowing'] });
    const u = unit(s, 0, cell(2, 1), walker);                    // in the void
    expect(check(s, { t: 'move', unit: u, path: [{ c: cell(2, 2), r: 'surface' }] }).ok).toBe(true);
    expect(check(s, { t: 'move', unit: u, path: [{ c: cell(2, 2), r: 'under' }] }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Card-level probes, added after pulling the live pool (1,169 cards) on 2026-11-13.
// These use synthetic CardAPIDTO shapes so they do not need a cards.json on disk.
// ---------------------------------------------------------------------------
import { normalizeApiCards, effectsFromText } from '../src/engine/cards';
import { defenseOf, power } from '../src/engine/rules';

const api = (name: string, engine: Record<string, unknown>) => ({ id: name, name, slug: name.toLowerCase().replace(/\W+/g, '_'), engine, printings: [] });

describe('AUDIT: API null stats', () => {
  it('a missing defense takes the printed power (p7; p23 "Minions with Split Power")', () => {
    // 38 of the 524 minions in the live pool ship engine.defense === null, e.g. Jormungand at 10 power.
    const { cards } = normalizeApiCards([
      api('Nullfang', { type: 'Minion', attack: 10, defense: null, rules: '', keywords: [], subtypes: [] }),
      api('Evenfang', { type: 'Minion', attack: 10, defense: 10, rules: '', keywords: [], subtypes: [] }),
    ]);
    const nullfang = cards.find((c) => c.name === 'Nullfang')!;
    expect(nullfang.attack).toBe(10);
    expect(nullfang.defense).toBe(10);
    expect(cards.find((c) => c.name === 'Evenfang')!.defense).toBe(10);

    // and it dies to a single point of damage
    let s = start(0);
    for (const c of cards) s.cards[c.id] = c;
    site(s, 0, cell(2, 3));
    const u = unit(s, 0, cell(2, 3), nullfang.id);
    expect(power(s, s.units[u])).toBe(10);
    expect(defenseOf(s, s.units[u])).toBe(10);
    s = apply(s, { t: 'manual', op: 'damage', unit: u, n: 1 });
    expect(s.units[u]).toBeDefined();                 // a 10-power minion survives 1 damage
  });

  it('makeCard has the fallback that normalizeApiCards lacks', () => {
    // why the 93-test suite never caught it: the fixtures all go through makeCard
    expect(makeCard({ name: 'Rig', type: 'Minion', attack: 7 }).defense).toBe(7);
  });
});

describe('AUDIT: card text readings', () => {

  it('keeps the "if it\'s a minion" clause: an Avatar bearer gets none of it (p5)', () => {
    const fx = effectsFromText('Artifact', "Bearer has Burrowing, Submerge, and Voidwalk, if it's a minion.", 'All-terrain Vestments');
    const grants = fx.filter((e) => e.op === 'grant');
    expect(grants.map((e) => e.keyword)).toEqual(['Burrowing', 'Submerge', 'Voidwalk']);
    expect(grants.every((e) => e.only === 'minion')).toBe(true);
  });
  it('an Avatar never leaves the surface, whatever it is given (p5)', () => {
    const s = start(0); site(s, 0, cell(2, 3));
    const av = s.players[0].avatar; s.units[av].mods = [{ atk: 0, def: 0, kw: 'Burrowing', from: 'test' }];
    expect(check(s, { t: 'move', unit: av, path: [{ c: cell(2, 3), r: 'under' }] }).ok).toBe(false);
  });
});

describe('projectiles', () => {
  it('the shooter chooses among several units where the projectile lands (p34 "Projectiles")', () => {
    let s = start(0);
    site(s, 0, cell(2, 3)); site(s, 1, cell(2, 2), 'Mill Pond');
    const archer = unit(s, 0, cell(2, 3), id('Ash Archer'));          // Ranged 1, 2 power
    const a = unit(s, 1, cell(2, 2), id('Kiln Brute'));
    const b = unit(s, 1, cell(2, 2), id('Ember Runner'));
    const shots = legalActions(s).filter((x) => x.t === 'shoot' && x.unit === archer);
    expect(shots.map((x) => (x as { hit?: string }).hit).sort()).toEqual([a, b].sort());
    s = apply(s, { t: 'shoot', unit: archer, dx: 0, dy: -1, hit: b });
    expect(s.units[b]).toBeUndefined();                                  // 2 damage kills the 2/2
    expect(s.units[a].damage).toBe(0);
  });
  it('a projectile stays in its region: it flies over a submerged unit (p34, p13)', () => {
    let s = start(0);
    site(s, 0, cell(2, 3)); site(s, 1, cell(2, 2), 'Mill Pond');
    const archer = unit(s, 0, cell(2, 3), id('Ash Archer'));
    unit(s, 1, cell(2, 2), id('Reed Lurker'), { r: 'under' });
    expect(check(s, { t: 'shoot', unit: archer, dx: 0, dy: -1 }).ok).toBe(false);
  });
});

describe('spellcasters', () => {
  it('a spell is cast by a chosen spellcaster and happens where it stands (p17)', () => {
    let s = start(0);
    for (const c of [cell(2, 3), cell(0, 1), cell(0, 0)]) site(s, 0, c);
    const caller = unit(s, 0, cell(0, 1), id('Tide Caller'));          // Spellcaster
    const foe = unit(s, 1, cell(0, 0), id('Ember Runner'));
    const nearbyBolt = T('Near Bolt', 'Magic', { cost: 0, effects: [{ on: 'cast', op: 'damage', n: 3, who: 'target', range: 'nearby', targets: true }] });
    const inst = give(s, 0, nearbyBolt);
    expect(check(s, { t: 'cast', inst, caster: s.players[0].avatar, choices: [{ target: foe }] }).ok).toBe(false); // too far from the Avatar
    s = apply(s, { t: 'cast', inst, caster: caller, choices: [{ target: foe }] });
    expect(s.units[foe]).toBeUndefined();
  });
  it('a Fire Spellcaster may only cast spells with a fire threshold (p34 "Spellcaster")', async () => {
    const { effectsFromText } = await import('../src/engine/cards');
    let s = start(0); site(s, 0, cell(2, 3)); site(s, 0, cell(2, 2)); site(s, 0, cell(1, 2), 'Mill Pond');
    const skull = T('Test Skull', 'Minion', { attack: 1, keywords: ['Spellcaster'], rules: 'Fire Spellcaster', effects: effectsFromText('Minion', 'Fire Spellcaster', 'Test Skull') });
    const sk = unit(s, 0, cell(2, 2), skull);
    const wet = T('Wet Spell', 'Magic', { cost: 0, thresholds: { air: 0, earth: 0, fire: 0, water: 1 }, effects: [{ on: 'cast', op: 'draw', n: 1, who: 'controller', deck: 'spellbook' }] });
    const hot = T('Hot Spell', 'Magic', { cost: 0, thresholds: { air: 0, earth: 0, fire: 1, water: 0 }, effects: [{ on: 'cast', op: 'draw', n: 1, who: 'controller', deck: 'spellbook' }] });
    expect(check(s, { t: 'cast', inst: give(s, 0, wet), caster: sk }).ok).toBe(false);
    expect(check(s, { t: 'cast', inst: give(s, 0, hot), caster: sk }).ok).toBe(true);
  });
  it('"is a Water Spellcaster" keeps the element (p34)', async () => {
    const { effectsFromText } = await import('../src/engine/cards');
    const fx = effectsFromText('Artifact', 'Bearer has +1 power and is a Water Spellcaster.', 'Eerie Coral');
    expect(fx.filter((e) => e.op === 'grant').map((e) => e.keyword)).toEqual(['Spellcaster (water)']);
  });
  it('casting a spell ends the caster\'s Stealth (Codex "Interact")', () => {
    let s = start(0); site(s, 0, cell(2, 3)); site(s, 0, cell(2, 2));
    const sneaky = T('Sneaky Mage', 'Minion', { attack: 1, keywords: ['Spellcaster', 'Stealth'] });
    const u = unit(s, 0, cell(2, 2), sneaky);
    const spell = T('Plain Spell', 'Magic', { cost: 0, effects: [{ on: 'cast', op: 'draw', n: 1, who: 'controller', deck: 'spellbook' }] });
    s = apply(s, { t: 'cast', inst: give(s, 0, spell), caster: u });
    expect(s.units[u].stealthLost).toBe(true);
  });
});

describe('deathrite timing', () => {
  it('a Deathrite resolves before its card reaches the cemetery (p32; Codex "Deathrite")', () => {
    let s = start(0); site(s, 0, cell(2, 3));
    const martyr = T('Test Martyr', 'Minion', { attack: 1, effects: [{ on: 'deathrite', op: 'damage', n: 1, who: 'target', range: 'any', targets: true }] });
    const u = unit(s, 0, cell(2, 3), martyr); const inst = s.units[u].inst;
    s = apply(s, { t: 'manual', op: 'destroy', unit: u });
    expect(s.queue?.length).toBe(1);                       // waiting for a target
    expect(s.players[0].cemetery).not.toContain(inst);     // not in the cemetery yet
    s = apply(s, { t: 'trigger', skip: true });
    expect(s.players[0].cemetery).toContain(inst);
  });
});

describe('bodies of water and spans of land', () => {
  it('a body of water is the cluster of water sites sharing borders, not corners (p12)', async () => {
    const { bodyOf } = await import('../src/engine/rules');
    const s = start(0);
    for (const c of [cell(0, 0), cell(1, 0), cell(1, 1), cell(3, 1)]) site(s, 1, c, 'Mill Pond');
    site(s, 0, cell(2, 0), 'Cinder Field'); site(s, 0, cell(2, 2), 'Mill Pond'); // (2,2) only touches (1,1) at a corner
    expect(bodyOf(s, cell(0, 0)).sort()).toEqual([cell(0, 0), cell(1, 0), cell(1, 1)].sort());
    expect(bodyOf(s, cell(2, 2))).toEqual([cell(2, 2)]);
    expect(bodyOf(s, cell(2, 0))).toEqual([cell(2, 0)]);
  });
  it('"+1 power for each site in her body of water" counts the cluster she is in', async () => {
    const { effectsFromText } = await import('../src/engine/cards');
    const s = start(0);
    for (const c of [cell(0, 3), cell(1, 3), cell(2, 3)]) site(s, 0, c, 'Mill Pond');
    const und = T('Test Undine', 'Minion', { attack: 1, effects: effectsFromText('Minion', 'Test Undine has +1 power for each site in her body of water.', 'Test Undine') });
    const u = unit(s, 0, cell(1, 3), und);
    const { forgetStatics } = await import('../src/engine/rules'); forgetStatics(s.cards);
    expect(power(s, s.units[u])).toBe(4);
  });
  it('"each ally" includes your Avatar (p32 "Ally")', async () => {
    const { effectsFromText } = await import('../src/engine/cards');
    expect(effectsFromText('Magic', 'Each ally heals an amount equal to the number of sites in its body of water.', 'Font')[0].who).toBe('allyUnits');
  });
});

describe('split power', () => {
  it('compares a split-power minion by the average of its two numbers, rounded down (Codex "Split Power")', async () => {
    const { powerValue } = await import('../src/engine/rules');
    const s = start(0); site(s, 0, cell(2, 3));
    const knight = T('Test Knight', 'Minion', { attack: 3, defense: 6 });
    const u = unit(s, 0, cell(2, 3), knight);
    expect(power(s, s.units[u])).toBe(3);        // strikes for 3
    expect(defenseOf(s, s.units[u])).toBe(6);    // dies at 6
    expect(powerValue(s, s.units[u])).toBe(4);   // compares as 4
  });
});
