import { describe, expect, it } from 'vitest';
import { type Action, type DeckList, type GameState, AVATAR_START, actor, apply, cardOf, cell, check, createGame, legalActions, makeCard, normalizeApiCards, reach, thresholdOf, unitCard } from '../src/engine';
import { PRACTICE_CARDS, PRACTICE_DECKS } from '../src/data/practiceSet';
import { chooseAction, determinize } from '../src/ai/ai';

const cards = Object.fromEntries(PRACTICE_CARDS.map((c) => [c.id, c]));
const pid = (n: string) => PRACTICE_CARDS.find((c) => c.name === n)!.id;

/** New game, mulligans kept, P1 (index 0) first, in main phase of turn 1. */
function start(decks: [DeckList, DeckList] = [PRACTICE_DECKS[0], PRACTICE_DECKS[1]]): GameState {
  let s = createGame(cards, decks, 42, 0);
  s = apply(s, { t: 'mulligan', cards: [] });
  s = apply(s, { t: 'mulligan', cards: [] });
  return s;
}
const handCard = (s: GameState, p: 0 | 1, name: string) => s.players[p].hand.find((i) => cardOf(s, i).name === name);
/** Test helper: put a named card in a player's hand (from thin air) and give mana. */
function give(s: GameState, p: 0 | 1, name: string, mana = 10): string {
  const k = `${p}x${Object.keys(s.inst).length}`;
  s.inst = { ...s.inst, [k]: pid(name) }; s.players[p].hand.push(k); s.players[p].mana = mana; return k;
}
function site(s: GameState, p: 0 | 1, name: string, c: number) { const k = give(s, p, name, s.players[p].mana); s.players[p].hand.pop(); s.sites[c] = { inst: k, owner: p }; }
function summon(s: GameState, p: 0 | 1, name: string, c: number, opts: Partial<GameState['units'][string]> = {}): string {
  const k = give(s, p, name, s.players[p].mana); s.players[p].hand.pop();
  const id = `t${s.nextId++}`;
  s.units[id] = { id, inst: k, owner: p, c, r: 'surface', tapped: false, damage: 0, enteredTurn: 0, avatar: false, stealthLost: false, lance: cards[pid(name)].keywords.includes('Lance'), ...opts };
  return id;
}
const reason = (s: GameState, a: Action) => { const c = check(s, a); return c.ok ? null : c.reason; };

describe('setup and turn structure', () => {
  it('deals 3 sites and 3 spells and places avatars mid back row', () => {
    const s = createGame(cards, [PRACTICE_DECKS[0], PRACTICE_DECKS[1]], 1, 0);
    for (const p of [0, 1] as const) {
      const types = s.players[p].hand.map((i) => cardOf(s, i).type);
      expect(types.filter((t) => t === 'Site')).toHaveLength(3);
      expect(types).toHaveLength(6);
      expect(s.units[s.players[p].avatar].c).toBe(AVATAR_START[p]);
    }
    expect(AVATAR_START).toEqual([cell(2, 3), cell(2, 0)]);
  });
  it('mulligan returns cards to the bottom of the right decks and redraws the same number from each', () => {
    let s = createGame(cards, [PRACTICE_DECKS[0], PRACTICE_DECKS[1]], 7, 0);
    const h = s.players[0].hand; const aSize = s.players[0].atlas.length, sSize = s.players[0].spellbook.length;
    const back = [h.find((i) => cardOf(s, i).type === 'Site')!, h.find((i) => cardOf(s, i).type !== 'Site')!];
    s = apply(s, { t: 'mulligan', cards: back });
    expect(s.players[0].hand).toHaveLength(6);
    expect(s.players[0].atlas).toHaveLength(aSize); expect(s.players[0].spellbook).toHaveLength(sSize);
    expect(s.players[0].atlas.at(-1)).toBe(back[0]); expect(s.players[0].spellbook.at(-1)).toBe(back[1]);
    expect(actor(s)).toBe(1);
  });
  it('first player skips the draw; second player must draw', () => {
    let s = start();
    expect(s.phase).toBe('main'); expect(s.turn).toBe(1);
    s = apply(s, { t: 'endTurn' });
    expect(s.phase).toBe('draw');
    expect(reason(s, { t: 'endTurn' })).toMatch(/Draw a card/);
    s = apply(s, { t: 'draw', deck: 'atlas' });
    expect(s.players[1].hand).toHaveLength(7);
  });
  it('same seed gives the same game (needed for online play)', () => {
    const a = createGame(cards, [PRACTICE_DECKS[0], PRACTICE_DECKS[1]], 99);
    const b = createGame(cards, [PRACTICE_DECKS[0], PRACTICE_DECKS[1]], 99);
    expect(a.players).toEqual(b.players); expect(a.first).toBe(b.first);
  });
});

describe('sites, mana, threshold', () => {
  it('first site must go on the avatar square; later sites orthogonally adjacent', () => {
    let s = start();
    const st = s.players[0].hand.filter((i) => cardOf(s, i).type === 'Site');
    expect(reason(s, { t: 'playSite', inst: st[0], c: cell(0, 3) })).toMatch(/Avatar's square/);
    s = apply(s, { t: 'playSite', inst: st[0], c: AVATAR_START[0] });
    expect(s.players[0].mana).toBe(1);
    expect(reason(s, { t: 'playSite', inst: st[1], c: cell(3, 3) })).toMatch(/Avatar is tapped/);
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    s = apply(apply(s, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    expect(s.players[0].mana).toBe(1); // one site → one mana at start of turn
    expect(reason(s, { t: 'playSite', inst: st[1], c: cell(3, 2) })).toMatch(/next to a site/);
    s = apply(s, { t: 'playSite', inst: st[1], c: cell(3, 3) });
    expect(s.players[0].mana).toBe(2);
  });
  it('casting needs mana and threshold; threshold is not spent', () => {
    const s = start();
    site(s, 0, 'Cinder Field', AVATAR_START[0]);
    const drake = give(s, 0, 'Pyre Drake', 10);
    expect(reason(s, { t: 'cast', inst: drake, c: AVATAR_START[0] })).toMatch(/2 fire threshold/);
    site(s, 0, 'Cinder Field', cell(1, 3));
    expect(thresholdOf(s, 0).fire).toBe(2);
    const runner = give(s, 0, 'Ember Runner', 0);
    expect(reason(s, { t: 'cast', inst: runner, c: AVATAR_START[0] })).toMatch(/costs 1 mana/);
    s.players[0].mana = 6;
    const g = apply(apply(s, { t: 'cast', inst: drake, c: AVATAR_START[0] }), { t: 'cast', inst: runner, c: cell(1, 3) });
    expect(g.players[0].mana).toBe(0); expect(thresholdOf(g, 0).fire).toBe(2);
    expect(reason(s, { t: 'cast', inst: drake, c: cell(0, 0) })).toMatch(/site you control/);
  });
  it('mana is lost at end of turn', () => {
    let s = start(); s.players[0].mana = 5;
    s = apply(s, { t: 'endTurn' });
    expect(s.players[0].mana).toBe(0);
  });
});

describe('movement', () => {
  const board = () => { const s = start(); for (let x = 0; x < 5; x++) { site(s, 0, x < 2 ? 'Mill Pond' : 'Stone Terrace', cell(x, 3)); site(s, 0, 'Stone Terrace', cell(x, 2)); } return s; };
  it('summoning sickness blocks moving unless Charge', () => {
    const s = board();
    const a = summon(s, 0, 'Kiln Brute', cell(2, 2), { enteredTurn: s.turn });
    const b = summon(s, 0, 'Ember Runner', cell(2, 2), { enteredTurn: s.turn });
    expect(reason(s, { t: 'move', unit: a, path: [{ c: cell(2, 1), r: 'surface' }] })).toMatch(/summoning sickness/);
    expect(reason(s, { t: 'move', unit: b, path: [{ c: cell(3, 2), r: 'surface' }] })).toBeNull();
  });
  it('void is closed, diagonals need Airborne, Movement +1 gives two steps', () => {
    const s = board();
    const brute = summon(s, 0, 'Kiln Brute', cell(2, 2));
    const sprite = summon(s, 0, 'Wind Sprite', cell(2, 2));
    const courier = summon(s, 0, 'Sky Courier', cell(0, 2));
    expect(reason(s, { t: 'move', unit: brute, path: [{ c: cell(2, 1), r: 'surface' }] })).toMatch(/void/);
    expect(reason(s, { t: 'move', unit: brute, path: [{ c: cell(3, 3), r: 'surface' }] })).toMatch(/Airborne/);
    expect(reason(s, { t: 'move', unit: sprite, path: [{ c: cell(3, 3), r: 'surface' }] })).toBeNull();
    expect(reach(s, s.units[courier]).has(cell(2, 2) + 's')).toBe(true);
    expect(reach(s, s.units[brute]).has(cell(4, 2) + 's')).toBe(false);
  });
  it('Burrowing goes under land only, Submerge under water only', () => {
    const s = board();
    const mole = summon(s, 0, 'Burrow Mole', cell(2, 2));
    const lurker = summon(s, 0, 'Reed Lurker', cell(0, 3));
    const brute = summon(s, 0, 'Kiln Brute', cell(2, 2));
    expect(reason(s, { t: 'move', unit: mole, path: [{ c: cell(2, 2), r: 'under' }] })).toBeNull();
    expect(reason(s, { t: 'move', unit: brute, path: [{ c: cell(2, 2), r: 'under' }] })).toMatch(/Burrowing/);
    expect(reason(s, { t: 'move', unit: lurker, path: [{ c: cell(0, 3), r: 'under' }] })).toBeNull();
    s.units[lurker].c = cell(2, 2);
    expect(reason(s, { t: 'move', unit: lurker, path: [{ c: cell(2, 2), r: 'under' }] })).not.toBeNull();
  });
  it('moving taps the unit', () => {
    const s = board(); const brute = summon(s, 0, 'Kiln Brute', cell(2, 2));
    const g = apply(s, { t: 'move', unit: brute, path: [{ c: cell(3, 2), r: 'surface' }] });
    expect(g.units[brute].tapped).toBe(true); expect(g.units[brute].c).toBe(cell(3, 2));
    expect(reason(g, { t: 'move', unit: brute, path: [{ c: cell(2, 2), r: 'surface' }] })).toMatch(/tapped/);
  });
});

describe('combat', () => {
  const arena = () => { const s = start(); for (let x = 1; x < 4; x++) { site(s, 0, 'Stone Terrace', cell(x, 3)); site(s, 0, 'Stone Terrace', cell(x, 2)); site(s, 1, 'Gale Ridge', cell(x, 1)); site(s, 1, 'Gale Ridge', cell(x, 0)); } return s; };
  it('fight: both strike at once; damage clears at the owner\'s end of turn', () => {
    const s = arena();
    const a = summon(s, 0, 'Kiln Brute', cell(1, 2)); // 4/4
    const d = summon(s, 1, 'Granite Guard', cell(1, 1), { tapped: true }); // 2/5
    let g = apply(s, { t: 'move', unit: a, path: [{ c: cell(1, 1), r: 'surface' }], attack: { unit: d } });
    expect(g.pending).toBeNull();
    expect(g.units[d].damage).toBe(4); expect(g.units[a].damage).toBe(2);
    g = apply(g, { t: 'endTurn' });
    expect(g.units[a].damage).toBe(0); expect(g.units[d].damage).toBe(4); // only the active player's minions heal
  });
  it('a minion dies when damage reaches its defense; Lethal kills with any damage', () => {
    const s = arena();
    const eel = summon(s, 0, 'Venom Eel', cell(1, 2)); // 1/3 lethal
    const giant = summon(s, 1, 'Hill Giant', cell(1, 1), { tapped: true });
    const g = apply(s, { t: 'move', unit: eel, path: [{ c: cell(1, 1), r: 'surface' }], attack: { unit: giant } });
    expect(g.units[giant]).toBeUndefined(); expect(g.units[eel]).toBeUndefined();
    expect(g.players[1].cemetery.some((i) => cardOf(g, i).name === 'Hill Giant')).toBe(true);
  });
  it('Lance strikes first with +1, once', () => {
    const s = arena();
    const lancer = summon(s, 0, 'Cloud Lancer', cell(1, 2)); // 3/3 + lance → 4 first
    const brute = summon(s, 1, 'Kiln Brute', cell(1, 1), { tapped: true }); // 4/4
    const g = apply(s, { t: 'move', unit: lancer, path: [{ c: cell(1, 1), r: 'surface' }], attack: { unit: brute } });
    expect(g.units[brute]).toBeUndefined(); expect(g.units[lancer].damage).toBe(0); expect(g.units[lancer].lance).toBe(false);
  });
  it('attacking an undefended site is life loss, and life loss cannot deal a death blow', () => {
    const s = arena();
    const a = summon(s, 0, 'Kiln Brute', cell(1, 2));
    let g = apply(s, { t: 'move', unit: a, path: [{ c: cell(1, 1), r: 'surface' }], attack: { site: true } });
    expect(g.players[1].life).toBe(16);
    g.players[1].life = 0; g.players[1].deathsDoor = true; g.players[1].ddTurn = 0; g.units[a].tapped = false;
    g = apply(g, { t: 'move', unit: a, path: [], attack: { site: true } });
    expect(g.winner).toBeNull();
  });
  it('defend: an untapped enemy in range may step in and replace a site as the target', () => {
    const s = arena();
    const a = summon(s, 0, 'Kiln Brute', cell(1, 2));
    const guard = summon(s, 1, 'Granite Guard', cell(2, 1));
    let g = apply(s, { t: 'move', unit: a, path: [{ c: cell(1, 1), r: 'surface' }], attack: { site: true } });
    expect(g.pending?.kind).toBe('defend'); expect(actor(g)).toBe(1);
    expect(reason(g, { t: 'endTurn' })).toMatch(/must choose/);
    g = apply(g, { t: 'respond', units: [guard] });
    expect(g.players[1].life).toBe(20); expect(g.units[guard].c).toBe(cell(1, 1)); expect(g.units[guard].tapped).toBe(true);
    expect(g.units[guard].damage).toBe(4); expect(g.units[a].damage).toBe(2); expect(actor(g)).toBe(0);
  });
  it('intercept: a move that ends on an untapped enemy without attacking can be intercepted', () => {
    const s = arena();
    const a = summon(s, 0, 'Ember Runner', cell(1, 2));
    const guard = summon(s, 1, 'Granite Guard', cell(1, 1));
    let g = apply(s, { t: 'move', unit: a, path: [{ c: cell(1, 1), r: 'surface' }] });
    expect(g.pending?.kind).toBe('intercept');
    g = apply(g, { t: 'respond', units: [guard] });
    expect(g.units[a]).toBeUndefined(); expect(g.units[guard].damage).toBe(2);
  });
  it('Stealth cannot be defended against or intercepted, and is lost after striking', () => {
    const s = arena();
    const stalker = summon(s, 0, 'Root Stalker', cell(1, 2));
    summon(s, 1, 'Granite Guard', cell(2, 1));
    const g = apply(s, { t: 'move', unit: stalker, path: [{ c: cell(1, 1), r: 'surface' }], attack: { site: true } });
    expect(g.pending).toBeNull(); expect(g.players[1].life).toBe(18); expect(g.units[stalker].stealthLost).toBe(true);
  });
  it('Airborne can only be attacked by Airborne; Ranged shoots without a strike back', () => {
    const s = arena();
    const brute = summon(s, 0, 'Kiln Brute', cell(1, 2));
    const archer = summon(s, 0, 'Ash Archer', cell(2, 2));
    const sprite = summon(s, 1, 'Wind Sprite', cell(1, 1), { tapped: true });
    const guard = summon(s, 1, 'Granite Guard', cell(2, 1), { tapped: true });
    expect(reason(s, { t: 'move', unit: brute, path: [{ c: cell(1, 1), r: 'surface' }], attack: { unit: sprite } })).toMatch(/Airborne/);
    const g = apply(s, { t: 'shoot', unit: archer, dx: 0, dy: -1 });
    expect(g.units[guard].damage).toBe(2); expect(g.units[archer].damage).toBe(0); expect(g.units[archer].tapped).toBe(true);
    expect(reason(s, { t: 'shoot', unit: archer, dx: 1, dy: 0 })).toMatch(/No unit/);
  });
});

describe("avatars and death's door", () => {
  it('reaching 0 life puts the avatar at death\'s door, immune that turn; later damage is a death blow', () => {
    const s = start();
    site(s, 0, 'Cinder Field', AVATAR_START[0]); site(s, 0, 'Cinder Field', cell(2, 2)); site(s, 1, 'Gale Ridge', cell(2, 1)); site(s, 1, 'Gale Ridge', AVATAR_START[1]);
    s.players[1].life = 2; s.units[s.players[0].avatar].c = cell(2, 1);
    const foe = s.players[1].avatar;
    let g = apply(s, { t: 'cast', inst: give(s, 0, 'Firebolt'), target: foe });
    expect(g.players[1].life).toBe(0); expect(g.players[1].deathsDoor).toBe(true); expect(g.winner).toBeNull();
    g = apply(g, { t: 'cast', inst: give(g, 0, 'Firebolt'), target: foe });
    expect(g.winner).toBeNull(); // immune for the rest of the turn
    g = apply(apply(g, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    g = apply(apply(g, { t: 'endTurn' }), { t: 'draw', deck: 'spellbook' });
    g = apply(g, { t: 'cast', inst: give(g, 0, 'Firebolt'), target: foe });
    expect(g.winner).toBe(0); expect(g.phase).toBe('over');
  });
  it('an avatar at death\'s door cannot gain life', () => {
    const s = start(); site(s, 0, 'Stone Terrace', AVATAR_START[0]);
    s.players[0].life = 0; s.players[0].deathsDoor = true;
    const g = apply(s, { t: 'cast', inst: give(s, 0, 'Mend') });
    expect(g.players[0].life).toBe(0);
  });
  it('a player who must draw with both decks empty loses', () => {
    let s = start(); s.players[1].spellbook = []; s.players[1].atlas = [];
    s = apply(s, { t: 'endTurn' });
    expect(s.winner).toBe(0);
  });
});

describe('data-driven effects and targeting', () => {
  it('targeted magic is measured from a spellcaster and cannot hit stealthed enemies', () => {
    const s = start(); site(s, 0, 'Cinder Field', AVATAR_START[0]); site(s, 1, 'Gale Ridge', cell(2, 2)); site(s, 1, 'Gale Ridge', cell(0, 0));
    const near = summon(s, 1, 'Kiln Brute', cell(2, 2)); const far = summon(s, 1, 'Kiln Brute', cell(0, 0)); const hidden = summon(s, 1, 'Root Stalker', cell(2, 2));
    const bolt = give(s, 0, 'Firebolt');
    expect(reason(s, { t: 'cast', inst: bolt, target: far })).toMatch(/valid target/);
    expect(reason(s, { t: 'cast', inst: bolt, target: hidden })).toMatch(/valid target/);
    expect(apply(s, { t: 'cast', inst: bolt, target: near }).units[near].damage).toBe(3);
  });
  it('genesis effects run on entry; magic goes to the cemetery', () => {
    const s = start(); site(s, 0, 'Mill Pond', AVATAR_START[0]);
    const n = s.players[0].hand.length;
    const g = apply(s, { t: 'cast', inst: give(s, 0, 'Tide Caller'), c: AVATAR_START[0] });
    expect(g.players[0].hand.length).toBe(n + 1);
    const h = apply(s, { t: 'cast', inst: give(s, 0, 'Insight') });
    expect(cardOf(h, h.players[0].cemetery.at(-1)!).name).toBe('Insight');
  });
});

describe('API normalization', () => {
  it('maps CardAPIDTO, reports unknown fields, and never throws on odd input', () => {
    const raw = [
      { id: 'a1', name: 'Test Minion', slug: 'test_minion', surprise: 1, engine: { type: 'Minion', rarity: 'Ordinary', rules: 'Airborne\nMovement +2', cost: 3, attack: 2, defense: 2, life: null, air: 1, earth: 0, fire: 0, water: 0, keywords: ['Airborne', 'Movement'], subtypes: ['Beast'], newField: true },
        printings: [{ id: 'p', slug: 'set-test_minion-b-s', set: { name: 'Set', code: 'SET' }, meta: { typeline: 'An Ordinary Beast' } }] },
      { name: 'Broken' }, null, { name: 'Odd', engine: { type: 'Vehicle' } },
    ];
    const r = normalizeApiCards(raw);
    expect(r.cards).toHaveLength(1);
    expect(r.cards[0]).toMatchObject({ movement: 2, cost: 3, thresholds: { air: 1 }, typeline: 'An Ordinary Beast' });
    expect(r.unknownFields).toEqual(expect.arrayContaining(['surprise', 'engine.newField', 'engine.type=Vehicle']));
    expect(r.skipped).toContain('Broken');
    expect(normalizeApiCards({ nope: true }).cards).toEqual([]);
  });
});

describe('AI', () => {
  it('determinization never changes public information or hand sizes', () => {
    const s = start();
    const g = determinize(s, 1);
    expect(g.players[0].hand).toHaveLength(s.players[0].hand.length);
    expect([...g.players[0].hand, ...g.players[0].spellbook, ...g.players[0].atlas].sort()).toEqual([...s.players[0].hand, ...s.players[0].spellbook, ...s.players[0].atlas].sort());
    expect(g.players[1].hand).toEqual(s.players[1].hand);
  });
  it('every tier plays full games with only legal actions', async () => {
    for (const [l0, l1] of [['easy', 'medium'], ['medium', 'hard'], ['hard', 'easy']] as const) {
      let s = createGame(cards, [PRACTICE_DECKS[0], PRACTICE_DECKS[1]], 5);
      let n = 0;
      while (s.phase !== 'over' && n++ < 700) {
        const a = await chooseAction(s, actor(s) === 0 ? l0 : l1, 8);
        expect(check(s, a).ok).toBe(true);
        s = apply(s, a);
      }
      expect(n).toBeGreaterThan(20);
      for (const a of legalActions(s)) expect(check(s, a).ok).toBe(true);
      void unitCard; void makeCard;
    }
  }, 60000);
});
