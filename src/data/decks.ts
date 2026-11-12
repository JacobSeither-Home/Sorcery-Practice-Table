import type { CardDef, DeckList } from '../engine';

const LIMIT: Record<string, number> = { Ordinary: 4, Exceptional: 3, Elite: 2, Unique: 1 };
/** Constructed-format notes (60+ spells, 30+ sites, copies by rarity). Notes never block play. */
export function deckNotes(d: DeckList, cards: Record<string, CardDef>): string[] {
  const out: string[] = [];
  if (!cards[d.avatar]) out.push('Choose an Avatar.');
  if (d.spellbook.length < 60) out.push(`Spellbook has ${d.spellbook.length} cards; constructed decks have at least 60.`);
  if (d.atlas.length < 30) out.push(`Atlas has ${d.atlas.length} sites; constructed decks have at least 30.`);
  if ((d.collection?.length ?? 0) > 10) out.push(`The collection has ${d.collection!.length} cards; constructed play allows up to 10.`);
  const n = new Map<string, number>();
  for (const id of [...d.spellbook, ...d.atlas, ...(d.collection ?? [])]) n.set(id, (n.get(id) ?? 0) + 1);
  for (const [id, k] of n) {
    const c = cards[id];
    if (!c) { out.push(`Unknown card "${id}" (not in the current card pool).`); continue; }
    const lim = LIMIT[c.rarity ?? ''] ?? 4;
    if (k > lim) out.push(`${k} copies of ${c.name}; ${c.rarity ?? 'Ordinary'} cards are limited to ${lim}.`);
  }
  return out;
}
export const playable = (d: DeckList, cards: Record<string, CardDef>) =>
  !!cards[d.avatar] && d.spellbook.length >= 10 && d.atlas.length >= 6 && [...d.spellbook, ...d.atlas].every((id) => cards[id]);

/** Parse a pasted list: one card per line, "4 Card Name" or "4x Card Name" or just "Card Name". */
export function parseDeckText(text: string, cards: Record<string, CardDef>, name: string): { deck: DeckList; unknown: string[] } {
  const byName = new Map(Object.values(cards).map((c) => [c.name.toLowerCase(), c]));
  const deck: DeckList = { name, avatar: '', spellbook: [], atlas: [] }; const unknown: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(?:(\d+)\s*x?\s+)?(.+?)$/i);
    if (!m || !m[2] || /^(avatar|spellbook|atlas|sites?|spells?|minions?|magics?|auras?|artifacts?)\b.*[:(]?\s*\d*\)?:?$/i.test(m[2])) continue;
    const c = byName.get(m[2].toLowerCase());
    if (!c) { unknown.push(m[2]); continue; }
    const k = parseInt(m[1] ?? '1', 10);
    if (c.type === 'Avatar') deck.avatar = c.id;
    else for (let i = 0; i < k; i++) (c.type === 'Site' ? deck.atlas : deck.spellbook).push(c.id);
  }
  return { deck, unknown };
}
