import type { CardDef, DeckList } from '../engine';

/** Copies of one card allowed in a constructed deck, by the rarity the card API reports. */
export const RARITY_LIMIT: Record<string, number> = { Ordinary: 4, Exceptional: 3, Elite: 2, Unique: 1 };
export const RARITIES = ['Ordinary', 'Exceptional', 'Elite', 'Unique'] as const;
const LIMIT = RARITY_LIMIT;
/** Cards with no rarity in the data (none seen so far) are treated like Ordinary. */
/** Copies allowed by rarity (rulebook p33-p35: Ordinary 4, Exceptional 3, Elite 2, Unique 1), unless the card itself says
 *  "Your spellbook may include any number of …" (Grey Wolves, Relentless Crowd): card text takes precedence (p5). */
export const anyNumber = (c: CardDef | undefined) => !!c && /your (?:spellbook|deck) may include any number of/i.test(c.rules);
export const copyLimit = (c: CardDef | undefined) => (anyNumber(c) ? Infinity : RARITY_LIMIT[c?.rarity ?? ''] ?? 4);
/** Copies of a card across spellbook, atlas and collection: the copy limit is counted over all three here. */
export const copiesOf = (d: DeckList, id: string) => [...d.spellbook, ...d.atlas, ...(d.collection ?? [])].filter((x) => x === id).length;
export const SPELLBOOK_MIN = 60, ATLAS_MIN = 30, COLLECTION_MAX = 10;

export interface DeckCheck { label: string; ok: boolean; detail: string }
/** The constructed-format checklist shown in the deck builder. */
export function deckChecks(d: DeckList, cards: Record<string, CardDef>): DeckCheck[] {
  const col = d.collection ?? [];
  const n = new Map<string, number>();
  for (const id of [...d.spellbook, ...d.atlas, ...col]) n.set(id, (n.get(id) ?? 0) + 1);
  const over = [...n].filter(([id, k]) => cards[id] && k > copyLimit(cards[id])).map(([id, k]) => `${cards[id].name} ${k}/${copyLimit(cards[id])} (${cards[id].rarity ?? 'no rarity'})`);
  const unknown = [...n.keys()].filter((id) => !cards[id]);
  const wrongPile = [...d.spellbook.filter((id) => cards[id]?.type === 'Site' || cards[id]?.type === 'Avatar'), ...d.atlas.filter((id) => cards[id] && cards[id].type !== 'Site')];
  return [
    { label: 'One Avatar', ok: cards[d.avatar]?.type === 'Avatar', detail: cards[d.avatar]?.name ?? 'none chosen' },
    { label: `Spellbook of at least ${SPELLBOOK_MIN}`, ok: d.spellbook.length >= SPELLBOOK_MIN, detail: `${d.spellbook.length} spells` },
    { label: `Atlas of at least ${ATLAS_MIN}`, ok: d.atlas.length >= ATLAS_MIN, detail: `${d.atlas.length} sites` },
    { label: 'Copies within rarity limits', ok: !over.length, detail: over.length ? over.join(', ') : 'Ordinary 4, Exceptional 3, Elite 2, Unique 1' },
    { label: `Collection of at most ${COLLECTION_MAX}`, ok: col.length <= COLLECTION_MAX, detail: `${col.length} cards` },
    ...(wrongPile.length ? [{ label: 'Spells in the spellbook, sites in the atlas', ok: false, detail: [...new Set(wrongPile)].map((id) => cards[id].name).join(', ') }] : []),
    ...(unknown.length ? [{ label: 'Every card is in your card pool', ok: false, detail: `${unknown.length} not found` }] : []),
  ];
}
export const constructedLegal = (d: DeckList, cards: Record<string, CardDef>) => deckChecks(d, cards).every((c) => c.ok);
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

/**
 * Parse a pasted list: one card per line, "4 Card Name", "4x Card Name" or just "Card Name".
 * A line that is only a section name ("Collection", "Sideboard", "Atlas (30)", "Spellbook:") switches
 * where the following cards go. Outside a collection section, sites go to the atlas, Avatars become
 * the Avatar, and everything else goes to the spellbook.
 */
export function parseDeckText(text: string, cards: Record<string, CardDef>, name: string): { deck: DeckList; unknown: string[] } {
  const byName = new Map(Object.values(cards).map((c) => [c.name.toLowerCase(), c]));
  const deck: DeckList = { name, avatar: '', spellbook: [], atlas: [], collection: [] }; const unknown: string[] = [];
  let inCollection = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim(); if (!line) continue;
    const head = line.match(/^(avatar|spellbook|atlas|collection|sideboard|side ?deck|maybeboard|sites?|spells?|minions?|magics?|auras?|artifacts?)\b\s*[:(]?\s*\d*\s*\)?:?$/i);
    if (head && !byName.has(line.toLowerCase())) { inCollection = /^(collection|sideboard|side ?deck|maybeboard)/i.test(head[1]); continue; }
    const m = line.match(/^(?:(\d+)\s*x?\s+)?(.+?)$/i);
    if (!m || !m[2]) continue;
    const c = byName.get(m[2].toLowerCase());
    if (!c) { unknown.push(m[2]); continue; }
    const k = parseInt(m[1] ?? '1', 10);
    if (inCollection) { if (c.type !== 'Avatar') for (let i = 0; i < k; i++) deck.collection!.push(c.id); }
    else if (c.type === 'Avatar') deck.avatar = c.id;
    else for (let i = 0; i < k; i++) (c.type === 'Site' ? deck.atlas : deck.spellbook).push(c.id);
  }
  if (!deck.collection!.length) delete deck.collection;
  return { deck, unknown };
}
