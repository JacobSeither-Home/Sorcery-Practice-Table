// AI opponent. Three tiers:
//  easy   — mostly random legal actions, with a nudge toward developing sites
//  medium — one-ply greedy on a board evaluation
//  hard   — plans its whole turn with a beam search, then scores each finished turn by playing out
//           the opponent's best greedy reply. It never reads the opponent's hand or either deck's
//           order: every search runs on a "determinized" copy in which the hidden cards have been
//           reshuffled, so it only uses what a human at the table could know (the public board, its
//           own hand, and which cards have not been seen yet).
// The AI only plays what the engine can resolve. A spell whose text is not automated would do
// nothing for it, so those are left out of its options (see aiActions).
import { type Action, type GameState, type PlayerId, type Unit, actor, apply, cardOf, clone, has, legalActions, moveOf, other, sitesOf, unitCard, xy } from '../engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

// ---------- evaluation ----------
/** Steps a unit needs to stand on a square: Manhattan, or king-moves for Airborne. */
function steps(s: GameState, u: Unit, c: number): number {
  const [ax, ay] = xy(u.c), [bx, by] = xy(c);
  const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
  return has(s, u, 'Airborne') ? Math.max(dx, dy) : dx + dy;
}
const range = (s: GameState, u: Unit) => (unitCard(s, u).keywords.includes('Immobile') ? 0 : 1 + moveOf(s, u));

export function evaluate(s: GameState, me: PlayerId): number {
  if (s.winner !== null) return s.winner === me ? 10000 : -10000;
  let v = 0;
  for (const p of [0, 1] as PlayerId[]) {
    const sign = p === me ? 1 : -1;
    const pl = s.players[p], foePl = s.players[other(p)];
    const foe = s.units[foePl.avatar];
    const foeSites = sitesOf(s, other(p));
    let x = pl.life * 2.2 + (pl.deathsDoor ? -45 : 0) + sitesOf(s, p).length * 4 + pl.hand.length * 0.8;
    // a death blow is possible only after the turn on which death's door was reached
    const foeOpen = foePl.deathsDoor && foePl.ddTurn !== s.turn;
    for (const u of Object.values(s.units)) {
      if (u.owner !== p) continue;
      const d = unitCard(s, u);
      const toFoe = steps(s, u, foe.c);
      if (u.avatar) { if (foeOpen && toFoe <= range(s, u)) x += 60; continue; }
      x += (d.attack + d.defense) * 1.2 + d.keywords.length * 0.5 - u.damage * 0.6 + (7 - toFoe) * 0.35;
      const reach = range(s, u);
      if (d.attack > 0 && u.r === 'surface') {
        if (toFoe <= reach) x += foeOpen ? 120 : d.attack * 0.9;                       // can hit the enemy Avatar next
        else if (foeSites.some((c) => steps(s, u, c) <= reach)) x += d.attack * 0.45;   // can hit an enemy site next
      }
    }
    v += sign * x;
  }
  return v;
}

// ---------- shared pieces ----------
/** Legal actions the AI is willing to consider. */
export function aiActions(s: GameState): Action[] {
  return legalActions(s).filter((a) => {
    if (a.t !== 'cast') return true;
    const d = cardOf(s, a.inst);
    if (d.type === 'Minion') return true;
    // text the engine can actually resolve: something it carries out on cast/entry, or an ability it can use later
    return d.effects.some((e) => e.op !== 'manual' && (e.on === (d.type === 'Magic' ? 'cast' : 'genesis') || (d.type !== 'Magic' && e.on !== 'cast')));
  });
}
/** Resolve pending prompts with "no response" so a position can be scored. */
function settle(s: GameState): GameState {
  let g = s; let n = 0;
  while (g.pending && n++ < 4) g = apply(g, g.pending.kind === 'allocate' ? legalActions(g)[0] : { t: 'respond', units: [] });
  return g;
}
function drawChoice(s: GameState, me: PlayerId, acts: Action[]): Action {
  const pl = s.players[me];
  const sitesInHand = pl.hand.filter((i) => cardOf(s, i).type === 'Site').length;
  const mine = sitesOf(s, me).length;
  const spells = pl.hand.map((i) => cardOf(s, i)).filter((c) => c.type !== 'Site');
  const cheapest = Math.min(99, ...spells.map((c) => c.cost));
  // A site only when there is none to play this turn, and only while the hand still holds spells to spend the mana on:
  // drawing a site every turn (and playing it at once) would leave the hand with nothing but what it started with.
  const wantSite = sitesInHand === 0 && pl.atlas.length > 0 && (mine < 2 || (spells.length >= 2 && (mine < 7 || cheapest > mine + 1)) || !pl.spellbook.length);
  return acts.find((a) => a.t === 'draw' && a.deck === (wantSite ? 'atlas' : 'spellbook')) ?? acts[0];
}
function mulliganChoice(s: GameState, me: PlayerId): Action {
  const costly = s.players[me].hand.filter((i) => { const c = cardOf(s, i); return c.type !== 'Site' && c.cost >= 5; });
  return { t: 'mulligan', cards: costly.length >= 2 ? costly.slice(0, 3) : [] };
}
function scored(s: GameState, me: PlayerId, acts: Action[]): { a: Action; v: number }[] {
  const base = evaluate(s, me);
  return acts.map((a) => {
    let v: number;
    try { v = evaluate(settle(apply(s, a)), me); } catch { v = -Infinity; }
    if (a.t === 'endTurn') v = base + 0.05; // baseline: only act when it improves the position
    if (a.t === 'drawSite') v = base + (s.players[me].hand.some((i) => cardOf(s, i).type === 'Site') ? -1 : 1.5);
    if (a.t === 'playSite') v += 2;
    if (a.t === 'move' && !a.attack && v <= base + 0.3) v = base - 0.5; // no shuffling about for nothing
    return { a, v };
  }).sort((x, y) => y.v - x.v);
}
function pickEasy(s: GameState, acts: Action[]): Action {
  const sites = acts.filter((a) => a.t === 'playSite');
  if (sites.length && Math.random() < 0.8) return sites[Math.floor(Math.random() * sites.length)];
  const nonEnd = acts.filter((a) => a.t !== 'endTurn');
  if (!nonEnd.length || (s.phase === 'main' && !s.pending && Math.random() < 0.18)) return acts.find((a) => a.t === 'endTurn') ?? acts[0];
  return nonEnd[Math.floor(Math.random() * nonEnd.length)];
}
/** One-ply greedy choice for whoever must act. Also the opponent model inside the hard search. */
function greedy(s: GameState): Action {
  const me = actor(s); const acts = aiActions(s);
  if (acts.length <= 1) return acts[0];
  if (s.phase === 'mulligan') return mulliganChoice(s, me);
  if (s.phase === 'draw') return drawChoice(s, me, acts);
  return scored(s, me, acts)[0].a;
}

// ---------- hard: determinized turn planning ----------
function shuffleInPlace<T>(a: T[]) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
export function determinize(s: GameState, me: PlayerId): GameState {
  const g = clone(s); g.log = [];
  g.rng = (Math.random() * 2 ** 31) | 0;
  const opp = g.players[other(me)];
  const handSites = opp.hand.filter((i) => cardOf(g, i).type === 'Site');
  const handSpells = opp.hand.filter((i) => cardOf(g, i).type !== 'Site');
  const spells = [...handSpells, ...opp.spellbook]; shuffleInPlace(spells);
  const sites = [...handSites, ...opp.atlas]; shuffleInPlace(sites);
  opp.hand = [...sites.splice(0, handSites.length), ...spells.splice(0, handSpells.length)];
  opp.spellbook = spells; opp.atlas = sites;
  shuffleInPlace(g.players[me].spellbook); shuffleInPlace(g.players[me].atlas);
  return g;
}
/** After my turn ends: let the opponent play a greedy turn (I answer its attacks greedily), then score. */
function afterReply(s: GameState, me: PlayerId): number {
  let g = s;
  for (let n = 0; n < 40 && g.phase !== 'over'; n++) {
    if (!g.pending && g.active === me) break; // back to my turn
    g = apply(g, greedy(g));
  }
  return evaluate(settle(g), me);
}
const key = (a: Action) => JSON.stringify(a);
const BEAM = 5, DEPTH = 9;

/** Search my whole turn in one determinized world. Returns the value of the best line found for each first action. */
function planTurn(root: GameState, me: PlayerId, deadline: number): Map<string, number> {
  type Node = { s: GameState; first: string; h: number };
  const best = new Map<string, number>();
  const leaf = (first: string, ended: GameState) => { const v = afterReply(ended, me); if (v > (best.get(first) ?? -Infinity)) best.set(first, v); };
  let beam: Node[] = [{ s: root, first: '', h: 0 }];
  for (let depth = 0; depth < DEPTH && beam.length; depth++) {
    const next: Node[] = [];
    for (const node of beam) {
      const acts = aiActions(node.s);
      const base = evaluate(node.s, me);
      for (const a of acts) {
        if (performance.now() > deadline && depth > 0) break;
        const first = node.first || key(a);
        let g: GameState;
        try { g = apply(node.s, a); } catch { continue; }
        for (let n = 0; n < 4 && g.pending && g.phase !== 'over'; n++) g = apply(g, greedy(g)); // the defender answers greedily
        if (g.phase === 'over') { const v = evaluate(g, me); if (v > (best.get(first) ?? -Infinity)) best.set(first, v); continue; }
        if (a.t === 'endTurn') { leaf(first, g); continue; }
        if (g.active !== me) continue;
        let h = evaluate(g, me);
        if (a.t === 'playSite') h += 2;
        if (a.t === 'drawSite') h = base + (node.s.players[me].hand.some((i) => cardOf(node.s, i).type === 'Site') ? -1 : 1.5);
        if (a.t === 'move' && !a.attack && h <= base + 0.3) continue;
        next.push({ s: g, first, h });
      }
    }
    next.sort((x, y) => y.h - x.h);
    beam = next.slice(0, BEAM);
    if (performance.now() > deadline) break;
  }
  for (const node of beam) { try { leaf(node.first, apply(node.s, { t: 'endTurn' })); } catch { /* not in main phase */ } }
  return best;
}

export async function chooseAction(s: GameState, level: Difficulty, budgetMs = 700): Promise<Action> {
  const me = actor(s);
  const acts = aiActions(s);
  if (acts.length <= 1 && s.phase !== 'mulligan') return acts[0];
  if (level === 'easy') return s.phase === 'draw' && Math.random() < 0.5 ? drawChoice(s, me, acts) : pickEasy(s, acts);
  if (level === 'medium' || s.pending || s.phase !== 'main') return greedy(s);

  // hard, main phase: plan the turn in a few sampled worlds and take the first step of the best plan
  const total = new Map<string, number>(); const seen = new Map<string, number>();
  const end = performance.now() + budgetMs; let worlds = 0;
  while (worlds < 6 && (worlds === 0 || performance.now() < end)) {
    const plan = planTurn(determinize(s, me), me, worlds === 0 ? end + budgetMs : end);
    for (const [k, v] of plan) { total.set(k, (total.get(k) ?? 0) + v); seen.set(k, (seen.get(k) ?? 0) + 1); }
    worlds++;
    await new Promise((r) => setTimeout(r)); // keep the table responsive
  }
  let bestKey = '', bestV = -Infinity;
  for (const [k, sum] of total) { const v = sum / seen.get(k)! - (worlds - seen.get(k)!) * 0.5; if (v > bestV) { bestV = v; bestKey = k; } }
  return acts.find((a) => key(a) === bestKey) ?? greedy(s);
}
