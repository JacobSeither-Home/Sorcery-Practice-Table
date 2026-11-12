// After a Card Sync: what the rules engine automates, a wishlist entry (with a ready-to-use Claude Code
// prompt) when cards arrive that it does not fully handle, and a copy of the cards in a folder the
// player chose on their own disk.
import { type CardDef, type CoverageReport, analyzeCards } from '../engine';
import { db } from './db';
import { type FeedbackItem, type Remote, submit } from '../feedback/feedback';

export const REPO = 'JacobSeither-Home/Sorcery-Practice-Table';
export const apiCards = (pool: Record<string, CardDef>) => Object.values(pool).filter((c) => c.source === 'api');
export const coverage = (pool: Record<string, CardDef>): CoverageReport => analyzeCards(apiCards(pool));

/** The prompt a Claude Code session can start from. Self-contained: it names where the card text is. */
export function claudePrompt(rep: CoverageReport, fresh: string[], catalog: boolean): string {
  const open = rep.cards.filter((c) => c.status === 'partial' || c.status === 'manual');
  const shapes = rep.shapes.slice(0, 30).map((s) => `- (${s.count}×, ${s.category}) ${s.shape}  — e.g. ${s.examples.join(', ')}`).join('\n');
  return `Claude Code task for the repository ${REPO}: implement the card rules that the latest Card Sync found the rules engine does not fully automate.

Counts after this sync: ${rep.total} cards; ${rep.counts.auto} fully automated, ${rep.counts.plain} keywords only, ${rep.counts.partial} partly automated, ${rep.counts.manual} resolved by hand. ${fresh.length} of the not-fully-automated cards are new since the last report: ${fresh.slice(0, 40).join(', ')}${fresh.length > 40 ? ', …' : ''}.

Where the card text is: ${catalog ? 'the Supabase table public.card_catalog in the project "sorcery-practice-table" (columns name, type, rules, status, unmatched, categories, sets). For example: select name, type, rules, unmatched from public.card_catalog where status in (\'partial\',\'manual\') order by name;' : 'this wishlist entry\'s context (field "cards"); the Card Sync ran without a signed-in account, so public.card_catalog was not updated.'}

How the rules are implemented (read docs/HANDOFF.md and docs/RULES_COVERAGE.md first):
1. src/engine/phrases.ts reads each sentence of card text with the RULES list. A new phrasing usually needs one more entry there (a regex and a builder returning Effects).
2. src/engine/rules.ts resolve() carries out each Effect op. Add an op only when no existing op fits; manual ops in the cast pop-up (src/ui/CastModal.tsx) cover what stays by hand.
3. Add a test per new phrase in tests/engine.test.ts, run npm test, and update docs/RULES_COVERAGE.md.
4. Phrase rules apply to every card with the same wording, so start with the most common shapes:
${shapes}

${open.length} cards are open in total. Work through them by category, most common shape first.`;
}

/** Make a wishlist entry when this sync brought cards the engine does not fully handle that were not reported before. */
export async function reportGaps(rep: CoverageReport, remote: Remote | null, by: string | null, catalog: boolean): Promise<{ item: FeedbackItem | null; fresh: number }> {
  const open = rep.cards.filter((c) => c.status === 'partial' || c.status === 'manual');
  const seen = new Set((await db.get<string[]>('coverage:reported')) ?? []);
  const fresh = open.filter((c) => !seen.has(c.id));
  if (!fresh.length) return { item: null, fresh: 0 };
  const sets = [...new Set(fresh.flatMap((c) => c.sets))].slice(0, 6);
  const items = await submit({
    kind: 'wish',
    title: `Card rules to implement: ${fresh.length} card${fresh.length > 1 ? 's' : ''} not fully automated${sets.length ? ` (${sets.join(', ')})` : ''}`,
    details: claudePrompt(rep, fresh.map((c) => c.name), catalog),
    submitted_by: by,
    context: {
      kind: 'card-coverage', counts: rep.counts, shapes: rep.shapes.slice(0, 60),
      cards: fresh.slice(0, 400).map((c) => ({ name: c.name, type: c.type, sets: c.sets, status: c.status, unmatched: c.manual, ...(catalog ? {} : { rules: c.rules }) })),
    },
  }, remote).catch(() => null);
  await db.set('coverage:reported', [...seen, ...fresh.map((c) => c.id)]);
  return { item: items?.[0] ?? null, fresh: fresh.length };
}

// ---- the cards folder on the player's own disk (like the art folder) ----
export const supportsSaveFolder = () => 'showDirectoryPicker' in window;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dir = any;
export async function rememberedCardFolder(): Promise<string | null> { const d: Dir = await db.get('cards:folder'); return d?.name ?? null; }
export async function pickCardFolder(): Promise<string> {
  const dir: Dir = await (window as unknown as { showDirectoryPicker: (o: object) => Promise<Dir> }).showDirectoryPicker({ id: 'sorcery-cards', mode: 'readwrite' });
  await db.set('cards:folder', dir);
  return dir.name;
}
const csv = (v: unknown) => { const t = Array.isArray(v) ? v.join('; ') : String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export function cardsCsv(cards: CardDef[], rep: CoverageReport): string {
  const by = new Map(rep.cards.map((c) => [c.id, c]));
  const head = ['name', 'type', 'cost', 'air', 'earth', 'fire', 'water', 'attack', 'defense', 'life', 'keywords', 'subtypes', 'sets', 'rules', 'automation', 'not automated', 'ability types'];
  const rows = [...cards].sort((a, b) => a.name.localeCompare(b.name)).map((c) => { const k = by.get(c.id); return [c.name, c.type, c.cost, c.thresholds.air, c.thresholds.earth, c.thresholds.fire, c.thresholds.water, c.attack, c.defense, c.life, c.keywords, c.subtypes, k?.sets ?? [], c.rules, k?.status ?? '', k?.manual ?? [], k?.categories ?? []].map(csv).join(','); });
  return [head.join(','), ...rows].join('\n');
}
export function coverageMarkdown(rep: CoverageReport, at: string): string {
  return `# Rules coverage (${at})

${rep.total} cards: ${rep.counts.auto} automated, ${rep.counts.plain} keywords only, ${rep.counts.partial} partly automated, ${rep.counts.manual} by hand.

## Ability types

| Type | Automated | By hand |
|---|---:|---:|
${rep.byCategory.map((c) => `| ${c.category} | ${c.auto} | ${c.manual} |`).join('\n')}

## Most common sentences not automated yet

${rep.shapes.slice(0, 80).map((s) => `- ${s.count}× (${s.category}) ${s.shape} — ${s.examples.join(', ')}`).join('\n')}
`;
}
/** Write cards.json, cards-text.csv and coverage.md to the remembered folder. Asks for permission when needed (needs a click). */
export async function saveToCardFolder(raw: unknown, cards: CardDef[], rep: CoverageReport, ask: boolean): Promise<string | null> {
  const dir: Dir = await db.get('cards:folder'); if (!dir) return null;
  let perm = await dir.queryPermission?.({ mode: 'readwrite' });
  if (perm !== 'granted' && ask) perm = await dir.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') return null;
  const at = new Date().toISOString();
  const put = async (name: string, text: string) => { const f = await dir.getFileHandle(name, { create: true }); const w = await f.createWritable(); await w.write(text); await w.close(); };
  await put('cards.json', JSON.stringify(raw, null, 1));
  await put('cards-text.csv', cardsCsv(cards, rep));
  await put('coverage.md', coverageMarkdown(rep, at));
  return dir.name;
}
/** Browsers without folder access: download the same files one by one. */
export function download(name: string, text: string, type = 'application/json') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
