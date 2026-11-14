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
  it('refuses a whole declared path when one step is illegal (rulebook p21: skip that step, continue)', () => {
    const s = start(0);
    site(s, 0, cell(2, 3)); site(s, 0, cell(2, 2), 'Cinder Field');
    const u = unit(s, 0, cell(2, 3), id('Sky Courier'));  // Movement +1 => 2 steps
    const r = check(s, { t: 'move', unit: u, path: [{ c: cell(2, 2), r: 'surface' }, { c: cell(2, 1), r: 'surface' }] });
    expect(r.ok).toBe(false);                 // cell(2,1) is void; the legal first step is refused too
  });

  it('does not fire "enters" for squares passed through (rulebook p28: entered even momentarily)', () => {
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
    expect(s.queue?.length ?? 0).toBe(0);     // the sentry never saw it  <-- deviation
  });

  it('forbids revisiting a location, not repeating a step (rulebook p21)', () => {
    const s = start(0);
    for (const c of [cell(2, 3), cell(1, 3), cell(1, 2), cell(2, 2)]) site(s, 0, c, 'Cinder Field');
    const u = unit(s, 0, cell(2, 3), id('Sky Courier'), { mods: [{ atk: 0, def: 0, move: 2, from: 'test' }] });
    // a 4-step loop back to the start repeats no step, but is refused
    const loop = [cell(1, 3), cell(1, 2), cell(2, 2), cell(2, 3)].map((c) => ({ c, r: 'surface' as const }));
    expect(check(s, { t: 'move', unit: u, path: loop }).ok).toBe(false);
  });
});

describe('AUDIT: damage allocation', () => {
  it('splits the attacker\'s damage itself, with no choice offered (rulebook p22: the controller allocates)', () => {
    let s = start(0);
    site(s, 0, cell(2, 3)); site(s, 1, cell(2, 2), 'Mill Pond');
    const atk = unit(s, 0, cell(2, 3), id('Pyre Drake'));        // 5 power, Airborne
    const weak = unit(s, 1, cell(2, 2), id('Wind Sprite'));      // 1/1 Airborne
    const tough = unit(s, 1, cell(2, 2), id('Storm Roc'));       // 4/4 Airborne
    s = apply(s, { t: 'move', unit: atk, path: [{ c: cell(2, 2), r: 'surface' }], attack: { unit: weak } });
    expect(s.pending?.kind).toBe('defend');
    const opts = legalActions(s);
    expect(opts.every((a) => a.t === 'respond')).toBe(true);      // only who defends; never how damage splits
    s = apply(s, { t: 'respond', units: [tough] });
    expect(s.pending).toBe(null);
    expect(s.queue?.length ?? 0).toBe(0);                        // fight already resolved: no allocation step
    // the engine spent 5 power as 1 + 4: the split that kills the most, which the player never got to pick
    expect(s.units[weak]).toBeUndefined();
    expect(s.units[tough]).toBeUndefined();
    expect(s.units[atk]).toBeUndefined();                        // and it struck back for 5, killing the attacker
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
  it('wards an Evil minion (rulebook p36: "Evil minions can\'t be warded")', () => {
    let s = start(0);
    site(s, 0, cell(2, 3));
    const evil = T('Evil Thing', 'Minion', { attack: 2, defense: 2, subtypes: ['Evil'] });
    const u = unit(s, 0, cell(2, 3), evil);
    const bless = T('Bless', 'Magic', { cost: 0, effects: [{ on: 'cast', op: 'grant', who: 'target', range: 'any', keyword: 'Ward', until: 'permanent' }] });
    const inst = give(s, 0, bless);
    s = apply(s, { t: 'cast', inst, choices: [{ target: u }] });
    expect(s.units[u].ward).toBe(true);                          // warded anyway  <-- deviation
  });

  it('keeps Stealth after the minion uses an activated ability (rulebook p34/p35: that is interacting)', () => {
    let s = start(0);
    site(s, 0, cell(2, 3));
    const sneak = T('Sneak', 'Minion', {
      attack: 2, defense: 2, keywords: ['Stealth'],
      effects: [{ on: 'tap', op: 'mana', n: 1, who: 'controller' }],
    });
    const u = unit(s, 0, cell(2, 3), sneak);
    s = apply(s, { t: 'ability', src: { unit: u }, fx: 0 });
    expect(s.units[u].stealthLost).toBe(false);                  // still hidden  <-- deviation
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
  it('drops the element on "is a Water Spellcaster" (rulebook p35)', () => {
    const fx = effectsFromText('Artifact', 'Bearer has +1 power and is a Water Spellcaster.', 'Eerie Coral');
    const granted = fx.filter((e) => e.op === 'grant').map((e) => e.keyword);
    expect(granted).toEqual(['Spellcaster']);         // not "Water Spellcaster": the restriction is gone
  });

  it('drops the "if it\'s a minion" clause, so an Avatar bearer gets all three (rulebook p5)', () => {
    const fx = effectsFromText('Artifact', "Bearer has Burrowing, Submerge, and Voidwalk, if it's a minion.", 'All-terrain Vestments');
    const grants = fx.filter((e) => e.op === 'grant');
    expect(grants.map((e) => e.keyword)).toEqual(['Burrowing', 'Submerge', 'Voidwalk']);
    expect(grants.every((e) => e.when === undefined)).toBe(true);   // no condition attached
  });
});
