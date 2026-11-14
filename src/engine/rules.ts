// Rules engine: pure functions over GameState. No UI, no browser APIs.
// Rules source: the Sorcery: Contested Realm rulebook as read on 2026-11-10 through a community
// rulebook reader (not fetched from sorcerytcg.com). Known simplifications are listed in docs/RULES_COVERAGE.md.
import {
  type Action, type CardDef, type CardFilter, type Check, type Choice, type Zone, type DeckList, type Effect, type GameState, type Loc, type ManualOp,
  type Element, type PlayerId, type PlayerState, type Queued, type Source, type Thresholds, type Trigger, type Unit, CELLS, COLS, ELEMENTS, ROWS,
} from './types';

// ---------- helpers ----------
export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
export const xy = (c: number): [number, number] => [c % COLS, Math.floor(c / COLS)];
export const cell = (x: number, y: number) => (x < 0 || y < 0 || x >= COLS || y >= ROWS ? -1 : y * COLS + x);
export const AVATAR_START: [number, number] = [cell(2, ROWS - 1), cell(2, 0)];
const locKey = (l: Loc) => l.c + (l.r === 'surface' ? 's' : 'u');
/** The four regions (rulebook Oct 2024 p13 and p34 "Region"; Codex "Region"): the surface, underground (below
 *  a land site), underwater (below a water site) and the void (a square with no site). A unit stores only its
 *  layer (`r`); its region follows the square, so a site that floods turns its underground into underwater. */
export type RealmRegion = 'surface' | 'underground' | 'underwater' | 'void';
export function regionOf(s: GameState, l: Loc): RealmRegion {
  if (!s.sites[l.c]) return 'void';
  if (l.r === 'surface') return 'surface';
  return isWater(s, l.c) ? 'underwater' : 'underground';
}
/** Rulebook p15: only locations in the same region are adjacent or nearby; p35 "Target": the same region. */
export const sameRegion = (s: GameState, a: Loc, b: Loc) => regionOf(s, a) === regionOf(s, b);

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
/** Rulebook p12 "Bodies of Water & Land": the contiguous cluster of sites sharing borders (not corners) with the
 *  site at c that are of its kind (water or land; rubble is land). Empty for a void. Codex "Body of Water", "Span of Land". */
export function bodyOf(s: GameState, c: number): number[] {
  if (!s.sites[c]) return [];
  const water = isWater(s, c); const out = [c]; const seen = new Set(out);
  for (let i = 0; i < out.length; i++) for (const n of orthAdjacent(out[i])) if (!seen.has(n) && s.sites[n] && isWater(s, n) === water) { seen.add(n); out.push(n); }
  return out;
}
/** The body of the given kind the square is part of ("her body of water" is empty while she is on land). */
export const bodyOfKind = (s: GameState, c: number, kind: 'water' | 'land') => (s.sites[c] && isWater(s, c) === (kind === 'water') ? bodyOf(s, c) : []);
export function isWater(s: GameState, c: number): boolean {
  const site = s.sites[c];
  if (!site || !site.inst) return false;
  const d = cardOf(s, site.inst);
  if (d.thresholds.water > 0 || d.keywords.includes('Flood') || s.players?.some((pl) => pl?.flooded === c)) return true; // Codex "Flooded": a flooded site is a water site
  if (s.perms?.some((m) => m.kind === 'aura' && auraArea(m.c).includes(c) && cardOf(s, m.inst).effects.some((e) => e.on === 'static' && e.op === 'grant' && e.keyword === 'Flood' && e.who === 'affectedSites'))) return true;
  return Object.values(s.units).some((u) => u.c === c && unitCard(s, u).effects.some((e) => e.on === 'static' && e.op === 'grant' && e.keyword === 'Flood' && e.who === 'siteHere'));
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
  for (const x of provided(s, p)) for (const e of ELEMENTS) t[e] += x.el?.[e] ?? 0;
  const ex = s.players[p].extra; if (ex && ex.turn === s.turn) for (const e of ELEMENTS) t[e] += ex.th[e] ?? 0;
  return t;
}
const provideCache = new WeakMap<object, Set<string>>();
/** Static "Provides …" effects of cards a player controls in the realm (minions, artifacts, auras, sites). */
function provided(s: GameState, p: PlayerId): Effect[] {
  let set = provideCache.get(s.cards);
  if (!set) { set = new Set(Object.values(s.cards).filter((d) => d.effects.some((e) => e.on === 'static' && e.op === 'provide')).map((d) => d.id)); provideCache.set(s.cards, set); }
  if (!set.size) return [];
  const out: Effect[] = [];
  const add = (inst: string, at: Loc, self?: string) => { const d = cardOf(s, inst); if (set!.has(d.id)) for (const e of d.effects) if (e.on === 'static' && e.op === 'provide' && condHolds(s, e.when, p, at, self)) out.push(e); };
  for (const u of Object.values(s.units)) if (u.owner === p && !isDisabled(s, u)) add(u.inst, u, u.id);
  for (const m of s.perms) if (m.owner === p) add(m.inst, { c: m.c, r: 'surface' });
  s.sites.forEach((st, c) => { if (st?.inst && st.owner === p) add(st.inst, { c, r: 'surface' }); });
  return out;
}
/** Mana a player gets at the start of the turn: 1 per site plus "Provides ①" abilities. */
export const manaIncome = (s: GameState, p: PlayerId) => sitesOf(s, p).length + provided(s, p).reduce((n, e) => n + (e.n ?? 0), 0);
// ---------- stat changes and granted keywords ----------
// Two sources: `mods` on the unit (from spells and activated abilities, some only for this turn), and
// static abilities of cards in the realm ("Other allies here have +1 power", "Bearer has Airborne").
const staticCache = new WeakMap<object, Set<string>>();
/** The index of cards with static abilities is kept per card table; call this after changing a table in place. */
export function forgetStatics(cards: Record<string, CardDef>) { staticCache.delete(cards); provideCache.delete(cards); preventCache.delete(cards); }
function staticCards(s: GameState): Set<string> {
  let set = staticCache.get(s.cards);
  if (!set) { set = new Set(Object.values(s.cards).filter((d) => d.effects.some((e) => e.on === 'static' && (e.op === 'buff' || e.op === 'grant'))).map((d) => d.id)); staticCache.set(s.cards, set); }
  return set;
}
interface Bonus { atk: number; def: number; kws: string[] }
/** Does a condition on an ability hold, for a card controlled by `p` at `at` (unit `self` if it is one)? */
export function condHolds(s: GameState, w: Effect['when'], p: PlayerId, at: Loc | null, self?: string): boolean {
  if (!w) return true;
  const me = self ? s.units[self] : undefined;
  const subOk = (d: CardDef) => (!w.sub || d.subtypes.some((y) => y.toLowerCase() === w.sub!.toLowerCase())) && (!w.name || d.name === w.name);
  let r = false;
  switch (w.k) {
    case 'moreLife': r = s.players[p].life > s.players[other(p)].life; break;
    case 'backRow': r = !!at && xy(at.c)[1] === (p === 0 ? ROWS - 1 : 0); break;
    case 'warded': r = !!me?.ward; break;
    case 'deathsDoor': r = s.players[p].deathsDoor; break;
    case 'control': r = Object.values(s.units).some((u) => u.owner === p && (!w.other || u.id !== self) && subOk(unitCard(s, u))); break;
    case 'lostLife': r = s.players[p].lostTurn === s.turn; break;
    case 'dead': r = ([0, 1] as PlayerId[]).some((q) => s.players[q].cemetery.some((i) => subOk(cardOf(s, i)))); break;
    case 'atop': { const st = at ? s.sites[at.c] : null; r = !!st?.inst && (!me || me.r === 'surface') && subOk(cardOf(s, st.inst)); break; }
    case 'yourTurn': r = s.active === p; break;
    case 'enemyTurn': r = s.active !== p; break;
    case 'inVoid': r = !!at && !s.sites[at.c]; break;
    case 'adjacentAlly': r = !!at && Object.values(s.units).some((u) => u.owner === p && u.id !== self && sameRegion(s, u, at) && [at.c, ...orthAdjacent(at.c)].includes(u.c) && (subOk(unitCard(s, u)) || (!!w.sub && has(s, u, w.sub)))); break;
    case 'noEnemiesHere': r = !!at && !Object.values(s.units).some((u) => u.owner !== p && u.c === at.c); break;
  }
  return w.not ? !r : r;
}
/** The squares a minion or artifact can be summoned or conjured to: sites its caster controls; any site for "may be summoned to any site";
 *  and, for a minion with Voidwalk, any void square (Codex "Voidwalk": such a minion can be summoned to void locations). */
export function summonCells(s: GameState, p: PlayerId, d: CardDef): number[] {
  const out: number[] = [];
  for (let c = 0; c < CELLS; c++) {
    const site = s.sites[c];
    if (site?.owner === p || (d.type === 'Minion' && ((site?.inst && allows(d, 'Summon to any site')) || (!site && d.keywords.includes('Voidwalk'))))) out.push(c);
  }
  return out;
}
/** Rulebook p28 "When Sites Move": a site moves only to a void; everything atop and under it goes with it (they
 *  are not considered to have moved), and anything in that void ends up atop the site. Here: nearby voids. */
export function siteMoveCells(s: GameState, from: number): number[] { return nearby(from).filter((c) => c !== from && !s.sites[c]); }
function moveSite(s: GameState, from: number, to: number) {
  for (const u of Object.values(s.units)) if (u.c === to) u.r = 'surface';
  for (const u of Object.values(s.units)) if (u.c === from) u.c = to;
  for (const m of s.perms) if (m.c === from && m.kind === 'artifact' && !m.carrier) m.c = to;
  s.sites[to] = s.sites[from]; s.sites[from] = null;
}
/** Has the player the threshold an ability asks for ("(A)(A)(A) — …", rulebook p18)? */
export const needMet = (s: GameState, p: PlayerId, e: Effect) => !e.need || ELEMENTS.every((el) => thresholdOf(s, p)[el] >= (e.need![el] ?? 0));
/** Where an aura at top-left square `c` can go in one step: the joints next to its own, up, down, left or right. */
export function auraSteps(c: number): number[] { const [x, y] = xy(c); return [[x, y - 1], [x - 1, y], [x + 1, y], [x, y + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a <= COLS - 2 && b <= ROWS - 2).map(([a, b]) => cell(a, b)); }
/** The four squares an aura at top-left square `c` covers (Codex "Casting Auras"). */
export function auraArea(c: number): number[] { const [x, y] = xy(c); return [cell(x, y), cell(x + 1, y), cell(x, y + 1), cell(x + 1, y + 1)].filter((n) => n >= 0); }
const AURA_HERE: Partial<Record<Effect['who'], Effect['who']>> = { unitsHere: 'affected', minionsHere: 'affected', enemiesHere: 'affected', alliesHere: 'affected' };
/** Does a static effect of a card (at `at`, controlled by `p`, on unit `self` if it is one) reach unit u? */
function staticReaches(s: GameState, e: Effect, p: PlayerId, at: Loc, u: Unit, self?: string, bearer?: string): boolean {
  if (e.only === 'minion' && u.avatar) return false;
  if (e.other && u.id === self) return false;
  const here = u.c === at.c && (u.r === at.r || !!at.site), near = sameRegion(s, u, at) && nearby(at.c).includes(u.c); // p33: a site's "here" is its surface and subsurface
  const inArea = u.r === 'surface' && auraArea(at.c).includes(u.c);
  if (at.aura && AURA_HERE[e.who]) { // Codex "Here": for an aura, its four locations
    if (!inArea) return false;
    if (e.who === 'enemiesHere') return u.owner !== p; if (e.who === 'alliesHere') return u.owner === p; return true;
  }
  switch (e.who) {
    case 'affected': return inArea;
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
    case 'allyUnits': return u.owner === p;
    case 'enemyUnits': return u.owner !== p;
    case 'alliesInBody': return u.owner === p && bodyOfKind(s, at.c, isWater(s, at.c) ? 'water' : 'land').includes(u.c) && regionOf(s, u) !== 'void';
    case 'allMinions': return !u.avatar;
    default: return false;
  }
}
/** "for each …" counts, measured from the card's own location. */
function countFor(s: GameState, per: NonNullable<Effect['per']>, d: CardDef, p: PlayerId, at: Loc, self?: string): number {
  const [x, y] = xy(at.c);
  switch (per.kind) {
    case 'sameNearby': return Object.values(s.units).filter((u) => u.id !== self && unitCard(s, u).name === d.name && sameRegion(s, u, at) && nearby(at.c).includes(u.c)).length;
    case 'adjacentSites': return [at.c, ...orthAdjacent(at.c)].filter((c) => s.sites[c]?.inst).length;
    case 'nearbySites': return nearby(at.c).filter((c) => s.sites[c]?.inst && (!per.el || (per.el === 'water' ? isWater(s, c) : cardOf(s, s.sites[c]!.inst!).thresholds[per.el] > 0))).length;
    case 'wards': return Object.values(s.units).filter((u) => u.ward).length + s.sites.filter((st) => st?.ward).length;
    case 'deadSub': return s.players[p].cemetery.filter((i) => cardOf(s, i).type === 'Minion' && (!per.sub || cardOf(s, i).subtypes.includes(per.sub))).length;
    case 'sameInCemetery': return s.players[p].cemetery.filter((i) => cardOf(s, i).name === d.name).length;
    case 'voidsInRow': return [0, 1, 2, 3, 4].filter((cx) => !s.sites[cell(cx, y)]).length + 0 * x;
    case 'bodySites': return bodyOfKind(s, at.c, per.body ?? 'water').length;
  }
}
export function bonus(s: GameState, u: Unit): Bonus {
  const b: Bonus = { atk: 0, def: 0, kws: [] };
  for (const m of u.mods ?? []) { b.atk += m.atk; b.def += m.def; if (m.kw) b.kws.push(m.kw); }
  const set = staticCards(s); if (!set.size) return b;
  const add = (d: CardDef, p: PlayerId, at: Loc, self?: string, bearer?: string) => {
    for (const e of d.effects) if (e.on === 'static' && staticReaches(s, e, p, at, u, self, bearer) && condHolds(s, e.when, p, at, self ?? bearer) && needMet(s, p, e)) {
      if (e.op === 'buff') { const k = e.per ? countFor(s, e.per, d, p, at, self) : 1; b.atk += (e.atk ?? 0) * k; b.def += (e.def ?? 0) * k; } else if (e.op === 'grant' && e.keyword) b.kws.push(e.keyword);
    }
  };
  for (const v of Object.values(s.units)) { const d = unitCard(s, v); if (set.has(d.id) && !d.keywords.includes('Disabled')) add(d, v.owner, v, v.id); }
  for (const m of s.perms) { const d = cardOf(s, m.inst); if (set.has(d.id)) add(d, m.owner, { c: m.c, r: m.carrier ? s.units[m.carrier]?.r ?? 'surface' : 'surface', ...(m.kind === 'aura' ? { aura: true } : {}) }, undefined, m.carrier); }
  for (let c = 0; c < CELLS; c++) { const st = s.sites[c]; if (st?.inst && st.owner !== null) { const d = cardOf(s, st.inst); if (set.has(d.id)) add(d, st.owner, { c, r: 'surface', site: true }); } }
  return b;
}
export function isDisabled(s: GameState, u: Unit): boolean {
  const k = unitCard(s, u).keywords;
  if (k.includes('Disabled') || u.mods?.some((m) => m.kw === 'Disabled')) return true;
  if (k.includes('Waterbound') && !isWater(s, u.c)) return true;
  if (k.includes('Landbound') && !isLand(s, u.c)) return true;
  return false;
}
/** The kinds of spellcaster a unit is: "Spellcaster" casts anything; "Spellcaster (fire)", "(earth+water)",
 *  "(not fire)", "(not Ordinary)" are limited (rulebook p34 "Spellcaster"; Codex "Spellcaster"). Avatars always are. */
export function casterKinds(s: GameState, u: Unit): string[] {
  if (u.avatar) return ['Spellcaster'];
  if (isDisabled(s, u)) return []; // rulebook p33 "Disabled": can't cast spells
  const d = unitCard(s, u); const out = new Set<string>();
  const own = d.effects.filter((e) => e.on === 'static' && e.op === 'grant' && e.who === 'self' && e.keyword?.startsWith('Spellcaster (')).map((e) => e.keyword!);
  own.forEach((k) => out.add(k));
  if (d.keywords.includes('Spellcaster') && !own.length) out.add('Spellcaster'); // the API lists a limited spellcaster's keyword as plain "Spellcaster"
  for (const m of u.mods ?? []) if (m.kw?.startsWith('Spellcaster')) out.add(m.kw);
  const b = staticCards(s).size > 0 ? bonus(s, u).kws : [];
  if (b.includes('Loses Spellcaster')) return [];
  for (const k of b) if (k === 'Spellcaster' || k.startsWith('Spellcaster (')) out.add(k);
  return [...out];
}
/** May a spellcaster of this kind cast card d? */
export function kindAllows(kind: string, d: CardDef): boolean {
  const m = kind.match(/^Spellcaster \((.+)\)$/); if (!m) return true;
  const not = m[1].match(/^not (.+)$/);
  if (not) return not[1] === 'Ordinary' ? d.rarity !== 'Ordinary' : !(d.thresholds[not[1] as Element] > 0);
  return m[1].split('+').some((el) => d.thresholds[el as Element] > 0);
}
export function has(s: GameState, u: Unit, kw: string): boolean {
  if (kw === 'Spellcaster') return casterKinds(s, u).length > 0;
  if (isDisabled(s, u)) return false;
  const b = staticCards(s).size > 0 ? bonus(s, u).kws : null;
  if (b?.includes('Loses ' + kw)) return false; // "All other minions lose Airborne"
  if (unitCard(s, u).keywords.includes(kw) || u.mods?.some((m) => m.kw === kw)) return true;
  return !!b?.includes(kw);
}
export const hasStealth = (s: GameState, u: Unit) => !u.stealthLost && has(s, u, 'Stealth');
/** Ranged X: printed, or given ("Bearer has Ranged 3"). 0 = not ranged. */
export function rangedOf(s: GameState, u: Unit): number {
  if (!has(s, u, 'Ranged') && !unitCard(s, u).ranged) { const g = givenNumber(s, u, 'Ranged'); return g; }
  return Math.max(unitCard(s, u).ranged, givenNumber(s, u, 'Ranged'), has(s, u, 'Ranged') ? 1 : 0);
}
/** The number on a keyword given by a static ability (Ranged 3, Movement +7). */
function givenNumber(s: GameState, u: Unit, kw: string): number {
  let n = 0; const set = staticCards(s); if (!set.size) return 0;
  const look = (d: CardDef, p: PlayerId, at: Loc, self?: string, bearer?: string) => { for (const e of d.effects) if (e.on === 'static' && e.op === 'grant' && e.keyword === kw && e.n && staticReaches(s, e, p, at, u, self, bearer)) n = Math.max(n, e.n); };
  for (const v of Object.values(s.units)) { const d = unitCard(s, v); if (set.has(d.id)) look(d, v.owner, v, v.id); }
  for (const m of s.perms) { const d = cardOf(s, m.inst); if (set.has(d.id)) look(d, m.owner, { c: m.c, r: 'surface' }, undefined, m.carrier); }
  return n;
}
/** A card in hand that may be put somewhere unusual ("May be summoned to any site", "You may play this site to any corner"). */
const allows = (d: CardDef, what: string) => d.effects.some((e) => e.on === 'static' && e.op === 'grant' && e.keyword === what);
export const summoningSick = (s: GameState, u: Unit) => !u.avatar && u.enteredTurn === s.turn && !has(s, u, 'Charge');
export function unitsAt(s: GameState, l: Loc): Unit[] { return Object.values(s.units).filter((u) => u.c === l.c && u.r === l.r); }
export function power(s: GameState, u: Unit): number { const d = unitCard(s, u); return Math.max(0, d.attack + (u.mods?.length || staticCards(s).size ? bonus(s, u).atk : 0)); }
/** Extra steps: Movement +X on the card plus any given this turn. */
export const moveOf = (s: GameState, u: Unit) => unitCard(s, u).movement + (u.mods ?? []).reduce((n, m) => n + (m.move ?? 0), 0) + givenNumber(s, u, 'Movement');
/** The power used when an effect compares or checks power ("weaker", "with 3 or less power", "3 or more power"):
 *  for a split-power minion the average of its attack and defense power, rounded down (Codex "Split Power";
 *  rulebook p35 "Stronger … Weaker"). Strikes still use attack power and dying still uses defense power (p23). */
export function powerValue(s: GameState, u: Unit): number {
  const d = unitCard(s, u); const a = power(s, u);
  return d.attack === d.defense ? a : Math.floor((a + defenseOf(s, u)) / 2);
}
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
    players: s.players.map((p) => ({ ...p, spellbook: p.spellbook.slice(), atlas: p.atlas.slice(), hand: p.hand.slice(), cemetery: p.cemetery.slice(), ...(p.collection ? { collection: p.collection.slice() } : {}) })) as [PlayerState, PlayerState],
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
    s.units[unitId] = { id: unitId, inst: av, owner: p, c: AVATAR_START[p], r: 'surface', tapped: false, damage: 0, enteredTurn: 0, avatar: true, stealthLost: false, lance: false, ...(cards[d.avatar]?.keywords.includes('Ward') ? { ward: true } : {}) };
    const pl: PlayerState = {
      life: cards[d.avatar]?.life || 20, deathsDoor: false, ddTurn: -1, mana: 0,
      spellbook: shuffle(s, mk(d.spellbook, 's')), atlas: shuffle(s, mk(d.atlas, 'a')), hand: [], cemetery: [], avatar: unitId, mulliganDone: false,
      ...(d.collection?.length ? { collection: mk(d.collection, 'k') } : {}),
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
  for (const u of Object.values(s.units)) if (u.owner === p) { if (u.tapped && has(s, u, "Can't untap")) { log(s, `${unitCard(s, u).name} can't untap.`, p); continue; } if (u.noUntap) { delete u.noUntap; log(s, `${unitCard(s, u).name} does not untap this time.`, p); } else u.tapped = false; }
  for (const m of s.perms) if (m.owner === p) m.tapped = false;
  for (const st of s.sites) if (st?.owner === p) st.tapped = false;
  for (const u of Object.values(s.units)) if (u.mods?.some((m) => m.next === p)) { u.mods = u.mods.filter((m) => m.next !== p); if (!u.mods.length) delete u.mods; }
  s.players[p].mana = s.players[p].income = manaIncome(s, p);
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
  pl.life = Math.max(0, pl.life - n); pl.lostTurn = s.turn;
  log(s, `${pname(p)}'s Avatar takes ${n} damage (life ${pl.life}).`, null);
  if (pl.life === 0) { pl.deathsDoor = true; pl.ddTurn = s.turn; log(s, `${pname(p)} is at death's door.`, null); }
}
function loseLife(s: GameState, p: PlayerId, n: number) {
  const pl = s.players[p];
  if (n <= 0 || pl.deathsDoor) return; // life loss cannot deal a death blow
  pl.lostTurn = s.turn;
  pl.life = Math.max(0, pl.life - n);
  log(s, `${pname(p)} loses ${n} life (life ${pl.life}).`, null);
  if (pl.life === 0) { pl.deathsDoor = true; pl.ddTurn = s.turn; log(s, `${pname(p)} is at death's door.`, null); }
}
/** Codex "Healing": an Avatar heals up to its maximum life, and not at all at death's door. */
export const maxLife = (s: GameState, p: PlayerId) => unitCard(s, s.units[s.players[p].avatar]).life || 20;
function gainLife(s: GameState, p: PlayerId, n: number) {
  const pl = s.players[p];
  if (pl.deathsDoor) { log(s, `${pname(p)} is at death's door and cannot gain life.`, null); return; }
  const before = pl.life; pl.life = Math.min(maxLife(s, p), pl.life + n);
  log(s, pl.life > before ? `${pname(p)} heals ${pl.life - before} (life ${pl.life}).` : `${pname(p)} is already at full life.`, null);
}
/** Codex "Ward": a warded unit or site is protected once from damage, destruction, or being targeted by the opponent; the Ward breaks instead. */
export const warded = (s: GameState, u: Unit) => !!u.ward && !isDisabled(s, u) && !isEvil(s, u);
/** Codex "Evil": a minion that is an Undead, Demon or Monster (or says Evil). Codex "Ward": Evil minions can't be warded. */
export function isEvil(s: GameState, u: Unit): boolean {
  if (u.avatar) return false;
  return unitCard(s, u).subtypes.some((x) => /^(undead|demon|monster|evil)$/i.test(x));
}
function breakWard(s: GameState, u: Unit, why: string) { u.ward = false; log(s, `${unitCard(s, u).name}'s Ward breaks (${why}).`, null); }
function killUnit(s: GameState, u: Unit, force = false) {
  if (!s.units[u.id] || u.avatar) return;
  if (!force && warded(s, u)) { breakWard(s, u, 'instead of being destroyed'); return; }
  if (!force && has(s, u, "Can't be destroyed")) { log(s, `${unitCard(s, u).name} can't be destroyed.`, null); return; }
  const d = unitCard(s, u);
  for (const m of s.perms) if (m.carrier === u.id) { m.c = u.c; delete m.carrier; } // what it carried stays where it fell
  delete s.units[u.id];
  log(s, `${d.name} dies.`, null);
  // Codex "Deathrite" (rulebook p32): its Deathrite resolves before the card is placed in the cemetery. When the
  // Deathrite waits for a choice, the card goes to the cemetery once that ability resolves or passes.
  const before = s.queue?.length ?? 0;
  fire(s, u.inst, 'deathrite', u.owner, { c: u.c, r: u.r });
  const waiting = (s.queue?.length ?? 0) > before ? s.queue![s.queue!.length - 1] : undefined;
  if (d.category === 'Token') log(s, `${d.name} is a token and is banished.`, null); // Codex "Token"
  else if (waiting) waiting.cemetery = u.inst;
  else toCemetery(s, u.inst);
  react(s, 'dies', u);
}
function toCemetery(s: GameState, inst: string) {
  const own = s.players[Number(inst[0]) as PlayerId]; own.cemetery.push(inst);
  if (own.died?.turn !== s.turn) own.died = { turn: s.turn, insts: [] }; own.died.insts.push(inst);
}
/** Where damage comes from, for prevention effects ("takes no damage from units with 4 or more power"). */
interface DmgFrom { unit?: Unit; card?: CardDef }
const preventCache = new WeakMap<object, Set<string>>();
/** Damage after static prevention effects that reach unit u. */
function afterPrevention(s: GameState, u: Unit, n: number, from?: DmgFrom): number {
  let set = preventCache.get(s.cards);
  if (!set) { set = new Set(Object.values(s.cards).filter((d) => d.effects.some((e) => e.op === 'prevent')).map((d) => d.id)); preventCache.set(s.cards, set); }
  if (!set.size) return n;
  const srcCard = from?.unit ? unitCard(s, from.unit) : from?.card;
  const applies = (e: Effect) => {
    if (e.fromMinPower !== undefined && !(from?.unit && powerValue(s, from.unit) >= e.fromMinPower)) return false;
    if (e.fromSub?.length && !(srcCard && e.fromSub.some((x) => srcCard.subtypes.some((y) => y.toLowerCase() === x.toLowerCase())))) return false;
    if (e.fromMagic && !(from?.card && !from.unit && from.card.type === 'Magic')) return false;
    if (e.fromElement && !(srcCard && srcCard.thresholds[e.fromElement as keyof Thresholds] > 0)) return false;
    if (e.fromSite?.length && !(from?.card?.type === 'Site' && e.fromSite.some((x) => from.card!.subtypes.some((y) => y.toLowerCase() === x.toLowerCase())))) return false;
    return true;
  };
  const visit = (d: CardDef, p: PlayerId, at: Loc, self?: string, bearer?: string) => {
    for (const e of d.effects) if (e.op === 'prevent' && e.on === 'static' && staticReaches(s, e, p, at, u, self, bearer) && applies(e)) n = e.less === undefined ? 0 : Math.max(0, n - e.less);
  };
  for (const v of Object.values(s.units)) { const d = unitCard(s, v); if (set.has(d.id) && !isDisabled(s, v)) visit(d, v.owner, v, v.id); }
  for (const m of s.perms) { const d = cardOf(s, m.inst); if (set.has(d.id)) visit(d, m.owner, { c: m.c, r: 'surface' }, undefined, m.carrier); }
  return n;
}
export function forgetPrevention(cards: Record<string, CardDef>) { preventCache.delete(cards); }
function damageUnit(s: GameState, u: Unit, n0: number, lethal = false, from?: DmgFrom) {
  const killer = from?.unit;
  if (n0 <= 0 || !s.units[u.id]) return;
  if (killer && s.units[killer.id]) killer.stealthLost = true; // Codex "Interact": dealing damage (even if prevented) ends Stealth
  if (warded(s, u)) { breakWard(s, u, `prevents ${n0} damage`); return; }
  let n = afterPrevention(s, u, n0, from);
  if (has(s, u, 'Immune to damage') || (from?.card?.type === 'Magic' && !from.unit && has(s, u, "Can't be damaged by magic"))) n = 0;
  else { const src = from?.unit ? unitCard(s, from.unit) : from?.card; const el = ELEMENTS.find((x) => has(s, u, `Immune to ${x} damage`)); if (el && src && src.thresholds[el] > 0) n = 0; }
  if (n <= 0) { log(s, `${unitCard(s, u).name} takes no damage.`, null); return; }
  if (!u.avatar && has(s, u, 'Prevent first damage each turn') && u.shieldTurn !== s.turn) { u.shieldTurn = s.turn; log(s, `${unitCard(s, u).name} prevents the first damage it takes this turn.`, null); return; }
  if (u.mods?.some((m) => m.hurt)) { u.mods = u.mods.filter((m) => !m.hurt); log(s, `${unitCard(s, u).name} wakes up.`, null); }
  if (n < n0) log(s, `${unitCard(s, u).name} takes ${n} instead of ${n0}.`, null);
  if (u.avatar) { damageAvatar(s, u.owner, n); return; }
  u.damage += n;
  const dies = lethal || u.damage >= defenseOf(s, u);
  if (!dies && has(s, u, 'Heals from damage that does not kill it')) { u.damage = 0; log(s, `${unitCard(s, u).name} heals at once.`, null); }
  react(s, 'damaged', u);
  if (dies && s.units[u.id]) { killUnit(s, u, true); if (killer && s.units[killer.id] && !s.units[u.id]) react(s, 'kills', killer, u); } // Codex "Kill Credit": the unit that struck or dealt the damage
}
function drawCard(s: GameState, p: PlayerId, deck: 'spellbook' | 'atlas'): boolean {
  const pl = s.players[p];
  const top = pl[deck].shift();
  if (!top) return false;
  pl.hand.push(top); return true;
}

// ---------- effects ----------
function spellcasters(s: GameState, p: PlayerId, d?: CardDef): Unit[] {
  return Object.values(s.units).filter((u) => u.owner === p && casterKinds(s, u).some((k) => !d || kindAllows(k, d)));
}
function inRange(s: GameState, from: Loc, to: Loc, range: Effect['range'], targeted = false): boolean {
  if (range === 'any' || !range) return !targeted || sameRegion(s, from, to); // rulebook p35 "Target": only within the Spellcaster's or card's region
  if (!sameRegion(s, from, to)) return false; // p15: adjacent and nearby only count locations in the same region
  return squareInRange(from.c, to.c, range);
}
/** Square distance only, for effects that pick a square (a void to fill, a site to flood) rather than a location in a region. */
function squareInRange(from: number, to: number, range: Effect['range']): boolean {
  if (range === 'any' || !range) return true;
  const f = { c: from }, t = { c: to };
  if (range === 'here') return f.c === t.c;
  if (range === 'two' || range === 'three') { const [a, b] = xy(f.c), [c2, d2] = xy(t.c); return Math.abs(a - c2) + Math.abs(b - d2) <= (range === 'two' ? 2 : 3); } // up to N steps away
  if (range === 'adjacent') return f.c === t.c || orthAdjacent(f.c).includes(t.c);
  return nearby(f.c).includes(t.c);
}
/** The effect asks the player for something when it resolves: a target, a number (X), or which deck to draw from. */
export const needsChoice = (e: Effect) => e.op === 'moveAura' || e.op === 'moveSite' || (e.op === 'summon' && (e.places === 'allySite' || e.places === 'allyMinion')) || e.op === 'pick' || (e.op === 'teleport' && chosenDest(e)) || (e.op === 'discard' && !e.random && e.who === 'controller') || (e.who === 'target' && !e.ref) || e.op === 'scry' || (e.who === 'atTarget' && !e.refCell) || e.op === 'shoot' || !!e.x || (e.op === 'draw' && !e.deck);
/** Filters shared by targets and groups: subtype, keyword, wounded. */
function fits(s: GameState, e: Effect, u: Unit, self?: string, selfPower?: number): boolean {
  if (e.sub?.length && !e.sub.some((x) => unitCard(s, u).subtypes.some((y) => y.toLowerCase() === x.toLowerCase()))) return false;
  if (e.kw && !has(s, u, e.kw)) return false;
  if (e.wounded && !(u.avatar ? s.players[u.owner].life < maxLife(s, u.owner) : u.damage > 0)) return false;
  if (e.surface && u.r !== 'surface') return false;
  if (e.maxPower !== undefined && powerValue(s, u) > e.maxPower) return false;
  if (e.weaker) { const mine = self && s.units[self] ? powerValue(s, s.units[self]) : selfPower; if (mine !== undefined && !(powerValue(s, u) < mine)) return false; } // Codex "Stronger, Weaker": strictly less power
  if (e.minPower !== undefined && powerValue(s, u) < e.minPower) return false;
  return true;
}
/** Squares effect `i` may choose for "at target location" (only squares that have a site or a unit). */
export function cellsFor(s: GameState, d: CardDef, i: number, origins: Loc[]): number[] {
  const e = d.effects[i]; if (e?.who !== 'atTarget') return [];
  const out: number[] = [];
  for (let c = 0; c < CELLS; c++) {
    if (e.siteKind && (!s.sites[c]?.inst || (e.siteKind === 'water') !== isWater(s, c))) continue;
    if (e.op === 'destroySite' && !s.sites[c]?.inst) continue;
    if (e.op === 'rubble' && s.sites[c]) continue;
    if (e.op === 'replaceRubble' && !(s.sites[c] && !s.sites[c]!.inst)) continue;
    if (e.op === 'flood' && !(s.sites[c]?.inst && nearby(c).some((x) => x !== c && isWater(s, x)))) continue;
    if ((s.sites[c] || Object.values(s.units).some((u) => u.c === c) || e.op === 'rubble') && origins.some((o) => squareInRange(o.c, c, e.range))) out.push(c);
  }
  const busy = (c: number) => Object.values(s.units).some((u) => u.c === c) ? 0 : 1;
  return out.sort((a, b) => busy(a) - busy(b) || a - b); // squares with units first
}
/** Where a teleport effect may send unit `u`. */
/** Where a movement effect may send unit `u` (`from` is the card's own location, for toward / away / here). */
export function teleportCells(s: GameState, e: Effect, u: Unit | undefined, from?: Loc | null): number[] {
  if (!u) return [];
  if (e.move === 'step' && (has(s, u, 'Immobile') || isDisabled(s, u))) return []; // a step is the unit's own
  const dist = (a: number, b: number) => { const [x1, y1] = xy(a), [x2, y2] = xy(b); return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)); };
  const enterable = (c: number) => (!!s.sites[c] || (has(s, u, 'Voidwalk') && !u.avatar)) || e.move === 'drag';
  const out: number[] = [];
  for (let c = 0; c < CELLS; c++) {
    if (c === u.c) continue;
    switch (e.dest) {
      case 'site': if (s.sites[c]?.inst) out.push(c); break;
      case 'adjacent': if (orthAdjacent(u.c).includes(c) && enterable(c)) out.push(c); break;
      case 'toward': if (from && orthAdjacent(u.c).includes(c) && enterable(c) && dist(c, from.c) < dist(u.c, from.c)) out.push(c); break;
      case 'away': if (from && orthAdjacent(u.c).includes(c) && enterable(c) && dist(c, from.c) > dist(u.c, from.c)) out.push(c); break;
      case 'here': case 'caster': case 'random': case 'to': break;
      default: if (nearby(u.c).includes(c) && enterable(c) && !(u.avatar && !s.sites[c])) out.push(c);
    }
  }
  return out;
}
const chosenDest = (e: Effect) => !e.dest || e.dest === 'nearby' || e.dest === 'site' || e.dest === 'adjacent';
/** Directions a projectile from `from` would hit something (for the AI and the pop-up). */
export function shotDirs(s: GameState, p: PlayerId, from: Loc, steps = 9): [number, number][] {
  return ([[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]).filter(([dx, dy]) => !!projectileHit(s, p, from, dx, dy, steps));
}
/** Where a projectile lands (rulebook p34 "Projectiles"; Codex "Projectile"): it flies from `from` in a cardinal
 *  direction within the same region and stops at the first square holding a unit it can hit, ignoring the shooter,
 *  allies at its starting square, and Stealthed minions (p34 "Stealth"). Returns every unit it could hit there:
 *  when there are several, the shooter chooses. */
export function projectileCandidates(s: GameState, p: PlayerId, from: Loc, dx: number, dy: number, steps: number, self?: string): Unit[] {
  const [x, y] = xy(from.c); const region = regionOf(s, from);
  for (let i = 0; i <= steps; i++) {
    const c = cell(x + dx * i, y + dy * i); if (c < 0) return [];
    const there = Object.values(s.units).filter((e) => e.c === c && regionOf(s, e) === region && e.id !== self && !(i === 0 && e.owner === p) && !hasStealth(s, e));
    if (there.length) return there.sort((a, b) => Number(a.owner === p) - Number(b.owner === p)); // enemies listed first
  }
  return [];
}
function projectileHit(s: GameState, p: PlayerId, from: Loc, dx: number, dy: number, steps: number, self?: string, pick?: string): Unit | null {
  const there = projectileCandidates(s, p, from, dx, dy, steps, self);
  return there.find((u) => u.id === pick) ?? there[0] ?? null;
}
/** Indices of a card's effects that happen on `on` (and, for activated abilities, come from the same line as effect `fx`). */
export function effectsOn(d: CardDef, on: Trigger, fx?: number): number[] {
  const line = fx === undefined ? undefined : d.effects[fx]?.line;
  return d.effects.map((e, i) => [e, i] as const).filter(([e, i]) => e.on === on && !e.afterSite && (fx === undefined || (line === undefined ? i === fx : e.line === line))).map(([, i]) => i);
}
/** Units effect `i` of card `d` may target, measured from `origins` (spellcasters for magic, the source otherwise). */
export function targetsFor(s: GameState, p: PlayerId, d: CardDef, i: number, origins: Loc[], self?: string): string[] {
  const e = d.effects[i];
  if (!e || e.who !== 'target' || e.ref) return [];
  const targeted = e.targets !== false;
  return Object.values(s.units).filter((u) => {
    if (targeted && u.owner !== p && hasStealth(s, u)) return false; // Codex "Stealth": cannot be targeted by the opponent
    if (targeted && d.type === 'Magic' && has(s, u, "Can't be targeted by magic")) return false;
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
    if (!fits(s, e, u, self, Math.floor((d.attack + d.defense) / 2))) return false;
    return origins.some((o) => inRange(s, o, u, e.range, targeted));
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
    if (e.optional && c?.skip) continue;
    if (e.who === 'target' && !e.ref) {
      const ok = targetsFor(s, p, d, i, origins, self);
      if (!ok.length) return no(`${d.name} has no valid target in range. A spell that says "target" needs a legal target when it is cast, in range and in the same region as the caster.`, 'Target');
      if (!c?.target || !ok.includes(c.target)) return no('Choose a valid target: in range and in the same region as a spellcaster you control (or the card using the ability), and not a stealthed or otherwise protected enemy.', 'Target');
    }
    if (e.x && c?.n !== undefined && (!Number.isInteger(c.n) || c.n < 0 || c.n > 99)) return no('Choose a number from 0 up.');
    if (e.who === 'atTarget' && !e.refCell) { const ok = cellsFor(s, d, i, origins); if (!ok.length) return no(`${d.name} has no location in range.`); if (c?.cell === undefined || !ok.includes(c.cell)) return no('Choose a location in range.'); }
    if (e.op === 'shoot' && (!c?.dir || Math.abs(c.dir[0]) + Math.abs(c.dir[1]) !== 1)) return no('Choose a direction to shoot.');
    if (e.op === 'shoot' && c?.hit && origins[0] && !projectileCandidates(s, p, origins[0], c.dir![0], c.dir![1], 9, self).some((u) => u.id === c.hit)) return no('The projectile stops at the first square with a unit it can hit; that unit is not there.', 'Projectile');
    if (e.op === 'moveSite' && !c?.skip && (c?.cell === undefined || !origins[0] || !siteMoveCells(s, origins[0].c).includes(c.cell))) return no('Choose a nearby void for the site to move to.', 'Site');
    if (e.op === 'moveAura' && (c?.cell === undefined || !origins[0] || !auraSteps(origins[0].c).includes(c.cell))) return no('Choose a neighbouring joint for the aura, or skip the move.', 'Aura');
    if (e.op === 'teleport' && chosenDest(e) && (e.who === 'target' || e.who === 'self')) { const u = c?.target ? s.units[c.target] : self ? s.units[self] : undefined; if (c?.cell === undefined || !teleportCells(s, e, u, origins[0]).includes(c.cell)) return no('Choose where it goes.'); }
  }
  return { ok: true };
}

/** Everything in the realm a player controls that can carry abilities. */
export function sourcesOf(s: GameState, p: PlayerId): { src: Source; inst: string; loc: Loc; unit?: Unit }[] {
  const out: { src: Source; inst: string; loc: Loc; unit?: Unit }[] = [];
  for (const u of Object.values(s.units)) if (u.owner === p) out.push({ src: { unit: u.id }, inst: u.inst, loc: { c: u.c, r: u.r }, unit: u });
  for (const m of s.perms) if (m.owner === p) { const b = m.carrier ? s.units[m.carrier] : undefined; out.push({ src: { perm: m.id }, inst: m.inst, loc: b ? { c: b.c, r: b.r } : { c: m.c, r: 'surface', ...(m.kind === 'aura' ? { aura: true } : {}) } }); }
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
const TRIG_NAME: Partial<Record<Trigger, string>> = { deathrite: 'Deathrite', genesis: 'Genesis', startTurn: 'start of turn', endTurn: 'end of turn', dies: 'reaction', damaged: 'reaction', attacks: 'reaction', enters: 'reaction', kills: 'reaction', casts: 'reaction' };
function fire(s: GameState, inst: string, on: Trigger, p: PlayerId, loc: Loc | null, src?: Source, subject?: string, only?: number[]) {
  const d = cardOf(s, inst); const idx = only ?? effectsOn(d, on);
  if (!idx.length || s.phase === 'over') return;
  if (idx.some((i) => needsChoice(d.effects[i]) || d.effects[i].op === 'manual' || d.effects[i].optional)) {
    (s.queue ??= []).push({ id: `q${s.nextId++}`, by: p, inst, fx: idx, loc, ...(src ? { src } : {}), ...(subject ? { subject } : {}) });
    log(s, `${d.name}: ${TRIG_NAME[on] ?? on} ability waits for ${pname(p)}.`, p);
    return;
  }
  resolve(s, d, idx, p, loc, [], src, subject);
}
/** Reactions ("Whenever …") of every card in the realm to something that happened to unit `u`. */
let reacting = 0;
/** `u` is the unit the event is about (for kills and casts: the one who killed or cast); `subject` is what "it" means in the text (the killed unit; default u). */
function react(s: GameState, on: 'dies' | 'damaged' | 'attacks' | 'enters' | 'kills' | 'casts', u: Unit, subject?: Unit, spell?: CardDef) {
  if (reacting > 6 || s.phase === 'over') return; // a chain of reactions stops eventually
  reacting++;
  try {
    // Rulebook p31 "Triggered Abilities": competing events go on the storyline non-active player first.
    for (const p of [other(s.active), s.active] as PlayerId[]) for (const x of sourcesOf(s, p)) {
      if (on === 'dies' && x.unit?.id === u.id) continue;
      const d = cardOf(s, x.inst);
      const idx = d.effects.map((e, i) => [e, i] as const).filter(([e]) => e.on === on && e.ev && evMatches(s, e.ev, p, x.loc, x.unit?.id, x.src, u) && (!e.ev.magic || spell?.type === 'Magic')).map(([, i]) => i);
      if (x.unit && isDisabled(s, x.unit)) continue;
      if (idx.length) fire(s, x.inst, on, p, x.loc, x.src, (subject ?? u).id, idx);
    }
  } finally { reacting--; }
}
function evMatches(s: GameState, f: NonNullable<Effect['ev']>, p: PlayerId, at: Loc, self: string | undefined, src: Source, u: Unit): boolean {
  if (f.self) return u.id === self || ('perm' in src && s.perms.find((m) => m.id === src.perm)?.carrier === u.id);
  if (f.other && u.id === self) return false;
  if (f.notKw && has(s, u, f.notKw)) return false;
  if (f.avatar && !u.avatar) return false;
  if (f.side === 'enemy' && u.owner === p) return false;
  if (f.side === 'ally' && u.owner !== p) return false;
  if (f.minion && u.avatar) return false;
  if (f.sub?.length && !f.sub.some((x) => unitCard(s, u).subtypes.some((y) => y.toLowerCase() === x.toLowerCase()))) return false;
  if (f.range === 'here' && u.c !== at.c) return false;
  if (f.range === 'nearby' && !(sameRegion(s, u, at) && nearby(at.c).includes(u.c))) return false;
  return true;
}
function fireAll(s: GameState, p: PlayerId, on: 'startTurn' | 'endTurn') {
  for (const x of sourcesOf(s, p)) { const d = cardOf(s, x.inst); const idx = effectsOn(d, on).filter((i) => !d.effects[i].eachTurn); if (idx.length) fire(s, x.inst, on, p, x.loc, x.src, undefined, idx); }
  // "At the end of each turn" / "At the start of each player's turn": cards of both players
  for (const q of [p, other(p)] as PlayerId[]) for (const x of sourcesOf(s, q)) { const d = cardOf(s, x.inst); const idx = effectsOn(d, on).filter((i) => d.effects[i].eachTurn); if (idx.length) fire(s, x.inst, on, q, x.loc, x.src, undefined, idx); }
}
/** A site that keeps some units out ("Units with 3 or more power can't enter this site"). */
function entryBlocked(s: GameState, u: Unit, c: number, ground = true): boolean {
  const st = s.sites[c]; if (!st?.inst) return false;
  // a site's own rule, or one from a minion standing on it ("Allies can't enter this site")
  const holders = [cardOf(s, st.inst), ...Object.values(s.units).filter((x) => x.c === c && x.id !== u.id).map((x) => unitCard(s, x))];
  return holders.some((hd) => hd.effects.some((e) => e.on === 'static' && e.noEnter && (!e.noEnter.ground || (ground && !has(s, u, 'Airborne'))) && (!e.noEnter.occupied || Object.values(s.units).some((x) => x.id !== u.id && !x.avatar && x.c === c && x.r === 'surface')) && (e.noEnter.minPower === undefined || powerValue(s, u) >= e.noEnter.minPower)
    && (!e.noEnter.side || (e.noEnter.side === 'ally' ? u.owner === st.owner : u.owner !== st.owner))));
}

/** Carry out effects `idx` of card `d` for player `p`. `loc` is where the ability happens; `src` what it came from. */
function lastSiteEl(s: GameState, p: PlayerId): Element | null {
  const ids = s.players[p].cast?.ids ?? []; const last = [...ids].reverse().find((x) => x.startsWith('site:'));
  if (!last) return null; const d = s.cards[last.slice(5)]; return d ? (ELEMENTS.find((e) => d.thresholds[e] > 0) ?? null) : null;
}
function resolve(s: GameState, d: CardDef, idx: number[], p: PlayerId, loc0: Loc | null, ch: (Choice | null)[], src?: Source, subject?: string) {
  const self = selfUnit(s, src), bearer = bearerOf(s, src);
  let loc = loc0;
  const shielded = new Set<string>(); // targets a Ward protected: the rest of the effect on them does not resolve
  for (const i of idx) {
    const e = d.effects[i]; const c = ch[i] ?? undefined;
    if (s.phase === 'over') return;
    if (e.optional && c?.skip) { log(s, `${pname(p)} chooses not to: ${e.text ?? ''}`, p); continue; }
    if (e.pay) { if (s.players[p].mana < e.pay) { log(s, `${pname(p)} cannot pay ${e.pay} mana for ${d.name}.`, p); continue; } s.players[p].mana -= e.pay; log(s, `${pname(p)} pays ${e.pay} mana (${d.name}).`, p); }
    if (e.cond === 'onlyCopy' && sitesOf(s, p).filter((x) => s.sites[x]!.inst && cardOf(s, s.sites[x]!.inst!).name === d.name).length !== 1) continue;
    if (e.refCell) { const prev = idx.slice(0, idx.indexOf(i)).reverse().find((k) => ch[k]?.cell !== undefined); ch = ch.slice(); ch[i] = { ...(ch[i] ?? {}), cell: prev !== undefined ? ch[prev]!.cell : undefined }; }
    const c2 = ch[i] ?? undefined;
    if (e.when && !condHolds(s, e.when, p, loc, self ?? bearer)) { if (e.on !== 'static') log(s, `${d.name}: the condition is not met (${e.text ?? ''}).`, p); continue; }
    if (e.afterSite && !(s.players[p].cast?.turn === s.turn && lastSiteEl(s, p) === e.afterSite)) continue;
    const n = e.amount === 'airCastThisTurn' ? (s.players[p].cast?.turn === s.turn ? s.players[p].cast!.ids.reduce((t, id) => t + (s.cards[id]?.thresholds.air ?? 0), 0) : 0)
      : e.amount === 'banishedElement' ? s.players[p].banished ?? 0
      : e.x ? Math.max(0, c?.n ?? 0) : e.n ?? 1;
    const all = Object.values(s.units);
    const auraSrc = !!src && 'perm' in src && s.perms.find((m) => m.id === src.perm)?.kind === 'aura';
    // Rulebook p33 "Here & There": when a site is referenced, here means both its surface and subsurface.
    const here = (u: Unit) => !!loc && (auraSrc ? u.r === 'surface' && auraArea(loc.c).includes(u.c) : u.c === loc.c && (u.r === loc.r || (!!src && 'site' in src)));
    const near = (u: Unit) => !!loc && sameRegion(s, u, loc) && nearby(loc.c).includes(u.c);
    let victims: Unit[] = [];
    switch (e.who) {
      case 'target': {
        if (e.ref) { const prev = idx.slice(0, idx.indexOf(i)).reverse().find((k) => d.effects[k].who === 'target' && !d.effects[k].ref); const pt = prev !== undefined ? ch[prev]?.target : subject; const t = pt ? s.units[pt] : undefined; if (t && !shielded.has(t.id)) victims = [t]; break; }
        const t = c?.target ? s.units[c.target] : undefined;
        if (t && shielded.has(t.id)) break;
        if (t && e.targets !== false && t.owner !== p && warded(s, t)) { breakWard(s, t, `${d.name} targeted it`); shielded.add(t.id); break; }
        if (t) victims = [t]; break;
      }
      case 'enemyAvatar': victims = [s.units[s.players[other(p)].avatar]]; break;
      case 'ownAvatar': victims = [s.units[s.players[p].avatar]]; break;
      case 'allAvatars': victims = [s.units[s.players[p].avatar], s.units[s.players[other(p)].avatar]]; break;
      case 'nearbyAvatars': victims = all.filter((u) => u.avatar && loc && nearby(loc.c).includes(u.c)); break;
      case 'self': victims = self && s.units[self] ? [s.units[self]] : []; break;
      case 'bearer': victims = bearer && s.units[bearer] ? [s.units[bearer]] : []; break;
      case 'enemiesHere': victims = all.filter((u) => here(u) && u.owner !== p); break;
      case 'alliesHere': victims = all.filter((u) => here(u) && u.owner === p); break;
      case 'unitsHere': case 'minionsHere': victims = all.filter(here); break;
      case 'affected': victims = loc ? all.filter((u) => u.r === 'surface' && auraArea(loc!.c).includes(u.c)) : []; break;
      case 'enemiesNearby': victims = all.filter((u) => near(u) && u.owner !== p); break;
      case 'alliesNearby': victims = all.filter((u) => near(u) && u.owner === p); break;
      case 'unitsNearby': victims = all.filter(near); break;
      case 'allMinions': victims = all.filter((u) => !u.avatar); break;
      case 'enemyMinions': victims = all.filter((u) => !u.avatar && u.owner !== p); break;
      case 'allyMinions': victims = all.filter((u) => !u.avatar && u.owner === p); break;
      case 'allyUnits': victims = all.filter((u) => u.owner === p); break;
      case 'enemyUnits': victims = all.filter((u) => u.owner !== p); break;
      case 'atTarget': victims = c2?.cell === undefined ? [] : all.filter((u) => u.c === c2.cell && (u.r === 'surface' || !loc || u.r === loc.r)); break;
    }
    if (e.who !== 'target') {
      if (e.only === 'minion' || e.who === 'minionsHere') victims = victims.filter((u) => !u.avatar);
      if (e.only === 'enemy' || e.only === 'enemyMinion') victims = victims.filter((u) => u.owner !== p);
      if (e.only === 'ally' || e.only === 'allyMinion') victims = victims.filter((u) => u.owner === p);
      if (e.other) victims = victims.filter((u) => u.id !== self);
      victims = victims.filter((u) => fits(s, e, u) && !(e.notKw && has(s, u, e.notKw)));
      if (e.random && victims.length > e.random) { const pick: Unit[] = []; const pool = victims.slice(); while (pick.length < e.random && pool.length) pick.push(pool.splice(Math.floor(rand(s) * pool.length), 1)[0]); victims = pick; }
    }
    const players: PlayerId[] = e.who === 'opponent' ? [other(p)] : e.who === 'controller' ? [p] : e.who === 'allAvatars' ? [p, other(p)] : [];
    const nm = (u: Unit) => unitCard(s, u).name;
    switch (e.op) {
      case 'damage':
        if (e.who === 'siteHere') { const st = loc ? s.sites[loc.c] : null; if (st?.owner != null) { if (st.ward) { st.ward = false; log(s, `The site's Ward breaks and prevents ${d.name}'s damage.`, p); } else { log(s, `${d.name} deals ${n} damage to the site.`, p); loseLife(s, st.owner, n); } } break; }
        for (const v of victims) { if (!s.units[v.id] && !v.avatar) continue; log(s, `${d.name} deals ${n} damage to ${nm(v)}.`, p); damageUnit(s, v, n, false, { card: d, ...(self && s.units[self] ? { unit: s.units[self] } : {}) }); } break;
      case 'strike': {
        const me = self ? s.units[self] : bearer ? s.units[bearer] : s.units[s.players[p].avatar]; if (!me) break; // magic: the caster strikes
        for (const v of victims) { if (!s.units[v.id] && !v.avatar) continue; log(s, `${nm(me)} strikes ${nm(v)} for ${power(s, me)}.`, p); me.stealthLost = true; damageUnit(s, v, power(s, me), has(s, me, 'Lethal') && !v.avatar, { unit: me }); }
        break;
      }
      case 'shoot': {
        if (!loc || !c?.dir) break;
        if (e.pierce) { // a piercing projectile hits every unit along its path
          const [x0, y0] = xy(loc.c); const hits: Unit[] = [];
          for (let k = 0; k < 9; k++) { const cc = cell(x0 + c.dir[0] * k, y0 + c.dir[1] * k); if (cc < 0) break; hits.push(...Object.values(s.units).filter((u) => u.c === cc && sameRegion(s, u, loc!) && u.id !== self && !(k === 0 && u.owner === p) && !hasStealth(s, u))); }
          if (!hits.length) log(s, `${d.name}'s projectile hits nothing.`, p);
          for (const h of hits) { log(s, `${d.name}'s projectile hits ${nm(h)} for ${n}.`, p); damageUnit(s, h, n, false, { card: d, ...(self && s.units[self] ? { unit: s.units[self] } : {}) }); }
          break;
        }
        const shots = e.shots === -1 ? Math.max(1, c?.n ?? 1) : e.shots ?? 1;
        for (let k = 0; k < shots && (s.phase as string) !== 'over'; k++) {
          const hit = projectileHit(s, p, loc, c.dir[0], c.dir[1], 9, self, k === 0 ? c.hit : undefined);
          if (!hit) { log(s, `${d.name}'s projectile hits nothing.`, p); break; }
          const at: Loc = { c: hit.c, r: hit.r };
          log(s, `${d.name}'s projectile hits ${nm(hit)} for ${n}.`, p); damageUnit(s, hit, n, false, { card: d, ...(self && s.units[self] ? { unit: s.units[self] } : {}) });
          if (e.splash) for (const o of unitsAt(s, at)) if (o.id !== hit.id) { log(s, `${d.name} deals ${e.splash} damage to ${nm(o)}.`, p); damageUnit(s, o, e.splash, false, { card: d }); }
        }
        break;
      }
      case 'provide': {
        if (e.n) { s.players[p].mana += e.n; log(s, `${pname(p)} gains ${e.n} mana (${d.name}).`, p); }
        if (e.el) {
          const pl = s.players[p]; if (!pl.extra || pl.extra.turn !== s.turn) pl.extra = { turn: s.turn, th: {} };
          for (const k of ELEMENTS) if (e.el[k]) pl.extra.th[k] = (pl.extra.th[k] ?? 0) + e.el[k]!;
          log(s, `${d.name} provides ${ELEMENTS.filter((k) => e.el![k]).map((k) => `${e.el![k]} ${k}`).join(', ')} threshold this turn.`, p);
        }
        break;
      }
      case 'summon': {
        const tok = Object.values(s.cards).find((x) => x.name.toLowerCase() === (e.token ?? '').toLowerCase());
        if (e.who === 'atTarget' && c2?.cell !== undefined) loc = { c: c2.cell, r: 'surface' };
        if (e.places) {
          const av = s.units[s.players[p].avatar];
          const at = loc ? loc.c : av.c;
          const cells = e.places === 'adjacentSites' ? orthAdjacent(at).filter((c) => s.sites[c]?.inst) : e.places === 'adjacentLocations' ? orthAdjacent(at).filter((c) => !!s.sites[c])
            : e.places === 'nearAvatar' ? nearby(av.c).filter((c) => s.sites[c]?.inst)
            : e.places === 'bordersEnemy' ? sitesOf(s, p).filter((c) => orthAdjacent(c).some((n) => s.sites[n]?.owner === other(p)))
            : e.places === 'allyMinion' ? (c2?.target && s.units[c2.target] ? [s.units[c2.target].c] : [])
            : (c2?.cell !== undefined ? [c2.cell] : []);
          const tok0 = Object.values(s.cards).find((x) => x.name.toLowerCase() === (e.token ?? '').toLowerCase());
          if (!tok0) { log(s, `${d.name}: the ${e.token} token is not in the card pool; summon it by hand.`, p); break; }
          for (const c of cells) for (let k = 0; k < n; k++) { const inst = `${p}tok${s.nextId}`; s.inst[inst] = tok0.id; const id = `u${s.nextId++}`; s.units[id] = { id, inst, owner: p, c, r: 'surface', tapped: false, damage: 0, enteredTurn: s.turn, avatar: false, stealthLost: false, lance: false }; }
          log(s, `${d.name} summons ${cells.length * n} ${tok0.name} token(s).`, p);
          break;
        }
        if (!tok || !loc) { log(s, `${d.name}: the ${e.token} token is not in the card pool; summon it by hand.`, p); break; }
        for (let k = 0; k < n; k++) {
          const inst = `${p}tok${s.nextId}`; s.inst[inst] = tok.id; const id = `u${s.nextId++}`;
          s.units[id] = { id, inst, owner: p, c: loc.c, r: s.sites[loc.c] ? 'surface' : loc.r, tapped: false, damage: 0, enteredTurn: s.turn, avatar: false, stealthLost: false, lance: tok.keywords.includes('Lance'), ...(tok.keywords.includes('Ward') ? { ward: true } : {}) };
        }
        log(s, `${d.name} summons ${n > 1 ? `${n} ${tok.name} tokens` : `a ${tok.name} token`}.`, p);
        break;
      }
      case 'destroy': for (const v of victims) if (!v.avatar && s.units[v.id]) { log(s, `${d.name} destroys ${nm(v)}.`, p); killUnit(s, v); } break;
      case 'banish': for (const v of victims) if (!v.avatar && s.units[v.id] && !has(s, v, "Can't be banished")) removeUnit(s, v, 'banish', d.name); break;
      case 'bounce': for (const v of victims) if (!v.avatar && s.units[v.id]) removeUnit(s, v, 'hand', d.name); break;
      case 'heal':
        if (e.who === 'siteController') { const sc = loc ? s.sites[loc.c]?.owner : undefined; if (sc != null) gainLife(s, sc, n); }
        else if (e.who === 'controller' || e.who === 'opponent') for (const q of players) gainLife(s, q, n);
        else for (const v of victims) {
          const k = e.amount === 'victimBody' ? bodyOfKind(s, v.c, 'water').length : n; if (!k) continue;
          if (v.avatar) gainLife(s, v.owner, k); else { v.damage = Math.max(0, v.damage - k); log(s, `${nm(v)} heals ${k}.`, p); }
        }
        break;
      case 'loseLife': {
        const sc = e.who === 'siteController' && loc ? s.sites[loc.c]?.owner : undefined;
        for (const q of e.who === 'siteController' ? (sc != null ? [sc] : []) : players.length ? players : victims.filter((v) => v.avatar).map((v) => v.owner)) loseLife(s, q, n);
        break;
      }
      case 'mana': s.players[p].mana += n; log(s, `${pname(p)} gains ${n} mana (${d.name}).`, p); break;
      case 'draw': {
        const deck = e.deck ?? c?.deck ?? 'spellbook';
        const who = e.who === 'opponent' ? other(p) : p;
        if (e.fromBottom) { const pl = s.players[who]; const b = pl[deck].pop(); if (b) { pl.hand.push(b); log(s, `${pname(who)} draws the bottom card of the ${deck} (${d.name}).`, p); } break; }
        for (let k = 0; k < n; k++) if (!drawCard(s, who, deck)) { log(s, `${pname(who)} must draw from an empty deck and loses.`, who); win(s, other(who)); break; }
        if ((s.phase as string) !== 'over') log(s, `${pname(who)} draws ${n} from the ${deck} (${d.name}).`, p);
        break;
      }
      case 'scry': {
        const pl = s.players[p]; const deck = e.deck ?? 'spellbook';
        if (!pl[deck].length) break;
        if (c?.bottom) { pl[deck].push(pl[deck].shift()!); log(s, `${pname(p)} looks at the top of the ${deck} and puts it on the bottom.`, p); }
        else log(s, `${pname(p)} looks at the top of the ${deck} and leaves it there.`, p);
        break;
      }
      case 'sink': for (const v of victims) {
        const st = s.sites[v.c]; if (!st?.inst || v.r === 'under') continue;
        const water = isWater(s, v.c);
        if (e.under && (e.under === 'water') !== water) continue;
        v.r = 'under'; log(s, `${nm(v)} is ${water ? 'submerged' : 'burrowed'} (${d.name}).`, p);
      } break;
      case 'moveSite': {
        const from = loc?.c; if (from === undefined || c?.cell === undefined || !siteMoveCells(s, from).includes(c.cell)) break;
        moveSite(s, from, c.cell); log(s, `${d.name} flies to ${'ABCDE'[xy(c.cell)[0]]}${4 - xy(c.cell)[1]}, with everything on it.`, p);
        break;
      }
      case 'moveAura': {
        const m = src && 'perm' in src ? s.perms.find((x) => x.id === src.perm) : undefined;
        if (m && m.kind === 'aura' && c?.cell !== undefined && auraSteps(m.c).includes(c.cell)) { m.c = c.cell; log(s, `${pname(p)} moves ${d.name} one step.`, p); }
        break;
      }
      case 'teleport': {
        // Codex "Forced Movement" / "Teleport": the unit is put at the destination; a step needs it to be able to step
        const mover = e.dest === 'to' ? (self ? s.units[self] : undefined) : undefined;
        const list = e.dest === 'to' ? (mover ? [mover] : []) : victims;
        for (const v of list) {
          if (!s.units[v.id]) continue;
          let to: number | undefined;
          if (e.dest === 'here') to = loc?.c;
          else if (e.dest === 'caster') to = s.units[s.players[p].avatar]?.c;
          else if (e.dest === 'to') { const t = c2?.target ? s.units[c2.target] : undefined; to = t?.c; }
          else if (e.dest === 'random') { const opts = [...Array(CELLS).keys()].filter((x) => x !== v.c); to = opts[Math.floor(rand(s) * opts.length)]; }
          else if (e.dest === 'toward' || e.dest === 'away') { const opts = teleportCells(s, e, v, loc); to = c2?.cell !== undefined && opts.includes(c2.cell) ? c2.cell : opts[0]; }
          else to = c2?.cell;
          if (to === undefined || to === v.c) continue;
          if (e.move !== 'step' && has(s, v, "Can't be moved by force")) { log(s, `${nm(v)} can't be moved by force.`, p); continue; }
          if (e.move === 'step' && !teleportCells(s, { ...e, dest: e.dest === 'toward' || e.dest === 'away' ? e.dest : 'adjacent' }, v, loc).includes(to) && e.dest !== 'here') { log(s, `${nm(v)} cannot take that step.`, p); continue; }
          v.c = to; v.r = 'surface';
          if (v.id === self) loc = { c: to, r: 'surface' }; // what follows on the line happens where it arrived
          log(s, `${nm(v)} ${e.move === 'step' ? 'takes a step' : e.move === 'drag' ? 'is dragged' : 'teleports'} (${d.name}).`, p);
          if (!s.sites[v.c] && !v.avatar && !has(s, v, 'Voidwalk')) removeUnit(s, v, 'banish', 'the void');
          else if (!s.sites[v.c] && v.avatar) { /* Codex "Mandatory Actions": an Avatar in the void must play a site under it */ }
          react(s, 'enters', v);
        }
        break;
      }
      case 'choose': break;
      case 'control': for (const v of victims) {
        if (v.avatar || v.owner === p) continue;
        v.ctrl = { was: v.owner, ...(e.until === 'turn' ? { turn: s.turn } : {}) }; v.owner = p;
        log(s, `${pname(p)} gains control of ${nm(v)}${e.until === 'turn' ? ' this turn' : ''} (${d.name}).`, p);
      } break;
      case 'pick': resolvePick(s, d, e, p, loc, c2, src); break;
      case 'unward': {
        for (const v of victims) if (v.ward) { v.ward = false; log(s, `${nm(v)}'s Ward breaks (${d.name}).`, p); }
        if (loc && (e.who === 'unitsNearby' || e.who === 'enemiesNearby' || e.who === 'alliesNearby')) for (const c0 of nearby(loc.c)) { const st = s.sites[c0]; if (st?.ward) { st.ward = false; log(s, `A site's Ward breaks (${d.name}).`, p); } }
        break;
      }
      case 'raise': {
        const dead = ([0, 1] as PlayerId[]).flatMap((q) => s.players[q].cemetery.map((inst) => ({ q, inst }))).filter((x) => cardOf(s, x.inst).type === 'Minion');
        if (!dead.length || c2?.cell === undefined) { log(s, `${d.name}: there is no dead minion.`, p); break; }
        const pick = dead[Math.floor(rand(s) * dead.length)]; const cem = s.players[pick.q].cemetery; cem.splice(cem.indexOf(pick.inst), 1);
        const id = `u${s.nextId++}`; const dc = cardOf(s, pick.inst);
        s.units[id] = { id, inst: pick.inst, owner: p, c: c2.cell, r: 'surface', tapped: false, damage: 0, enteredTurn: s.turn, avatar: false, stealthLost: false, lance: dc.keywords.includes('Lance'), ...(dc.keywords.includes('Ward') ? { ward: true } : {}) };
        log(s, `${d.name} summons ${dc.name} from the cemetery.`, p);
        break;
      }
      case 'noUntap': for (const v of victims) { v.noUntap = true; } if (victims.length) log(s, `${victims.map(nm).join(', ')} will not untap next time (${d.name}).`, p); break;
      case 'flood': if (c2?.cell !== undefined && s.sites[c2.cell]?.inst) { s.players[p].flooded = c2.cell; log(s, `${d.name} floods ${cardOf(s, s.sites[c2.cell]!.inst!).name}: it is a water site until ${pname(p)} floods another.`, p); } break;
      case 'rubble': if (c2?.cell !== undefined && !s.sites[c2.cell]) { s.sites[c2.cell] = { inst: null, owner: null }; log(s, `${d.name} fills the void with Rubble.`, p); } break;
      case 'replaceRubble': {
        const st = c2?.cell !== undefined ? s.sites[c2.cell] : null; const top = s.players[p].atlas[0];
        if (!st || st.inst || !top) break;
        s.players[p].atlas.shift(); s.sites[c2!.cell!] = { inst: top, owner: p }; log(s, `${d.name} replaces the Rubble with ${cardOf(s, top).name}.`, p);
        break;
      }
      case 'destroySite': {
        const st = c?.cell !== undefined ? s.sites[c.cell] : null;
        if (!st?.inst) break;
        if (st.ward) { st.ward = false; log(s, `The site's Ward breaks instead (${d.name}).`, p); break; }
        s.players[Number(st.inst[0]) as PlayerId].cemetery.push(st.inst); log(s, `${d.name} destroys ${cardOf(s, st.inst).name}; it leaves Rubble.`, p);
        s.sites[c!.cell!] = { inst: null, owner: null };
        break;
      }
      case 'mill': { const pl = s.players[p]; const deck = e.deck ?? 'spellbook'; const top = pl[deck].splice(0, n); pl.cemetery.push(...top); log(s, `${pname(p)} discards the top ${top.length} of the ${deck}: ${top.map((x) => cardOf(s, x).name).join(', ') || 'nothing'}.`, p); break; }
      case 'discard':
        if (!e.random && e.who === 'controller') { const h = s.players[p].hand; const pickI = c?.card && h.includes(c.card) ? c.card : h.find((x) => (e.deck === 'atlas' ? cardOf(s, x).type === 'Site' : e.deck === 'spellbook' ? cardOf(s, x).type !== 'Site' : true)); if (pickI) { h.splice(h.indexOf(pickI), 1); s.players[p].cemetery.push(pickI); log(s, `${pname(p)} discards ${cardOf(s, pickI).name} (${d.name}).`, p); } break; }
        for (const q of players.length ? players : victims.filter((v) => v.avatar).map((v) => v.owner)) for (let k = 0; k < n; k++) {
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
        if (e.who === 'siteHere' && e.keyword === 'Ward') { const st = loc ? s.sites[loc.c] : null; if (st?.inst) { st.ward = true; log(s, `${d.name} wards the site.`, p); } break; }
        if (e.keyword === 'Ward') { for (const v of victims) { if (isEvil(s, v)) { log(s, `${nm(v)} is Evil and can't be warded (${d.name}).`, p); continue; } v.ward = true; log(s, `${nm(v)} gains a Ward (${d.name}).`, p); } break; }
        if (e.keyword === 'Lance' && e.on !== 'static') { for (const v of victims) { v.lance = true; log(s, `${nm(v)} takes up a Lance (${d.name}).`, p); } break; }
        if (e.keyword === 'Disabled') for (const v of victims) v.stealthLost = true; // Codex "Stealth": a minion that becomes disabled loses its Stealth mark
        for (const v of victims) {
          if (e.keyword === 'Movement') { (v.mods ??= []).push({ atk: 0, def: 0, move: e.n ?? 1, ...(e.until === 'turn' ? { turn: s.turn } : e.until === 'next' ? { next: p } : {}), from: d.name }); log(s, `${nm(v)} gets Movement +${e.n ?? 1} (${d.name}).`, p); continue; }
          (v.mods ??= []).push({ atk: e.op === 'buff' ? e.atk ?? 0 : 0, def: e.op === 'buff' ? e.def ?? 0 : 0, ...(e.keyword ? { kw: e.keyword } : {}), ...(e.until === 'turn' ? { turn: s.turn } : e.until === 'next' ? { next: p } : e.until === 'hurt' ? { hurt: true } : {}), from: d.name });
          if (e.keyword === 'Stealth') v.stealthLost = false;
          log(s, `${nm(v)} ${e.op === 'buff' ? `gets ${(e.atk ?? 0) >= 0 ? '+' : ''}${e.atk ?? 0} power` : `gains ${e.keyword}`}${e.until === 'turn' ? ' this turn' : e.until === 'next' ? ' until your next turn' : ''} (${d.name}).`, p);
          if (!v.avatar && v.damage >= defenseOf(s, v)) killUnit(s, v);
        }
        break;
      case 'manual': s.log.push({ turn: s.turn, p, text: `${d.name}: “${e.text ?? ''}” — not automated; resolve by hand.`, manual: true }); break;
    }
  }
}
/** Codex "Sacrifice": the card is destroyed and nothing prevents it. A sacrificed site leaves Rubble. */
function sacrifice(s: GameState, src: Source) {
  if ('unit' in src) { const u = s.units[src.unit]; if (u && !u.avatar) { log(s, `${unitCard(s, u).name} is sacrificed.`, u.owner); killUnit(s, u, true); } return; }
  if ('perm' in src) { const i = s.perms.findIndex((m) => m.id === src.perm); if (i >= 0) { const [m] = s.perms.splice(i, 1); s.players[Number(m.inst[0]) as PlayerId].cemetery.push(m.inst); log(s, `${cardOf(s, m.inst).name} is sacrificed.`, m.owner); } return; }
  const st = s.sites[src.site]; if (!st?.inst) return;
  s.players[Number(st.inst[0]) as PlayerId].cemetery.push(st.inst); log(s, `${cardOf(s, st.inst).name} is sacrificed and leaves Rubble.`, st.owner);
  s.sites[src.site] = { inst: null, owner: null };
}
// ---------- choosing cards from a zone (search, look at, reveal, return, collection) ----------
export interface PickOption { key: string; inst?: string; cardId: string; zone: Zone; owner: PlayerId }
function matchesFilter(s: GameState, f: CardFilter | undefined, d: CardDef, self: CardDef, p: PlayerId, inst?: string): boolean {
  if (!f) return true;
  if (f.same && d.name !== self.name) return false;
  if (f.name && d.name.toLowerCase() !== f.name.toLowerCase()) return false;
  if (f.type && !f.type.includes(d.type)) return false;
  if (f.notType?.includes(d.type)) return false;
  if (f.minion && d.type !== 'Minion') return false;
  if (f.sub?.length && !f.sub.some((x) => d.subtypes.some((y) => y.toLowerCase() === x.toLowerCase()))) return false;
  if (f.maxCost !== undefined && d.cost > f.maxCost) return false;
  if (f.rarity?.length && !f.rarity.includes(d.rarity ?? '')) return false;
  if (f.kw && !d.keywords.includes(f.kw)) return false;
  if (f.diedThisTurn && !(inst && s.players[p].died?.turn === s.turn && s.players[p].died!.insts.includes(inst))) return false;
  return true;
}
/** What a pick effect may choose from right now. Hidden cards are only offered to their controller. */
export function pickOptions(s: GameState, p: PlayerId, d: CardDef, e: Effect): PickOption[] {
  const pk = e.pick; if (!pk) return [];
  const out: PickOption[] = []; const seen = new Set<string>();
  const add = (inst: string, zone: Zone, owner: PlayerId) => { const cd = cardOf(s, inst); if (matchesFilter(s, pk.filter, cd, d, owner, inst)) out.push({ key: inst, inst, cardId: cd.id, zone, owner }); };
  for (const z of pk.zones) {
    const me = s.players[p], opp = s.players[other(p)];
    if (z === 'spellbook' || z === 'atlas') { const deck = me[z]; const slice = pk.top ? (pk.fromBottom ? deck.slice(-pk.top) : deck.slice(0, pk.top)) : deck; slice.forEach((i) => add(i, z, p)); }
    else if (z === 'oppSpellbook') (pk.top ? opp.spellbook.slice(0, pk.top) : opp.spellbook).forEach((i) => add(i, z, other(p)));
    else if (z === 'hand') me.hand.forEach((i) => add(i, z, p));
    else if (z === 'oppHand') opp.hand.forEach((i) => add(i, z, other(p)));
    else if (z === 'cemetery') me.cemetery.forEach((i) => add(i, z, p));
    else if (z === 'anyCemetery') { me.cemetery.forEach((i) => add(i, 'cemetery', p)); opp.cemetery.forEach((i) => add(i, 'cemetery', other(p))); }
    else if (z === 'collection') {
      (me.collection ?? []).forEach((i) => { add(i, z, p); seen.add(cardOf(s, i).name); });
      // Codex "Collection", casual play: a card named by the effect can always be taken from your collection
      if (pk.filter?.name && !seen.has(pk.filter.name)) { const nd = Object.values(s.cards).find((x) => x.name.toLowerCase() === pk.filter!.name!.toLowerCase()); if (nd) out.push({ key: 'card:' + nd.id, cardId: nd.id, zone: z, owner: p }); }
    }
  }
  return out;
}
function takeFromZone(s: GameState, o: PickOption, p: PlayerId): string {
  if (!o.inst) { const inst = `${p}col${s.nextId++}`; s.inst[inst] = o.cardId; return inst; } // a named card fetched for the collection
  const pl = s.players[o.owner];
  for (const z of ['spellbook', 'atlas', 'hand', 'cemetery'] as const) { const i = pl[z].indexOf(o.inst); if (i >= 0) { pl[z].splice(i, 1); return o.inst; } }
  const ci = pl.collection?.indexOf(o.inst) ?? -1; if (ci >= 0) pl.collection!.splice(ci, 1);
  return o.inst;
}
function resolvePick(s: GameState, d: CardDef, e: Effect, p: PlayerId, loc: Loc | null, c: Choice | undefined, src?: Source) {
  const pk = e.pick!; const opts = pickOptions(s, p, d, e);
  let chosenKeys = (c?.cards ?? []).filter((k) => opts.some((o) => o.key === k));
  if (pk.take === 'all') chosenKeys = opts.map((o) => o.key);
  else chosenKeys = chosenKeys.slice(0, pk.take);
  const looked = pk.top ? (() => { const deck = s.players[p][pk.zones.includes('atlas') ? 'atlas' : 'spellbook']; return pk.fromBottom ? deck.slice(-pk.top) : deck.slice(0, pk.top); })() : [];
  const names = chosenKeys.map((k) => cardOf(s, opts.find((o) => o.key === k)!.inst ?? '') ?? s.cards[opts.find((o) => o.key === k)!.cardId]).map((x) => x?.name ?? '?');
  const where = pk.zones.join(' / ');
  if (!chosenKeys.length) log(s, `${pname(p)} ${pk.top ? `looks at ${pk.top} card(s)` : `searches ${where}`} for ${d.name} and takes nothing.`, p);
  let summonAt: Loc | null = loc;
  if ((pk.to === 'summon' || pk.to === 'cast') && pk.where === 'choose' && c?.cell !== undefined) summonAt = { c: c.cell, r: 'surface' };
  if ((pk.to === 'summon' || pk.to === 'cast') && pk.where === 'avatar') { const av = s.units[s.players[p].avatar]; summonAt = { c: av.c, r: av.r }; }
  for (const key of chosenKeys) {
    const o = opts.find((x) => x.key === key)!;
    const cd = s.cards[o.cardId];
    if (pk.to === 'cast') {
      const pl = s.players[p];
      if (pl.mana < cd.cost) { log(s, `${pname(p)} cannot pay ${cd.cost} mana to cast ${cd.name}.`, p); continue; }
      pl.mana -= cd.cost;
    }
    const inst = takeFromZone(s, o, p);
    switch (pk.to) {
      case 'hand': s.players[p].hand.push(inst); log(s, `${pname(p)} puts ${pk.reveal || o.zone === 'cemetery' ? cd.name : 'a card'} into their hand (${d.name}).`, p); break;
      case 'summon': case 'cast': {
        if (!summonAt || cd.type !== 'Minion') { s.players[Number(inst[0]) as PlayerId].cemetery.push(inst); break; }
        const id = `u${s.nextId++}`;
        s.units[id] = { id, inst, owner: p, c: summonAt.c, r: s.sites[summonAt.c] ? 'surface' : summonAt.r, tapped: false, damage: 0, enteredTurn: s.turn, avatar: false, stealthLost: false, lance: cd.keywords.includes('Lance'), ...(cd.keywords.includes('Ward') ? { ward: true } : {}) };
        log(s, `${pname(p)} ${pk.to === 'cast' ? 'casts' : 'summons'} ${cd.name} (${d.name}).`, p);
        resolve(s, cd, effectsOn(cd, 'genesis').filter((k) => !needsChoice(cd.effects[k])), p, summonAt, [], { unit: id });
        break;
      }
      case 'bottom': s.players[o.owner][o.zone === 'atlas' ? 'atlas' : 'spellbook'].push(inst); log(s, `${pname(p)} puts a card on the bottom (${d.name}).`, p); break;
      case 'top': s.players[o.owner][o.zone === 'atlas' ? 'atlas' : 'spellbook'].unshift(inst); log(s, `${pname(p)} puts a card on top (${d.name}).`, p); break;
      case 'banish': log(s, `${cd.name} is banished (${d.name}).`, p); break;
      case 'discard': s.players[o.owner].cemetery.push(inst); log(s, `${cd.name} goes to the cemetery (${d.name}).`, p); break;
      case 'none': s.players[o.owner][o.zone === 'oppHand' ? 'hand' : o.zone === 'atlas' ? 'atlas' : 'spellbook'].push(inst); break;
    }
  }
  if (pk.top && pk.rest && pk.rest !== 'stay') {
    const deckName = pk.zones.includes('atlas') ? 'atlas' : 'spellbook'; const deck = s.players[p][deckName];
    const rest = looked.filter((i) => deck.includes(i));
    for (const i of rest) deck.splice(deck.indexOf(i), 1);
    if (pk.rest === 'bottom') deck.push(...rest);
    else if (pk.rest === 'top') deck.unshift(...rest);
    else if (pk.rest === 'shuffle') { deck.push(...rest); shuffle(s, deck); }
    else if (pk.rest === 'banish') { /* banished */ }
    else s.players[p].cemetery.push(...rest);
    if (rest.length) log(s, `The other ${rest.length} go${rest.length === 1 ? 'es' : ''} ${pk.rest === 'bottom' ? 'to the bottom' : pk.rest === 'top' ? 'back on top' : pk.rest === 'shuffle' ? 'back and the deck is shuffled' : pk.rest === 'banish' ? 'into banishment' : 'to the cemetery'}.`, p);
  }
  // the player's order for the looked-at cards that stayed in the deck (first = nearest the top)
  if (pk.top && c?.order?.length && !pk.shuffle && pk.rest !== 'shuffle') {
    const deck = s.players[p][pk.zones.includes('atlas') ? 'atlas' : 'spellbook'];
    const back = looked.filter((i) => deck.includes(i));
    const want = c.order.filter((i) => back.includes(i));
    if (back.length > 1 && want.length === back.length && new Set(want).size === want.length) {
      const pos = back.map((i) => deck.indexOf(i)).sort((x, y) => x - y);
      pos.forEach((ix, k) => { deck[ix] = want[k]; });
      log(s, `${pname(p)} puts ${back.length} cards back in an order of their choosing (${d.name}).`, p);
    }
  }
  if (pk.shuffle) { for (const z of pk.zones) if (z === 'spellbook' || z === 'atlas') shuffle(s, s.players[p][z]); log(s, `${pname(p)} shuffles.`, p); }
  void names; void src;
}
function removeUnit(s: GameState, u: Unit, to: 'banish' | 'hand', why: string) {
  for (const m of s.perms) if (m.carrier === u.id) { m.c = u.c; delete m.carrier; }
  delete s.units[u.id];
  const owner = Number(u.inst[0]) as PlayerId;
  if (to === 'hand' && unitCard(s, u).category === 'Token') log(s, `${unitCard(s, u).name} is a token and is banished instead.`, null);
  else if (to === 'hand') { s.players[owner].hand.push(u.inst); log(s, `${unitCard(s, u).name} returns to ${pname(owner)}'s hand (${why}).`, null); }
  else log(s, `${unitCard(s, u).name} is banished (${why}).`, null);
}

/** Codex "Mana" (current; the Oct 2024 rulebook p17 said the opposite for a lost site): mana sources you gain or
 *  lose during your turn change your available mana at once. Available = sources you control now + mana you gained
 *  − mana you spent, so it can sit below zero after a source is lost (shown as 0) until a new source covers it. */
function followMana(s: GameState) {
  if (s.phase !== 'main') return;
  const pl = s.players[s.active]; const now = manaIncome(s, s.active);
  if (pl.income !== undefined && now !== pl.income) pl.mana += now - pl.income;
  pl.income = now;
}

// ---------- movement ----------
/** Can this unit live in that region? Rulebook p13 (subsurface), p12 (void), p5/p35 (Avatars never enter the void). */
function canOperate(s: GameState, u: Unit, r: RealmRegion): boolean {
  if (r === 'surface') return true;
  if (u.avatar) return false; // rulebook p5: "Avatars can never enter a region other than the surface"
  if (r === 'void') return !u.avatar && has(s, u, 'Voidwalk');
  return r === 'underwater' ? has(s, u, 'Submerge') : has(s, u, 'Burrowing');
}
/** One step (rulebook p15 "Steps": between adjacent locations, which p15 keeps within one region). Airborne steps
 *  diagonally on the surface (p32); Burrowing/Submerge step between a site's surface and subsurface (p32, p35);
 *  Voidwalk steps into the void, between voids, and out of it to a site's surface or, when the unit can live
 *  there, straight to its subsurface (p35 "Voidwalk"; Codex "Voidwalk"). */
function stepOk(s: GameState, u: Unit, from: Loc, to: Loc): boolean {
  if (!s.sites[to.c] && to.r !== 'surface') return false; // a void square has one location
  // rulebook p33 "Ground Movement": a step between the surfaces of two sites, unless Airborne
  if (from.c !== to.c && entryBlocked(s, u, to.c, from.r === 'surface' && to.r === 'surface' && !!s.sites[from.c])) return false;
  const rf = regionOf(s, from), rt = regionOf(s, to);
  if (from.c === to.c) {
    if (from.r === to.r || rt === 'void') return false;
    return canOperate(s, u, rf === 'surface' ? rt : rf);
  }
  const [x1, y1] = xy(from.c), [x2, y2] = xy(to.c);
  const dx = Math.abs(x1 - x2), dy = Math.abs(y1 - y2);
  if (dx > 1 || dy > 1) return false;
  if (dx + dy === 2 && !(rf === 'surface' && rt === 'surface' && has(s, u, 'Airborne'))) return false;
  if (rf === 'void' || rt === 'void') return !u.avatar && has(s, u, 'Voidwalk') && canOperate(s, u, rt);
  if (rf !== rt) return false;
  return canOperate(s, u, rt);
}
/** Why a step can't be taken now, for the warning. */
function stepWhyNot(s: GameState, u: Unit, from: Loc, to: Loc): Check {
  const name = unitCard(s, u).name;
  if (from.c !== to.c && entryBlocked(s, u, to.c)) return no(`${name} can't enter that site: a card there keeps it out.`);
  if (!s.sites[to.c]) return no(u.avatar ? 'An Avatar can never enter the void.' : 'That square is void. A minion entering the void is banished unless it has Voidwalk.', 'Voidwalk');
  const rt = regionOf(s, to), rf = regionOf(s, from);
  if (rt === 'underground' || rt === 'underwater') if (!canOperate(s, u, rt)) return no(`Only ${rt === 'underwater' ? 'Submerge units can go underwater' : 'Burrowing units can go underground'}.`, rt === 'underwater' ? 'Submerge' : 'Burrowing');
  if (from.c !== to.c && rf !== rt && rf !== 'void') return no('A step stays in one region: from the surface to the surface, underground to underground, underwater to underwater.', 'Region');
  return no('A step goes to a bordering square. Diagonal steps need Airborne.', 'Airborne');
}
/** What a step costs against the unit's steps: 0 when it "moves freely" (rulebook p34 "Moves Freely": the step's
 *  start and end satisfy the condition), e.g. an Airborne minion leaving a site that lets it move freely away. */
export function stepCost(s: GameState, u: Unit, from: Loc, to: Loc): number {
  if (from.c === to.c || from.r !== 'surface' || u.avatar) return 1;
  const st = s.sites[from.c]; if (!st?.inst) return 1;
  return cardOf(s, st.inst).effects.some((e) => e.on === 'static' && e.keyword === 'Moves freely away' && (!e.kw || has(s, u, e.kw))) ? 0 : 1;
}
/** Every location the unit can end a move on, with one path to it. Includes staying put (empty path). */
export function reach(s: GameState, u: Unit): Map<string, Loc[]> {
  const out = new Map<string, Loc[]>();
  const start: Loc = { c: u.c, r: u.r };
  out.set(locKey(start), []);
  if (has(s, u, 'Immobile') || unitCard(s, u).keywords.includes('Immobile')) return out;
  const budget = 1 + moveOf(s, u);
  const best = new Map<string, number>([[locKey(start), 0]]);
  const queue: { at: Loc; path: Loc[]; cost: number }[] = [{ at: start, path: [], cost: 0 }];
  while (queue.length) {
    const { at: from, path, cost } = queue.shift()!;
    const cands: Loc[] = [{ c: from.c, r: from.r === 'surface' ? 'under' : 'surface' }, ...nearby(from.c).filter((c) => c !== from.c).flatMap((c) => [{ c, r: 'surface' as const }, { c, r: 'under' as const }])];
    for (const to of cands) {
      if (!stepOk(s, u, from, to)) continue;
      const c2 = cost + stepCost(s, u, from, to); const k = locKey(to);
      if (c2 > budget || (best.has(k) && best.get(k)! <= c2)) continue;
      best.set(k, c2); const p = [...path, to]; out.set(k, p); queue.push({ at: to, path: p, cost: c2 });
    }
  }
  return out;
}
function canAct(s: GameState, u: Unit): Check {
  if (u.tapped) return { ok: false, reason: `${unitCard(s, u).name} is tapped. Tapped units cannot move, attack or use tap abilities until they untap at the start of your turn.`, keyword: 'Tap' };
  if (summoningSick(s, u)) return { ok: false, reason: `${unitCard(s, u).name} entered this turn and has summoning sickness (it cannot tap until your next turn, unless it has Charge).`, keyword: 'Summoning Sickness' };
  if (isDisabled(s, u)) return { ok: false, reason: `${unitCard(s, u).name} is disabled and cannot take actions.`, keyword: 'Disabled' };
  return { ok: true };
}
export function attackTargets(s: GameState, u: Unit, at: Loc): { unit?: string; site?: boolean }[] {
  const out: { unit?: string; site?: boolean }[] = [];
  if (has(s, u, "Can't attack")) return out;
  const siteSafe = !!s.sites[at.c]?.inst && Object.values(s.units).some((x) => x.c === at.c && has(s, x, 'Protects this site from attacks'));
  for (const e of unitsAt(s, at)) {
    if (e.owner === u.owner) continue;
    if (hasStealth(s, e)) continue; // Codex "Stealth": attacks cannot target it
    if (has(s, e, "Can't be attacked") || siteSafe) continue;
    if (has(s, e, 'Airborne') && !has(s, u, 'Airborne')) continue;
    out.push({ unit: e.id });
  }
  const site = s.sites[at.c];
  if (at.r === 'surface' && site && site.owner === other(u.owner) && !has(s, u, "Can't attack sites") && !siteSafe && !(site.inst && cardOf(s, site.inst).effects.some((e) => e.on === 'static' && e.keyword === "Can't be attacked"))) out.push({ site: true });
  return out;
}
function defenders(s: GameState, attacker: Unit, at: Loc, target?: string): string[] {
  if (hasStealth(s, attacker)) return [];
  return Object.values(s.units).filter((d) => d.owner !== attacker.owner && !d.tapped && !isDisabled(s, d) && d.id !== target && !has(s, d, "Can't defend")
    && (has(s, d, "Can't move to defend") ? d.c === at.c && d.r === at.r : reach(s, d).has(locKey(at)))).map((d) => d.id);
}
function interceptors(s: GameState, mover: Unit): string[] {
  if (hasStealth(s, mover)) return [];
  const air = has(s, mover, 'Airborne');
  return unitsAt(s, mover).filter((d) => d.owner !== mover.owner && !d.tapped && !isDisabled(s, d) && !has(s, d, "Can't intercept") && (!air || has(s, d, 'Airborne') || rangedOf(s, d) > 0)).map((d) => d.id);
}
/** Units the responding player may commit to the pending defend/intercept. */
export function responders(s: GameState): string[] {
  const p = s.pending; if (!p) return [];
  const a = s.units[p.attacker]; if (!a) return [];
  if (p.kind === 'allocate') return [];
  return p.kind === 'defend' ? defenders(s, a, p.loc, p.target?.unit) : interceptors(s, a);
}

/** How much damage a unit's strike deals (its power, +1 for a lance's first strike: Codex "Lance"). */
export const strikeOf = (s: GameState, u: Unit) => power(s, u) + (u.lance ? 1 : 0);
/** A suggested split of the attacker's strike: enough to kill the weakest enemies first, the rest on the next
 *  in line. Used by the AI and as the starting point of the allocation prompt; the player decides. */
export function autoSplit(s: GameState, attackerId: string, foeIds: string[]): Record<string, number> {
  const a = s.units[attackerId]; const out: Record<string, number> = {}; if (!a) return out;
  const lethal = has(s, a, 'Lethal'); let left = strikeOf(s, a);
  const foes = foeIds.map((id) => s.units[id]).filter(Boolean);
  const need = (u: Unit) => (u.avatar ? Infinity : lethal ? 1 : Math.max(1, defenseOf(s, u) - u.damage));
  const order = [...foes].sort((x, y) => need(x) - need(y));
  for (const f of foes) out[f.id] = 0;
  for (const f of order) { const n = need(f); if (n <= left) { out[f.id] = n; left -= n; } }
  if (left > 0 && order.length) { const rest = order.find((f) => !out[f.id]) ?? order[0]; out[rest.id] += left; }
  return out;
}
function fight(s: GameState, attackerId: string, enemyIds: string[], siteOwner: PlayerId | null, split?: Record<string, number>) {
  const a = s.units[attackerId]; if (!a) return;
  a.stealthLost = true;
  if (!enemyIds.length) {
    if (siteOwner !== null) {
      const st = s.sites[a.c];
      if (st?.ward) { st.ward = false; log(s, `${unitCard(s, a).name} strikes the site; its Ward breaks and prevents the damage.`, a.owner); }
      else { log(s, `${unitCard(s, a).name} strikes the site.`, a.owner); loseLife(s, siteOwner, power(s, a)); }
    }
    return;
  }
  type Strike = { from: Unit; to: Unit; dmg: number; lethal: boolean; first: boolean };
  const strikes: Strike[] = [];
  const mk = (from: Unit, to: Unit) => {
    if (isDisabled(s, from)) return;
    const lance = from.lance; from.lance = false; from.stealthLost = true;
    strikes.push({ from, to, dmg: power(s, from) + (lance ? 1 : 0), lethal: has(s, from, 'Lethal'), first: lance });
  };
  // Rulebook p23 "Multiple Combatants" / Codex "Fight": the attacker's controller divides its single strike among
  // the enemies (some may get 0). With one enemy it all goes there; with several the player chose (`split`).
  if (!isDisabled(s, a)) {
    const lance = a.lance || has(s, a, 'Strikes first while attacking');
    const lethal = has(s, a, 'Lethal');
    const give = enemyIds.length === 1 ? { [enemyIds[0]]: strikeOf(s, a) } : split ?? autoSplit(s, a.id, enemyIds);
    a.lance = false;
    for (const id of enemyIds) { const f = s.units[id]; if (f && give[id]) strikes.push({ from: a, to: f, dmg: give[id], lethal, first: lance }); }
  }
  for (const id of enemyIds) { const dfn = s.units[id]; if (dfn && has(s, dfn, "Doesn't strike back while defending")) { log(s, `${unitCard(s, dfn).name} does not strike back.`, dfn.owner); continue; } mk(dfn, a); }
  for (const pass of [true, false]) {
    const batch = strikes.filter((x) => x.first === pass && s.units[x.from.id]);
    const wardHit = new Set<string>(); // Codex: all simultaneous damage to a warded unit is prevented when the Ward breaks
    for (const x of batch) {
      if (!s.units[x.to.id] && !x.to.avatar) continue;
      if (wardHit.has(x.to.id)) { log(s, `${unitCard(s, x.from).name}'s strike on ${unitCard(s, x.to).name} is prevented.`, x.from.owner); continue; }
      if (warded(s, x.to) && x.dmg > 0) wardHit.add(x.to.id);
      log(s, `${unitCard(s, x.from).name} strikes ${unitCard(s, x.to).name} for ${x.dmg}.`, x.from.owner);
      damageUnit(s, x.to, x.dmg, x.lethal && !x.to.avatar && !has(s, x.to, 'Immune to Lethal'), { unit: x.from });
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
/** What a spell costs right now: its printed cost less "Costs (N) less to cast if …" (Codex "Cost": never below 0). */
export function costOf(s: GameState, p: PlayerId, d: CardDef): number {
  let c = d.cost;
  for (const e of d.effects) if (e.op === 'castRule' && e.less2 && condHolds(s, e.when, p, null)) c -= e.less2;
  return Math.max(0, c);
}
const castRules = (d: CardDef) => d.effects.filter((e) => e.op === 'castRule');
/** Where magic is measured from: your spellcasters, plus allies when the card says "May be cast by any ally". */
/** Who may cast card d (rulebook p17: a spell is cast by a Spellcaster you control, from its location): your
 *  spellcasters that can cast it, plus allies when the card says "May be cast by any ally". Avatar first. */
export function castersFor(s: GameState, p: PlayerId, d: CardDef): Unit[] {
  const by = castRules(d).find((e) => e.byAlly);
  const extra = by ? Object.values(s.units).filter((u) => u.owner === p && !isDisabled(s, u) && (!by.bySub?.length || by.bySub.some((x) => unitCard(s, u).subtypes.some((y) => y.toLowerCase() === x.toLowerCase())))) : [];
  const all = [...spellcasters(s, p, d), ...extra];
  return all.filter((u, i) => all.indexOf(u) === i).sort((a, b) => Number(b.avatar) - Number(a.avatar));
}
function castOrigins(s: GameState, p: PlayerId, d: CardDef, caster?: string): Loc[] {
  return castersFor(s, p, d).filter((u) => !caster || u.id === caster).map((u) => ({ c: u.c, r: u.r }));
}
/** The spellcaster a cast uses: the one chosen, else the first (Avatar first) from which its choices are legal. */
function casterFor(s: GameState, p: PlayerId, d: CardDef, idx: number[], ch: (Choice | null)[], chosen?: string): Unit | undefined {
  const all = castersFor(s, p, d);
  if (chosen) return all.find((u) => u.id === chosen);
  if (d.type !== 'Magic') return all[0];
  return all.find((u) => checkChoices(s, p, d, idx, ch, [{ c: u.c, r: u.r }]).ok) ?? all[0];
}
function affordable(s: GameState, p: PlayerId, d: CardDef): Check {
  const cost = costOf(s, p, d);
  if (s.players[p].mana < cost) return { ok: false, reason: `${d.name} costs ${cost} mana${cost !== d.cost ? ` (${d.cost} printed)` : ''} and you have ${Math.max(0, s.players[p].mana)}. Sites give 1 mana each at the start of your turn.`, keyword: 'Mana' };
  const t = thresholdOf(s, p);
  for (const e of ELEMENTS) if (t[e] < d.thresholds[e]) return { ok: false, reason: `${d.name} needs ${d.thresholds[e]} ${e} threshold and your sites provide ${t[e]}. Threshold is counted from the element symbols on sites you control; it is not spent.`, keyword: 'Threshold' };
  return { ok: true };
}
const no = (reason: string, keyword?: string): Check => ({ ok: false, reason, keyword });

export function check(s: GameState, a: Action): Check {
  if (s.phase === 'over') return no('The game is over.');
  const p = actor(s);
  const pl = s.players[p];
  if (a.t === 'manual') return s.pending ? no('Resolve the pending defend or intercept first.', 'Defend') : { ok: true };
  if (!s.pending && s.queue?.length) {
    if (a.t !== 'trigger') return no(`${pname(s.queue[0].by)} must first resolve ${cardOf(s, s.queue[0].inst).name}'s triggered ability.`, 'Triggered ability');
    let at = 0;
    if (a.id) { // only one of the same player's abilities waiting together at the front of the queue
      at = s.queue.findIndex((x) => x.id === a.id);
      if (at < 0 || s.queue.slice(0, at + 1).some((x) => x.by !== s.queue![0].by)) return no('That ability is not next on the storyline.', 'Storyline');
    }
    if (a.skip) return { ok: true };
    const q = s.queue[at]; const d = cardOf(s, q.inst);
    const self = q.src && 'unit' in q.src ? q.src.unit : undefined;
    return checkChoices(s, q.by, d, q.fx, a.choices ?? [], q.loc ? [q.loc] : casterOrigins(s, q.by), self);
  }
  if (a.t === 'trigger') return no('There is no triggered ability waiting.');
  if (s.pending?.kind === 'allocate') {
    if (a.t !== 'allocate') return no(`${pname(s.pending.by)} must first split ${unitCard(s, s.units[s.pending.attacker]).name}'s damage among the enemies in the fight.`, 'Fight');
    const foes = s.pending.foes ?? []; const total = strikeOf(s, s.units[s.pending.attacker]);
    if (Object.keys(a.split).some((id) => !foes.includes(id))) return no('Damage can only go to the enemies in this fight.', 'Fight');
    if (Object.values(a.split).some((n) => !Number.isInteger(n) || n < 0)) return no('Each share is a whole number from 0 up.', 'Fight');
    const sum = Object.values(a.split).reduce((x, y) => x + y, 0);
    if (sum !== total) return no(`The shares must add up to the strike: ${total} damage (now ${sum}).`, 'Fight');
    return { ok: true };
  }
  if (a.t === 'allocate') return no('There is no fight waiting for its damage to be split.');
  if (s.pending) {
    if (a.t !== 'respond') return no(`${pname(s.pending.by)} must choose whether to ${s.pending.kind} first.`, s.pending.kind === 'defend' ? 'Defend' : 'Intercept');
    const ok = responders(s);
    for (const id of a.units) if (!ok.includes(id)) return no('That unit cannot respond: it must be untapped, not disabled, and able to reach the fight.', 'Defend');
    return { ok: true };
  }
  if (a.t === 'respond') return no('There is nothing to respond to.');
  if (s.phase === 'mulligan') {
    if (a.t !== 'mulligan') return no('Finish the mulligan first.', 'Setup');
    if (a.cards.length > 3) return no('A mulligan returns at most 3 cards.', 'Setup');
    if (a.cards.some((c) => !pl.hand.includes(c))) return no('Those cards are not in your hand.');
    return { ok: true };
  }
  if (s.phase === 'draw') {
    if (a.t !== 'draw') return no('Draw a card from your spellbook or atlas first: every turn starts with a draw (except the first player\'s first turn).', 'Start phase');
    if (!pl[a.deck].length) return no(`Your ${a.deck} is empty. Drawing from an empty deck loses the game, so choose the other one.`, 'Winning');
    return { ok: true };
  }
  const avatar = s.units[pl.avatar];
  switch (a.t) {
    case 'endTurn': return { ok: true };
    case 'drawSite':
      if (avatar.tapped) return no('Your Avatar is tapped. Its ability (tap: play or draw a site) can be used once per turn.', 'Avatar');
      if (!pl.atlas.length) return no('Your atlas is empty.');
      return { ok: true };
    case 'playSite': {
      if (!pl.hand.includes(a.inst)) return no('That card is not in your hand.');
      const d = cardOf(s, a.inst);
      if (d.type !== 'Site') return no(`${d.name} is not a site.`);
      if (avatar.tapped) return no('Your Avatar is tapped. Playing a site taps your Avatar, so it is one site per turn.', 'Site');
      const corner = allows(d, 'Play to any corner') && [0, 4, 15, 19].includes(a.c) && (!s.sites[a.c] || !s.sites[a.c]!.inst);
      if (!corner && !siteCells(s, p).includes(a.c)) return no(sitesOf(s, p).length ? 'A site must go on a void or rubble square next to a site you control (not diagonally).' : "Your first site goes on your Avatar's square.", 'Site');
      return { ok: true };
    }
    case 'cast': {
      const fromCem = !pl.hand.includes(a.inst) && pl.cemetery.includes(a.inst);
      if (!pl.hand.includes(a.inst) && !(fromCem && castRules(cardOf(s, a.inst)).some((e) => e.fromCemetery))) return no(fromCem ? `${cardOf(s, a.inst).name} cannot be cast from the cemetery.` : 'That card is not in your hand.', 'Casting spells');
      const d = cardOf(s, a.inst);
      if (d.type === 'Site') return no('Sites are played with your Avatar ability, not cast.', 'Site');
      if (d.type === 'Avatar') return no('Avatars are not cast.');
      const aff = affordable(s, p, d); if (!aff.ok) return aff;
      const casters = castersFor(s, p, d);
      if (!casters.length) return no(`None of your units can cast ${d.name}. Your Avatar can't cast right now, and your other spellcasters are limited to other elements or kinds of spell.`, 'Spellcaster');
      if (a.caster && !casters.some((u) => u.id === a.caster)) { const u = s.units[a.caster]; return no(u ? `${unitCard(s, u).name} can't cast ${d.name}${casterKinds(s, u).length ? `: it is a ${casterKinds(s, u).join(' / ').replace(/Spellcaster \((.+)\)/g, '$1 Spellcaster').replace(/\+/g, ' and ')}` : ': it is not a spellcaster'}.` : 'Choose a spellcaster you control.', 'Spellcaster'); }
      if (d.type === 'Minion' || d.type === 'Artifact') {
        if (a.c === undefined || !summonCells(s, p, d).includes(a.c)) return no(`${d.type === 'Minion' ? 'Minions are summoned' : 'Artifacts are conjured'} on a site you control${d.type === 'Minion' ? ' (a minion with Voidwalk can also be summoned to the void)' : ''}.`, d.type === 'Minion' && !s.sites[a.c ?? -1] ? 'Voidwalk' : 'Casting spells');
      } else if (d.type === 'Aura') {
        if (a.c === undefined || a.c < 0 || a.c >= CELLS) return no('Choose where the aura goes.');
        if (xy(a.c)[0] > COLS - 2 || xy(a.c)[1] > ROWS - 2) return no('An aura sits where four squares meet (a 2×2 area); choose the top-left square of that area.', 'Aura');
      }
      const on: Trigger = d.type === 'Magic' ? 'cast' : 'genesis';
      const idx = effectsOn(d, on);
      const needsTarget = idx.some((i) => d.effects[i].who === 'target');
      if (d.type === 'Artifact' && !needsTarget && a.target) { // conjured straight into a unit's hands
        const b = s.units[a.target];
        if (!b || b.owner !== p || b.c !== a.c) return no('An artifact can be handed to one of your own units on the site where it is conjured.', 'Carry');
        return { ok: true };
      }
      return checkChoices(s, p, d, idx, choicesOf(d, idx, a.choices, a.target), d.type === 'Magic' ? castOrigins(s, p, d, a.caster) : [{ c: a.c!, r: 'surface' }]);
    }
    case 'ability': {
      const src = sourceOf(s, a.src);
      if (!src || src.owner !== p) return no('That is not yours.');
      const d = cardOf(s, src.inst); const e = d.effects[a.fx];
      if (!e || (e.on !== 'tap' && e.on !== 'activated') || e.afterSite) return no(`${d.name} has no ability to use there.`);
      if (!effectsOn(d, e.on, a.fx).length) return no(`${d.name} has no ability to use there.`);
      if (src.unit && isDisabled(s, src.unit)) return no(`${d.name} is disabled and its abilities do not work.`, 'Disabled');
      if (e.on === 'tap') {
        if (src.unit) { const can = canAct(s, src.unit); if (!can.ok) return can; }
        else if (src.tapped) return no(`${d.name} is already tapped. A tap ability can be used again after it untaps at the start of your turn.`, 'Tap');
      } else if (!e.repeat && s.used?.[`${srcKey(a.src)}:${e.line ?? a.fx}`] === s.turn) return no(`${d.name}'s ability can be used once per turn.`, 'Activated ability');
      const cost = e.cost ?? 0;
      if (cost > pl.mana) return no(`That ability costs ${cost} mana and you have ${pl.mana}.`, 'Mana');
      for (const i of effectsOn(d, e.on, a.fx)) { const ce = d.effects[i]; if (ce.isCost && ce.op === 'discard' && !pl.hand.some((x) => (ce.deck === 'atlas' ? cardOf(s, x).type === 'Site' : ce.deck === 'spellbook' ? cardOf(s, x).type !== 'Site' : true))) return no(`That ability's cost is to discard a ${ce.deck === 'atlas' ? 'site' : ce.deck === 'spellbook' ? 'spell' : 'card'}, and you have none in hand.`, 'Discard'); }
      if (!needMet(s, p, e)) return no(`That ability needs ${ELEMENTS.filter((el) => e.need![el]).map((el) => `${e.need![el]} ${el}`).join(' and ')} threshold, from the element symbols on sites you control.`, 'Threshold');
      if (e.banishDead && !pl.cemetery.some((i) => cardOf(s, i).type === 'Minion' && cardOf(s, i).thresholds[e.banishDead!] > 0)) return no(`You have no dead ${e.banishDead} minions to banish.`);
      const idx = effectsOn(d, e.on, a.fx);
      return checkChoices(s, p, d, idx, a.choices ?? [], [src.loc], src.unit?.id);
    }
    case 'move': {
      const u = s.units[a.unit];
      if (!u || u.owner !== p) return no('That is not your unit.');
      const can = canAct(s, u); if (!can.ok) return can;
      if (!a.path.length && !a.attack) return no('Choose a square to move to or something to attack.', 'Move and Attack');
      { let cost = 0, at: Loc = { c: u.c, r: u.r }; for (const to of a.path) { cost += stepCost(s, u, at, to); at = to; }
        if (cost > 1 + moveOf(s, u)) return no(`${unitCard(s, u).name} can take ${1 + moveOf(s, u)} step(s) per move.`, 'Movement'); }
      if (a.path.length && unitCard(s, u).keywords.includes('Immobile')) return no(`${unitCard(s, u).name} is Immobile and cannot take steps.`, 'Immobile');
      // Rulebook p21: declare every step, then resolve them in order. The only limit on declaring is that a step
      // (from one location to the next) is not repeated; each step is checked as it resolves and an illegal one is
      // skipped. A declaration with no step that could be taken right now is refused, with the reason.
      const start: Loc = { c: u.c, r: u.r }; const used = new Set<string>();
      let from = start, decl = start, firstBad: Check | null = null;
      for (const to of a.path) {
        const k = locKey(decl) + '>' + locKey(to);
        if (used.has(k)) return no('A path may not repeat a step (the same move from one location to the same next one). Coming back to a square is fine.', 'Move and Attack');
        used.add(k); decl = to;
        if (stepOk(s, u, from, to)) from = to; else firstBad ??= stepWhyNot(s, u, from, to);
      }
      if (a.path.length && from === start && firstBad) return firstBad;
      if (a.attack) {
        const ts = attackTargets(s, u, from);
        if (a.attack.site) { if (!ts.some((t) => t.site)) return no('There is no enemy site surface to attack at that location.', 'Move and Attack'); }
        else if (!ts.some((t) => t.unit === a.attack!.unit)) {
          const e = a.attack.unit ? s.units[a.attack.unit] : undefined;
          if (e && has(s, e, 'Airborne')) return no('Airborne units can only be attacked by Airborne units.', 'Airborne');
          if (e && hasStealth(s, e)) return no(`${unitCard(s, e).name} has Stealth: it cannot be targeted by attacks until it interacts with the realm.`, 'Stealth');
          return no('You can only attack an enemy at the location where the move ends.', 'Move and Attack');
        }
      }
      return { ok: true };
    }
    case 'shoot': {
      const u = s.units[a.unit];
      if (!u || u.owner !== p) return no('That is not your unit.');
      if (!rangedOf(s, u)) return no(`${unitCard(s, u).name} is not Ranged.`, 'Ranged');
      const can = canAct(s, u); if (!can.ok) return can;
      if (Math.abs(a.dx) + Math.abs(a.dy) !== 1) return no('Projectiles travel in a straight line along the grid.', 'Projectile');
      const there = shotCandidates(s, u, a.dx, a.dy);
      if (!there.length) return no('No unit would be hit in that direction within range.', 'Ranged');
      if (a.hit && !there.some((x) => x.id === a.hit)) return no('The projectile stops at the first square with a unit it can hit; that unit is not there.', 'Projectile');
      return { ok: true };
    }
    default: return no('Unknown action.');
  }
}
/** Codex "Projectile": it starts at the shooter's location (allies there are ignored) and stops at the
 *  first unit it reaches, ally or enemy. Stealthed minions are not hit. Ranged X: it stops after X steps. */
/** Ranged X: a projectile that stops after X steps (rulebook p34 "Ranged X"). */
export const shotCandidates = (s: GameState, u: Unit, dx: number, dy: number) => projectileCandidates(s, u.owner, { c: u.c, r: u.r }, dx, dy, rangedOf(s, u), u.id);
function shotTarget(s: GameState, u: Unit, dx: number, dy: number, pick?: string): Unit | null {
  const there = shotCandidates(s, u, dx, dy); return there.find((e) => e.id === pick) ?? there[0] ?? null;
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
      s.sites[a.c] = { inst: a.inst, owner: p, ...(cardOf(s, a.inst).keywords.includes('Ward') ? { ward: true } : {}) };
      log(s, `${pname(p)} plays ${cardOf(s, a.inst).name} (+1 mana).`); // the +1 comes from followMana below
      (s.players[p].cast ??= { turn: s.turn, ids: [] }); if (s.players[p].cast!.turn !== s.turn) s.players[p].cast = { turn: s.turn, ids: [] };
      s.players[p].cast!.ids.push('site:' + s.inst[a.inst]);
      fire(s, a.inst, 'genesis', p, { c: a.c, r: 'surface' }, { site: a.c });
      // the Avatar's own "If you played an earth site, …" follow-ups
      const av = s.units[pl.avatar]; const avd = unitCard(s, av); const follow = avd.effects.map((e, i) => [e, i] as const).filter(([e]) => e.afterSite).map(([, i]) => i);
      if (follow.length) fire(s, av.inst, 'tap', p, { c: av.c, r: av.r }, { unit: av.id }, undefined, follow);
      break;
    }
    case 'cast': {
      const d = cardOf(s, a.inst);
      const fromCem = !pl.hand.includes(a.inst);
      if (fromCem) pl.cemetery.splice(pl.cemetery.indexOf(a.inst), 1); else pl.hand.splice(pl.hand.indexOf(a.inst), 1);
      pl.mana -= costOf(s, p, d);
      if (fromCem) log(s, `${pname(p)} casts ${d.name} from the cemetery.`);
      if (!pl.cast || pl.cast.turn !== s.turn) pl.cast = { turn: s.turn, ids: [] }; pl.cast.ids.push(d.id);
      const on: Trigger = d.type === 'Magic' ? 'cast' : 'genesis';
      const idx = effectsOn(d, on);
      const ch = choicesOf(d, idx, a.choices, a.target);
      const caster = casterFor(s, p, d, idx, ch, a.caster) ?? s.units[pl.avatar];
      if (caster) {
        if (!caster.avatar) log(s, `${unitCard(s, caster).name} casts it.`, p);
        caster.stealthLost = true; // Codex "Interact": casting a spell ends Stealth
        react(s, 'casts', caster, caster, d);
      }
      const hand = d.effects.some((e) => e.op === 'manual') ? ' Part of its text is not automated; resolve it by hand.' : '';
      if (d.type === 'Minion') {
        const id = `u${s.nextId++}`;
        s.units[id] = { id, inst: a.inst, owner: p, c: a.c!, r: 'surface', tapped: false, damage: 0, enteredTurn: s.turn, avatar: false, stealthLost: false, lance: d.keywords.includes('Lance'), ...(d.keywords.includes('Ward') ? { ward: true } : {}) };
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
        resolve(s, d, idx, p, caster ? { c: caster.c, r: caster.r } : null, ch); // the spell happens where its caster is (rulebook p17)
        if (fromCem && castRules(d).some((e) => e.banishAfter)) log(s, `${d.name} is banished.`); else pl.cemetery.push(a.inst);
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
      if (src.unit && s.units[src.unit.id]) s.units[src.unit.id].stealthLost = true; // Codex "Interact" / rulebook p34: activating a special ability ends Stealth
      if (e.cost) pl.mana -= e.cost;
      if (e.banishDead) {
        const dead = pl.cemetery.filter((i) => cardOf(s, i).type === 'Minion' && cardOf(s, i).thresholds[e.banishDead!] > 0);
        pl.cemetery = pl.cemetery.filter((i) => !dead.includes(i));
        pl.banished = dead.reduce((n, i) => n + cardOf(s, i).thresholds[e.banishDead!], 0);
        log(s, `${pname(p)} banishes ${dead.length} dead ${e.banishDead} minion(s) (${pl.banished} ${e.banishDead}).`);
      }
      log(s, `${pname(p)} uses ${d.name}${e.on === 'tap' ? ' (tap)' : ''}${e.cost ? `, paying ${e.cost} mana` : ''}.`);
      resolve(s, d, effectsOn(d, e.on, a.fx), p, src.loc, a.choices ?? [], a.src);
      if (e.sacrifice) sacrifice(s, a.src);
      break;
    }
    case 'trigger': {
      const at = a.id ? s.queue!.findIndex((x) => x.id === a.id) : 0;
      const q = s.queue!.splice(at, 1)[0]; const d = cardOf(s, q.inst);
      if (a.skip) log(s, `${pname(q.by)} lets ${d.name}'s ability pass.`, q.by);
      else resolve(s, d, q.fx, q.by, q.loc, a.choices ?? [], q.src, q.subject);
      if (q.cemetery) toCemetery(s, q.cemetery); // a dead minion whose Deathrite waited for this
      if (!s.queue!.length) delete s.queue;
      break;
    }
    case 'move': {
      const u = s.units[a.unit];
      u.tapped = true;
      // Rulebook p21: resolve the declared steps one at a time, confirming each is legal at that moment; an illegal
      // step is skipped and the rest continue. p28: a unit enters every location it passes, even for a moment.
      let took = 0;
      for (const to of a.path) {
        if (!s.units[u.id] || u.halted) break;
        const from: Loc = { c: u.c, r: u.r };
        if (!stepOk(s, u, from, to)) { log(s, `${unitCard(s, u).name} can't take a step it declared (${(stepWhyNot(s, u, from, to) as { reason: string }).reason}); it skips it.`); continue; }
        // "Minions here can traverse the void, gaining Voidwalk until leaving it" (Planar Gate)
        if (!s.sites[to.c] && s.sites[from.c]?.inst && cardOf(s, s.sites[from.c]!.inst!).effects.some((e) => e.keyword === 'Void gate') && !u.mods?.some((m) => m.void)) (u.mods ??= []).push({ atk: 0, def: 0, kw: 'Voidwalk', void: true, from: cardOf(s, s.sites[from.c]!.inst!).name });
        if (s.sites[to.c] && u.mods?.some((m) => m.void)) { u.mods = u.mods.filter((m) => !m.void); if (!u.mods.length) delete u.mods; }
        u.c = to.c; u.r = to.r; took++;
        if (to.c !== from.c) react(s, 'enters', u);
      }
      if (s.units[u.id]) delete s.units[u.id].halted;
      if (!s.units[u.id]) break; // a reaction to it entering killed it
      if (a.path.length && !took) log(s, `${unitCard(s, u).name} takes no steps, so it has not moved.`);
      const at: Loc = { c: u.c, r: u.r };
      // rulebook p23: as the attack resolves, confirm the target is legal at that moment; if not, the unit has not attacked
      const attackOk = !!a.attack && attackTargets(s, u, at).some((t) => (a.attack!.site ? t.site : t.unit === a.attack!.unit));
      if (a.attack && !attackOk) log(s, `${unitCard(s, u).name}'s attack target can't be attacked from where it ended up, so it does not attack.`);
      if (a.attack && attackOk) {
        react(s, 'attacks', u);
        if (!s.units[u.id] || (a.attack.unit && !s.units[a.attack.unit])) break;
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
    case 'allocate': { const pd = s.pending!; s.pending = null; fight(s, pd.attacker, pd.foes ?? [], null, a.split); break; }
    case 'shoot': {
      const u = s.units[a.unit]; const t = shotTarget(s, u, a.dx, a.dy, a.hit)!;
      u.tapped = true; u.stealthLost = true;
      log(s, `${unitCard(s, u).name} shoots ${unitCard(s, t).name} for ${power(s, u)}.`);
      damageUnit(s, t, power(s, u), has(s, u, 'Lethal') && !t.avatar, { unit: u });
      break;
    }
    case 'endTurn': {
      fireAll(s, p, 'endTurn');
      for (const u of Object.values(s.units)) if (u.ctrl?.turn !== undefined) { log(s, `${unitCard(s, u).name} returns to ${pname(u.ctrl.was)}'s control.`, null); u.owner = u.ctrl.was; delete u.ctrl; }
      for (const m of [...s.perms]) { // Codex "Lasts 3 of Your Turns": a counter each end of turn, dispelled at N
        if (m.owner !== p) continue;
        const n = cardOf(s, m.inst).effects.find((e) => e.op === 'lasts')?.n; if (!n) continue;
        m.turns = (m.turns ?? 0) + 1;
        if (m.turns >= n) { s.perms.splice(s.perms.indexOf(m), 1); s.players[Number(m.inst[0]) as PlayerId].cemetery.push(m.inst); log(s, `${cardOf(s, m.inst).name} is dispelled (it lasted ${n} turns).`, p); }
      }
      // Rulebook p16 End Phase step 2: "Players remove all damage from their minions" — both players, not just the active one.
      for (const u of Object.values(s.units)) { if (!u.avatar) u.damage = 0; if (u.mods?.some((m) => m.turn !== undefined)) { u.mods = u.mods.filter((m) => m.turn === undefined); if (!u.mods.length) delete u.mods; } }
      pl.mana = 0;
      startTurn(s, other(p));
      break;
    }
    case 'manual': manual(s, a); break;
  }
  followMana(s);
  // carried artifacts go where their bearer goes; if the bearer is gone they stay where it fell
  for (const m of s.perms) if (m.carrier) { const b = s.units[m.carrier]; if (b) m.c = b.c; else delete m.carrier; }
  return s;
}
function resolvePending(s: GameState, ids: string[], removeOriginal: boolean) {
  const pd = s.pending!; s.pending = null;
  const a = s.units[pd.attacker]; if (!a) return;
  for (const id of ids) { const d = s.units[id]; d.tapped = true; d.c = pd.loc.c; d.r = pd.loc.r; }
  if (ids.length) log(s, `${ids.map((id) => unitCard(s, s.units[id]).name).join(', ')} ${pd.kind === 'defend' ? 'defend' : 'intercept'}.`, pd.by);
  if (pd.kind === 'intercept' && !ids.length) return;
  const enemies = [...ids];
  let siteOwner: PlayerId | null = null;
  if (pd.target?.unit) { if (!(removeOriginal && ids.length) && s.units[pd.target.unit]) enemies.unshift(pd.target.unit); }
  else if (pd.target?.site && !ids.length) siteOwner = s.sites[pd.loc.c]?.owner ?? null;
  // several enemies: the attacker's controller decides how its strike is split (rulebook p23; Codex "Fight")
  if (enemies.length > 1 && !isDisabled(s, a) && strikeOf(s, a) > 0) {
    s.pending = { kind: 'allocate', by: a.owner, attacker: a.id, loc: pd.loc, target: null, foes: enemies };
    log(s, `${unitCard(s, a).name} faces ${enemies.length} enemies: ${pname(a.owner)} splits its ${strikeOf(s, a)} damage.`, a.owner);
    return;
  }
  fight(s, a.id, enemies, siteOwner);
}
function manual(s: GameState, a: ManualOp) {
  const say = (t: string) => log(s, `Manual: ${t}`, s.active, true);
  switch (a.op) {
    case 'life': { const pl = s.players[a.p]; pl.life = Math.max(0, pl.life + a.n); if (pl.life > 0) pl.deathsDoor = false; else if (!pl.deathsDoor) { pl.deathsDoor = true; pl.ddTurn = s.turn; } say(`${pname(a.p)} life ${a.n >= 0 ? '+' : ''}${a.n} (now ${pl.life}).`); break; }
    case 'mana': s.players[a.p].mana = Math.max(0, s.players[a.p].mana + a.n); say(`${pname(a.p)} mana ${a.n >= 0 ? '+' : ''}${a.n}.`); break;
    case 'damage': { const u = s.units[a.unit]; if (u) { say(`${a.n} damage to ${unitCard(s, u).name}.`); damageUnit(s, u, a.n); } break; }
    case 'destroy': { const u = s.units[a.unit]; if (u && !u.avatar) { say(`destroy ${unitCard(s, u).name}.`); killUnit(s, u, true); } break; }
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
    if (e.who === 'target' && !e.ref) { const t = targetsFor(s, p, d, i, origins, self); if (!t.length) return []; if (spread < 0) spread = i; base[i] = { target: t[0] }; }
    if (e.x) base[i] = { ...(base[i] ?? {}), n: 1 };
    if (e.op === 'draw' && !e.deck) base[i] = { ...(base[i] ?? {}), deck: 'spellbook' };
    if (e.op === 'moveSite') { const cl = origins[0] ? siteMoveCells(s, origins[0].c) : []; if (!cl.length) return []; base[i] = { cell: cl[0] }; }
    if (e.op === 'moveAura') base[i] = e.optional ? { skip: true } : { cell: origins[0] ? auraSteps(origins[0].c)[0] : undefined }; // the AI leaves its auras where they are
    if (e.who === 'atTarget' && !e.refCell && !['damage', 'destroy', 'banish', 'strike', 'tap', 'sink', 'choose'].includes(e.op)) { const cl = cellsFor(s, d, i, origins); if (!cl.length) return []; base[i] = { ...(base[i] ?? {}), cell: cl[0] }; }
    else if (e.who === 'atTarget' && !e.refCell) {
      // the AI aims area effects at squares with more enemies than allies
      const cells = cellsFor(s, d, i, origins).map((c) => ({ c, v: Object.values(s.units).filter((u) => u.c === c).reduce((n, u) => n + (u.owner === p ? -1 : 1), 0) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
      if (!cells.length) return []; base[i] = { ...(base[i] ?? {}), cell: cells[0].c };
    }
    if (e.op === 'pick' && e.pick && e.pick.take !== 'all') {
      const opts = pickOptions(s, p, d, e).sort((a, b) => (s.cards[b.cardId]?.cost ?? 0) - (s.cards[a.cardId]?.cost ?? 0));
      const usable = e.pick.to === 'cast' ? opts.filter((o) => (s.cards[o.cardId]?.cost ?? 0) <= s.players[p].mana) : opts;
      base[i] = { ...(base[i] ?? {}), cards: usable.slice(0, e.pick.take).map((o) => o.key) };
      if (e.pick.where === 'choose') { const cl = cellsFor(s, d, i, origins); if (cl.length) base[i] = { ...base[i]!, cell: cl[0] }; }
    }
    if (e.op === 'teleport' && chosenDest(e) && (e.who === 'target' || e.who === 'self')) { const t = base[i]?.target ? s.units[base[i]!.target!] : self ? s.units[self] : undefined; const cl = teleportCells(s, e, t, origins[0]); if (!cl.length) return []; base[i] = { ...(base[i] ?? {}), cell: cl[0] }; }
    if (e.op === 'shoot') { const dirs = origins.length ? shotDirs(s, p, origins[0]) : []; const dir = dirs.find(([dx, dy]) => projectileHit(s, p, origins[0], dx, dy, 9, self)?.owner !== p); if (!dir) return []; base[i] = { ...(base[i] ?? {}), dir }; }
  }
  if (spread < 0) return [base];
  return targetsFor(s, p, d, spread, origins, self).map((target) => {
    const c = base.slice(); c[spread] = { ...(c[spread] ?? {}), target };
    const e = d.effects[spread];
    if (e.op === 'teleport' && chosenDest(e)) { const cl = teleportCells(s, e, s.units[target], origins[0]); if (!cl.length) return null; c[spread] = { ...c[spread]!, cell: cl[0] }; } // the destination depends on which unit moves
    return c;
  }).filter((c): c is Choice[] => !!c);
}

export function playableSiteCells(s: GameState, p: PlayerId): number[] { return siteCells(s, p); }

export function legalActions(s: GameState): Action[] {
  if (s.phase === 'over') return [];
  const p = actor(s); const pl = s.players[p]; const out: Action[] = [];
  if (s.pending?.kind === 'allocate') {
    // the suggested split, and everything on each single enemy
    const pd = s.pending; const foes = pd.foes ?? []; const total = strikeOf(s, s.units[pd.attacker]);
    out.push({ t: 'allocate', split: autoSplit(s, pd.attacker, foes) });
    for (const f of foes) out.push({ t: 'allocate', split: Object.fromEntries(foes.map((x) => [x, x === f ? total : 0])) });
    return out;
  }
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
      if (allows(d, 'Play to any corner')) for (const c of [0, 4, 15, 19]) if (!cells.includes(c) && (!s.sites[c] || !s.sites[c]!.inst)) out.push({ t: 'playSite', inst, c });
    }
    if (pl.atlas.length) out.push({ t: 'drawSite' });
  }
  const mine = sitesOf(s, p); const seen = new Set<string>();
  for (const inst of [...pl.hand, ...pl.cemetery.filter((i) => castRules(cardOf(s, i)).some((e) => e.fromCemetery))]) {
    const d = cardOf(s, inst);
    if (d.type === 'Site' || d.type === 'Avatar' || seen.has(d.id) || !affordable(s, p, d).ok) continue; seen.add(d.id);
    if (!pl.hand.includes(inst) && !castRules(d).some((e) => e.fromCemetery)) continue;
    if (d.type === 'Magic') {
      for (const choices of choiceSets(s, p, d, effectsOn(d, 'cast'), castOrigins(s, p, d))) out.push({ t: 'cast', inst, ...(choices.length ? { choices } : {}) });
    } else {
      const places = d.type === 'Aura' ? [...Array(CELLS).keys()].filter((c) => xy(c)[0] <= COLS - 2 && xy(c)[1] <= ROWS - 2) : summonCells(s, p, d);
      for (const c of places) for (const choices of choiceSets(s, p, d, effectsOn(d, 'genesis'), [{ c, r: 'surface', ...(d.type === 'Aura' ? { aura: true } : {}) }])) out.push({ t: 'cast', inst, c, ...(choices.length ? { choices } : {}) });
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
    if (rangedOf(s, u)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const there = shotCandidates(s, u, dx, dy); if (there.length === 1) out.push({ t: 'shoot', unit: u.id, dx, dy }); else for (const h of there) out.push({ t: 'shoot', unit: u.id, dx, dy, hit: h.id }); }
  }
  out.push({ t: 'endTurn' });
  return out;
}
