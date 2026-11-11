import type { CardDef, CardType, Effect } from './types';

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


// ---- reading simple rules text ----
// Card text is far too varied to interpret in general (checked against the API on 2026-11-10: of
// about 1,100 cards, nearly every text is unique). This reads only the handful of sentences whose
// meaning is unambiguous, and only when that sentence is the card's ENTIRE text apart from keyword
// lines. Anything else is left for the manual tools. Hand-entered effects always take precedence.
const KEYWORD_LINE = /^(Airborne|Burrowing|Charge|Deathrite|Disabled|Flood|Genesis|Immobile|Lance|Landbound|Lethal|Movement|Ranged|Spellcaster|Stealth|Submerge|Voidwalk|Ward|Waterbound)(\s*\+?\s*\d+)?$/i;
const COUNT: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4 };
export function effectsFromText(type: CardType, rules: string): Effect[] {
  const lines = rules.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !l.split(/,\s*/).every((part) => KEYWORD_LINE.test(part.trim())));
  if (lines.length !== 1) return [];
  const line = lines[0].replace(/\s+/g, ' ').replace(/->/g, '→');
  let on: Effect['on'] = 'cast'; let body = line;
  const trig = line.match(/^(Genesis|Deathrite) → (.+)$/i);
  if (trig) { on = trig[1].toLowerCase() as Effect['on']; body = trig[2]; }
  else if (type !== 'Magic') return []; // a plain sentence on a permanent is a static ability, not an event
  const rangeOf = (a?: string, b?: string): Effect['range'] => (/adjacent/i.test(`${a} ${b}`) ? 'adjacent' : /nearby/i.test(`${a} ${b}`) ? 'nearby' : 'any');
  let m: RegExpMatchArray | null;
  if ((m = body.match(/^Deal (\d+) damage to target (nearby |adjacent )?(unit|minion)( nearby| adjacent)?\.$/i)) && on !== 'deathrite')
    return [{ on, op: 'damage', n: +m[1], who: 'target', range: rangeOf(m[2], m[4]), ...(m[3].toLowerCase() === 'minion' ? { only: 'minion' as const } : {}), auto: true }];
  if ((m = body.match(/^(?:Destroy|Kill) target (nearby |adjacent )?minion( nearby| adjacent)?\.$/i)) && on !== 'deathrite')
    return [{ on, op: 'destroy', who: 'target', range: rangeOf(m[1], m[2]), only: 'minion', auto: true }];
  if ((m = body.match(/^Draw (a|one|two|three|four|\d+) (spell|site)s?\.$/i)))
    return [{ on, op: 'draw', n: COUNT[m[1].toLowerCase()] ?? +m[1], who: 'controller', deck: m[2].toLowerCase() === 'site' ? 'atlas' : 'spellbook', auto: true }];
  // "①" style mana symbols are the circled digits U+2460..
  const mana = (x: string) => (/^\d+$/.test(x) ? +x : x.charCodeAt(0) - 0x245f);
  if (on === 'genesis' && (m = body.match(/^If this is the only .+ you control, gain ([\u2460-\u2473]|\(?\d+\)?) this turn\.$/i)))
    return [{ on, op: 'mana', n: mana(m[1].replace(/[()]/g, '')), who: 'controller', cond: 'onlyCopy', auto: true }];
  if (on === 'genesis' && (m = body.match(/^Each nearby Avatar heals (\d+) life\.$/i))) return [{ on, op: 'heal', n: +m[1], who: 'nearbyAvatars', auto: true }];
  if ((m = body.match(/^(?:You )?gain (\d+) life\.$/i))) return [{ on, op: 'heal', n: +m[1], who: 'controller', auto: true }];
  return [];
}

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
      subtypes: arr(e.subtypes),
      keywords,
      movement: keywords.includes('Movement') ? Math.max(1, keywordNumber(rules, 'Movement')) : 0,
      ranged: keywords.includes('Ranged') ? Math.max(1, keywordNumber(rules, 'Ranged')) : 0,
      typeline: str(first?.meta?.typeline),
      printings: printingsRaw.map((p) => { const meta = (p?.meta ?? {}) as Record<string, unknown>; return { slug: str(p?.slug), set: str((p?.set as Record<string, unknown> | undefined)?.name), finish: str(meta.finish) || undefined, product: str(meta.product) || undefined }; }).filter((p) => p.slug),
      source: 'api',
      effects: overlays[id] ?? overlays[slug] ?? effectsFromText(type, rules),
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
    typeline: p.typeline ?? '', printings: p.printings ?? [], source: p.source ?? 'custom', effects: p.effects ?? [],
  };
}
