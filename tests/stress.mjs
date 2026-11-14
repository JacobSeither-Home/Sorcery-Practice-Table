// Stress test: random decks built from a full card list, played AI vs AI, to run every automated effect.
// node tests/stress.mjs <cards.json> [games] [seed]. Not part of `npm test`.
import { createServer } from 'vite'; import fs from 'fs';
const v = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const E = await v.ssrLoadModule('/src/engine/index.ts');
const { chooseAction } = await v.ssrLoadModule('/src/ai/ai.ts');
const pool = {}; for (const c of E.normalizeApiCards(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))).cards) pool[c.id] = c;
const games = +(process.argv[3] ?? 20); let seed = +(process.argv[4] ?? 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const all = Object.values(pool);
const EL = ['air', 'earth', 'fire', 'water'];
function deck() {
  const els = [pick(EL), pick(EL)];
  const ok = (c) => EL.every((e) => !c.thresholds[e] || els.includes(e));
  const spells = all.filter((c) => !['Site', 'Avatar'].includes(c.type) && c.category !== 'Token' && ok(c));
  const sites = all.filter((c) => c.type === 'Site' && c.category !== 'Token' && (EL.every((e) => !c.thresholds[e] || els.includes(e))));
  return { name: els.join('+'), avatar: pick(all.filter((c) => c.type === 'Avatar')).id, spellbook: Array.from({ length: 40 }, () => pick(spells).id), atlas: Array.from({ length: 20 }, () => pick(sites).id),
    collection: Array.from({ length: 5 }, () => pick(spells).id) };
}
const used = new Map(); let errors = 0, finished = 0, stuck = 0;
for (let g = 0; g < games; g++) {
  const decks = [deck(), deck()];
  let s = E.createGame(pool, decks, 7000 + g); let n = 0;
  try {
    while (s.phase !== 'over' && n++ < 1200) {
      const a = await chooseAction(s, n % 3 ? 'easy' : 'medium', 15);
      if (!a) throw new Error(`no legal action (phase ${s.phase}, queue ${s.queue?.length ?? 0}, pending ${!!s.pending})`);
      if (a.t === 'cast' || a.t === 'ability' || a.t === 'trigger') { const inst = a.t === 'cast' ? a.inst : a.t === 'ability' ? E.sourceOf(s, a.src)?.inst : s.queue?.[0]?.inst; if (inst) { const nm = E.cardOf(s, inst).name; used.set(nm, (used.get(nm) ?? 0) + 1); } }
      const before = JSON.stringify(s.players.map((p) => p.life)); globalThis.__lastA = a;
      s = E.apply(s, a);
      for (const u of Object.values(s.units)) if (!s.inst[u.inst]) throw new Error('unit without a card');
      if (s.players.some((p) => !Number.isFinite(p.life) || !Number.isFinite(p.mana) || p.mana < -20)) throw new Error('bad life/mana after ' + JSON.stringify(a) + ' ' + before);
    }
    if (s.phase === 'over') finished++; else stuck++;
  } catch (e) { errors++; console.log(`game ${g} ERROR after ${n}:`, e.message, globalThis.__lastA ? JSON.stringify(globalThis.__lastA).slice(0, 300) : "", globalThis.__lastA && (globalThis.__lastA.t === "trigger" ? E.cardOf(s, s.queue[0].inst).name : globalThis.__lastA.t === "ability" ? E.cardOf(s, E.sourceOf(s, globalThis.__lastA.src).inst).name : globalThis.__lastA.inst ? E.cardOf(s, globalThis.__lastA.inst).name : ""), '\n   last:', s.log.slice(-3).map((l) => l.text).join(' | ')); }
}
console.log({ games, finished, unfinished: stuck, errors, distinctCardsUsedWithText: used.size });
await v.close();
