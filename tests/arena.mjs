// AI strength check: node tests/arena.mjs [games] [budgetMs]. Not part of `npm test`.
import { createServer } from 'vite';
const v = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { createGame, apply, actor } = await v.ssrLoadModule('/src/engine/index.ts');
const { chooseAction } = await v.ssrLoadModule('/src/ai/ai.ts');
const { PRACTICE_CARDS, PRACTICE_DECKS } = await v.ssrLoadModule('/tests/fixtures/practiceSet.ts');
const cards = Object.fromEntries(PRACTICE_CARDS.map((c) => [c.id, c]));
const games = +(process.argv[2] ?? 10), budget = +(process.argv[3] ?? 60);
async function match(a, b) {
  let wins = 0, draws = 0, turns = 0;
  for (let g = 0; g < games; g++) {
    const flip = g % 2 === 1; const levels = flip ? [b, a] : [a, b];
    const decks = (g >> 1) % 2 ? [PRACTICE_DECKS[1], PRACTICE_DECKS[0]] : [PRACTICE_DECKS[0], PRACTICE_DECKS[1]];
    let s = createGame(cards, decks, 1000 + g, g % 4 < 2 ? 0 : 1); let n = 0;
    while (s.phase !== 'over' && n++ < 3000) s = apply(s, await chooseAction(s, levels[actor(s)], budget));
    turns += s.turn;
    if (s.winner === null) draws++; else if ((s.winner === 0) !== flip) wins++;
  }
  console.log(`${a} vs ${b}: ${a} won ${wins}/${games}, unfinished ${draws}, avg turns ${(turns / games).toFixed(1)}`);
}
const t = Date.now();
await match('medium', 'easy'); await match('hard', 'easy'); await match('hard', 'medium');
console.log('seconds', ((Date.now() - t) / 1000).toFixed(0)); await v.close();
