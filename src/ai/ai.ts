// AI opponent. Three tiers:
//  easy   — mostly random legal actions, with a nudge toward developing sites
//  medium — one-ply greedy on a board evaluation
//  hard   — Monte Carlo lookahead over determinized worlds. It never reads the opponent's hand or
//           either deck's order: before every playout the hidden cards are reshuffled, so the search
//           only uses what a human at the table could know (public board, own hand, cards not yet seen).
import { type Action, type GameState, type PlayerId, actor, apply, cardOf, clone, legalActions, other, sitesOf, unitCard, xy } from '../engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

export function evaluate(s: GameState, me: PlayerId): number {
  if (s.winner !== null) return s.winner === me ? 10000 : -10000;
  let v = 0;
  for (const p of [0, 1] as PlayerId[]) {
    const sign = p === me ? 1 : -1;
    const pl = s.players[p];
    let x = pl.life * 2 + (pl.deathsDoor ? -30 : 0) + sitesOf(s, p).length * 4 + pl.hand.length * 0.8;
    const foe = s.units[s.players[other(p)].avatar];
    const [fx, fy] = xy(foe.c);
    for (const u of Object.values(s.units)) {
      if (u.owner !== p || u.avatar) continue;
      const d = unitCard(s, u);
      const [ux, uy] = xy(u.c);
      x += (d.attack + d.defense) * 1.2 + d.keywords.length * 0.5 - u.damage * 0.6 + (7 - Math.abs(ux - fx) - Math.abs(uy - fy)) * 0.35;
    }
    v += sign * x;
  }
  return v;
}

/** Resolve a pending prompt with "no response" so a position can be scored. */
function settle(s: GameState): GameState {
  let g = s; let n = 0;
  while (g.pending && n++ < 4) g = apply(g, { t: 'respond', units: [] });
  return g;
}

function pickEasy(s: GameState, acts: Action[]): Action {
  const sites = acts.filter((a) => a.t === 'playSite');
  if (sites.length && Math.random() < 0.8) return sites[Math.floor(Math.random() * sites.length)];
  const nonEnd = acts.filter((a) => a.t !== 'endTurn');
  if (!nonEnd.length || (s.phase === 'main' && !s.pending && Math.random() < 0.18)) return acts.find((a) => a.t === 'endTurn') ?? acts[0];
  return nonEnd[Math.floor(Math.random() * nonEnd.length)];
}

function drawChoice(s: GameState, me: PlayerId, acts: Action[]): Action {
  const pl = s.players[me];
  const sitesInHand = pl.hand.filter((i) => cardOf(s, i).type === 'Site').length;
  const wantSite = sitesInHand === 0 && sitesOf(s, me).length < 7;
  return acts.find((a) => a.t === 'draw' && a.deck === (wantSite ? 'atlas' : 'spellbook')) ?? acts[0];
}

function scored(s: GameState, me: PlayerId, acts: Action[]): { a: Action; v: number }[] {
  return acts.map((a) => {
    let v: number;
    try { v = evaluate(settle(apply(s, a)), me); } catch { v = -Infinity; }
    if (a.t === 'endTurn') v = evaluate(s, me) + 0.05; // baseline: only act when it improves the position
    if (a.t === 'drawSite') v = evaluate(s, me) + (s.players[me].hand.some((i) => cardOf(s, i).type === 'Site') ? -1 : 1.5);
    if (a.t === 'playSite') v += 2;
    return { a, v };
  }).sort((x, y) => y.v - x.v);
}

function pickMedium(s: GameState, me: PlayerId, acts: Action[]): Action {
  if (s.phase === 'draw') return drawChoice(s, me, acts);
  return scored(s, me, acts)[0].a;
}

// ---- hard: determinized Monte Carlo ----
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
function rolloutPick(s: GameState, acts: Action[]): Action {
  if (acts.length === 1) return acts[0];
  let total = 0;
  const w = acts.map((a) => {
    const x = a.t === 'playSite' ? 8 : a.t === 'cast' ? 6 : a.t === 'move' ? (a.attack ? 5 : 1) : a.t === 'shoot' ? 5 : a.t === 'endTurn' ? 1.2 : a.t === 'drawSite' ? 0.6 : 1;
    total += x; return x;
  });
  let r = Math.random() * total;
  for (let i = 0; i < acts.length; i++) { r -= w[i]; if (r <= 0) return acts[i]; }
  return acts[acts.length - 1];
}
function playout(s: GameState, me: PlayerId): number {
  let g = s; const stopTurn = g.turn + 2;
  for (let n = 0; n < 80 && g.phase !== 'over' && g.turn < stopTurn; n++) {
    const acts = legalActions(g);
    if (!acts.length) break;
    g = apply(g, rolloutPick(g, acts));
  }
  return evaluate(settle(g), me);
}

export async function chooseAction(s: GameState, level: Difficulty, budgetMs = 650): Promise<Action> {
  const me = actor(s);
  const acts = legalActions(s);
  if (acts.length <= 1) return acts[0];
  if (level === 'easy') return s.phase === 'draw' && Math.random() < 0.5 ? drawChoice(s, me, acts) : pickEasy(s, acts);
  if (level === 'medium' || s.phase === 'draw') return pickMedium(s, me, acts);
  const cands = scored(s, me, acts).filter((x) => x.v > -Infinity).slice(0, 10);
  if (cands.length === 1) return cands[0].a;
  const sum = cands.map(() => 0), cnt = cands.map(() => 0);
  const end = performance.now() + budgetMs; let slice = performance.now() + 14; let i = 0;
  while (performance.now() < end) {
    const k = i++ % cands.length;
    try { sum[k] += playout(apply(determinize(s, me), cands[k].a), me); cnt[k]++; } catch { /* action illegal in this world */ }
    if (performance.now() > slice) { await new Promise((r) => setTimeout(r)); slice = performance.now() + 14; }
  }
  let best = 0, bestV = -Infinity;
  cands.forEach((c, k) => { const v = cnt[k] ? sum[k] / cnt[k] + c.v * 0.15 : -Infinity; if (v > bestV) { bestV = v; best = k; } });
  return cands[best].a;
}
