// Rules coverage for a card list: node tests/coverage.mjs <cards.json> [out-dir]. Not part of `npm test`.
// cards.json is the response of GET https://api.sorcerytcg.com/api/cards (Settings → Card Sync writes it
// to the cards folder). It is never committed to this repository. Writes shapes.tsv (unread wordings,
// most common first) and open.tsv (every card that is not fully automated) to out-dir when given.
import { createServer } from 'vite';
import fs from 'fs';
const [file, out] = process.argv.slice(2);
if (!file) { console.error('usage: node tests/coverage.mjs <cards.json> [out-dir]'); process.exit(1); }
const v = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const E = await v.ssrLoadModule('/src/engine/index.ts');
const { cards } = E.normalizeApiCards(JSON.parse(fs.readFileSync(file, 'utf8')));
const rep = E.analyzeCards(cards);
console.log(`${rep.total} cards:`, rep.counts);
const byType = {}; for (const c of rep.cards) { byType[c.type] ??= {}; byType[c.type][c.status] = (byType[c.type][c.status] ?? 0) + 1; }
console.table(byType);
console.table(rep.byCategory.map((c) => ({ type: c.category, automated: c.auto, byHand: c.manual })));
console.log('Most common unread wordings:'); for (const s of rep.shapes.slice(0, 25)) console.log(`  ${s.count}× ${s.shape}`);
if (out) {
  fs.writeFileSync(`${out}/shapes.tsv`, rep.shapes.map((s) => [s.count, s.category, s.shape, s.examples.join(', ')].join('\t')).join('\n'));
  fs.writeFileSync(`${out}/open.tsv`, rep.cards.filter((c) => c.status === 'partial' || c.status === 'manual').map((c) => [c.name, c.type, c.status, c.manual.join(' | '), c.rules.replace(/\s+/g, ' ')].join('\t')).join('\n'));
}
await v.close();
