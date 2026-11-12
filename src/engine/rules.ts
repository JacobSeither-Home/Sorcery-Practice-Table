// Rules engine: pure functions over GameState. No UI, no browser APIs.
// Rules source: the Sorcery: Contested Realm rulebook as read on 2026-11-10 through a community
// rulebook reader (not fetched from sorcerytcg.com). Known simplifications are listed in docs/RULES_COVERAGE.md.
import {
  type Action, type CardDef, type Check, type Choice, type DeckList, type Effect, type GameState, type Loc, type ManualOp,
  type PlayerId, type PlayerState, type Queued, type Source, type Thresholds, type Trigger, type Unit, CELLS, COLS, ELEMENTS, ROWS,
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
// ---------- stat changes and granted keywords ----------
// Two sources: `mods` on the unit (from spells and activated abilities, some only for this turn), and
// static abilities of cards in the realm ("Other allies here have +1 power", "Bearer has Airborne").
const staticCache = new WeakMap<object, Set<string>>();
/** The index of cards with static abilities is kept per card table; call this after changing a table in place. */
export function forgetStatics(cards: Record<string, CardDef>) { staticCache.delete(cards); }
function staticCards(s: GameState): Set<string> {
  let set = staticCache.get(s.cards);
  if (!set) { set = new Set(Object.values(s.cards).filter((d) => d.effects.some((e) => e.on === 'static' && (e.op === 'buff' || e.op === 'grant'))).map((d) => d.id)); staticCache.set(s.cards, set); }
  return set;
}
interface Bonus { atk: number; def: number; kws: string[] }
/** Does a static effect of a card (at `at`, controlled by `p`, on unit `self` if it is one) reach unit u? */
function staticReaches(s: GameState, e: Effect, p: PlayerId, at: Loc, u: Unit, self?: string, bearer?: string): boolean {
  if (e.only === 'minion' && u.avatar) return false;
  if (e.other && u.id === self) return false;
  const here = u.c === at.c && u.r === at.r, near = u.r === at.r && nearby(at.c).includes(u.c);
  switch (e.who) {
    case 'self': return u.id === self;
    case 'bearer': return u.id === bearer;
    case 'ownAvatar': return u.avatar && u.owner === p;
    case 'enemyAvatar': return u.avatar && u.owner !== p;
    case 'allAvatars': return u.avatar;
    case 'alliesHere': return here && u.owner === p;
    case 'enemiesHere': return here && u.owner !== p;
    case 'unitsHere': case 'minionsHere': return here;
    case 'alliesNearby': return near && u.owner === p;
    case 'enemiesNearby': return near && u.owner !== p;
    case 'unitsNearby': return near;
    case 'allyMinions': return !u.avatar && u.owner === p;
    case 'enemyMinions': return !u.avatar && u.owner !== p;
    case 'allMinions': return !u.avatar;
    default: return false;
  }
}
export function bonus(s: GameState, u: Unit): Bonus {
  const b: Bonus = { atk: 0, def: 0, kws: [] };
  for (const m of u.mods ?? []) { b.atk += m.atk; b.def += m.def; if (m.kw) b.kws.push(m.kw); }
  const set = staticCards(s); if (!set.size) return b;
  const add = (d: CardDef, p: PlayerId, at: Loc, self?: string, bearer?: string) => {
    for (const e of d.effects) if (e.on === 'static' && staticReaches(s, e, p, at, u, self, bearer)) {
      if (e.op === 'buff') { b.atk += e.atk ?? 0; b.def += e.def ?? 0; } else if (e.op === 'grant' && e.keyword) b.kws.push(e.keyword);
    }
  };
  for (const v of Object.values(s.units)) { const d = unitCard(s, v); if (set.has(d.id) && !d.keywords.includes('Disabled')) add(d, v.owner, v, v.id); }
  for (const m of s.perms) { const d = cardOf(s, m.inst); if (set.has(d.id)) add(d, m.owner, { c: m.c, r: m.carrier ? s.units[m.carrier]?.r ?? 'surface' : 'surface' }, undefined, m.carrier); }
  for (let c = 0; c < CELLS; c++) { const st = s.sites[c]; if (st?.inst && st.owner !== null) { const d = cardOf(s, st.inst); if (set.has(d.id)) add(d, st.owner, { c, r: 'surface' }); } }
  return b;
}
export function isDisabled(s: GameState, u: Unit): boolean {
  const k = unitCard(s, u).keywords;
  if (k.includes('Disabled') || u.mods?.some((m) => m.kw === 'Disabled')) return true;
  if (k.includes('Waterbound') && !isWater(s, u.c)) return true;
  if (k.includes('Landbound') && !isLand(s, u.c)) return true;
  return false;
}
export function has(s: GameState, u: Unit, kw: string): boolean {
  if (isDisabled(s, u)) return false;
  if (unitCard(s, u).keywords.includes(kw) || u.mods?.some((m) => m.kw === kw)) return true;
  return staticCards(s).size > 0 && bonus(s, u).kws.includes(kw);
}
export const hasStealth = (s: GameState, u: Unit) => !u.stealthLost && has(s, u, 'Stealth');
export const summoningSick = (s: GameState, u: Unit) => !u.avatar && u.enteredTurn === s.turn && !has(s, u, 'Charge');
export function unitsAt(s: GameState, l: Loc): Unit[] { return Object.values(s.units).filter((u) => u.c === l.c && u.r === l.r); }
export function power(s: GameState, u: Unit): number { const d = unitCard(s, u); return Math.max(0, d.attack + (u.mods?.length || staticCards(s).size ? bonus(s, u).atk : 0)); }
export function defenseOf(s: GameState, u: Unit): number { const d = unitCard(s, u); return Math.max(0, d.defense + (u.mods?.length || staticCards(s).size ? bonus(s, u).def : 0)); }

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
  for (const k in s.units) { const u = s.units[k]; units[k] = u.mods ? { ...u, mods: u.mods.slice() } : { ...u }; }
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, spellbook: p.spellbook.slice(), atlas: p.atlas.slice(), hand: p.hand.slice(), cemetery: p.cemetery.slice() })) as [PlayerState, PlayerState],
    sites: s.sites.map((x) => (x ? { ...x } : null)),
    units,
    perms: s.perms.map((p) => ({ ...p })),
    pending: s.pending ? { ...s.pending, loc: { ...s.pending.loc }, target: s.pending.target ? { ...s.pending.target } : null } : null,
    log: s.log.slice(),
    ...(s.queue ? { queue: s.queue.map((q) => ({ ...q, fx: q.fx.slice() })) } : {}),
    ...(s.used ? { used: { ...s.used } } : {}),
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
  if (s.queue?.length) return s.queue[0].by;
  if (s.phase === 'mulligan') return s.players[s.first].mulliganDone ? other(s.first) : s.first;
  return s.active;
}

function startTurn(s: GameState, p: PlayerId) {
  s.turn++; s.active = p;
  for (const u of Object.values(s.units)) if (u.owner === p) u.tapped = false;
  for (const m of s.perms) if (m.owner === p) m.tapped = false;
  for (const st of s.sites) if (st?.owner === p) st.tapped = false;
  s.players[p].mana = sitesOf(s, p).length;
  if (s.turn === 1) { s.phase = 'main'; log(s, `Turn 1 — ${pname(p)}. The first player skips the draw.`); fireAll(s, p, 'startTurn'); return; }
  const pl = s.players[p];
  if (!pl.spellbook.length && !pl.atlas.length) { log(s, `${pname(p)} must draw from an empty deck and loses.`); win(s, other(p)); return; }
  s.phase = 'draw';
  log(s, `Turn ${s.turn} — ${pname(p)}.`);
  fireAll(s, p, 'startTurn');
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
  for (const m of s.perms) if (m.carrier === u.id) { m.c = u.c; delete m.carrier; } // what it carried stays where it fell
  delete s.units[u.id];
  log(s, `${d.name} dies.`, null);
  s.players[Number(u.inst[0]) as PlayerId].cemetery.push(u.inst);
  fire(s, u.inst, 'deathrite', u.owner, { c: u.c, r: u.r });
}
function damageUnit(s: GameState, u: Unit, n: number, lethal = false) {
  if (n <= 0 || !s.units[u.id]) return;
  if (u.avatar) { damageAvatar(s, u.owner, n); return; }
  u.damage += n;
  if (lethal || u.damage >= defenseOf(s, u)) killUnit(s, u);
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
  if (range === 'here') return from.c === to.c;
  if (range === 'adjacent') return from.c === to.c || orthAdjacent(from.c).includes(to.c);
  return nearby(from.c).includes(to.c);
}
/** The effect asks the player for something when it resolves: a target, a number (X), or which deck to draw from. */
export const needsChoice = (e: Effect) => e.who === 'target' || !!e.x || (e.op === 'draw' && !e.deck);
/** Indices of a card's effects that happen on `on` (and, for activated abilities, come from the same line as effect `fx`). */
export function effectsOn(d: CardDef, on: Trigger, fx?: number): number[] {
  const line = fx === undefined ? undefined : d.effects[fx]?.line;
  return d.effects.map((e, i) => [e, i] as const).filter(([e, i]) => e.on === on && (fx === undefined || (line === undefined ? i === fx : e.line === line))).map(([, i]) => i);
}
/** Units effect `i` of card `d` may target, measured from `origins` (spellcasters for magic, the source otherwise). */
export function targetsFor(s: GameState, p: PlayerId, d: CardDef, i: number, origins: Loc[], self?: string): string[] {
  const e = d.effects[i];
  if (!e || e.who !== 'target') return [];
  return Object.values(s.units).filter((u) => {
    if (u.owner !== p && hasStealth(s, u)) return false;
    if ((e.op === 'destroy' || e.op === 'banish' || e.op === 'bounce') && u.avatar) return false;
    switch (e.only) {
      case 'minion': if (u.avatar) return false; break;
      case 'avatar': if (!u.avatar) return false; break;
      case 'enemy': if (u.owner === p) return false; break;
      case 'ally': if (u.owner !== p) return false; break;
      case 'enemyMinion': if (u.avatar || u.owner === p) return false; break;
      case 'allyMinion': if (u.avatar || u.owner !== p) return false; break;
    }
    if (e.other && u.id === self) return false;
    return origins.some((o) => inRange(o, u, e.range));
  }).map((u) => u.id);
}
/** Where targeted magic is measured from. */
export const casterOrigins = (s: GameState, p: PlayerId): Loc[] => spellcasters(s, p).map((u) => ({ c: u.c, r: u.r }));
/** Units a card's first targeted effect may choose (kept for callers that only need one target). */
export function validTargets(s: GameState, p: PlayerId, d: CardDef, origin?: Loc): string[] {
  const on: Trigger = d.type === 'Magic' ? 'cast' : 'genesis';
  const i = d.effects.findIndex((x) => x.who === 'target' && x.on === on);
  if (i < 0) return [];
  return targetsFor(s, p, d, i, origin ? [origin] : casterOrigins(s, p));
}
/** Turn an action's old single `target` into per-effect choices. */
function choicesOf(d: CardDef, idx: number[], choices?: (Choice | null)[], target?: string): (Choice | null)[] {
  const out = (choices ?? []).slice();
  if (target) { const i = idx.find((k) => d.effects[k].who === 'target'); if (i !== undefined && !out[i]?.target) out[i] = { ...(out[i] ?? {}), target }; }
  return out;
}
/** Check the choices for effects `idx` of card `d`. */
function checkChoices(s: GameState, p: PlayerId, d: CardDef, idx: number[], ch: (Choice | null)[], origins: Loc[], self?: string): Check {
  for (const i of idx) {
    const e = d.effects[i]; const c = ch[i] ?? undefined;
    if (e.who === 'target') {
      const ok = targetsFor(s, p, d, i, origins, self);
      if (!ok.length) return no(`${d.name} has no valid target in range.`);
      if (!c?.target || !ok.includes(c.target)) return no('Choose a valid target: in range and region of a spellcaster you control, and not a stealthed enemy.', 'Stealth');
    }
    if (e.x && c?.n !== undefined && (!Number.isInteger(c.n) || c.n < 0 || c.n > 99)) return no('Choose a number from 0 up.');
  }
  return { ok: true };
}

/** Everything in the realm a player controls that can carry abilities. */
export function sourcesOf(s: GameState, p: PlayerId): { src: Source; inst: string; loc: Loc; unit?: Unit }[] {
  const out: { src: Source; inst: string; loc: Loc; unit?: Unit }[] = [];
  for (const u of Object.values(s.units)) if (u.owner === p) out.push({ src: { unit: u.id }, inst: u.inst, loc: { c: u.c, r: u.r }, unit: u });
  for (const m of s.perms) if (m.owner === p) { const b = m.carrier ? s.units[m.carrier] : undefined; out.push({ src: { perm: m.id }, inst: m.inst, loc: b ? { c: b.c, r: b.r } : { c: m.c, r: 'surface' } }); }
  for (let c = 0; c < CELLS; c++) { const st = s.sites[c]; if (st?.inst && st.owner === p) out.push({ src: { site: c }, inst: st.inst, loc: { c, r: 'surface' } }); }
  return out;
}
export function sourceOf(s: GameState, src: Source): { inst: string; owner: PlayerId; loc: Loc; unit?: Unit; tapped: boolean } | null {
  if ('unit' in src) { const u = s.units[src.unit]; return u ? { inst: u.inst, owner: u.owner, loc: { c: u.c, r: u.r }, unit: u, tapped: u.tapped } : null; }
  if ('perm' in src) { const m = s.perms.find((x) => x.id === src.perm); if (!m) return null; const b = m.carrier ? s.units[m.carrier] : undefined; return { inst: m.inst, owner: m.owner, loc: b ? { c: b.c, r: b.r } : { c: m.c, r: 'surface' }, tapped: !!m.tapped }; }
  const st = s.sites[src.site]; return st?.inst && st.owner !== null ? { inst: st.inst, owner: st.owner, loc: { c: src.site, r: 'surface' }, tapped: !!st.tapped } : null;
}
const srcKey = (src: Source) => ('unit' in src ? 'u' + src.unit : 'perm' in src ? 'm' + src.perm : 's' + src.site);
const selfUnit = (s: GameState, src?: Source) => (src && 'unit' in src ? src.unit : undefined);
const bearerOf = (s: GameState, src?: Source) => (src && 'perm' in src ? s.perms.find((m) => m.id === src.perm)?.carrier : undefined);

/** A triggered ability: resolve it now when it needs no decision, otherwise queue it for its controller. */
function fire(s: GameState, inst: string, on: Trigger, p: PlayerId, loc: Loc | null, src?: Source) {
  const d = cardOf(s, inst); const idx = effectsOn(d, on);
  if (!idx.length || s.phase === 'over') return;
  if (idx.some((i) => needsChoice(d.effects[i]) || d.effects[i].op === 'manual')) {
    (s.queue ??= []).push({ id: `q${s.nextId++}`, by: p, inst, fx: idx, loc, ...(src ? { src } : {}) });
    log(s, `${d.name}: ${on === 'deathrite' ? 'Deathrite' : on === 'genesis' ? 'Genesis' : on === 'startTurn' ? 'start of turn' : 'end of turn'} ability waits for ${pname(p)}.`, p);
    return;
  }
  resolve(s, d, idx, p, loc, [], src);
}
function fireAll(s: GameState, p: PlayerId, on: 'startTurn' | 'endTurn') {
  for (const x of sourcesOf(s, p)) fire(s, x.inst, on, p, x.loc, x.src);
}

/** Carry out effects `idx` of card `d` for player `p`. `loc` is where the ability happens; `src` what it came from. */
function resolve(s: GameState, d: CardDef, idx: number[], p: PlayerId, loc: Loc | null, ch: (Choice | null)[], src?: Source) {
  const self = selfUnit(s, src), bearer = bearerOf(s, src);
  for (const i of idx) {
    const e = d.effects[i]; const c = ch[i] ?? undefined;
    if (s.phase === 'over') return;
    if (e.cond === 'onlyCopy' && sitesOf(s, p).filter((x) => s.sites[x]!.inst && cardOf(s, s.sites[x]!.inst!).name === d.name).length !== 1) continue;
    const n = e.x ? Math.max(0, c?.n ?? 0) : e.n ?? 1;
    const all = Object.values(s.units);
    const here = (u: Unit) => !!loc && u.c === loc.c && u.r === loc.r;
    const near = (u: Unit) => !!loc && u.r === loc.r && nearby(loc.c).includes(u.c);
    let victims: Unit[] = [];
    switch (e.who) {
      case 'target': { const t = c?.target ? s.units[c.target] : undefined; if (t) victims = [t]; break; }
      case 'enemyAvatar': victims = [s.units[s.players[other(p)].avatar]]; break;
      case 'ownAvatar': victims = [s.units[s.players[p].avatar]]; break;
      case 'allAvatars': victims = [s.units[s.players[p].avatar], s.units[s.players[other(p)].avatar]]; break;
      case 'nearbyAvatars': victims = all.filter((u) => u.avatar && loc && nearby(loc.c).includes(u.c)); break;
      case 'self': victims = self && s.units[self] ? [s.units[self]] : []; break;
      case 'bearer': victims = bearer && s.units[bearer] ? [s.units[bearer]] : []; break;
      case 'enemiesHere': victims = all.filter((u) => here(u) && u.owner !== p); break;
      case 'alliesHere': victims = all.filter((u) => here(u) && u.owner === p); break;
      case 'unitsHere': case 'minionsHere': victims = all.filter(here); break;
      case 'enemiesNearby': victims = all.filter((u) => near(u) && u.owner !== p); break;
      case 'alliesNearby': victims = all.filter((u) => near(u) && u.owner === p); break;
      case 'unitsNearby': victims = all.filter(near); break;
      case 'allMinions': victims = all.filter((u) => !u.avatar); break;
      case 'enemyMinions': victims = all.filter((u) => !u.avatar && u.owner !== p); break;
      case 'allyMinions': victims = all.filter((u) => !u.avatar && u.owner === p); break;
    }
    if (e.who !== 'target') { if (e.only === 'minion' || e.who === 'minionsHere') victims = victims.filter((u) => !u.avatar); if (e.other) victims = victims.filter((u) => u.id !== self); }
    const players: PlayerId[] = e.who === 'opponent' ? [other(p)] : e.who === 'controller' ? [p] : e.who === 'allAvatars' ? [p, other(p)] : [];
    const nm = (u: Unit) => unitCard(s, u).name;
    switch (e.op) {
      case 'damage': for (const v of victims) { if (!s.units[v.id] && !v.avatar) continue; log(s, `${d.name} deals ${n} damage to ${nm(v)}.`, p); damageUnit(s, v, n); } break;
      case 'destroy': for (const v of victims) if (!v.avatar && s.units[v.id]) { log(s, `${d.name} destroys ${nm(v)}.`, p); killUnit(s, v); } break;
      case 'banish': for (const v of victims) if (!v.avatar && s.units[v.id]) removeUnit(s, v, 'banish', d.name); break;
      case 'bounce': for (const v of victims) if (!v.avatar && s.units[v.id]) removeUnit(s, v, 'hand', d.name); break;
      case 'heal':
        if (e.who === 'controller' || e.who === 'opponent') for (const q of players) gainLife(s, q, n);
        else for (const v of victims) if (v.avatar) gainLife(s, v.owner, n); else { v.damage = Math.max(0, v.damage - n); log(s, `${nm(v)} heals ${n}.`, p); }
        break;
      case 'loseLife': for (const q of players.length ? players : victims.filter((v) => v.avatar).map((v) => v.owner)) loseLife(s, q, n); break;
      case 'mana': s.players[p].mana += n; log(s, `${pname(p)} gains ${n} mana (${d.name}).`, p); break;
      case 'draw': {
        const deck = e.deck ?? c?.deck ?? 'spellbook';
        const who = e.who === 'opponent' ? other(p) : p;
        for (let k = 0; k < n; k++) if (!drawCard(s, who, deck)) { log(s, `${pname(who)} must draw from an empty deck and loses.`, who); win(s, other(who)); break; }
        if ((s.phase as string) !== 'over') log(s, `${pname(who)} draws ${n} from the ${deck} (${d.name}).`, p);
        break;
      }
      case 'discard': for (const q of players) for (let k = 0; k < n; k++) {
        const h = s.players[q].hand; if (!h.length) break;
        const [x] = h.splice(Math.floor(rand(s) * h.length), 1); s.players[q].cemetery.push(x);
        log(s, `${pname(q)} discards ${cardOf(s, x).name} (${d.name}).`, p);
      } break;
      case 'tap': case 'untap': {
        const on = e.op === 'tap';
        if (e.who === 'self' && src && 'site' in src && s.sites[src.site]) s.sites[src.site]!.tapped = on;
        else if (e.who === 'self' && src && 'perm' in src) { const m = s.perms.find((x) => x.id === src.perm); if (m) m.tapped = on; }
        for (const v of victims) { v.tapped = on; log(s, `${d.name} ${on ? 'taps' : 'untaps'} ${nm(v)}.`, p); }
        break;
      }
      case 'buff': case 'grant':
        for (const v of victims) {
          (v.mods ??= []).push({ atk: e.op === 'buff' ? e.atk ?? 0 : 0, def: e.op === 'buff' ? e.def ?? 0 : 0, ...(e.keyword ? { kw: e.keyword } : {}), ...(e.until === 'turn' ? { turn: s.turn } : {}), from: d.name });
          log(s, `${nm(v)} ${e.op === 'buff' ? `gets ${(e.atk ?? 0) >= 0 ? '+' : ''}${e.atk ?? 0} power` : `gains ${e.keyword}`}${e.until === 'turn' ? ' this turn' : ''} (${d.name}).`, p);
          if (!v.avatar && v.damage >= defenseOf(s, v)) killUnit(s, v);
        }
        break;
      case 'manual': s.log.push({ turn: s.turn, p, text: `${d.name}: “${e.text ?? ''}” — not automated; resolve by hand.`, manual: true }); break;
    }
  }
}
function removeUnit(s: GameState, u: Unit, to: 'banish' | 'hand', why: string) {
  for (const m of s.perms) if (m.carrier === u.id) { m.c = u.c; delete m.carrier; }
  delete s.units[u.id];
  const owner = Number(u.inst[0]) as PlayerId;
  if (to === 'hand') { s.players[owner].hand.push(u.inst); log(s, `${unitCard(s, u).name} returns to ${pname(owner)}'s hand (${why}).`, null); }
  else log(s, `${unitCard(s, u).name} is banished (${why}).`, null);
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
  // The attacker divides its damage among the enemies in the fight. The engine picks the split
  // that kills the most: weakest minions first, anything left over on the next enemy in line.
  if (!isDisabled(s, a)) {
    const lance = a.lance; a.lance = false;
    const lethal = has(s, a, 'Lethal');
    let left = power(s, a) + (lance ? 1 : 0);
    const foes = enemyIds.map((id) => s.units[id]).filter(Boolean);
    const need = (u: Unit) => (u.avatar ? Infinity : lethal ? 1 : Math.max(1, defenseOf(s, u) - u.damage));
    const order = [...foes].sort((x, y) => need(x) - need(y));
    const give = new Map<string, number>();
    for (const f of order) { const n = need(f); if (n <= left) { give.set(f.id, n); left -= n; } }
    if (left > 0) { const rest = order.find((f) => !give.has(f.id)) ?? order[0]; if (rest) give.set(rest.id, (give.get(rest.id) ?? 0) + left); }
    for (const f of foes) if (give.get(f.id)) strikes.push({ from: a, to: f, dmg: give.get(f.id)!, lethal, first: lance });
  }
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
  if (!s.pending && s.queue?.length) {
    if (a.t !== 'trigger') return no(`${pname(s.queue[0].by)} must first resolve ${cardOf(s, s.queue[0].inst).name}'s triggered ability.`);
    if (a.skip) return { ok: true };
    const q = s.queue[0]; const d = cardOf(s, q.inst);
    const self = q.src && 'unit' in q.src ? q.src.unit : undefined;
    return checkChoices(s, q.by, d, q.fx, a.choices ?? [], q.loc ? [q.loc] : casterOrigins(s, q.by), self);
  }
  if (a.t === 'trigger') return no('There is no triggered ability waiting.');
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
      const on: Trigger = d.type === 'Magic' ? 'cast' : 'genesis';
      const idx = effectsOn(d, on);
      const needsTarget = idx.some((i) => d.effects[i].who === 'target');
      if (d.type === 'Artifact' && !needsTarget && a.target) { // conjured straight into a unit's hands
        const b = s.units[a.target];
        if (!b || b.owner !== p || b.c !== a.c) return no('An artifact can be handed to one of your own units on the site where it is conjured.');
        return { ok: true };
      }
      return checkChoices(s, p, d, idx, choicesOf(d, idx, a.choices, a.target), d.type === 'Magic' ? casterOrigins(s, p) : [{ c: a.c!, r: 'surface' }]);
    }
    case 'ability': {
      const src = sourceOf(s, a.src);
      if (!src || src.owner !== p) return no('That is not yours.');
      const d = cardOf(s, src.inst); const e = d.effects[a.fx];
      if (!e || (e.on !== 'tap' && e.on !== 'activated')) return no(`${d.name} has no ability to use there.`);
      if (src.unit && isDisabled(s, src.unit)) return no(`${d.name} is disabled and its abilities do not work.`, 'Disabled');
      if (e.on === 'tap') {
        if (src.unit) { const can = canAct(s, src.unit); if (!can.ok) return can; }
        else if (src.tapped) return no(`${d.name} is already tapped.`);
      } else if (!e.repeat && s.used?.[`${srcKey(a.src)}:${e.line ?? a.fx}`] === s.turn) return no(`${d.name}'s ability can be used once per turn.`);
      const cost = e.cost ?? 0;
      if (cost > pl.mana) return no(`That ability costs ${cost} mana and you have ${pl.mana}.`);
      const idx = effectsOn(d, e.on, a.fx);
      return checkChoices(s, p, d, idx, a.choices ?? [], [src.loc], src.unit?.id);
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
      fire(s, a.inst, 'genesis', p, { c: a.c, r: 'surface' }, { site: a.c });
      break;
    }
    case 'cast': {
      const d = cardOf(s, a.inst);
      pl.hand.splice(pl.hand.indexOf(a.inst), 1);
      pl.mana -= d.cost;
      const on: Trigger = d.type === 'Magic' ? 'cast' : 'genesis';
      const idx = effectsOn(d, on);
      const ch = choicesOf(d, idx, a.choices, a.target);
      const hand = d.effects.some((e) => e.op === 'manual') ? ' Part of its text is not automated; resolve it by hand.' : '';
      if (d.type === 'Minion') {
        const id = `u${s.nextId++}`;
        s.units[id] = { id, inst: a.inst, owner: p, c: a.c!, r: 'surface', tapped: false, damage: 0, enteredTurn: s.turn, avatar: false, stealthLost: false, lance: d.keywords.includes('Lance') };
        log(s, `${pname(p)} summons ${d.name}.${hand}`);
        resolve(s, d, idx, p, { c: a.c!, r: 'surface' }, ch, { unit: id });
      } else if (d.type === 'Artifact' || d.type === 'Aura') {
        const bearer = d.type === 'Artifact' && !idx.some((i) => d.effects[i].who === 'target') ? a.target : undefined;
        const mid = `m${s.nextId++}`;
        s.perms.push({ id: mid, inst: a.inst, owner: p, c: a.c!, kind: d.type === 'Aura' ? 'aura' : 'artifact', ...(bearer ? { carrier: bearer } : {}) });
        if (bearer) log(s, `${unitCard(s, s.units[bearer]).name} takes up ${d.name}.`);
        log(s, `${pname(p)} conjures ${d.name}.${hand}`);
        resolve(s, d, idx, p, { c: a.c!, r: 'surface' }, ch, { perm: mid });
      } else {
        log(s, `${pname(p)} casts ${d.name}.${hand}`);
        const caster = s.units[pl.avatar];
        resolve(s, d, idx, p, { c: caster.c, r: caster.r }, ch);
        pl.cemetery.push(a.inst);
      }
      break;
    }
    case 'ability': {
      const src = sourceOf(s, a.src)!; const d = cardOf(s, src.inst); const e = d.effects[a.fx];
      if (e.on === 'tap') {
        if (src.unit) s.units[src.unit.id].tapped = true;
        else if ('perm' in a.src) { const m = s.perms.find((x) => x.id === (a.src as { perm: string }).perm); if (m) m.tapped = true; }
        else if ('site' in a.src) s.sites[a.src.site]!.tapped = true;
      } else (s.used ??= {})[`${srcKey(a.src)}:${e.line ?? a.fx}`] = s.turn;
      if (e.cost) pl.mana -= e.cost;
      log(s, `${pname(p)} uses ${d.name}${e.on === 'tap' ? ' (tap)' : ''}${e.cost ? `, paying ${e.cost} mana` : ''}.`);
      resolve(s, d, effectsOn(d, e.on, a.fx), p, src.loc, a.choices ?? [], a.src);
      break;
    }
    case 'trigger': {
      const q = s.queue!.shift()!; const d = cardOf(s, q.inst);
      if (a.skip) log(s, `${pname(q.by)} lets ${d.name}'s ability pass.`, q.by);
      else resolve(s, d, q.fx, q.by, q.loc, a.choices ?? [], q.src);
      if (!s.queue!.length) delete s.queue;
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
      fireAll(s, p, 'endTurn');
      for (const u of Object.values(s.units)) { if (u.owner === p && !u.avatar) u.damage = 0; if (u.mods?.some((m) => m.turn !== undefined)) { u.mods = u.mods.filter((m) => m.turn === undefined); if (!u.mods.length) delete u.mods; } }
      pl.mana = 0;
      startTurn(s, other(p));
      break;
    }
    case 'manual': manual(s, a); break;
  }
  // carried artifacts go where their bearer goes; if the bearer is gone they stay where it fell
  for (const m of s.perms) if (m.carrier) { const b = s.units[m.carrier]; if (b) m.c = b.c; else delete m.carrier; }
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
    case 'carry': { const m = s.perms.find((x) => x.id === a.perm); const u = a.unit ? s.units[a.unit] : undefined;
      if (m && m.kind === 'artifact') { if (u && u.c === m.c) { m.carrier = u.id; m.owner = u.owner; say(`${unitCard(s, u).name} picks up ${cardOf(s, m.inst).name}.`); } else if (!a.unit) { delete m.carrier; say(`${cardOf(s, m.inst).name} is put down.`); } }
      break; }
    case 'buff': { const u = s.units[a.unit]; if (u) { (u.mods ??= []).push({ atk: a.atk, def: a.def, ...(a.turn ? { turn: s.turn } : {}), from: 'manual' }); say(`${unitCard(s, u).name} ${a.atk >= 0 ? '+' : ''}${a.atk} power${a.turn ? ' this turn' : ''}.`); if (!u.avatar && u.damage >= defenseOf(s, u)) killUnit(s, u); } break; }
    case 'grant': { const u = s.units[a.unit]; if (u) { (u.mods ??= []).push({ atk: 0, def: 0, kw: a.keyword, ...(a.turn ? { turn: s.turn } : {}), from: 'manual' }); say(`${unitCard(s, u).name} gains ${a.keyword}${a.turn ? ' this turn' : ''}.`); } break; }
    case 'untap': { const u = s.units[a.unit]; if (u) { u.tapped = false; say(`untap ${unitCard(s, u).name}.`); } break; }
    case 'banish': { const u = s.units[a.unit]; if (u && !u.avatar) { say(`banish ${unitCard(s, u).name}.`); removeUnit(s, u, 'banish', 'by hand'); } break; }
    case 'bounce': { const u = s.units[a.unit]; if (u && !u.avatar) { say(`return ${unitCard(s, u).name} to its owner's hand.`); removeUnit(s, u, 'hand', 'by hand'); } break; }
    case 'note': say(a.text.slice(0, 200)); break;
    case 'teleport': { const u = s.units[a.unit]; if (u && a.c >= 0 && a.c < CELLS) { u.c = a.c; u.r = 'surface'; say(`move ${unitCard(s, u).name}.`); } break; }
  }
}

// ---------- enumeration (AI + move highlighting) ----------
/** Candidate choices for effects `idx`: every target for the first targeted effect, the first valid one for the rest. X is 1. */
function choiceSets(s: GameState, p: PlayerId, d: CardDef, idx: number[], origins: Loc[], self?: string): Choice[][] {
  const base: Choice[] = []; let spread = -1;
  for (const i of idx) {
    const e = d.effects[i];
    if (e.who === 'target') { const t = targetsFor(s, p, d, i, origins, self); if (!t.length) return []; if (spread < 0) spread = i; base[i] = { target: t[0] }; }
    if (e.x) base[i] = { ...(base[i] ?? {}), n: 1 };
    if (e.op === 'draw' && !e.deck) base[i] = { ...(base[i] ?? {}), deck: 'spellbook' };
  }
  if (spread < 0) return [base];
  return targetsFor(s, p, d, spread, origins, self).map((target) => { const c = base.slice(); c[spread] = { ...(c[spread] ?? {}), target }; return c; });
}

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
  if (s.queue?.length) {
    const q = s.queue[0]; const d = cardOf(s, q.inst);
    const self = q.src && 'unit' in q.src ? q.src.unit : undefined;
    for (const choices of choiceSets(s, q.by, d, q.fx, q.loc ? [q.loc] : casterOrigins(s, q.by), self)) out.push({ t: 'trigger', choices });
    out.push({ t: 'trigger', skip: true });
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
      for (const choices of choiceSets(s, p, d, effectsOn(d, 'cast'), casterOrigins(s, p))) out.push({ t: 'cast', inst, ...(choices.length ? { choices } : {}) });
    } else {
      for (const c of mine) for (const choices of choiceSets(s, p, d, effectsOn(d, 'genesis'), [{ c, r: 'surface' }])) out.push({ t: 'cast', inst, c, ...(choices.length ? { choices } : {}) });
    }
  }
  // activated abilities (the AI leaves out ones that are only text to resolve by hand)
  for (const x of sourcesOf(s, p)) {
    const d = cardOf(s, x.inst); const lines = new Set<string>();
    d.effects.forEach((e, i) => {
      if ((e.on !== 'tap' && e.on !== 'activated') || lines.has(`${e.on}:${e.line ?? i}`)) return;
      lines.add(`${e.on}:${e.line ?? i}`);
      const idx = effectsOn(d, e.on, i);
      if (idx.every((k) => d.effects[k].op === 'manual')) return;
      for (const choices of choiceSets(s, p, d, idx, [x.loc], x.unit?.id)) { const a: Action = { t: 'ability', src: x.src, fx: i, choices }; if (check(s, a).ok) out.push(a); }
    });
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
