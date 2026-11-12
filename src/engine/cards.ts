import type { CardDef, CardType, Effect } from './types';
import { readRules } from './phrases';

// Field names taken from the CardAPIDTO schema published on api.sorcerytcg.com (read 2026-11-10).
// The API states that fields can change without notice, so everything here is defensive:
// unknown fields are reported, missing fields get safe defaults, nothing throws.
const KNOWN_TOP = ['id', 'name', 'slug', 'engine', 'printings'];
const KNOWN_ENGINE = ['type', 'category', 'rarity', 'slot', 'rules', 'cost', 'attack', 'defense', 'life',
  'water', 'earth', 'fire', 'air', 'elements', 'subtypes', 'keywords', 'umbrellas', 'back'];
const KNOWN_PRINTING = ['id', 'slug', 'printedAt', 'set', 'meta'];
const TYPES: CardType[] = ['Avatar', 'Minion', 'Magic', 'Aura', 'Artifact', 'Site'];

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** "Movement +2" / "Ranged 2" carry their number in the rules text; the keyword array only has the bare word. */
export function keywordNumber(rules: string, word: 'Movement' | 'Ranged'): number {
  const m = rules.match(word === 'Movement' ? /Movement\s*\+\s*(\d+)/i : /Ranged\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}


// ---- reading rules text ----
// The phrase rules live in phrases.ts. Every sentence that matches a known phrase becomes an effect;
// every other sentence becomes a `manual` effect that the cast pop-up offers to resolve by hand.
// Hand-entered effects (Card library) always take precedence.
export function effectsFromText(type: CardType, rules: string, name = ''): Effect[] { return readRules(type, rules, name).effects; }

export interface NormalizeReport { cards: CardDef[]; unknownFields: string[]; skipped: string[] }

export function normalizeApiCards(raw: unknown, overlays: Record<string, Effect[]> = {}): NormalizeReport {
  const unknown = new Set<string>();
  const skipped: string[] = [];
  const cards: CardDef[] = [];
  if (!Array.isArray(raw)) return { cards, unknownFields: ['(response is not an array)'], skipped };
  for (const item of raw) {
    if (!item || typeof item !== 'object') { skipped.push('(non-object entry)'); continue; }
    const o = item as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!KNOWN_TOP.includes(k)) unknown.add(k);
    const e = (o.engine && typeof o.engine === 'object' ? o.engine : {}) as Record<string, unknown>;
    for (const k of Object.keys(e)) if (!KNOWN_ENGINE.includes(k)) unknown.add('engine.' + k);
    const name = str(o.name);
    const type = str(e.type) as CardType;
    if (!name || !TYPES.includes(type)) {
      if (name && str(e.type)) unknown.add('engine.type=' + str(e.type));
      skipped.push(name || '(unnamed)');
      continue;
    }
    const rules = str(e.rules);
    const keywords = arr(e.keywords);
    const printingsRaw = Array.isArray(o.printings) ? (o.printings as Record<string, unknown>[]) : [];
    for (const p of printingsRaw) if (p && typeof p === 'object') for (const k of Object.keys(p)) if (!KNOWN_PRINTING.includes(k)) unknown.add('printings.' + k);
    const first = printingsRaw[0] as { meta?: { typeline?: unknown } } | undefined;
    const slug = str(o.slug) || slugify(name);
    const id = str(o.id) || slug;
    cards.push({
      id, name, slug, type,
      rarity: str(e.rarity) || null,
      rules,
      cost: num(e.cost), attack: num(e.attack), defense: num(e.defense), life: num(e.life),
      thresholds: { air: num(e.air), earth: num(e.earth), fire: num(e.fire), water: num(e.water) },
      subtypes: [...arr(e.subtypes), ...arr(e.umbrellas)],
      keywords,
      movement: keywords.includes('Movement') ? Math.max(1, keywordNumber(rules, 'Movement')) : 0,
      ranged: keywords.includes('Ranged') ? Math.max(1, keywordNumber(rules, 'Ranged')) : 0,
      typeline: str(first?.meta?.typeline),
      printings: printingsRaw.map((p) => { const meta = (p?.meta ?? {}) as Record<string, unknown>; return { slug: str(p?.slug), set: str((p?.set as Record<string, unknown> | undefined)?.name), finish: str(meta.finish) || undefined, product: str(meta.product) || undefined }; }).filter((p) => p.slug),
      source: 'api', category: str(e.category) || undefined,
      effects: overlays[id] ?? overlays[slug] ?? effectsFromText(type, rules, name),
    });
  }
  return { cards, unknownFields: [...unknown].sort(), skipped };
}

/** Helper for the practice set, tests, and custom cards. */
export function makeCard(p: Partial<CardDef> & { name: string; type: CardType }): CardDef {
  const slug = p.slug ?? slugify(p.name);
  const rules = p.rules ?? '';
  const keywords = p.keywords ?? [];
  return {
    id: p.id ?? slug, slug, name: p.name, type: p.type, rarity: p.rarity ?? 'Ordinary', rules,
    cost: p.cost ?? 0, attack: p.attack ?? 0, defense: p.defense ?? p.attack ?? 0, life: p.life ?? 0,
    thresholds: { air: 0, earth: 0, fire: 0, water: 0, ...(p.thresholds ?? {}) },
    subtypes: p.subtypes ?? [], keywords,
    movement: p.movement ?? (keywords.includes('Movement') ? Math.max(1, keywordNumber(rules, 'Movement')) : 0),
    ranged: p.ranged ?? (keywords.includes('Ranged') ? Math.max(1, keywordNumber(rules, 'Ranged')) : 0),
    typeline: p.typeline ?? '', printings: p.printings ?? [], source: p.source ?? 'custom', effects: p.effects ?? [], ...(p.category ? { category: p.category } : {}),
  };
}
