import { describe, expect, it } from 'vitest';
import { PRACTICE_CARDS, PRACTICE_DECKS } from './fixtures/practiceSet';
import { type Action, type CardDef, type GameState, type PlayerId, AVATAR_START, actor, apply, cell, check, createGame, legalActions, makeCard, normalizeApiCards, reach, thresholdOf } from '../src/engine';
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
  const k = `${p}t${Object.keys(s.inst).length}`; s.inst[k] = id(name); s.sites[c] = { inst: k, owner: p };
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
  it('minion damage clears at the end of its controller\'s turn, not the opponent\'s', () => {
    let s = rig();
    const brute = unit(s, 0, cell(2, 2), id('Kiln Brute'));
    const guard = unit(s, 1, cell(2, 1), id('Granite Guard'), { tapped: true });
    s = apply(s, { t: 'move', unit: brute, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: guard } });
    s = apply(s, { t: 'endTurn' });
    expect(s.units[brute].damage).toBe(0); expect(s.units[guard].damage).toBe(4);
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
    expect(OFFICIAL_DECKS.length).toBe(4);
    const pool: Record<string, CardDef> = {};
    for (const d of OFFICIAL_DECKS) {
      expect(d.spellbook.reduce((n, [k]) => n + k, 0)).toBe(36);
      expect(d.atlas.reduce((n, [k]) => n + k, 0)).toBe(16);
      const av = makeCard({ name: d.avatar, type: 'Avatar', life: 20, source: 'api' }); pool[av.id] = av;
      for (const [, n] of d.spellbook) { const c = makeCard({ name: n, type: 'Minion', source: 'api' }); pool[c.id] = c; }
      for (const [, n] of d.atlas) { const c = makeCard({ name: n, type: 'Site', source: 'api' }); pool[c.id] = c; }
    }
    for (const r of resolveOfficial(pool)) { expect(r.missing).toEqual([]); expect(r.deck.spellbook.length).toBe(36); expect(r.deck.atlas.length).toBe(16); expect(pool[r.deck.avatar].type).toBe('Avatar'); }
    expect(resolveOfficial({})[0].missing.length).toBeGreaterThan(20); // nothing synced: listed, not playable
  });
});

describe('rules text and damage split', () => {
  it('reads only whole-text, unambiguous sentences into effects', async () => {
    const { effectsFromText } = await import('../src/engine/cards');
    expect(effectsFromText('Magic', 'Deal 4 damage to target nearby unit.')).toMatchObject([{ on: 'cast', op: 'damage', n: 4, who: 'target', range: 'nearby' }]);
    expect(effectsFromText('Magic', 'Deal 7 damage to target minion nearby.')).toMatchObject([{ op: 'damage', n: 7, range: 'nearby', only: 'minion' }]);
    expect(effectsFromText('Minion', 'Spellcaster\r\nGenesis → Draw a spell.')).toMatchObject([{ on: 'genesis', op: 'draw', n: 1, deck: 'spellbook' }]);
    expect(effectsFromText('Minion', 'Airborne, Ward\nGenesis → Kill target adjacent minion.')).toMatchObject([{ on: 'genesis', op: 'destroy', range: 'adjacent', only: 'minion' }]);
    // anything with more to it is left alone
    expect(effectsFromText('Magic', 'Deal 2 damage to target unit nearby. Any number of times, you may spend ② to additionally target a new unit.')).toEqual([]);
    expect(effectsFromText('Magic', 'Deal 1 damage to target nearby minion and untap it.')).toEqual([]);
    expect(effectsFromText('Minion', 'Genesis → Kill target adjacent Unique or Elite minion.')).toEqual([]);
    expect(effectsFromText('Artifact', 'Once on your turn, bearer may deal 1 damage to target adjacent minion.')).toEqual([]);
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
  it('an attacker facing several enemies splits its damage to kill the most', () => {
    let s = start(0); for (let c = 0; c < 20; c++) site(s, c < 10 ? 1 : 0, c); s.units[s.players[1].avatar].tapped = true;
    const giant = unit(s, 0, cell(2, 2), id('Hill Giant'));                       // 7 power
    const a = unit(s, 1, cell(2, 1), id('Wind Sprite'), { tapped: true });        // 1 defense, airborne but it is the giant's... target below
    const b = unit(s, 1, cell(3, 1), id('Ember Runner'));                         // 2/2 defender
    const c2 = unit(s, 1, cell(1, 1), id('Kiln Brute'));                          // 4/4 defender
    const tgt = unit(s, 1, cell(2, 1), id('Ash Archer'), { tapped: true });       // 2/2 original target
    s = apply(s, { t: 'move', unit: giant, path: [{ c: cell(2, 1), r: 'surface' }], attack: { unit: tgt } });
    s = apply(s, { t: 'respond', units: [b, c2] });
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
