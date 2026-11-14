import { describe, expect, it } from 'vitest';
import { PRACTICE_CARDS, PRACTICE_DECKS } from './fixtures/practiceSet';
import { type Action, type CardDef, type GameState, type PlayerId, AVATAR_START, actor, apply, autoSplit, cell, check, createGame, forgetStatics, has, isDisabled, isWater, legalActions, rangedOf, makeCard, normalizeApiCards, power, reach, thresholdOf } from '../src/engine';
import { chooseAction, determinize } from '../src/ai/ai';

const cards: Record<string, CardDef> = Object.fromEntries(PRACTICE_CARDS.map((c) => [c.id, c]));
const T = (name: string, type: CardDef['type'], extra: Partial<CardDef> = {}) => { const c = makeCard({ name, type, ...extra }); cards[c.id] = c; return c.id; };
const id = (name: string) => PRACTICE_CARDS.find((c) => c.name === name)!.id;

function start(first: PlayerId = 0): GameState {
  let s = createGame(cards, [PRACTICE_DECKS[0], PRACTICE_DECKS[1]], 42, first);
  s = apply(s, { t: 'mulligan', cards: [] });
  return apply(s, { t: 'mulligan', cards: [] });
}
/** Test rig: put a card into the active player's hand and return its instance id. */
function give(s: GameState, p: PlayerId, cardId: string): string {
  const k = `${p}x${Object.keys(s.inst).length}`; s.inst[k] = cardId; s.players[p].hand.push(k); return k;
}
function site(s: GameState, p: PlayerId, c: number, name = p === 0 ? 'Cinder Field' : 'Mill Pond') {
  const k = `${p}t${Object.keys(s.inst).length}`; s.inst[k] = id(name);
  // a site put down by hand during setup is not "gained mid-turn": count it in the turn's income so it adds no mana
  if (s.sites[c]?.owner !== p && s.players[p].income !== undefined) s.players[p].income! += 1;
  s.sites[c] = { inst: k, owner: p };
}
function unit(s: GameState, p: PlayerId, c: number, cardId: string, o: Partial<GameState['units'][string]> = {}) {
  const k = `${p}u${Object.keys(s.inst).length}`; s.inst[k] = cardId; const uid = `u${s.nextId++}`;
  s.units[uid] = { id: uid, inst: k, owner: p, c, r: 'surface', tapped: false, damage: 0, enteredTurn: 0, avatar: false, stealthLost: false, lance: false, ...o };
  return uid;
}
const reason = (s: GameState, a: Action) => { const r = check(s, a); return r.ok ? '' : r.reason; };

describe('setup and turn structure', () => {
  it('deals 3 sites + 3 spells and places avatars mid back row', () => {
    const s = createGame(cards, [PRACTICE_DECKS[0], PRACTICE_DECKS[1]], 1, 0);
    for (const p of [0, 1] as PlayerId[]) {
      const hand = s.players[p].hand.map((i) => cards[s.inst[i]].type);
      expect(hand.filter((t) => t === 'Site').length).toBe(3);
      expect(hand.length).toBe(6);
      expect(s.units[s.players[p].avatar].c).toBe(AVATAR_START[p]);
    }
    expect(AVATAR_START).toEqual([cell(2, 3), cell(2, 0)]);
  });
  it('mulligan returns cards to the bottom and redraws the same split', () => {
    let s = createGame(cards, [PRACTICE_DECKS[0], PRACTICE_DECKS[1]], 7, 0);
    const back = s.players[0].hand.slice(0, 2);
    s = apply(s, { t: 'mulligan', cards: back });
    expect(s.players[0].hand.length).toBe(6);
    expect(s.players[0].atlas.slice(-2)).toEqual(back);
    expect(actor(s)).toBe(1);
    expect(reason(s, { t: 'mulligan', cards: s.players[1].hand.slice(0, 4) })).toMatch(/at most 3/);
  });
  it('first player skips the draw; second player must draw before acting', () => {
    let s = start(0);
    expect(s.phase).toBe('main'); expect(s.turn).toBe(1);
    s = apply(s, { t: 'endTurn' });
    expect(s.phase).toBe('draw'); expect(s.active).toBe(1);
    expect(reason(s, { t: 'endTurn' })).toMatch(/Draw a card/);
    s = apply(s, { t: 'draw', deck: 'atlas' });
    expect(s.players[1].hand.length).toBe(7);
  });
  it('same seed gives the same game (needed for online play)', () => {
    const a = start(0), b = start(0);
    expect(a.players[0].hand).toEqual(b.players[0].hand);
    expect(a.players[1].spellbook).toEqual(b.players[1].spellbook);
  });
});

describe('sites, mana, threshold', () => {
  it('first site goes on the avatar square, later sites orthogonally adjacent', () => {
    let s = start(0);
    const sites = s.players[0].hand.filter((i) => cards[s.inst[i]].type === 'Site');
    expect(reason(s, { t: 'playSite', inst: sites[0], c: cell(1, 3) })).toMatch(/Avatar's square/);
    s = apply(s, { t: 'playSite', inst: sites[0], c: AVATAR_START[0] });
    expect(s.players[0].mana).toBe(1); // site gives 1 immediately
    expect(reason(s, { t: 'playSite', inst: sites[1], c: cell(1, 3) })).toMatch(/Avatar is tapped/);
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    expect(s.players[0].mana).toBe(1); // one site -> one mana at start of turn
    expect(reason(s, { t: 'playSite', inst: sites[1], c: cell(1, 2) })).toMatch(/next to a site/); // diagonal
    s = apply(s, { t: 'playSite', inst: sites[1], c: cell(2, 2) });
    expect(s.players[0].mana).toBe(2);
  });
  it('threshold comes from controlled sites and is not spent; mana is', () => {
    const s = start(0);
    site(s, 0, AVATAR_START[0]); s.players[0].mana = 2;
    const giant = give(s, 0, id('Hill Giant')); const runner = give(s, 0, id('Ember Runner'));
    expect(thresholdOf(s, 0).fire).toBe(1);
    expect(reason(s, { t: 'cast', inst: giant, c: AVATAR_START[0] })).toMatch(/costs 6 mana/);
    s.players[0].mana = 6;
    expect(reason(s, { t: 'cast', inst: giant, c: AVATAR_START[0] })).toMatch(/earth threshold/);
    const g = apply(s, { t: 'cast', inst: runner, c: AVATAR_START[0] });
    expect(g.players[0].mana).toBe(5); expect(thresholdOf(g, 0).fire).toBe(1);
  });
  it('minions are summoned only onto your own sites', () => {
    const s = start(0); site(s, 0, AVATAR_START[0]); site(s, 1, AVATAR_START[1]); s.players[0].mana = 3;
    const r = give(s, 0, id('Ember Runner'));
    expect(reason(s, { t: 'cast', inst: r, c: AVATAR_START[1] })).toMatch(/site you control/);
    expect(reason(s, { t: 'cast', inst: r, c: cell(0, 0) })).toMatch(/site you control/);
  });
});

describe('movement and keywords', () => {
  const rig = () => { const s = start(0); for (let c = 0; c < 20; c++) if (c !== cell(0, 0)) site(s, c < 10 ? 1 : 0, c, c < 10 ? 'Mill Pond' : 'Stone Terrace'); return s; };
  it('summoning sickness blocks tapping unless the minion has Charge', () => {
    const s = rig();
    const plain = unit(s, 0, cell(2, 2), id('Kiln Brute'), { enteredTurn: s.turn });
    const charge = unit(s, 0, cell(2, 2), id('Ember Runner'), { enteredTurn: s.turn });
    expect(reason(s, { t: 'move', unit: plain, path: [{ c: cell(2, 1), r: 'surface' }] })).toMatch(/summoning sickness/);
    expect(check(s, { t: 'move', unit: charge, path: [{ c: cell(2, 1), r: 'surface' }] }).ok).toBe(true);
  });
  it('one orthogonal step by default; diagonal needs Airborne; Movement +1 adds a step', () => {
    const s = rig();
    const brute = unit(s, 0, cell(2, 2), id('Kiln Brute'));
    const sprite = unit(s, 0, cell(2, 2), id('Wind Sprite'));
    const courier = unit(s, 0, cell(2, 2), id('Sky Courier'));
    expect(reason(s, { t: 'move', unit: brute, path: [{ c: cell(3, 1), r: 'surface' }] })).toMatch(/Diagonal/);
    expect(check(s, { t: 'move', unit: sprite, path: [{ c: cell(3, 1), r: 'surface' }] }).ok).toBe(true);
    expect(reach(s, s.units[brute]).size).toBe(5);
    expect(reach(s, s.units[courier]).size).toBe(12); // radius-2 diamond clipped by the board edge
    expect(reason(s, { t: 'move', unit: brute, path: [{ c: cell(2, 1), r: 'surface' }, { c: cell(2, 0), r: 'surface' }] })).toMatch(/1 step/);
  });
  it('a minion with Voidwalk can be summoned to a void square; other minions cannot (Codex "Voidwalk")', () => {
    const s = rig(); s.players[0].mana = 9;
    const walker = give(s, 0, T('Test Void Summon', 'Minion', { attack: 1, defense: 1, cost: 0, keywords: ['Voidwalk'] }));
    const plain = give(s, 0, T('Test Plain Summon', 'Minion', { attack: 1, defense: 1, cost: 0 }));
    expect(reason(s, { t: 'cast', inst: plain, c: cell(0, 0) })).toMatch(/site you control/);
    expect(check(s, { t: 'cast', inst: walker, c: cell(0, 0) }).ok).toBe(true);
    const s2 = apply(s, { t: 'cast', inst: walker, c: cell(0, 0) });
    expect(Object.values(s2.units).some((u) => u.inst === walker && u.c === cell(0, 0))).toBe(true);
  });
  it('void is closed to units without Voidwalk; going under needs Burrowing/Submerge on the right terrain', () => {
    const s = rig();
    const brute = unit(s, 0, cell(0, 1), id('Kiln Brute'));
    expect(reason(s, { t: 'move', unit: brute, path: [{ c: cell(0, 0), r: 'surface' }] })).toMatch(/void/);
    const walker = unit(s, 0, cell(0, 1), T('Test Voidwalker', 'Minion', { attack: 1, keywords: ['Voidwalk'] }));
    expect(check(s, { t: 'move', unit: walker, path: [{ c: cell(0, 0), r: 'surface' }] }).ok).toBe(true);
    const mole = unit(s, 0, cell(2, 2), id('Burrow Mole'));   // on land
    const lurker = unit(s, 0, cell(2, 2), id('Reed Lurker')); // Submerge, on land
    expect(check(s, { t: 'move', unit: mole, path: [{ c: cell(2, 2), r: 'under' }] }).ok).toBe(true);
    expect(reason(s, { t: 'move', unit: lurker, path: [{ c: cell(2, 2), r: 'under' }] })).toMatch(/Burrowing/);
    const mole2 = unit(s, 0, cell(2, 1), id('Burrow Mole'));  // on water
    expect(reason(s, { t: 'move', unit: mole2, path: [{ c: cell(2, 1), r: 'under' }] })).toMatch(/Submerge/);
  });
  it('Immobile cannot step; Waterbound is disabled off water', () => {
    const s = rig();
    const rock = unit(s, 0, cell(2, 2), T('Test Statue', 'Minion', { attack: 1, keywords: ['Immobile'] }));
    expect(reason(s, { t: 'move', unit: rock, path: [{ c: cell(2, 1), r: 'surface' }] })).toMatch(/Immobile/);
    const fish = unit(s, 0, cell(2, 2), T('Test Fish', 'Minion', { attack: 2, keywords: ['Waterbound'] }));
    expect(reason(s, { t: 'move', unit: fish, path: [{ c: cell(2, 1), r: 'surface' }] })).toMatch(/disabled/);
  });
});

describe('combat', () => {
  // enemy avatar starts tapped so that it does not offer to defend in every test
  const rig = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); s.units[s.players[1].avatar].tapped = true; return s; };
  it('a fight is simultaneous: both strike, damage >= defense kills, split power respected', () => {
    let s = rig();
    const brute = unit(s, 0, cell(2, 2), id('Kiln Brute'));     // 4/4
    const guard = unit(s, 1, cell(2, 1), id('Granite Guard'), { tapped: true }); // 2 atk / 5 def
    s = apply(s, { t: 'move', unit: brute, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: guard } });
    expect(s.pending).toBeNull();
    expect(s.units[guard].damage).toBe(4); expect(s.units[brute].damage).toBe(2); // guard survives at 5 defense
    expect(s.units[brute].tapped).toBe(true);
  });
  it('minion damage clears at the end of every turn, for both players (rulebook p16 End Phase step 2)', () => {
    let s = rig();
    const brute = unit(s, 0, cell(2, 2), id('Kiln Brute'));
    const guard = unit(s, 1, cell(2, 1), id('Granite Guard'), { tapped: true });
    s = apply(s, { t: 'move', unit: brute, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: guard } });
    s = apply(s, { t: 'endTurn' });
    expect(s.units[brute].damage).toBe(0); expect(s.units[guard].damage).toBe(0);
  });
  it('attacking an undefended site makes its controller lose life', () => {
    let s = rig();
    const brute = unit(s, 0, cell(2, 2), id('Kiln Brute'));
    s = apply(s, { t: 'move', unit: brute, path: [{ c: cell(2, 1), r: 'surface' }], attack: { site: true } });
    expect(s.players[1].life).toBe(16);
  });
  it('an untapped enemy in range may defend; defending a site takes the site out of the fight', () => {
    let s = rig();
    const brute = unit(s, 0, cell(2, 2), id('Kiln Brute'));
    const guard = unit(s, 1, cell(3, 1), id('Granite Guard'));
    s = apply(s, { t: 'move', unit: brute, path: [{ c: cell(2, 1), r: 'surface' }], attack: { site: true } });
    expect(s.pending?.kind).toBe('defend'); expect(actor(s)).toBe(1);
    expect(reason(s, { t: 'endTurn' })).toMatch(/must choose/);
    s = apply(s, { t: 'respond', units: [guard] });
    expect(s.players[1].life).toBe(20);
    expect(s.units[guard].c).toBe(cell(2, 1)); expect(s.units[guard].tapped).toBe(true);
    expect(s.units[guard].damage).toBe(4); expect(s.units[brute].damage).toBe(2);
  });
  it('a defender can take the original target out of the fight', () => {
    let s = rig();
    const brute = unit(s, 0, cell(2, 2), id('Kiln Brute'));
    const sprite = unit(s, 1, cell(2, 1), T('Test Squire', 'Minion', { attack: 1 }), { tapped: true });
    const guard = unit(s, 1, cell(3, 1), id('Granite Guard'));
    s = apply(s, { t: 'move', unit: brute, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: sprite } });
    s = apply(s, { t: 'respond', units: [guard], removeOriginal: true });
    expect(s.units[sprite]).toBeDefined(); expect(s.units[guard].damage).toBe(4);
  });
  it('moving next to an untapped enemy without attacking lets it intercept', () => {
    let s = rig();
    const brute = unit(s, 0, cell(2, 2), id('Kiln Brute'));
    const guard = unit(s, 1, cell(2, 1), id('Granite Guard'));
    s = apply(s, { t: 'move', unit: brute, path: [{ c: cell(2, 1), r: 'surface' }] });
    expect(s.pending?.kind).toBe('intercept');
    s = apply(s, { t: 'respond', units: [guard] });
    expect(s.units[brute].damage).toBe(2);
  });
  it('Airborne: ground units cannot attack it; Stealth: cannot be defended against', () => {
    let s = rig();
    const brute = unit(s, 0, cell(2, 2), id('Kiln Brute'));
    const roc = unit(s, 1, cell(2, 1), id('Storm Roc'));
    expect(reason(s, { t: 'move', unit: brute, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: roc } })).toMatch(/Airborne/);
    const stalker = unit(s, 0, cell(1, 2), id('Root Stalker'));
    unit(s, 1, cell(0, 1), id('Granite Guard'));
    s = apply(s, { t: 'move', unit: stalker, path: [{ c: cell(1, 1), r: 'surface' }], attack: { site: true } });
    expect(s.pending).toBeNull(); expect(s.players[1].life).toBe(18);
    expect(s.units[stalker].stealthLost).toBe(true);
  });
  it('Lethal kills on any damage; Lance strikes first with +1 then breaks', () => {
    let s = rig();
    const eel = unit(s, 0, cell(2, 2), id('Venom Eel'));
    const giant = unit(s, 1, cell(2, 1), id('Hill Giant'), { tapped: true });
    s = apply(s, { t: 'move', unit: eel, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: giant } });
    expect(s.units[giant]).toBeUndefined(); expect(s.units[eel]).toBeUndefined(); // simultaneous: giant strikes back
    const lancer = unit(s, 0, cell(1, 2), id('Cloud Lancer'), { lance: true });   // 3/3, +1 first strike
    const brute = unit(s, 1, cell(1, 1), id('Kiln Brute'), { tapped: true });     // 4/4
    s = apply(s, { t: 'move', unit: lancer, path: [{ c: cell(1, 1), r: 'surface' }], attack: { unit: brute } });
    expect(s.units[brute]).toBeUndefined(); expect(s.units[lancer].damage).toBe(0); expect(s.units[lancer].lance).toBe(false);
  });
  it('Ranged shoots the first enemy in line with no strike back', () => {
    let s = rig();
    const archer = unit(s, 0, cell(2, 2), id('Ash Archer'));
    const sprite = unit(s, 1, cell(2, 1), id('Wind Sprite'));
    expect(reason(s, { t: 'shoot', unit: archer, dx: 1, dy: 0 })).toMatch(/No unit/);
    s = apply(s, { t: 'shoot', unit: archer, dx: 0, dy: -1 });
    expect(s.units[sprite]).toBeUndefined(); expect(s.units[archer].damage).toBe(0);
  });
});

describe("avatars, life, death's door", () => {
  const rig = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); return s; };
  it("0 life puts an avatar at death's door, immune for that turn; later damage is a death blow", () => {
    let s = rig(); s.players[1].life = 3;
    const a = unit(s, 0, cell(2, 1), id('Kiln Brute')); const b = unit(s, 0, cell(2, 1), id('Kiln Brute'));
    const foe = s.players[1].avatar; s.units[foe].tapped = true;
    s = apply(s, { t: 'move', unit: a, path: [{ c: cell(2, 0), r: 'surface' }], attack: { unit: foe } });
    expect(s.players[1].deathsDoor).toBe(true); expect(s.winner).toBeNull();
    s = apply(s, { t: 'move', unit: b, path: [{ c: cell(2, 0), r: 'surface' }], attack: { unit: foe } });
    expect(s.winner).toBeNull(); // immune this turn
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    const c2 = unit(s, 0, cell(2, 0), id('Ember Runner'));
    s = apply(s, { t: 'move', unit: c2, path: [], attack: { unit: foe } });
    expect(s.winner).toBe(0); expect(s.phase).toBe('over');
  });
  it("site life loss can bring a player to death's door but never deals the death blow; no healing at death's door", () => {
    let s = rig(); s.players[1].life = 2;
    const a = unit(s, 0, cell(1, 2), id('Kiln Brute'));
    s = apply(s, { t: 'move', unit: a, path: [{ c: cell(1, 1), r: 'surface' }], attack: { site: true } });
    expect(s.players[1].deathsDoor).toBe(true);
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    site(s, 1, cell(2, 0), 'Stone Terrace'); s.players[1].mana = 5;
    const mend = give(s, 1, id('Mend'));
    s = apply(s, { t: 'cast', inst: mend });
    expect(s.players[1].life).toBe(0);
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    const b = unit(s, 0, cell(3, 2), id('Kiln Brute'));
    s = apply(s, { t: 'move', unit: b, path: [{ c: cell(3, 1), r: 'surface' }], attack: { site: true } });
    expect(s.winner).toBeNull();
  });
  it('a player who must draw with both decks empty loses', () => {
    let s = start(0); s.players[1].spellbook = []; s.players[1].atlas = [];
    s = apply(s, { t: 'endTurn' });
    expect(s.winner).toBe(0);
  });
});

describe('data-driven effects', () => {
  it('targeted magic needs a target in range of a spellcaster and respects Stealth', () => {
    let s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c);
    s.players[0].mana = 9;
    const bolt = give(s, 0, id('Firebolt'));
    const far = unit(s, 1, cell(0, 0), id('Kiln Brute'));
    const near = unit(s, 1, cell(2, 2), id('Wind Sprite'));
    const sneaky = unit(s, 1, cell(2, 2), id('Root Stalker'));
    expect(reason(s, { t: 'cast', inst: bolt, target: far })).toMatch(/valid target/);
    expect(reason(s, { t: 'cast', inst: bolt, target: sneaky })).toMatch(/valid target/);
    s = apply(s, { t: 'cast', inst: bolt, target: near });
    expect(s.units[near]).toBeUndefined();
    expect(s.players[0].cemetery).toContain(bolt);
  });
  it('genesis effects fire on entry', () => {
    let s = start(0); site(s, 0, AVATAR_START[0], 'Mill Pond'); s.players[0].mana = 3;
    const caller = give(s, 0, id('Tide Caller')); const n = s.players[0].hand.length;
    s = apply(s, { t: 'cast', inst: caller, c: AVATAR_START[0] });
    expect(s.players[0].hand.length).toBe(n); // -1 cast, +1 drawn
  });
});

describe('API normalization', () => {
  it('maps CardAPIDTO, reports unknown fields, and never throws on odd input', () => {
    const raw = [
      { id: 'x1', name: 'Sample Minion', slug: 'sample_minion', mystery: 1, engine: { type: 'Minion', category: 'Spell', rarity: 'Ordinary', rules: 'Airborne\nMovement +2', cost: 3, attack: 2, defense: 2, life: null, water: 0, earth: 0, fire: 0, air: 2, elements: ['Air'], subtypes: ['Beast'], keywords: ['Airborne', 'Movement'], umbrellas: [], back: null, newStat: 4 },
        printings: [{ id: 'p', slug: 'set-sample_minion-b-s', printedAt: '', set: { name: 'Set', code: 'SET', releasedAt: '' }, meta: { finish: 'Standard', product: 'Booster', typeline: 'An Ordinary Beast', flavor: null, artist: { name: '', slug: '' }, back: null } }] },
      { name: 'Broken' }, null, 5,
    ];
    const r = normalizeApiCards(raw);
    expect(r.cards.length).toBe(1);
    expect(r.cards[0]).toMatchObject({ movement: 2, thresholds: { air: 2 }, typeline: 'An Ordinary Beast', printings: [{ slug: 'set-sample_minion-b-s' }] });
    expect(r.unknownFields).toEqual(['engine.newStat', 'mystery']);
    expect(r.skipped.length).toBe(3);
    expect(normalizeApiCards({ nope: true }).cards).toEqual([]);
  });
});

describe('AI', () => {
  it('every tier plays a full game using only legal actions', async () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      let s = createGame(cards, [PRACTICE_DECKS[0], PRACTICE_DECKS[1]], level.length * 99, 0);
      let n = 0;
      while (s.phase !== 'over' && n++ < 1500) {
        const a = await chooseAction(s, level, 15);
        expect(check(s, a).ok).toBe(true);
        s = apply(s, a);
      }
      expect(n).toBeGreaterThan(20);
      if (level !== 'easy') expect(s.phase).toBe('over');
    }
  }, 120000);
  it('determinization hides the opponent hand but keeps its size and the public board', () => {
    const s = start(0);
    const d = determinize(s, 0);
    expect(d.players[1].hand.length).toBe(s.players[1].hand.length);
    expect(d.players[0].hand).toEqual(s.players[0].hand);
    expect([...d.players[1].hand, ...d.players[1].spellbook, ...d.players[1].atlas].sort()).toEqual([...s.players[1].hand, ...s.players[1].spellbook, ...s.players[1].atlas].sort());
    let differs = false;
    for (let i = 0; i < 20 && !differs; i++) differs = determinize(s, 0).players[1].hand.join() !== s.players[1].hand.join();
    expect(differs).toBe(true);
  });
  it('legalActions only returns actions that pass check', () => {
    let s = start(0);
    for (let i = 0; i < 60 && s.phase !== 'over'; i++) {
      const acts = legalActions(s);
      for (const a of acts) expect(check(s, a).ok).toBe(true);
      s = apply(s, acts[(i * 7) % acts.length]);
    }
  });
});

describe('art matching', () => {
  it('files every image under its card as a variant, printings by slug and other names by filename', async () => {
    const { matcher, fileKey, orderVariants, variantLabel } = await import('../src/data/artSync');
    const card = makeCard({ id: 'c1', name: 'Sample Knight', type: 'Minion', printings: [
      { slug: 'alp-sample_knight-b-s', set: 'Alpha', finish: 'Standard', product: 'Booster' },
      { slug: 'alp-sample_knight-b-f', set: 'Alpha', finish: 'Foil', product: 'Booster' },
      { slug: 'pro-sample_knight-op-s', set: 'Promotional', finish: 'Standard', product: 'Organized Play' }] });
    const other = makeCard({ id: 'c2', name: 'Knight', type: 'Minion' });
    const m = matcher([card, other]);
    expect(m(fileKey('zip2/alp-sample_knight-b-f.png'))).toEqual({ id: 'c1', variant: 'alp_sample_knight_b_f', exact: true });
    expect(m(fileKey('Sample Knight.png'))).toEqual({ id: 'c1', variant: 'base', exact: true });
    expect(m(fileKey('Sample Knight (alt art 2).jpg'))).toMatchObject({ id: 'c1', variant: 'sample_knight_alt_art_2', exact: false }); // longest name wins over "Knight"
    expect(m(fileKey('unrelated.png'))).toBeNull();
    const order = orderVariants(card, ['sample_knight_alt_art_2', 'alp_sample_knight_b_f', 'base', 'pro_sample_knight_op_s', 'alp_sample_knight_b_s']);
    expect(order).toEqual(['alp_sample_knight_b_s', 'pro_sample_knight_op_s', 'alp_sample_knight_b_f', 'base', 'sample_knight_alt_art_2']);
    expect(variantLabel(card, 'pro_sample_knight_op_s')).toBe('Promotional, Standard, Organized Play');
    // real slug shape from the API (2026-11-10): numeric set code, then name, product and finish letters
    const real = makeCard({ id: 'c3', name: 'Mix Aer', type: 'Magic', printings: [{ slug: '002-mix_aer-b-s', set: 'Beta' }, { slug: '002-mix_aer-b-f', set: 'Beta' }, { slug: '001-mix_aer-b-s', set: 'Alpha' }] });
    const m2 = matcher([real]);
    expect(m2(fileKey('Beta/002-mix_aer-b-f.png'))).toMatchObject({ variant: '002_mix_aer_b_f', exact: true });
    expect(m2(fileKey('bet-mix_aer-b-f.png'))).toMatchObject({ variant: '002_mix_aer_b_f', exact: true });   // only one printing ends in b_f
    expect(m2(fileKey('bet-mix_aer-b-s.png'))).toMatchObject({ variant: 'bet_mix_aer_b_s', exact: false });  // two sets share b_s: kept under its own name
  });
});

describe('official precon lists', () => {
  it('every bundled deck has 36 spells and 16 sites and resolves against a pool that has its cards', async () => {
    const { OFFICIAL_DECKS, resolveOfficial } = await import('../src/data/officialDecks');
    expect(OFFICIAL_DECKS.length).toBe(8);
    const pool: Record<string, CardDef> = {};
    for (const d of OFFICIAL_DECKS) {
      expect(d.spellbook.reduce((n, [k]) => n + k, 0)).toBe(36);
      expect(d.atlas.reduce((n, [k]) => n + k, 0)).toBe(16);
      const av = makeCard({ name: d.avatar, type: 'Avatar', life: 20, source: 'api' }); pool[av.id] = av;
      for (const [, n] of d.spellbook) { const c = makeCard({ name: n, type: 'Minion', source: 'api' }); pool[c.id] = c; }
      for (const [, n] of d.atlas) { const c = makeCard({ name: n, type: 'Site', source: 'api' }); pool[c.id] = c; }
      for (const [, n] of d.collection ?? []) { const c = makeCard({ name: n, type: 'Minion', source: 'api' }); pool[c.id] ??= c; }
    }
    for (const r of resolveOfficial(pool)) { expect(r.missing).toEqual([]); expect(r.deck.spellbook.length).toBe(36); expect(r.deck.atlas.length).toBe(16); expect(pool[r.deck.avatar].type).toBe('Avatar'); }
    expect(resolveOfficial({})[0].missing.length).toBeGreaterThan(20); // nothing synced: listed, not playable
  });
});

describe('rules text and damage split', () => {
  it('reads each sentence it knows into an effect and leaves the rest for the hand tools', async () => {
    const { effectsFromText } = await import('../src/engine/cards');
    const auto = (fx: { op: string }[]) => fx.filter((e) => e.op !== 'manual');
    const hand = (fx: { op: string; text?: string }[]) => fx.filter((e) => e.op === 'manual').map((e) => e.text);
    expect(effectsFromText('Magic', 'Deal 4 damage to target nearby unit.')).toMatchObject([{ on: 'cast', op: 'damage', n: 4, who: 'target', range: 'nearby' }]);
    expect(effectsFromText('Magic', 'Deal 7 damage to target minion nearby.')).toMatchObject([{ op: 'damage', n: 7, range: 'nearby', only: 'minion' }]);
    expect(effectsFromText('Minion', 'Spellcaster\r\nGenesis → Draw a spell.')).toMatchObject([{ on: 'genesis', op: 'draw', n: 1, deck: 'spellbook' }]);
    expect(effectsFromText('Minion', 'Airborne, Ward\nGenesis → Kill target adjacent minion.')).toMatchObject([{ on: 'genesis', op: 'destroy', range: 'adjacent', only: 'minion' }]);
    // a known first sentence is automated; the sentence after it is left for the hand tools
    const two = effectsFromText('Magic', 'Deal 2 damage to target unit nearby. Any number of times, you may spend ② to additionally target a new unit.');
    expect(auto(two)).toMatchObject([{ op: 'damage', n: 2 }]);
    expect(hand(two)).toEqual(['Any number of times, you may spend ② to additionally target a new unit.']);
    // sentences with more to them are not guessed at
    // "it" points back at the chosen target
    expect(auto(effectsFromText('Magic', 'Deal 1 damage to target nearby minion and untap it.'))).toMatchObject([{ op: 'damage', who: 'target' }, { op: 'untap', who: 'target', ref: true }]);
    expect(auto(effectsFromText('Minion', 'Genesis → Kill target adjacent Unique or Elite minion.'))).toEqual([]);
    // "Once on your turn, bearer may …" is an activated ability
    expect(effectsFromText('Artifact', 'Once on your turn, bearer may deal 1 damage to target adjacent minion.')).toMatchObject([{ on: 'activated', op: 'damage', n: 1, range: 'adjacent', only: 'minion' }]);
    expect(effectsFromText('Minion', 'Airborne\nMovement +1')).toEqual([]);
    const r = normalizeApiCards([{ id: 'a', name: 'Bolt', slug: 'bolt', engine: { type: 'Magic', rules: 'Deal 3 damage to target nearby unit.', cost: 2, air: 1, keywords: [] }, printings: [] }], {});
    expect(r.cards[0].effects.length).toBe(1);
    expect(normalizeApiCards([{ id: 'a', name: 'Bolt', engine: { type: 'Magic', rules: 'Deal 3 damage to target nearby unit.' }, printings: [] }], { a: [] }).cards[0].effects).toEqual([]); // switched off by hand
  });
  it('a "minion only" effect cannot target an avatar', () => {
    let s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c);
    s.players[0].mana = 9; s.units[s.players[0].avatar].c = cell(2, 1);
    const zap = give(s, 0, T('Test Zap', 'Magic', { cost: 1, effects: [{ on: 'cast', op: 'damage', n: 2, who: 'target', range: 'nearby', only: 'minion' }] }));
    expect(reason(s, { t: 'cast', inst: zap, target: s.players[1].avatar })).toMatch(/valid target/);
  });
  it('an attacker facing several enemies: the suggested split kills the most, and the player confirms it', () => {
    let s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); s.units[s.players[1].avatar].tapped = true;
    const giant = unit(s, 0, cell(2, 2), id('Hill Giant'));                       // 7 power
    const a = unit(s, 1, cell(2, 1), id('Wind Sprite'), { tapped: true });        // 1 defense, airborne but it is the giant's... target below
    const b = unit(s, 1, cell(3, 1), id('Ember Runner'));                         // 2/2 defender
    const c2 = unit(s, 1, cell(1, 1), id('Kiln Brute'));                          // 4/4 defender
    const tgt = unit(s, 1, cell(2, 1), id('Ash Archer'), { tapped: true });       // 2/2 original target
    s = apply(s, { t: 'move', unit: giant, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: tgt } });
    s = apply(s, { t: 'respond', units: [b, c2] });
    expect(s.pending?.kind).toBe('allocate');
    s = apply(s, { t: 'allocate', split: autoSplit(s, giant, s.pending!.foes!) });
    expect(s.units[tgt]).toBeUndefined(); expect(s.units[b]).toBeUndefined();     // 2 + 2 spent on the weakest two
    expect(s.units[c2].damage).toBe(3);                                           // the remaining 3 land on the brute
    expect(s.units[a]).toBeDefined();                                             // bystander was never in the fight
    expect(s.units[giant]).toBeUndefined();                                       // all three strike back for 2 + 4 + 2: dead at 7 defense
  });
});

describe('site text read from the API', () => {
  it('"only copy" towers give 1 extra mana on the turn they are played, once', async () => {
    const { effectsFromText } = await import('../src/engine/cards');
    const fx = effectsFromText('Site', 'Genesis → If this is the only Lone Tower you control, gain ① this turn.');
    expect(fx).toMatchObject([{ on: 'genesis', op: 'mana', n: 1, cond: 'onlyCopy' }]);
    const tower = T('Lone Tower', 'Site', { thresholds: { air: 1, earth: 0, fire: 0, water: 0 }, effects: fx });
    let s = start(0);
    const a = give(s, 0, tower), b = give(s, 0, tower);
    s = apply(s, { t: 'playSite', inst: a, c: AVATAR_START[0] });
    expect(s.players[0].mana).toBe(2);                       // 1 for the site + 1 from its Genesis
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    expect(s.players[0].mana).toBe(1);                       // the bonus was for that turn only
    s = apply(s, { t: 'playSite', inst: b, c: cell(2, 2) });
    expect(s.players[0].mana).toBe(2);                       // second Lone Tower: site mana only, no bonus
  });
  it('Holy Ground heals each nearby Avatar', async () => {
    const { effectsFromText } = await import('../src/engine/cards');
    const fx = effectsFromText('Site', 'Genesis → Each nearby Avatar heals 3 life.');
    const holy = T('Holy Ground', 'Site', { effects: fx });
    let s = start(0); s.players[0].life = 10; s.players[1].life = 10;
    s = apply(s, { t: 'playSite', inst: give(s, 0, holy), c: AVATAR_START[0] });
    expect(s.players[0].life).toBe(13); expect(s.players[1].life).toBe(10); // the far Avatar is not nearby
  });
});

describe('carried artifacts', () => {
  it('an artifact handed to a unit travels with it and stays where the bearer dies', () => {
    let s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); s.units[s.players[1].avatar].tapped = true;
    s.players[0].mana = 5;
    const runner = unit(s, 0, cell(2, 2), id('Ember Runner'));
    const foe = unit(s, 1, cell(2, 1), id('Hill Giant'), { tapped: true });
    const lantern = give(s, 0, id('Old Lantern'));
    expect(reason(s, { t: 'cast', inst: lantern, c: cell(2, 2), target: foe })).toMatch(/your own units/);
    s = apply(s, { t: 'cast', inst: lantern, c: cell(2, 2), target: runner });
    expect(s.perms[0].carrier).toBe(runner);
    s = apply(s, { t: 'move', unit: runner, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: foe } });
    expect(s.units[runner]).toBeUndefined();                 // the giant strikes back
    expect(s.perms[0].carrier).toBeUndefined(); expect(s.perms[0].c).toBe(cell(2, 1)); // dropped where it fell
    s = apply(s, { t: 'manual', op: 'carry', perm: s.perms[0].id, unit: foe });
    expect(s.perms[0].carrier).toBe(foe); expect(s.perms[0].owner).toBe(1);
  });
});

describe('card abilities read from text', () => {
  const read = (type: CardDef['type'], name: string, rules: string, extra: Partial<CardDef> = {}) => {
    const c = makeCard({ name, type, rules, ...extra });
    c.effects = normalizeApiCards([{ id: c.id, name, engine: { type, rules, cost: c.cost, attack: c.attack, defense: c.defense } }]).cards[0].effects;
    cards[c.id] = c; forgetStatics(cards); return c.id;
  };
  const board = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); return s; };

  it('a tap ability is used when the player chooses, needs an untapped source, and taps it', () => {
    let s = board();
    const pinger = read('Minion', 'Test Pinger', 'Tap → Deal 1 damage to target nearby minion.', { attack: 1, defense: 1 });
    const me = unit(s, 0, cell(2, 2), pinger);
    const foe = unit(s, 1, cell(2, 1), id('Ember Runner'));
    const fx = cards[pinger].effects.findIndex((e) => e.on === 'tap');
    expect(legalActions(s).some((a) => a.t === 'ability')).toBe(true);
    expect(reason(s, { t: 'ability', src: { unit: me }, fx, choices: [] })).toMatch(/valid target/);
    const choices: { target?: string }[] = []; choices[fx] = { target: foe };
    s = apply(s, { t: 'ability', src: { unit: me }, fx, choices });
    expect(s.units[me].tapped).toBe(true); expect(s.units[foe].damage).toBe(1);
    expect(reason(s, { t: 'ability', src: { unit: me }, fx, choices })).toMatch(/tapped/);
  });
  it('static "allies here have +1 power" changes power while the source is in the realm', () => {
    const s = board();
    const banner = read('Minion', 'Test Banner', 'Other allies here have +1 power.', { attack: 1, defense: 1 });
    const runner = unit(s, 0, cell(2, 2), id('Ember Runner'));
    const b = unit(s, 0, cell(2, 2), banner);
    expect(power(s, s.units[runner])).toBe(cards[id('Ember Runner')].attack + 1);
    expect(power(s, s.units[b])).toBe(1);                                    // "other": not itself
    delete s.units[b];
    expect(power(s, s.units[runner])).toBe(cards[id('Ember Runner')].attack);
  });
  it('a this-turn boost from a spell ends with the turn', () => {
    let s = board(); s.players[0].mana = 9;
    const pump = read('Magic', 'Test Pump', 'Target minion gets +2 power this turn.', { cost: 1 });
    const runner = unit(s, 0, cell(2, 2), id('Ember Runner'));
    s = apply(s, { t: 'cast', inst: give(s, 0, pump), target: runner });
    expect(power(s, s.units[runner])).toBe(cards[id('Ember Runner')].attack + 2);
    s = apply(s, { t: 'endTurn' });
    expect(power(s, s.units[runner])).toBe(cards[id('Ember Runner')].attack);
  });
  it('a Deathrite that needs a target waits in the queue for its controller', () => {
    let s = board(); s.players[0].mana = 9; s.units[s.players[1].avatar].tapped = true;
    const martyr = read('Minion', 'Test Martyr', 'Deathrite → Deal 2 damage to target minion.', { attack: 1, defense: 1 });
    const m = unit(s, 1, cell(2, 1), martyr, { tapped: true });
    const giant = unit(s, 0, cell(2, 2), id('Hill Giant'));
    const other = unit(s, 0, cell(3, 3), id('Ember Runner'));
    s = apply(s, { t: 'move', unit: giant, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: m } });
    expect(s.units[m]).toBeUndefined();
    expect(s.queue?.length).toBe(1); expect(actor(s)).toBe(1);
    expect(reason(s, { t: 'endTurn' })).toMatch(/triggered ability/);
    const fx = cards[martyr].effects.findIndex((e) => e.on === 'deathrite');
    const choices: { target?: string }[] = []; choices[fx] = { target: other };
    s = apply(s, { t: 'trigger', choices });
    expect(s.queue).toBeUndefined(); expect(s.units[other]).toBeUndefined(); // 2 damage kills the 2/2 runner
    expect(actor(s)).toBe(0);
  });
  it('start-of-turn abilities resolve on their own when they need no choice', () => {
    let s = board(); s.players[0].life = 10;
    const shrine = read('Aura', 'Test Shrine', 'At the start of your turn, gain 2 life.');
    s.inst['0zz'] = shrine; s.perms.push({ id: 'mz', inst: '0zz', owner: 0, c: cell(2, 3), kind: 'aura' });
    s = apply(s, { t: 'endTurn' }); s = apply(s, { t: 'draw', deck: 'spellbook' }); s = apply(s, { t: 'endTurn' });
    expect(s.players[0].life).toBe(12);
  });
  it('text the reader does not know is logged for the hand tools, and the rest still happens', () => {
    let s = board(); s.players[0].mana = 9;
    const odd = read('Magic', 'Test Odd', 'Draw a spell. Swap two sites you control.', { cost: 1 });
    const before = s.players[0].hand.length;
    s = apply(s, { t: 'cast', inst: give(s, 0, odd) });
    expect(s.players[0].hand.length).toBe(before + 1);                     // given card cast (-1), drew one (+1)
    expect(s.log.some((l) => l.manual && /Swap two sites/.test(l.text))).toBe(true);
  });
});

describe('rules checked against the Codex', () => {
  const board = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); return s; };
  it('Ward breaks instead of damage, destruction, or being targeted by the opponent', () => {
    let s = board(); s.players[0].mana = 9;
    const w = T('Test Warded', 'Minion', { attack: 2, defense: 2, keywords: ['Ward'] });
    const foe = unit(s, 1, cell(2, 2), w, { ward: true });
    const bolt = give(s, 0, id('Firebolt'));
    s = apply(s, { t: 'cast', inst: bolt, target: foe });
    expect(s.units[foe].damage).toBe(0); expect(s.units[foe].ward).toBe(false);
    s = apply(s, { t: 'cast', inst: give(s, 0, id('Firebolt')), target: foe });
    expect(s.units[foe]).toBeUndefined();                                   // no Ward left: 3 damage kills it
  });
  it('a summoned minion with the Ward keyword enters with a Ward mark', () => {
    let s = board(); s.players[0].mana = 9;
    const w = T('Test Warded 2', 'Minion', { attack: 1, defense: 1, keywords: ['Ward'] });
    s = apply(s, { t: 'cast', inst: give(s, 0, w), c: cell(2, 3) });
    expect(Object.values(s.units).find((u) => u.inst.startsWith('0x'))?.ward).toBe(true);
  });
  it('healing stops at the Avatar\'s maximum life', () => {
    let s = board(); s.players[0].mana = 9; s.players[0].life = 19; site(s, 0, cell(0, 3), 'Stone Terrace');
    s = apply(s, { t: 'cast', inst: give(s, 0, id('Mend')) });
    expect(s.players[0].life).toBe(20);
  });
  it('a projectile stops at the first unit in its path, ally or enemy, and can hit an enemy at the shooter\'s location', () => {
    let s = board();
    const archer = unit(s, 0, cell(2, 3), id('Ash Archer'));
    const ally = unit(s, 0, cell(2, 2), id('Ember Runner'));
    unit(s, 1, cell(2, 1), id('Wind Sprite'));
    s = apply(s, { t: 'shoot', unit: archer, dx: 0, dy: -1 });
    expect(s.units[ally]).toBeUndefined();                                  // 2 power kills the 2/2 ally in the way
    let t = board();
    const a2 = unit(t, 0, cell(2, 3), id('Ash Archer')); const e2 = unit(t, 1, cell(2, 3), id('Ember Runner'));
    t = apply(t, { t: 'shoot', unit: a2, dx: 1, dy: 0 });
    expect(t.units[e2]).toBeUndefined();
  });
  it('a flooded site counts as a water site', () => {
    const s = board();
    const flooded = T('Test Flooded', 'Site', { keywords: ['Flood'], thresholds: { air: 0, earth: 1, fire: 0, water: 0 } });
    s.inst['0fl'] = flooded; s.sites[cell(0, 3)] = { inst: '0fl', owner: 0 };
    expect(isWater(s, cell(0, 3))).toBe(true);
  });
});

describe('more card text (wording from the live card list)', () => {
  const read = (type: CardDef['type'], name: string, rules: string, extra: Partial<CardDef> = {}) => {
    const c = makeCard({ name, type, rules, ...extra });
    c.effects = normalizeApiCards([{ id: c.id, name, engine: { type, rules, cost: c.cost, attack: c.attack, defense: c.defense, keywords: c.keywords } }]).cards[0].effects;
    cards[c.id] = c; forgetStatics(cards); return c.id;
  };
  const board = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); return s; };
  const fx = (cid: string, op: string) => cards[cid].effects.findIndex((e) => e.op === op);
  it('"Provides (A) and ① to its controller" adds threshold and a mana each turn', () => {
    let s = board();
    const core = read('Artifact', 'Test Core', 'Provides (A) and ① to its controller.');
    s.inst['0cr'] = core; s.perms.push({ id: 'mc', inst: '0cr', owner: 0, c: cell(2, 3), kind: 'artifact' });
    expect(thresholdOf(s, 0).air).toBe(1);
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' }); s = apply(s, { t: 'endTurn' });
    expect(s.players[0].mana).toBe(11);                                    // 10 sites + 1 from the core
  });
  it('"Genesis → Provides (A)(E)(F) this turn" lasts only this turn', () => {
    let s = start(0);
    const bloom = read('Site', 'Test Bloom', 'Genesis → Provides (A)(E)(F) this turn.');
    s = apply(s, { t: 'playSite', inst: give(s, 0, bloom), c: AVATAR_START[0] });
    expect(thresholdOf(s, 0)).toMatchObject({ air: 1, earth: 1, fire: 1 });
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    expect(thresholdOf(s, 0).air).toBe(0);
  });
  it('a token summoned by Deathrite enters, and is banished (not put in the cemetery) when it dies', () => {
    let s = board(); s.players[0].mana = 9;
    cards['tok:skeleton'] = makeCard({ id: 'tok:skeleton', name: 'Skeleton', type: 'Minion', attack: 1, defense: 1, category: 'Token' });
    const twosome = read('Minion', 'Test Twosome', 'Deathrite → Summon a Skeleton token here.', { attack: 1, defense: 1 });
    const t = unit(s, 0, cell(2, 2), twosome);
    s = apply(s, { t: 'manual', op: 'destroy', unit: t });
    const sk = Object.values(s.units).find((u) => cards[s.inst[u.inst]].name === 'Skeleton')!;
    expect(sk.c).toBe(cell(2, 2));
    const before = s.players[0].cemetery.length;
    s = apply(s, { t: 'manual', op: 'destroy', unit: sk.id });
    expect(s.players[0].cemetery.length).toBe(before);
  });
  it('"Shoot three projectiles in the same direction" hits up to three times', () => {
    let s = board(); s.players[0].mana = 9; s.units[s.players[0].avatar].c = cell(2, 3);
    const bolts = read('Magic', 'Test Bolts', 'Shoot three projectiles in the same direction, one at a time. Each deals 1 damage.', { cost: 1 });
    const foe = unit(s, 1, cell(2, 1), id('Kiln Brute'));                    // 4 defense
    const ch: { dir?: [number, number] }[] = []; ch[fx(bolts, 'shoot')] = { dir: [0, -1] };
    s = apply(s, { t: 'cast', inst: give(s, 0, bolts), choices: ch });
    expect(s.units[foe].damage).toBe(3);
  });
  it('area damage at a chosen location hits each unit there', () => {
    let s = board(); s.players[0].mana = 9;
    const blast = read('Magic', 'Test Blast', 'Deal 3 damage to each unit at target location up to two steps away.', { cost: 1 });
    const a = unit(s, 1, cell(2, 1), id('Ember Runner')), b = unit(s, 1, cell(2, 1), id('Wind Sprite'));
    const ch: { cell?: number }[] = []; ch[fx(blast, 'damage')] = { cell: cell(2, 1) };
    s = apply(s, { t: 'cast', inst: give(s, 0, blast), choices: ch });
    expect(s.units[a]).toBeUndefined(); expect(s.units[b]).toBeUndefined();
    const far: { cell?: number }[] = []; far[fx(blast, 'damage')] = { cell: cell(2, 0) };
    s.players[0].mana = 9;
    expect(reason(s, { t: 'cast', inst: give(s, 0, blast), choices: far })).toMatch(/location in range/); // three steps from the Avatar
  });
  it('a reaction: "Whenever a minion dies nearby, you heal 1"', () => {
    let s = board(); s.players[0].life = 10;
    const box = read('Artifact', 'Test Box', 'Whenever a minion dies nearby, you heal 1.');
    s.inst['0bx'] = box; s.perms.push({ id: 'mb', inst: '0bx', owner: 0, c: cell(2, 2), kind: 'artifact' });
    const v = unit(s, 1, cell(2, 1), id('Ember Runner'));
    s = apply(s, { t: 'manual', op: 'destroy', unit: v });
    expect(s.players[0].life).toBe(11);
  });
  it('"You may …" can be skipped in the pop-up', () => {
    let s = board(); s.players[0].mana = 9;
    const maybe = read('Magic', 'Test Maybe', 'You may draw a spell.', { cost: 1 });
    expect(cards[maybe].effects[0]).toMatchObject({ op: 'draw', optional: true });
    const n = s.players[0].hand.length;
    s = apply(s, { t: 'cast', inst: give(s, 0, maybe), choices: [{ skip: true }] });
    expect(s.players[0].hand.length).toBe(n);                              // cast one, drew none
  });
  it('"Can\'t defend" keeps a unit out of defending', () => {
    let s = board(); s.units[s.players[1].avatar].tapped = true;
    const lump = read('Minion', 'Test Lump', "Can't defend or intercept.", { attack: 3, defense: 3 });
    unit(s, 1, cell(2, 1), lump);
    const tgt = unit(s, 1, cell(2, 1), id('Ember Runner'), { tapped: true });
    const att = unit(s, 0, cell(2, 2), id('Hill Giant'));
    s = apply(s, { t: 'move', unit: att, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: tgt } });
    expect(s.pending).toBeNull();                                           // nobody could defend
  });
});

describe('damage prevention read from text', () => {
  it('"Takes no damage from units with 4 or more power" and "Nearby allies take 1 less damage"', () => {
    const mk = (name: string, rules: string, atk: number) => { const c = makeCard({ name, type: 'Minion', rules, attack: atk, defense: atk }); c.effects = normalizeApiCards([{ id: c.id, name, engine: { type: 'Minion', rules } }]).cards[0].effects; cards[c.id] = c; forgetStatics(cards); return c.id; };
    const pix = mk('Test Pixies', 'Takes no damage from units with 4 or more power.', 1);
    const maid = mk('Test Maidens', 'Nearby allies take 1 less damage.', 2);
    let s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); s.units[s.players[1].avatar].tapped = true;
    const p1 = unit(s, 1, cell(2, 1), pix, { tapped: true });
    const giant = unit(s, 0, cell(2, 2), id('Hill Giant'));
    s = apply(s, { t: 'move', unit: giant, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: p1 } });
    expect(s.units[p1]).toBeDefined();                                       // 7 power: no damage
    let t = start(0); for (let c = 0; c < 20; c++) site(t, c < 10 ? 1 : 0, c); t.players[0].mana = 9;
    const brute = unit(t, 1, cell(2, 2), id('Kiln Brute')); unit(t, 1, cell(3, 2), maid);
    t = apply(t, { t: 'cast', inst: give(t, 0, id('Firebolt')), target: brute });
    expect(t.units[brute].damage).toBe(2);                                   // 3 - 1
  });
});

describe('Beta Avatar abilities from their text', () => {
  const read = (type: CardDef['type'], name: string, rules: string, extra: Partial<CardDef> = {}) => {
    const c = makeCard({ name, type, rules, ...extra });
    c.effects = normalizeApiCards([{ id: c.id, name, engine: { type, rules, cost: c.cost, attack: c.attack, defense: c.defense, life: c.life } }]).cards[0].effects;
    cards[c.id] = c; forgetStatics(cards); return c.id;
  };
  const withAvatar = (av: string, life = 20) => { const s = start(0); s.inst[s.units[s.players[0].avatar].inst] = av; cards[av].life = life; return s; };
  it('Sparkmage-style: damage to a random other unit at a nearby location equal to the (A) on spells cast this turn', () => {
    const av = read('Avatar', 'Test Spark', "Tap → Play or draw a site.\n\nTap → Target nearby location. Deal damage to another random unit there equal to the sum of (A) on spells you've cast this turn.");
    let s = withAvatar(av); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); s.players[0].mana = 9;
    const gust = give(s, 0, id('Gust Strike')); // an air spell (1 air)
    const foe = unit(s, 1, cell(2, 2), id('Kiln Brute'));
    s.players[0].hand.push(gust); site(s, 0, cell(0, 3), 'Gale Ridge' as never);
    const fxi = cards[av].effects.findIndex((e) => e.op === 'choose');
    s.players[0].cast = { turn: s.turn, ids: [id('Gust Strike'), id('Gust Strike')] };   // two air spells already cast this turn
    const ch: { cell?: number }[] = []; ch[fxi] = { cell: cell(2, 2) };
    s = apply(s, { t: 'ability', src: { unit: s.players[0].avatar }, fx: fxi, choices: ch });
    expect(s.units[foe].damage).toBe(2);
    expect(s.units[s.players[0].avatar].tapped).toBe(true);
  });
  it('Flamecaller-style: banish dead fire minions as the cost; the projectile deals their (F)', () => {
    const av = read('Avatar', 'Test Flame', 'Tap → Play or draw a site.\n\nTap, Banish all your dead fire minions → Shoot a projectile. It deals damage equal to to the sum of their (F).');
    let s = withAvatar(av); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c);
    const fxi = cards[av].effects.findIndex((e) => e.op === 'shoot');
    expect(reason(s, { t: 'ability', src: { unit: s.players[0].avatar }, fx: fxi, choices: [] })).toMatch(/no dead fire/);
    s.inst['0d1'] = id('Kiln Brute'); s.inst['0d2'] = id('Pyre Drake'); s.players[0].cemetery.push('0d1', '0d2'); // 1 + 2 fire
    const foe = unit(s, 1, cell(2, 1), id('Hill Giant'));
    const ch: { dir?: [number, number] }[] = []; ch[fxi] = { dir: [0, -1] };
    s = apply(s, { t: 'ability', src: { unit: s.players[0].avatar }, fx: fxi, choices: ch });
    expect(s.units[foe].damage).toBe(3); expect(s.players[0].cemetery).not.toContain('0d1');
  });
  it('Geomancer-style: after playing an earth site, a void next to the Avatar may become Rubble; Rubble can be replaced by the top site', () => {
    const av = read('Avatar', 'Test Geo', 'Tap → Play or draw a site. If you played an earth site, fill a void adjacent to you with Rubble.\n\nTap → Replace an adjacent Rubble with the topmost site of your atlas.');
    let s = withAvatar(av);
    const terrace = give(s, 0, id('Stone Terrace'));
    s = apply(s, { t: 'playSite', inst: terrace, c: AVATAR_START[0] });
    expect(s.queue?.length).toBe(1);                                         // choose which void
    const fxi = cards[av].effects.findIndex((e) => e.op === 'rubble');
    const ch: { cell?: number }[] = []; ch[fxi] = { cell: cell(1, 3) };
    s = apply(s, { t: 'trigger', choices: ch });
    expect(s.sites[cell(1, 3)]).toEqual({ inst: null, owner: null });
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' }); s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    const rep = cards[av].effects.findIndex((e) => e.op === 'replaceRubble');
    const top = s.players[0].atlas[0];
    const ch2: { cell?: number }[] = []; ch2[rep] = { cell: cell(1, 3) };
    s = apply(s, { t: 'ability', src: { unit: s.players[0].avatar }, fx: rep, choices: ch2 });
    expect(s.sites[cell(1, 3)]).toEqual({ inst: top, owner: 0 });
  });
  it('Waveshaper-style: flood a site near water, tap minions there without Submerge, and they skip their next untap', () => {
    const av = read('Avatar', 'Test Wave', "Tap → Play or draw a site.\n\nTap → Flood a site near your body of water until you do so again. Tap minions without submerge there. They don't untap the next time they would.");
    let s = withAvatar(av); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c);
    site(s, 0, cell(1, 2), 'Mill Pond');                                    // water next to the target
    const foe = unit(s, 1, cell(2, 2), id('Kiln Brute')); const fish = unit(s, 1, cell(2, 2), id('Reed Lurker'));
    const fxi = cards[av].effects.findIndex((e) => e.op === 'flood');
    const ch: { cell?: number }[] = []; ch[fxi] = { cell: cell(2, 2) };
    s = apply(s, { t: 'ability', src: { unit: s.players[0].avatar }, fx: fxi, choices: ch });
    expect(isWater(s, cell(2, 2))).toBe(true);
    expect(s.units[foe].tapped).toBe(true); expect(s.units[fish].tapped).toBe(false);
    s = apply(s, { t: 'endTurn' });
    expect(s.units[foe].tapped).toBe(true);                                 // skipped this untap
  });
});

describe('short passive and end-of-turn lines', () => {
  const read = (type: CardDef['type'], name: string, rules: string, extra: Partial<CardDef> = {}) => {
    const c = makeCard({ name, type, rules, ...extra });
    c.effects = normalizeApiCards([{ id: c.id, name, engine: { type, rules, cost: c.cost, attack: c.attack, defense: c.defense } }]).cards[0].effects;
    cards[c.id] = c; forgetStatics(cards); return c.id;
  };
  const board = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); return s; };
  it('"All other minions lose Airborne" takes Airborne away while it is in the realm', () => {
    const s = board();
    const baron = read('Minion', 'Test Baron', 'All other minions lose Airborne.', { attack: 2, defense: 2 });
    const sprite = unit(s, 1, cell(2, 1), id('Wind Sprite'));
    expect(has(s, s.units[sprite], 'Airborne')).toBe(true);
    unit(s, 0, cell(4, 3), baron);
    expect(has(s, s.units[sprite], 'Airborne')).toBe(false);
  });
  it('"Dies at the end of your turn."', () => {
    let s = board();
    const ig = read('Minion', 'Test Ignited', 'Dies at the end of your turn.', { attack: 3, defense: 3 });
    const u = unit(s, 0, cell(2, 3), ig);
    s = apply(s, { t: 'endTurn' });
    expect(s.units[u]).toBeUndefined();
  });
  it('"Bearer has Ranged 3."', () => {
    const s = board();
    const bow = read('Artifact', 'Test Bow', 'Bearer has Ranged 3.');
    const u = unit(s, 0, cell(2, 3), id('Ember Runner'));
    s.inst['0bw'] = bow; s.perms.push({ id: 'mbw', inst: '0bw', owner: 0, c: cell(2, 3), kind: 'artifact', carrier: u });
    expect(rangedOf(s, s.units[u])).toBe(3);
  });
});

describe('choosing cards from zones, the collection, and targets', () => {
  const read = (type: CardDef['type'], name: string, rules: string, extra: Partial<CardDef> = {}) => {
    const c = makeCard({ name, type, rules, ...extra });
    c.effects = normalizeApiCards([{ id: c.id, name, engine: { type, rules, cost: c.cost, attack: c.attack, defense: c.defense, keywords: c.keywords } }]).cards[0].effects;
    cards[c.id] = c; forgetStatics(cards); return c.id;
  };
  const board = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); s.players[0].mana = 20; return s; };
  const fxOf = (cid: string, op: string) => cards[cid].effects.findIndex((e) => e.op === op);
  it('"Search your spellbook for an … card, reveal it, and put it into your hand. Shuffle your spellbook."', () => {
    let s = board();
    const tutor = read('Magic', 'Test Tutor', 'Search your spellbook for a minion that costs ② or less, reveal it, and put it into your hand. Shuffle your spellbook.', { cost: 1 });
    const want = s.players[0].spellbook.find((i) => cards[s.inst[i]].type === 'Minion' && cards[s.inst[i]].cost <= 2)!;
    const ch: { cards?: string[] }[] = []; ch[fxOf(tutor, 'pick')] = { cards: [want] };
    s = apply(s, { t: 'cast', inst: give(s, 0, tutor), choices: ch });
    expect(s.players[0].hand).toContain(want); expect(s.players[0].spellbook).not.toContain(want);
  });
  it('"Look at your next seven spells. Put one in your hand and the rest on the bottom …"', () => {
    let s = board();
    const browse = read('Magic', 'Test Browse', 'Look at your next seven spells. Put one in your hand and the rest on the bottom of your spellbook in any order.', { cost: 1 });
    const seven = s.players[0].spellbook.slice(0, 7);
    const ch: { cards?: string[] }[] = []; ch[fxOf(browse, 'pick')] = { cards: [seven[3]] };
    s = apply(s, { t: 'cast', inst: give(s, 0, browse), choices: ch });
    expect(s.players[0].hand).toContain(seven[3]);
    expect(s.players[0].spellbook.slice(-6).sort()).toEqual(seven.filter((x) => x !== seven[3]).sort());
  });
  it('"Return a minion from your cemetery to your hand."', () => {
    let s = board();
    const rescue = read('Magic', 'Test Rescue', 'Return a minion from your cemetery to your hand.', { cost: 1 });
    s.inst['0dd'] = id('Kiln Brute'); s.players[0].cemetery.push('0dd');
    const ch: { cards?: string[] }[] = []; ch[fxOf(rescue, 'pick')] = { cards: ['0dd'] };
    s = apply(s, { t: 'cast', inst: give(s, 0, rescue), choices: ch });
    expect(s.players[0].hand).toContain('0dd');
  });
  it('a named card is cast from the collection (casual play: always available), paying its cost', () => {
    let s = board(); s.players[0].mana = 5;
    const town = read('Site', 'Test Town', 'Genesis → You may cast a Kiln Brute from your collection to this site.');
    s.sites[cell(1, 3)] = null; s.players[0].income! -= 1; s.units[s.players[0].avatar].tapped = false;
    s = apply(s, { t: 'playSite', inst: give(s, 0, town), c: cell(1, 3) });
    expect(s.queue?.length).toBe(1);
    const opts = (s.queue![0]); void opts;
    const ch: { cards?: string[] }[] = []; ch[fxOf(town, 'pick')] = { cards: ['card:' + id('Kiln Brute')] };
    s = apply(s, { t: 'trigger', choices: ch });
    expect(Object.values(s.units).some((u) => cards[s.inst[u.inst]].name === 'Kiln Brute' && u.c === cell(1, 3))).toBe(true);
    expect(s.players[0].mana).toBe(5 + 1 - 3);                              // site mana +1, Kiln Brute costs 3
  });
  it('a deck\'s collection is a zone in the game', () => {
    const s = createGame(cards, [{ ...PRACTICE_DECKS[0], collection: [id('Hill Giant')] }, PRACTICE_DECKS[1]], 3, 0);
    expect(s.players[0].collection?.map((i) => cards[s.inst[i]].name)).toEqual(['Hill Giant']);
  });
  it('"Reveal your topmost spell. If it\'s a minion, you may summon it here."', () => {
    let s = board();
    const mother = read('Minion', 'Test Mother', "At the start of your turn, reveal your topmost spell. If it's a minion, you may summon it here.", { attack: 1, defense: 1 });
    unit(s, 0, cell(2, 3), mother);
    s.inst['0tp'] = id('Ember Runner'); s.players[0].spellbook.unshift('0tp');
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' }); s = apply(s, { t: 'endTurn' });
    expect(s.queue?.length).toBe(1);
    const ch: { cards?: string[] }[] = []; ch[fxOf(mother, 'pick')] = { cards: ['0tp'] };
    s = apply(s, { t: 'trigger', choices: ch });
    expect(Object.values(s.units).some((u) => u.inst === '0tp')).toBe(true);
  });
  it('targets: a choice without the word "target" may pick a stealthed enemy; a target may not; attacks cannot target Stealth', () => {
    let s = board();
    const kill = read('Magic', 'Test Kill', 'Kill target minion.', { cost: 1 });
    const slay = read('Magic', 'Test Slay', 'Kill a minion.', { cost: 1 });
    const sneak = unit(s, 1, cell(2, 2), id('Root Stalker'));                // Stealth
    expect(cards[kill].effects[0].targets).toBe(true); expect(cards[slay].effects[0].targets).toBe(false);
    expect(reason(s, { t: 'cast', inst: give(s, 0, kill), target: sneak })).toMatch(/valid target/);
    s = apply(s, { t: 'cast', inst: give(s, 0, slay), target: sneak });
    expect(s.units[sneak]).toBeUndefined();
    let t = board(); t.units[t.players[1].avatar].tapped = true;
    const sn = unit(t, 1, cell(2, 2), id('Root Stalker')); const att = unit(t, 0, cell(2, 3), id('Hill Giant'));
    expect(reason(t, { t: 'move', unit: att, path: [{ c: cell(2, 2), r: 'surface' }], attack: { unit: sn } })).toMatch(/Stealth/);
  });
  it('targets: the source must be in the same region as what it targets', () => {
    let s = board();
    const zap = read('Magic', 'Test Far Zap', 'Deal 1 damage to target minion.', { cost: 1 });
    const mole = unit(s, 1, cell(2, 2), id('Burrow Mole'), { r: 'under' });
    expect(reason(s, { t: 'cast', inst: give(s, 0, zap), target: mole })).toMatch(/valid target/);
  });
});

describe('movement from card text (Codex "Forced Movement", "Teleport")', () => {
  const read = (type: CardDef['type'], name: string, rules: string, extra: Partial<CardDef> = {}) => {
    const c = makeCard({ name, type, rules, ...extra });
    c.effects = normalizeApiCards([{ id: c.id, name, engine: { type, rules, cost: c.cost, attack: c.attack, defense: c.defense, keywords: c.keywords } }]).cards[0].effects;
    cards[c.id] = c; forgetStatics(cards); return c.id;
  };
  const board = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); s.players[0].mana = 20; return s; };
  it('"Lure target adjacent enemy minion to take a step closer" moves it one step toward the source', () => {
    let s = board();
    const lure = read('Minion', 'Test Lurer', 'Genesis → Lure target nearby enemy minion to take a step closer.', { attack: 1, defense: 1 });
    const foe = unit(s, 1, cell(2, 1), id('Ember Runner'));
    s = apply(s, { t: 'cast', inst: give(s, 0, lure), c: cell(2, 2), target: foe });
    expect(s.units[foe].c).toBe(cell(2, 2));
  });
  it('an Immobile unit cannot be lured into a step, but can be teleported', () => {
    let s = board();
    const lure = read('Minion', 'Test Lurer 2', 'Genesis → Lure target nearby enemy minion to take a step closer.', { attack: 1, defense: 1 });
    const pull = read('Magic', 'Test Pull', 'Teleport target minion to the caster\'s location.', { cost: 1 });
    const rock = read('Minion', 'Test Rock', 'Immobile', { attack: 1, defense: 5, keywords: ['Immobile'] });
    const r = unit(s, 1, cell(2, 1), rock);
    s = apply(s, { t: 'cast', inst: give(s, 0, lure), c: cell(2, 2), target: r });
    expect(s.units[r].c).toBe(cell(2, 1));
    s = apply(s, { t: 'cast', inst: give(s, 0, pull), target: r });
    expect(s.units[r].c).toBe(s.units[s.players[0].avatar].c);
  });
  it('"Teleport target weaker minion to this location. … may strike it."', () => {
    let s = board();
    const harp = read('Minion', 'Test Harpies', 'Genesis → Teleport target weaker minion to this location. Test Harpies may strike it.', { attack: 3, defense: 3 });
    const weak = unit(s, 1, cell(4, 0), id('Wind Sprite')); const strong = unit(s, 1, cell(0, 0), id('Hill Giant'));
    expect(reason(s, { t: 'cast', inst: give(s, 0, harp), c: cell(2, 3), target: strong })).toMatch(/valid target/);
    s = apply(s, { t: 'cast', inst: give(s, 0, harp), c: cell(2, 3), target: weak });
    expect(s.units[weak]).toBeUndefined();                                  // teleported in, then struck for 3
  });
  it('"An allied minion takes a step." to an adjacent square the player picks', () => {
    let s = board();
    const wind = read('Magic', 'Test Wind', 'An allied minion takes a step.', { cost: 1 });
    const runner = unit(s, 0, cell(2, 2), id('Ember Runner'));
    const ch: { target?: string; cell?: number }[] = []; ch[0] = { target: runner, cell: cell(3, 2) };
    s = apply(s, { t: 'cast', inst: give(s, 0, wind), choices: ch });
    expect(s.units[runner].c).toBe(cell(3, 2));
  });
});

describe('auras occupy a 2×2 area (Codex "Casting Auras")', () => {
  const read = (type: CardDef['type'], name: string, rules: string, extra: Partial<CardDef> = {}) => {
    const c = makeCard({ name, type, rules, ...extra });
    c.effects = normalizeApiCards([{ id: c.id, name, engine: { type, rules, cost: c.cost } }]).cards[0].effects;
    cards[c.id] = c; forgetStatics(cards); return c.id;
  };
  const board = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); s.players[0].mana = 20; return s; };
  it('an aura can be conjured anywhere, its static ability reaches the four squares, and it lasts N turns', () => {
    let s = board();
    const tangle = read('Aura', 'Test Tangle', 'Minions occupying affected sites lose Airborne.\nLasts 2 of your turns.', { cost: 1 });
    const inArea = unit(s, 1, cell(3, 1), id('Wind Sprite')); const outside = unit(s, 1, cell(0, 0), id('Wind Sprite'));
    expect(reason(s, { t: 'cast', inst: give(s, 0, tangle), c: cell(4, 1) })).toMatch(/2×2/);
    s = apply(s, { t: 'cast', inst: give(s, 0, tangle), c: cell(2, 0) });   // covers C4 D4 C3 D3 → cells (2,0) (3,0) (2,1) (3,1)
    expect(has(s, s.units[inArea], 'Airborne')).toBe(false);
    expect(has(s, s.units[outside], 'Airborne')).toBe(true);
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' }); s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    expect(s.perms.some((m) => m.kind === 'aura')).toBe(true);              // one counter
    s = apply(s, { t: 'endTurn' });
    expect(s.perms.some((m) => m.kind === 'aura')).toBe(false);             // dispelled after its second turn
  });
  it('"here" on an aura means all four squares', () => {
    let s = board();
    const storm = read('Aura', 'Test Storm', 'At the end of your turn, deal 1 damage to each unit here.', { cost: 1 });
    const a = unit(s, 1, cell(2, 0), id('Wind Sprite')), b = unit(s, 1, cell(3, 1), id('Wind Sprite')), c = unit(s, 1, cell(0, 0), id('Wind Sprite'));
    s = apply(s, { t: 'cast', inst: give(s, 0, storm), c: cell(2, 0) });
    s = apply(s, { t: 'endTurn' });
    expect(s.units[a]).toBeUndefined(); expect(s.units[b]).toBeUndefined();  // both squares of the area were hit (1 power: 1 damage kills)
    expect(s.units[c]).toBeDefined();                                         // outside the area
  });
});

describe('conditions on abilities', () => {
  const read = (type: CardDef['type'], name: string, rules: string, extra: Partial<CardDef> = {}) => {
    const c = makeCard({ name, type, rules, ...extra });
    c.effects = normalizeApiCards([{ id: c.id, name, engine: { type, rules, cost: c.cost, attack: c.attack, defense: c.defense } }]).cards[0].effects;
    cards[c.id] = c; forgetStatics(cards); return c.id;
  };
  it('"Has Airborne and +1 power while Warded" only while it has a Ward', () => {
    const s = start(0);
    const angel = read('Minion', 'Test Angel', 'Has Airborne and +1 power while Warded.', { attack: 2, defense: 2 });
    const u = unit(s, 0, cell(2, 2), angel, { ward: true });
    expect(power(s, s.units[u])).toBe(3); expect(has(s, s.units[u], 'Airborne')).toBe(true);
    s.units[u].ward = false;
    expect(power(s, s.units[u])).toBe(2); expect(has(s, s.units[u], 'Airborne')).toBe(false);
  });
  it('"Has +3 power during enemy turns"', () => {
    let s = start(0);
    const iron = read('Minion', 'Test Ironside', 'Has +3 power during enemy turns.', { attack: 2, defense: 2 });
    const u = unit(s, 0, cell(2, 3), iron);
    expect(power(s, s.units[u])).toBe(2);
    s = apply(s, { t: 'endTurn' });
    expect(power(s, s.units[u])).toBe(5);
  });
  it('"Disabled unless adjacent to an allied Spellcaster"', () => {
    const s = start(0);
    const spirit = read('Minion', 'Test Bound', 'Disabled unless adjacent to an allied Spellcaster.', { attack: 3, defense: 3 });
    const u = unit(s, 0, cell(0, 0), spirit);
    expect(isDisabled(s, s.units[u]) || has(s, s.units[u], 'Disabled')).toBe(true);
    unit(s, 0, cell(1, 0), id('Tide Caller'));                              // a Spellcaster next to it
    expect(has(s, s.units[u], 'Disabled')).toBe(false);
  });
});

describe('casting rules from card text', () => {
  const read = (type: CardDef['type'], name: string, rules: string, extra: Partial<CardDef> = {}) => {
    const c = makeCard({ name, type, rules, ...extra });
    c.effects = normalizeApiCards([{ id: c.id, name, engine: { type, rules, cost: c.cost, attack: c.attack, defense: c.defense } }]).cards[0].effects;
    cards[c.id] = c; forgetStatics(cards); return c.id;
  };
  const board = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); return s; };
  it('"Costs (2) less to cast if you have more life than each opponent"', () => {
    const s = board(); s.players[0].mana = 2;
    const knight = read('Minion', 'Test Knight', 'Costs (2) less to cast if you have more life than each opponent.', { cost: 4, attack: 3, defense: 3 });
    const k = give(s, 0, knight);
    expect(reason(s, { t: 'cast', inst: k, c: cell(2, 3) })).toMatch(/costs 4/);
    s.players[1].life = 15;
    expect(reason(s, { t: 'cast', inst: k, c: cell(2, 3) })).toBe('');
  });
  it('"You may cast this spell from your cemetery, banishing it afterward."', () => {
    let s = board(); s.players[0].mana = 9;
    const ghost = read('Magic', 'Test Ghostfire', 'Gain 1 life.\nYou may cast this spell from your cemetery, banishing it afterward.', { cost: 1 });
    s.inst['0gh'] = ghost; s.players[0].cemetery.push('0gh'); s.players[0].life = 15;
    expect(legalActions(s).some((a) => a.t === 'cast' && a.inst === '0gh')).toBe(true);
    s = apply(s, { t: 'cast', inst: '0gh' });
    expect(s.players[0].life).toBe(16); expect(s.players[0].cemetery).not.toContain('0gh');
  });
  it('"May be cast by any ally": range is measured from your allies too', () => {
    let s = board(); s.players[0].mana = 9;
    const bury = read('Magic', 'Test Bury', 'May be cast by any ally.\nDeal 1 damage to target adjacent minion.', { cost: 1 });
    const foe = unit(s, 1, cell(0, 0), id('Kiln Brute'));
    expect(reason(s, { t: 'cast', inst: give(s, 0, bury), target: foe })).toMatch(/valid target/); // nothing of yours is adjacent
    unit(s, 0, cell(1, 0), id('Ember Runner'));
    s = apply(s, { t: 'cast', inst: give(s, 0, bury), target: foe });
    expect(s.units[foe].damage).toBe(1);
  });
});

describe('site rules, control, tokens to many places, each-turn triggers', () => {
  const read = (type: CardDef['type'], name: string, rules: string, extra: Partial<CardDef> = {}) => {
    const c = makeCard({ name, type, rules, ...extra });
    c.effects = normalizeApiCards([{ id: c.id, name, engine: { type, rules, cost: c.cost, attack: c.attack, defense: c.defense } }]).cards[0].effects;
    cards[c.id] = c; forgetStatics(cards); return c.id;
  };
  const board = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); s.players[0].mana = 20; return s; };
  it('"Units with 3 or more power can\'t enter this site"', () => {
    const s = board();
    const hollows = read('Site', 'Test Hollows', "Units with 3 or more power can't enter this site.");
    s.inst['1hh'] = hollows; s.sites[cell(2, 1)] = { inst: '1hh', owner: 1 };
    const giant = unit(s, 0, cell(2, 2), id('Hill Giant')); const runner = unit(s, 0, cell(3, 1), id('Ember Runner'));
    expect(reason(s, { t: 'move', unit: giant, path: [{ c: cell(2, 1), r: 'surface' }] })).not.toBe('');
    expect(reason(s, { t: 'move', unit: runner, path: [{ c: cell(2, 1), r: 'surface' }] })).toBe('');
  });
  it('"Gain control of target enemy minion this turn and untap it": control comes back at the end of the turn', () => {
    let s = board();
    const betray = read('Magic', 'Test Betrayal', 'Gain control of target enemy minion this turn and untap it.', { cost: 1 });
    const foe = unit(s, 1, cell(2, 2), id('Kiln Brute'), { tapped: true });
    s = apply(s, { t: 'cast', inst: give(s, 0, betray), target: foe });
    expect(s.units[foe].owner).toBe(0); expect(s.units[foe].tapped).toBe(false);
    s = apply(s, { t: 'endTurn' });
    expect(s.units[foe].owner).toBe(1);
  });
  it('"Summon a Skeleton token to each other adjacent site"', () => {
    let s = board();
    cards['tok:skel2'] = makeCard({ id: 'tok:skel2', name: 'Skeleton', type: 'Minion', attack: 1, defense: 1, category: 'Token' });
    const necro = read('Minion', 'Test Necro', 'Genesis → Summon a Skeleton token to each other adjacent site.', { attack: 1, defense: 1 });
    s = apply(s, { t: 'cast', inst: give(s, 0, necro), c: cell(2, 2) });
    expect(Object.values(s.units).filter((u) => cards[s.inst[u.inst]].name === 'Skeleton').map((u) => u.c).sort()).toEqual([cell(1, 2), cell(3, 2), cell(2, 1), cell(2, 3)].sort());
  });
  it('"At the end of each turn, the controller of this\'s site loses 1 life" happens on both players\' turns', () => {
    let s = board();
    const egg = read('Artifact', 'Test Egg', "At the end of each turn, the controller of Test Egg's site loses 1 life.");
    s.inst['0eg'] = egg; s.perms.push({ id: 'meg', inst: '0eg', owner: 0, c: cell(2, 1), kind: 'artifact' }); // on player 2's site
    s = apply(s, { t: 'endTurn' }); s = apply(apply(s, { t: 'draw', deck: 'spellbook' }), { t: 'endTurn' });
    expect(s.players[1].life).toBe(18);
  });
});

describe('protections and restrictions', () => {
  const read = (type: CardDef['type'], name: string, rules: string, extra: Partial<CardDef> = {}) => {
    const c = makeCard({ name, type, rules, ...extra });
    c.effects = normalizeApiCards([{ id: c.id, name, engine: { type, rules, cost: c.cost, attack: c.attack, defense: c.defense } }]).cards[0].effects;
    cards[c.id] = c; forgetStatics(cards); return c.id;
  };
  const board = () => { const s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); s.players[0].mana = 20; return s; };
  it('"Can\'t be targeted or damaged by magic"', () => {
    const s = board();
    const mut = read('Minion', 'Test Mutation', "Can't be targeted or damaged by magic.", { attack: 2, defense: 2 });
    const u = unit(s, 1, cell(2, 2), mut);
    expect(reason(s, { t: 'cast', inst: give(s, 0, id('Firebolt')), target: u })).toMatch(/valid target/);
  });
  it('"Other minions can\'t untap"', () => {
    let s = board();
    const rhitta = read('Minion', 'Test Rhitta', "Other minions can't untap.", { attack: 2, defense: 2 });
    unit(s, 1, cell(0, 0), rhitta);
    const r = unit(s, 0, cell(2, 3), id('Ember Runner'), { tapped: true });
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' }); s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    expect(s.units[r].tapped).toBe(true);
  });
  it('"Can\'t be moved by force"', () => {
    let s = board();
    const dreig = read('Minion', 'Test Dreig', "Can't be moved by force.", { attack: 2, defense: 2 });
    const pull = read('Magic', 'Test Pull 2', "Teleport target minion to the caster's location.", { cost: 1 });
    const u = unit(s, 1, cell(0, 0), dreig);
    s = apply(s, { t: 'cast', inst: give(s, 0, pull), target: u });
    expect(s.units[u].c).toBe(cell(0, 0));
  });
});

describe('deck building rules', () => {
  it('counts copies across spellbook, atlas and collection against the rarity limit', async () => {
    const { deckChecks, constructedLegal, copyLimit, parseDeckText } = await import('../src/data/decks');
    const pool: Record<string, CardDef> = {};
    const mk = (name: string, type: CardDef['type'], rarity: string) => { const c = makeCard({ name, type, rarity, source: 'api' }); pool[c.id] = c; return c.id; };
    const av = mk('Test Mage', 'Avatar', 'Unique'), ord = mk('Foot Troop', 'Minion', 'Ordinary'), exc = mk('Fine Blade', 'Artifact', 'Exceptional'), eli = mk('Old Wyrm', 'Minion', 'Elite'), uni = mk('The Crown', 'Artifact', 'Unique'), site = mk('Plain Field', 'Site', 'Ordinary');
    expect([ord, exc, eli, uni].map((id) => copyLimit(pool[id]))).toEqual([4, 3, 2, 1]);
    const deck = { name: 'd', avatar: av, spellbook: [...Array(57).fill(ord), exc, exc, exc, eli, eli, uni], atlas: Array(30).fill(site), collection: [uni] };
    const checks = deckChecks(deck, pool);
    const by = (label: string) => checks.find((c) => c.label.startsWith(label))!;
    expect(by('One Avatar').ok).toBe(true); expect(by('Spellbook').ok).toBe(true); expect(by('Atlas').ok).toBe(true); expect(by('Collection').ok).toBe(true);
    expect(by('Copies').ok).toBe(false);
    expect(by('Copies').detail).toMatch(/Foot Troop 57\/4/); expect(by('Copies').detail).toMatch(/The Crown 2\/1 \(Unique\)/); // one in the spellbook + one in the collection
    expect(by('Copies').detail).not.toMatch(/Fine Blade|Old Wyrm/);
    expect(constructedLegal(deck, pool)).toBe(false);
    const r = parseDeckText('Avatar (1)\n1 Test Mage\nSpellbook\n2 Old Wyrm\n3x Fine Blade\nAtlas:\n4 Plain Field\nCollection (2)\n1 The Crown\n1 Plain Field\nNot A Card', pool, 'x');
    expect(r.deck.avatar).toBe(av); expect(r.deck.spellbook.length).toBe(5); expect(r.deck.atlas.length).toBe(4);
    expect(r.deck.collection).toEqual([uni, site]); expect(r.unknown).toEqual(['Not A Card']);
  });
});
