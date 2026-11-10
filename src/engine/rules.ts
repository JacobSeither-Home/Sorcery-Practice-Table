// Rules engine: pure functions over GameState. No UI, no browser APIs.
// Rules source: the Sorcery: Contested Realm rulebook as read on 2026-11-10 through a community
// rulebook reader (not fetched from sorcerytcg.com). Known simplifications are listed in docs/RULES_COVERAGE.md.
import {
  type Action, type CardDef, type Check, type DeckList, type Effect, type GameState, type Loc, type ManualOp,
  type PlayerId, type PlayerState, type Thresholds, type Unit, CELLS, COLS, ELEMENTS, ROWS,
} from './types';

// ---------- helpers ----------
export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
export const xy = (c: number): [number, number] => [c % COLS, Math.floor(c / COLS)];
export const cell = (x: number, y: number) => (x < 0 || y < 0 || x >= COLS || y >= ROWS ? -1 : y * COLS + x);
export const AVATAR_START: [number, number] = [cell(2, ROWS - 1), cell(2, 0)];
const locKey = (l: Loc) => l.c + (l.r === 'surface' ? 's' : 'u');

export function cardOf(s: GameState, inst: string): CardDef { return s.cards[s.inst[inst]]; }
export function unitCard(s: GameState, u: Unit): CardDef { return cardOf(s, u.inst); }
export function orthAdjacent(c: number): number[] {
  const [x, y] = xy(c);
  return [cell(x + 1, y), cell(x - 1, y), cell(x, y + 1), cell(x, y - 1)].filter((n) => n >= 0);
}
export function nearby(c: number): number[] {
  const [x, y] = xy(c); const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = cell(x + dx, y + dy); if (n >= 0) out.push(n); }
  return out;
}
export function isWater(s: GameState, c: number): boolean {
  const site = s.sites[c];
  return !!site && !!site.inst && cardOf(s, site.inst).thresholds.water > 0;
}
export const isLand = (s: GameState, c: number) => !!s.sites[c] && !isWater(s, c);
export function sitesOf(s: GameState, p: PlayerId): number[] {
  const out: number[] = [];
  for (let c = 0; c < CELLS; c++) if (s.sites[c]?.owner === p) out.push(c);
  return out;
}
export function thresholdOf(s: GameState, p: PlayerId): Thresholds {
  const t: Thresholds = { air: 0, earth: 0, fire: 0, water: 0 };
  for (const c of sitesOf(s, p)) { const d = cardOf(s, s.sites[c]!.inst!); for (const e of ELEMENTS) t[e] += d.thresholds[e]; }
  return t;
}
export function isDisabled(s: GameState, u: Unit): boolean {
  const k = unitCard(s, u).keywords;
  if (k.includes('Disabled')) return true;
  if (k.includes('Waterbound') && !isWater(s, u.c)) return true;
  if (k.includes('Landbound') && !isLand(s, u.c)) return true;
  return false;
}
export function has(s: GameState, u: Unit, kw: string): boolean { return unitCard(s, u).keywords.includes(kw) && !isDisabled(s, u); }
export const hasStealth = (s: GameState, u: Unit) => !u.stealthLost && has(s, u, 'Stealth');
export const summoningSick = (s: GameState, u: Unit) => !u.avatar && u.enteredTurn === s.turn && !has(s, u, 'Charge');
export function unitsAt(s: GameState, l: Loc): Unit[] { return Object.values(s.units).filter((u) => u.c === l.c && u.r === l.r); }
export function power(s: GameState, u: Unit): number { return unitCard(s, u).attack; }

function rand(s: GameState): number {
  let t = (s.rng += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function shuffle<T>(s: GameState, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function log(s: GameState, text: string, p: PlayerId | null = s.active, manual = false) {
  s.log.push(manual ? { turn: s.turn, p, text, manual } : { turn: s.turn, p, text });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}
const pname = (p: PlayerId) => `P${p + 1}`;

export function clone(s: GameState): GameState {
  const units: Record<string, Unit> = {};
  for (const k in s.units) units[k] = { ...s.units[k] };
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, spellbook: p.spellbook.slice(), atlas: p.atlas.slice(), hand: p.hand.slice(), cemetery: p.cemetery.slice() })) as [PlayerState, PlayerState],
    sites: s.sites.map((x) => (x ? { ...x } : null)),
    units,
    perms: s.perms.map((p) => ({ ...p })),
    pending: s.pending ? { ...s.pending, loc: { ...s.pending.loc }, target: s.pending.target ? { ...s.pending.target } : null } : null,
    log: s.log.slice(),
  };
}

// ---------- setup ----------
export function createGame(cards: Record<string, CardDef>, decks: [DeckList, DeckList], seed: number, first?: PlayerId): GameState {
  const s: GameState = {
    cards, inst: {}, seed, rng: seed | 0, turn: 0, active: 0, first: 0, phase: 'mulligan', winner: null,
    players: [null!, null!], sites: Array(CELLS).fill(null), units: {}, perms: [], pending: null, nextId: 1, log: [],
  };
  ([0, 1] as PlayerId[]).forEach((p) => {
    const d = decks[p];
    const mk = (ids: string[], tag: string) => ids.map((id, i) => { const k = `${p}${tag}${i}`; s.inst[k] = id; return k; });
    const av = `${p}av`; s.inst[av] = d.avatar;
    const unitId = `u${s.nextId++}`;
    s.units[unitId] = { id: unitId, inst: av, owner: p, c: AVATAR_START[p], r: 'surface', tapped: false, damage: 0, enteredTurn: 0, avatar: true, stealthLost: false, lance: false };
    const pl: PlayerState = {
      life: cards[d.avatar]?.life || 20, deathsDoor: false, ddTurn: -1, mana: 0,
      spellbook: shuffle(s, mk(d.spellbook, 's')), atlas: shuffle(s, mk(d.atlas, 'a')), hand: [], cemetery: [], avatar: unitId, mulliganDone: false,
    };
    pl.hand.push(...pl.atlas.splice(0, 3), ...pl.spellbook.splice(0, 3));
    s.players[p] = pl;
  });
  s.first = first ?? (rand(s) < 0.5 ? 0 : 1);
  s.active = s.first;
  log(s, `${pname(s.first)} goes first. Each player may take one mulligan.`, null);
  return s;
}

/** Whose decision it is right now. */
export function actor(s: GameState): PlayerId {
  if (s.pending) return s.pending.by;
  if (s.phase === 'mulligan') return s.players[s.first].mulliganDone ? other(s.first) : s.first;
  return s.active;
}

function startTurn(s: GameState, p: PlayerId) {
  s.turn++; s.active = p;
  for (const u of Object.values(s.units)) if (u.owner === p) u.tapped = false;
  s.players[p].mana = sitesOf(s, p).length;
  if (s.turn === 1) { s.phase = 'main'; log(s, `Turn 1 — ${pname(p)}. The first player skips the draw.`); return; }
  const pl = s.players[p];
  if (!pl.spellbook.length && !pl.atlas.length) { log(s, `${pname(p)} must draw from an empty deck and loses.`); win(s, other(p)); return; }
  s.phase = 'draw';
  log(s, `Turn ${s.turn} — ${pname(p)}.`);
}
function win(s: GameState, p: PlayerId) { s.winner = p; s.phase = 'over'; s.pending = null; log(s, `${pname(p)} wins.`, null); }

// ---------- life, damage, death ----------
function damageAvatar(s: GameState, p: PlayerId, n: number) {
  if (n <= 0 || s.phase === 'over') return;
  const pl = s.players[p];
  if (pl.deathsDoor) {
    if (pl.ddTurn === s.turn) { log(s, `${pname(p)}'s Avatar is at death's door and immune to damage this turn.`, null); return; }
    log(s, `Death blow to ${pname(p)}'s Avatar.`, null); win(s, other(p)); return;
  }
  pl.life = Math.max(0, pl.life - n);
  log(s, `${pname(p)}'s Avatar takes ${n} damage (life ${pl.life}).`, null);
  if (pl.life === 0) { pl.deathsDoor = true; pl.ddTurn = s.turn; log(s, `${pname(p)} is at death's door.`, null); }
}
function loseLife(s: GameState, p: PlayerId, n: number) {
  const pl = s.players[p];
  if (n <= 0 || pl.deathsDoor) return; // life loss cannot deal a death blow
  pl.life = Math.max(0, pl.life - n);
  log(s, `${pname(p)} loses ${n} life (life ${pl.life}).`, null);
  if (pl.life === 0) { pl.deathsDoor = true; pl.ddTurn = s.turn; log(s, `${pname(p)} is at death's door.`, null); }
}
function gainLife(s: GameState, p: PlayerId, n: number) {
  const pl = s.players[p];
  if (pl.deathsDoor) { log(s, `${pname(p)} is at death's door and cannot gain life.`, null); return; }
  pl.life += n; log(s, `${pname(p)} gains ${n} life (life ${pl.life}).`, null);
}
function killUnit(s: GameState, u: Unit) {
  if (!s.units[u.id] || u.avatar) return;
  const d = unitCard(s, u);
  delete s.units[u.id];
  log(s, `${d.name} dies.`, null);
  runEffects(s, d, 'deathrite', u.owner, { c: u.c, r: u.r });
  s.players[Number(u.inst[0]) as PlayerId].cemetery.push(u.inst);
}
function damageUnit(s: GameState, u: Unit, n: number, lethal = false) {
  if (n <= 0 || !s.units[u.id]) return;
  if (u.avatar) { damageAvatar(s, u.owner, n); return; }
  u.damage += n;
  if (lethal || u.damage >= unitCard(s, u).defense) killUnit(s, u);
}
function drawCard(s: GameState, p: PlayerId, deck: 'spellbook' | 'atlas'): boolean {
  const pl = s.players[p];
  const top = pl[deck].shift();
  if (!top) return false;
  pl.hand.push(top); return true;
}

// ---------- effects ----------
function spellcasters(s: GameState, p: PlayerId): Unit[] {
  return Object.values(s.units).filter((u) => u.owner === p && (u.avatar || has(s, u, 'Spellcaster')) && !isDisabled(s, u));
}
function inRange(from: Loc, to: Loc, range: Effect['range']): boolean {
  if (range === 'any' || !range) return true;
  if (from.r !== to.r) return false;
  if (range === 'adjacent') return from.c === to.c || orthAdjacent(from.c).includes(to.c);
  return nearby(from.c).includes(to.c);
}
/** Units a card's targeted effect may choose. `origin` is the unit's own location for genesis effects. */
export function validTargets(s: GameState, p: PlayerId, d: CardDef, origin?: Loc): string[] {
  const e = d.effects.find((x) => x.who === 'target');
  if (!e) return [];
  const origins = origin ? [origin] : spellcasters(s, p).map((u) => ({ c: u.c, r: u.r }));
  return Object.values(s.units).filter((u) => {
    if (u.owner !== p && hasStealth(s, u)) return false;
    if (e.op === 'destroy' && u.avatar) return false;
    return origins.some((o) => inRange(o, u, e.range));
  }).map((u) => u.id);
}
function runEffects(s: GameState, d: CardDef, on: Effect['on'], p: PlayerId, loc: Loc | null, target?: string) {
  for (const e of d.effects) {
    if (e.on !== on || s.phase === 'over') continue;
    const n = e.n ?? 1;
    const victims: Unit[] = [];
    if (e.who === 'target') { const t = target ? s.units[target] : undefined; if (t) victims.push(t); }
    else if (e.who === 'enemyAvatar') victims.push(s.units[s.players[other(p)].avatar]);
    else if (e.who === 'ownAvatar') victims.push(s.units[s.players[p].avatar]);
    else if (e.who === 'enemiesHere' && loc) victims.push(...unitsAt(s, loc).filter((u) => u.owner !== p));
    switch (e.op) {
      case 'damage': for (const v of victims) { log(s, `${d.name} deals ${n} damage to ${unitCard(s, v).name}.`, p); damageUnit(s, v, n); } break;
      case 'destroy': for (const v of victims) if (!v.avatar) killUnit(s, v); break;
      case 'heal': gainLife(s, e.who === 'enemyAvatar' ? other(p) : p, n); break;
      case 'mana': s.players[p].mana += n; log(s, `${pname(p)} gains ${n} mana.`, p); break;
      case 'draw': {
        for (let i = 0; i < n; i++) if (!drawCard(s, p, e.deck ?? 'spellbook')) { log(s, `${pname(p)} must draw from an empty deck and loses.`, p); win(s, other(p)); break; }
        if ((s.phase as string) !== 'over') log(s, `${pname(p)} draws ${n} from the ${e.deck ?? 'spellbook'} (${d.name}).`, p);
        break;
      }
    }
  }
}

// ---------- movement ----------
function stepOk(s: GameState, u: Unit, from: Loc, to: Loc): boolean {
  if (from.c === to.c) {
    if (from.r === to.r || !s.sites[to.c]) return false;
    return isWater(s, to.c) ? has(s, u, 'Submerge') : has(s, u, 'Burrowing');
  }
  if (from.r !== to.r) return false;
  const [x1, y1] = xy(from.c), [x2, y2] = xy(to.c);
  const dx = Math.abs(x1 - x2), dy = Math.abs(y1 - y2);
  if (dx > 1 || dy > 1) return false;
  if (dx + dy === 2 && !(to.r === 'surface' && has(s, u, 'Airborne'))) return false;
  if (!s.sites[to.c]) return to.r === 'surface' && !u.avatar && has(s, u, 'Voidwalk');
  if (to.r === 'under') return isWater(s, to.c) ? has(s, u, 'Submerge') : has(s, u, 'Burrowing');
  return true;
}
/** Every location the unit can end a move on, with one path to it. Includes staying put (empty path). */
export function reach(s: GameState, u: Unit): Map<string, Loc[]> {
  const out = new Map<string, Loc[]>();
  const start: Loc = { c: u.c, r: u.r };
  out.set(locKey(start), []);
  if (has(s, u, 'Immobile') || unitCard(s, u).keywords.includes('Immobile')) return out;
  const steps = 1 + unitCard(s, u).movement;
  let frontier: Loc[][] = [[]];
  for (let i = 0; i < steps; i++) {
    const next: Loc[][] = [];
    for (const path of frontier) {
      const from = path.length ? path[path.length - 1] : start;
      const cands: Loc[] = [{ c: from.c, r: from.r === 'surface' ? 'under' : 'surface' }, ...nearby(from.c).filter((c) => c !== from.c).map((c) => ({ c, r: from.r }))];
      for (const to of cands) {
        if (out.has(locKey(to)) || !stepOk(s, u, from, to)) continue;
        const p = [...path, to]; out.set(locKey(to), p); next.push(p);
      }
    }
    frontier = next;
  }
  return out;
}
function canAct(s: GameState, u: Unit): Check {
  if (u.tapped) return { ok: false, reason: `${unitCard(s, u).name} is tapped.` };
  if (summoningSick(s, u)) return { ok: false, reason: `${unitCard(s, u).name} entered this turn and has summoning sickness (it cannot tap until your next turn).`, keyword: 'Charge' };
  if (isDisabled(s, u)) return { ok: false, reason: `${unitCard(s, u).name} is disabled and cannot take actions.`, keyword: 'Disabled' };
  return { ok: true };
}
export function attackTargets(s: GameState, u: Unit, at: Loc): { unit?: string; site?: boolean }[] {
  const out: { unit?: string; site?: boolean }[] = [];
  for (const e of unitsAt(s, at)) {
    if (e.owner === u.owner) continue;
    if (has(s, e, 'Airborne') && !has(s, u, 'Airborne')) continue;
    out.push({ unit: e.id });
  }
  const site = s.sites[at.c];
  if (at.r === 'surface' && site && site.owner === other(u.owner)) out.push({ site: true });
  return out;
}
function defenders(s: GameState, attacker: Unit, at: Loc, target?: string): string[] {
  if (hasStealth(s, attacker)) return [];
  return Object.values(s.units).filter((d) => d.owner !== attacker.owner && !d.tapped && !isDisabled(s, d) && d.id !== target && reach(s, d).has(locKey(at))).map((d) => d.id);
}
function interceptors(s: GameState, mover: Unit): string[] {
  if (hasStealth(s, mover)) return [];
  const air = has(s, mover, 'Airborne');
  return unitsAt(s, mover).filter((d) => d.owner !== mover.owner && !d.tapped && !isDisabled(s, d) && (!air || has(s, d, 'Airborne') || unitCard(s, d).ranged > 0)).map((d) => d.id);
}
/** Units the responding player may commit to the pending defend/intercept. */
export function responders(s: GameState): string[] {
  const p = s.pending; if (!p) return [];
  const a = s.units[p.attacker]; if (!a) return [];
  return p.kind === 'defend' ? defenders(s, a, p.loc, p.target?.unit) : interceptors(s, a);
}

function fight(s: GameState, attackerId: string, enemyIds: string[], siteOwner: PlayerId | null) {
  const a = s.units[attackerId]; if (!a) return;
  a.stealthLost = true;
  if (!enemyIds.length) {
    if (siteOwner !== null) { log(s, `${unitCard(s, a).name} strikes the site.`, a.owner); loseLife(s, siteOwner, power(s, a)); }
    return;
  }
  type Strike = { from: Unit; to: Unit; dmg: number; lethal: boolean; first: boolean };
  const strikes: Strike[] = [];
  const mk = (from: Unit, to: Unit) => {
    if (isDisabled(s, from)) return;
    const lance = from.lance; from.lance = false; from.stealthLost = true;
    strikes.push({ from, to, dmg: power(s, from) + (lance ? 1 : 0), lethal: has(s, from, 'Lethal'), first: lance });
  };
  mk(a, s.units[enemyIds[0]]);
  for (const id of enemyIds) mk(s.units[id], a);
  for (const pass of [true, false]) {
    const batch = strikes.filter((x) => x.first === pass && s.units[x.from.id]);
    for (const x of batch) {
      if (!s.units[x.to.id] && !x.to.avatar) continue;
      log(s, `${unitCard(s, x.from).name} strikes ${unitCard(s, x.to).name} for ${x.dmg}.`, x.from.owner);
      damageUnit(s, x.to, x.dmg, x.lethal && !x.to.avatar);
      if ((s.phase as string) === 'over') return;
    }
  }
}

// ---------- legality ----------
function siteCells(s: GameState, p: PlayerId): number[] {
  const mine = sitesOf(s, p);
  const open = (c: number) => !s.sites[c] || !s.sites[c]!.inst;
  if (mine.length) { const set = new Set<number>(); for (const c of mine) for (const n of orthAdjacent(c)) if (open(n)) set.add(n); return [...set]; }
  const av = s.units[s.players[p].avatar];
  if (open(av.c)) return [av.c];
  const [ax, ay] = xy(av.c);
  const dist = (c: number) => Math.abs(xy(c)[0] - ax) + Math.abs(xy(c)[1] - ay);
  const cands = [...Array(CELLS).keys()].filter(open);
  const best = Math.min(...cands.map(dist));
  return cands.filter((c) => dist(c) === best);
}
function affordable(s: GameState, p: PlayerId, d: CardDef): Check {
  if (s.players[p].mana < d.cost) return { ok: false, reason: `${d.name} costs ${d.cost} mana and you have ${s.players[p].mana}. Sites give 1 mana each at the start of your turn.` };
  const t = thresholdOf(s, p);
  for (const e of ELEMENTS) if (t[e] < d.thresholds[e]) return { ok: false, reason: `${d.name} needs ${d.thresholds[e]} ${e} threshold and your sites provide ${t[e]}. Threshold is counted from the element symbols on sites you control; it is not spent.`, keyword: 'Threshold' };
  return { ok: true };
}
const no = (reason: string, keyword?: string): Check => ({ ok: false, reason, keyword });

export function check(s: GameState, a: Action): Check {
  if (s.phase === 'over') return no('The game is over.');
  const p = actor(s);
  const pl = s.players[p];
  if (a.t === 'manual') return s.pending ? no('Resolve the pending defend or intercept first.') : { ok: true };
  if (s.pending) {
    if (a.t !== 'respond') return no(`${pname(s.pending.by)} must choose whether to ${s.pending.kind} first.`);
    const ok = responders(s);
    for (const id of a.units) if (!ok.includes(id)) return no('That unit cannot respond: it must be untapped, not disabled, and able to reach the fight.');
    return { ok: true };
  }
  if (a.t === 'respond') return no('There is nothing to respond to.');
  if (s.phase === 'mulligan') {
    if (a.t !== 'mulligan') return no('Finish the mulligan first.');
    if (a.cards.length > 3) return no('A mulligan returns at most 3 cards.');
    if (a.cards.some((c) => !pl.hand.includes(c))) return no('Those cards are not in your hand.');
    return { ok: true };
  }
  if (s.phase === 'draw') {
    if (a.t !== 'draw') return no('Draw a card from your spellbook or atlas first.');
    if (!pl[a.deck].length) return no(`Your ${a.deck} is empty.`);
    return { ok: true };
  }
  const avatar = s.units[pl.avatar];
  switch (a.t) {
    case 'endTurn': return { ok: true };
    case 'drawSite':
      if (avatar.tapped) return no('Your Avatar is tapped. Its ability (tap: play or draw a site) can be used once per turn.');
      if (!pl.atlas.length) return no('Your atlas is empty.');
      return { ok: true };
    case 'playSite': {
      if (!pl.hand.includes(a.inst)) return no('That card is not in your hand.');
      const d = cardOf(s, a.inst);
      if (d.type !== 'Site') return no(`${d.name} is not a site.`);
      if (avatar.tapped) return no('Your Avatar is tapped. Playing a site taps your Avatar, so it is one site per turn.');
      if (!siteCells(s, p).includes(a.c)) return no(sitesOf(s, p).length ? 'A site must go on a void or rubble square next to a site you control (not diagonally).' : "Your first site goes on your Avatar's square.");
      return { ok: true };
    }
    case 'cast': {
      if (!pl.hand.includes(a.inst)) return no('That card is not in your hand.');
      const d = cardOf(s, a.inst);
      if (d.type === 'Site') return no('Sites are played with your Avatar ability, not cast.');
      if (d.type === 'Avatar') return no('Avatars are not cast.');
      const aff = affordable(s, p, d); if (!aff.ok) return aff;
      if (d.type === 'Minion' || d.type === 'Artifact') {
        if (a.c === undefined || s.sites[a.c]?.owner !== p) return no(`${d.type === 'Minion' ? 'Minions are summoned' : 'Artifacts are conjured'} on a site you control.`);
      } else if (d.type === 'Aura') {
        if (a.c === undefined || a.c < 0 || a.c >= CELLS) return no('Choose a square for the aura.');
      }
      const needsTarget = d.effects.some((e) => e.who === 'target' && (d.type === 'Magic' ? e.on === 'cast' : e.on === 'genesis'));
      if (needsTarget) {
        const ok = validTargets(s, p, d, d.type === 'Magic' ? undefined : { c: a.c!, r: 'surface' });
        if (!ok.length) return no(`${d.name} has no valid target in range.`);
        if (!a.target || !ok.includes(a.target)) return no('Choose a valid target: in range and region of a spellcaster you control, and not a stealthed enemy.', 'Stealth');
      }
      return { ok: true };
    }
    case 'move': {
      const u = s.units[a.unit];
      if (!u || u.owner !== p) return no('That is not your unit.');
      const can = canAct(s, u); if (!can.ok) return can;
      if (!a.path.length && !a.attack) return no('Choose a square to move to or something to attack.');
      if (a.path.length > 1 + unitCard(s, u).movement) return no(`${unitCard(s, u).name} can take ${1 + unitCard(s, u).movement} step(s) per move.`, 'Movement');
      if (a.path.length && unitCard(s, u).keywords.includes('Immobile')) return no(`${unitCard(s, u).name} is Immobile and cannot take steps.`, 'Immobile');
      let from: Loc = { c: u.c, r: u.r }; const seen = new Set([locKey(from)]);
      for (const to of a.path) {
        if (seen.has(locKey(to))) return no('A path cannot repeat a location.');
        if (!stepOk(s, u, from, to)) {
          if (from.c !== to.c && !s.sites[to.c]) return no('That square is void. A unit entering the void is banished unless it has Voidwalk.', 'Voidwalk');
          if (to.r === 'under') return no('Only Burrowing (land) or Submerge (water) units can go below the surface.', isWater(s, to.c) ? 'Submerge' : 'Burrowing');
          return no('A step goes to a bordering square. Diagonal steps need Airborne.', 'Airborne');
        }
        seen.add(locKey(to)); from = to;
      }
      if (a.attack) {
        const ts = attackTargets(s, u, from);
        if (a.attack.site) { if (!ts.some((t) => t.site)) return no('There is no enemy site surface to attack at that location.'); }
        else if (!ts.some((t) => t.unit === a.attack!.unit)) {
          const e = a.attack.unit ? s.units[a.attack.unit] : undefined;
          if (e && has(s, e, 'Airborne')) return no('Airborne units can only be attacked by Airborne units.', 'Airborne');
          return no('You can only attack an enemy at the location where the move ends.');
        }
      }
      return { ok: true };
    }
    case 'shoot': {
      const u = s.units[a.unit];
      if (!u || u.owner !== p) return no('That is not your unit.');
      if (!unitCard(s, u).ranged) return no(`${unitCard(s, u).name} is not Ranged.`, 'Ranged');
      const can = canAct(s, u); if (!can.ok) return can;
      if (Math.abs(a.dx) + Math.abs(a.dy) !== 1) return no('Projectiles travel in a straight line along the grid.');
      if (!shotTarget(s, u, a.dx, a.dy)) return no('No unit would be hit in that direction within range.', 'Ranged');
      return { ok: true };
    }
    default: return no('Unknown action.');
  }
}
function shotTarget(s: GameState, u: Unit, dx: number, dy: number): Unit | null {
  const [x, y] = xy(u.c);
  for (let i = 1; i <= unitCard(s, u).ranged; i++) {
    const c = cell(x + dx * i, y + dy * i); if (c < 0) return null;
    const hit = unitsAt(s, { c, r: u.r }).find((e) => e.owner !== u.owner && !hasStealth(s, e));
    if (hit) return hit;
  }
  return null;
}

// ---------- apply ----------
export function apply(state: GameState, a: Action): GameState {
  const chk = check(state, a);
  if (!chk.ok) throw new Error(chk.reason);
  const s = clone(state);
  const p = actor(s); const pl = s.players[p];
  switch (a.t) {
    case 'mulligan': {
      if (a.cards.length) {
        let nS = 0, nA = 0;
        for (const c of a.cards) {
          pl.hand.splice(pl.hand.indexOf(c), 1);
          if (cardOf(s, c).type === 'Site') { pl.atlas.push(c); nA++; } else { pl.spellbook.push(c); nS++; }
        }
        pl.hand.push(...pl.atlas.splice(0, nA), ...pl.spellbook.splice(0, nS));
        log(s, `${pname(p)} mulligans ${a.cards.length} card(s).`, p);
      } else log(s, `${pname(p)} keeps.`, p);
      pl.mulliganDone = true;
      if (s.players[0].mulliganDone && s.players[1].mulliganDone) startTurn(s, s.first);
      break;
    }
    case 'draw': drawCard(s, p, a.deck); s.phase = 'main'; log(s, `${pname(p)} draws from the ${a.deck}.`); break;
    case 'drawSite': s.units[pl.avatar].tapped = true; drawCard(s, p, 'atlas'); log(s, `${pname(p)}'s Avatar taps to draw a site.`); break;
    case 'playSite': {
      s.units[pl.avatar].tapped = true;
      pl.hand.splice(pl.hand.indexOf(a.inst), 1);
      s.sites[a.c] = { inst: a.inst, owner: p };
      pl.mana += 1;
      log(s, `${pname(p)} plays ${cardOf(s, a.inst).name} (+1 mana).`);
      runEffects(s, cardOf(s, a.inst), 'genesis', p, { c: a.c, r: 'surface' });
      break;
    }
    case 'cast': {
      const d = cardOf(s, a.inst);
      pl.hand.splice(pl.hand.indexOf(a.inst), 1);
      pl.mana -= d.cost;
      if (d.type === 'Minion') {
        const id = `u${s.nextId++}`;
        s.units[id] = { id, inst: a.inst, owner: p, c: a.c!, r: 'surface', tapped: false, damage: 0, enteredTurn: s.turn, avatar: false, stealthLost: false, lance: d.keywords.includes('Lance') };
        log(s, `${pname(p)} summons ${d.name}.`);
        runEffects(s, d, 'genesis', p, { c: a.c!, r: 'surface' }, a.target);
      } else if (d.type === 'Artifact' || d.type === 'Aura') {
        s.perms.push({ id: `m${s.nextId++}`, inst: a.inst, owner: p, c: a.c!, kind: d.type === 'Aura' ? 'aura' : 'artifact' });
        log(s, `${pname(p)} conjures ${d.name}.${d.effects.length ? '' : d.rules ? ' Its text is not automated; use the manual tools.' : ''}`);
        runEffects(s, d, 'genesis', p, { c: a.c!, r: 'surface' }, a.target);
      } else {
        log(s, `${pname(p)} casts ${d.name}.${d.effects.some((e) => e.on === 'cast') ? '' : ' Its text is not automated; resolve it with the manual tools.'}`);
        const caster = s.units[pl.avatar];
        runEffects(s, d, 'cast', p, { c: caster.c, r: caster.r }, a.target);
        pl.cemetery.push(a.inst);
      }
      break;
    }
    case 'move': {
      const u = s.units[a.unit];
      u.tapped = true;
      if (a.path.length) { const end = a.path[a.path.length - 1]; u.c = end.c; u.r = end.r; }
      const at: Loc = { c: u.c, r: u.r };
      if (a.attack) {
        const what = a.attack.site ? 'the site' : unitCard(s, s.units[a.attack.unit!]).name;
        log(s, `${unitCard(s, u).name} ${a.path.length ? 'moves and ' : ''}attacks ${what}.`);
        s.pending = { kind: 'defend', by: other(p), attacker: u.id, loc: at, target: a.attack };
        if (!responders(s).length) resolvePending(s, [], false);
      } else {
        log(s, `${unitCard(s, u).name} moves.`);
        s.pending = { kind: 'intercept', by: other(p), attacker: u.id, loc: at, target: null };
        if (!responders(s).length) s.pending = null;
      }
      break;
    }
    case 'respond': resolvePending(s, a.units, !!a.removeOriginal); break;
    case 'shoot': {
      const u = s.units[a.unit]; const t = shotTarget(s, u, a.dx, a.dy)!;
      u.tapped = true; u.stealthLost = true;
      log(s, `${unitCard(s, u).name} shoots ${unitCard(s, t).name} for ${power(s, u)}.`);
      damageUnit(s, t, power(s, u), has(s, u, 'Lethal') && !t.avatar);
      break;
    }
    case 'endTurn': {
      for (const u of Object.values(s.units)) if (u.owner === p && !u.avatar) u.damage = 0;
      pl.mana = 0;
      startTurn(s, other(p));
      break;
    }
    case 'manual': manual(s, a); break;
  }
  return s;
}
function resolvePending(s: GameState, ids: string[], removeOriginal: boolean) {
  const pd = s.pending!; s.pending = null;
  const a = s.units[pd.attacker]; if (!a) return;
  for (const id of ids) { const d = s.units[id]; d.tapped = true; d.c = pd.loc.c; d.r = pd.loc.r; }
  if (ids.length) log(s, `${ids.map((id) => unitCard(s, s.units[id]).name).join(', ')} ${pd.kind === 'defend' ? 'defend' : 'intercept'}.`, pd.by);
  if (pd.kind === 'intercept') { if (ids.length) fight(s, a.id, ids, null); return; }
  const enemies = [...ids];
  let siteOwner: PlayerId | null = null;
  if (pd.target?.unit) { if (!(removeOriginal && ids.length) && s.units[pd.target.unit]) enemies.unshift(pd.target.unit); }
  else if (pd.target?.site && !ids.length) siteOwner = s.sites[pd.loc.c]?.owner ?? null;
  fight(s, a.id, enemies, siteOwner);
}
function manual(s: GameState, a: ManualOp) {
  const say = (t: string) => log(s, `Manual: ${t}`, s.active, true);
  switch (a.op) {
    case 'life': { const pl = s.players[a.p]; pl.life = Math.max(0, pl.life + a.n); if (pl.life > 0) pl.deathsDoor = false; else if (!pl.deathsDoor) { pl.deathsDoor = true; pl.ddTurn = s.turn; } say(`${pname(a.p)} life ${a.n >= 0 ? '+' : ''}${a.n} (now ${pl.life}).`); break; }
    case 'mana': s.players[a.p].mana = Math.max(0, s.players[a.p].mana + a.n); say(`${pname(a.p)} mana ${a.n >= 0 ? '+' : ''}${a.n}.`); break;
    case 'damage': { const u = s.units[a.unit]; if (u) { say(`${a.n} damage to ${unitCard(s, u).name}.`); damageUnit(s, u, a.n); } break; }
    case 'destroy': { const u = s.units[a.unit]; if (u && !u.avatar) { say(`destroy ${unitCard(s, u).name}.`); killUnit(s, u); } break; }
    case 'destroyPerm': { const i = s.perms.findIndex((x) => x.id === a.perm); if (i >= 0) { const [m] = s.perms.splice(i, 1); s.players[Number(m.inst[0]) as PlayerId].cemetery.push(m.inst); say(`destroy ${cardOf(s, m.inst).name}.`); } break; }
    case 'tap': { const u = s.units[a.unit]; if (u) { u.tapped = !u.tapped; say(`${u.tapped ? 'tap' : 'untap'} ${unitCard(s, u).name}.`); } break; }
    case 'draw': if (drawCard(s, a.p, a.deck)) say(`${pname(a.p)} draws from the ${a.deck}.`); break;
    case 'discard': { const pl = s.players[a.p]; const i = pl.hand.indexOf(a.inst); if (i >= 0) { pl.hand.splice(i, 1); pl.cemetery.push(a.inst); say(`${pname(a.p)} discards ${cardOf(s, a.inst).name}.`); } break; }
    case 'teleport': { const u = s.units[a.unit]; if (u && a.c >= 0 && a.c < CELLS) { u.c = a.c; u.r = 'surface'; say(`move ${unitCard(s, u).name}.`); } break; }
  }
}

// ---------- enumeration (AI + move highlighting) ----------
export function playableSiteCells(s: GameState, p: PlayerId): number[] { return siteCells(s, p); }

export function legalActions(s: GameState): Action[] {
  if (s.phase === 'over') return [];
  const p = actor(s); const pl = s.players[p]; const out: Action[] = [];
  if (s.pending) {
    const r = responders(s);
    out.push({ t: 'respond', units: [] });
    for (const id of r) out.push({ t: 'respond', units: [id] });
    if (s.pending.kind === 'defend' && s.pending.target?.unit) for (const id of r) out.push({ t: 'respond', units: [id], removeOriginal: true });
    return out;
  }
  if (s.phase === 'mulligan') return [{ t: 'mulligan', cards: [] }];
  if (s.phase === 'draw') { for (const deck of ['spellbook', 'atlas'] as const) if (pl[deck].length) out.push({ t: 'draw', deck }); return out; }
  const avatar = s.units[pl.avatar];
  if (!avatar.tapped) {
    const cells = siteCells(s, p); const seen = new Set<string>();
    for (const inst of pl.hand) {
      const d = cardOf(s, inst);
      if (d.type !== 'Site' || seen.has(d.id)) continue; seen.add(d.id);
      for (const c of cells) out.push({ t: 'playSite', inst, c });
    }
    if (pl.atlas.length) out.push({ t: 'drawSite' });
  }
  const mine = sitesOf(s, p); const seen = new Set<string>();
  for (const inst of pl.hand) {
    const d = cardOf(s, inst);
    if (d.type === 'Site' || d.type === 'Avatar' || seen.has(d.id) || !affordable(s, p, d).ok) continue; seen.add(d.id);
    if (d.type === 'Magic') {
      if (d.effects.some((e) => e.who === 'target' && e.on === 'cast')) for (const target of validTargets(s, p, d)) out.push({ t: 'cast', inst, target });
      else out.push({ t: 'cast', inst });
    } else {
      for (const c of mine) {
        if (d.effects.some((e) => e.who === 'target' && e.on === 'genesis')) for (const target of validTargets(s, p, d, { c, r: 'surface' })) out.push({ t: 'cast', inst, c, target });
        else out.push({ t: 'cast', inst, c });
      }
    }
  }
  for (const u of Object.values(s.units)) {
    if (u.owner !== p || !canAct(s, u).ok) continue;
    for (const path of reach(s, u).values()) {
      const end = path.length ? path[path.length - 1] : { c: u.c, r: u.r };
      for (const attack of attackTargets(s, u, end)) out.push({ t: 'move', unit: u.id, path, attack });
      if (path.length) out.push({ t: 'move', unit: u.id, path });
    }
    if (unitCard(s, u).ranged) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (shotTarget(s, u, dx, dy)) out.push({ t: 'shoot', unit: u.id, dx, dy });
  }
  out.push({ t: 'endTurn' });
  return out;
}
