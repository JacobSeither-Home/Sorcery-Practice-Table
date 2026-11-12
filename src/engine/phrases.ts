// The card-text reader. Every card's rules text is split into lines and sentences, and each sentence is
// matched against the phrase rules below. A sentence that matches becomes an Effect the engine carries
// out; a sentence that does not becomes a `manual` entry, which the cast pop-up shows next to the hand
// tools so the player can resolve it. Nothing here is per-card: a new set is covered automatically as
// long as its cards use phrasing these rules already know. `analyzeCards` reports what is and is not
// covered, grouped by ability type, so new phrasing shows up after a Card Sync.
//
// Source of the phrasing: written from the card-text shapes the engine already read (cards.ts, checked
// against the API on 2026-11-10) and general Sorcery wording. Any rule here that turns out not to match
// real card text simply never fires; the coverage report shows what is left.
import type { CardDef, CardType, Effect, Trigger, Who } from './types';

export const KEYWORDS = ['Airborne', 'Burrowing', 'Charge', 'Deathrite', 'Disabled', 'Flood', 'Genesis', 'Immobile', 'Lance', 'Landbound', 'Lethal', 'Movement', 'Ranged', 'Spellcaster', 'Stealth', 'Submerge', 'Voidwalk', 'Ward', 'Waterbound'];
const KEYWORD_LINE = new RegExp(`^(${KEYWORDS.join('|')})(\\s*\\+?\\s*\\d+)?$`, 'i');
const GRANTABLE = KEYWORDS.filter((k) => !['Deathrite', 'Genesis', 'Flood', 'Movement', 'Ranged'].includes(k));

export type Category =
  | 'Damage' | 'Removal' | 'Life' | 'Cards' | 'Mana' | 'Power boosts' | 'Keyword grants' | 'Tap / untap'
  | 'Avatar site ability'
  // categories for sentences the reader does not automate (by what they talk about)
  | 'Summons & tokens' | 'Search & reveal' | 'Movement & position' | 'Sites & threshold' | 'Costs & mana rules'
  | 'Combat rules' | 'Reactions (whenever …)' | 'Conditions (if …)' | 'Protection & restrictions' | 'Other';

export const OP_CATEGORY: Record<Effect['op'], Category> = {
  damage: 'Damage', destroy: 'Removal', banish: 'Removal', bounce: 'Removal', heal: 'Life', loseLife: 'Life',
  draw: 'Cards', discard: 'Cards', mana: 'Mana', buff: 'Power boosts', grant: 'Keyword grants', tap: 'Tap / untap', untap: 'Tap / untap', manual: 'Other',
};

/** Guess what an unautomated sentence is about, so the coverage report can group it. */
export function categorize(sentence: string): Category {
  const t = sentence.toLowerCase();
  if (/^whenever|^when |^after /.test(t)) return 'Reactions (whenever …)';
  if (/^if |^unless |^while /.test(t)) return 'Conditions (if …)';
  if (/summon|token|create|conjure/.test(t)) return 'Summons & tokens';
  if (/search|look at|reveal|shuffle|top of|bottom of/.test(t)) return 'Search & reveal';
  if (/can't|cannot|prevent|immune|ignore|instead/.test(t)) return 'Protection & restrictions';
  if (/strike|attack|defend|intercept|fight|combat/.test(t)) return 'Combat rules';
  if (/\bmove|step|teleport|push|swap|carr(y|ies)|pick up|location/.test(t)) return 'Movement & position';
  if (/threshold|site|rubble|flood|void|atlas/.test(t)) return 'Sites & threshold';
  if (/cost|mana|[①-⑳]/.test(t)) return 'Costs & mana rules';
  if (/damage/.test(t)) return 'Damage';
  if (/destroy|kill|banish|sacrifice/.test(t)) return 'Removal';
  if (/life/.test(t)) return 'Life';
  if (/draw|discard|hand/.test(t)) return 'Cards';
  if (/power|defen[cs]e/.test(t)) return 'Power boosts';
  if (/\btap|untap/.test(t)) return 'Tap / untap';
  return 'Other';
}

// ---- small grammar pieces ----
const WORDNUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const NUM = '(\\d+|a|an|one|two|three|four|five|six|seven|x)';
const amount = (w: string): Pick<Effect, 'n' | 'x'> => (/^x$/i.test(w) ? { x: true } : { n: WORDNUM[w.toLowerCase()] ?? +w });
/** ① .. ⑳ are the circled digits U+2460..; "(1)" and "1 mana" are accepted as well */
const MANA = '([\\u2460-\\u2473]|\\(\\d+\\)|\\d+ mana)';
const manaOf = (w: string) => (/^[①-⑳]$/.test(w) ? w.charCodeAt(0) - 0x245f : parseInt(w.replace(/\D/g, ''), 10));

type TargetSpec = Pick<Effect, 'who' | 'range' | 'only'>;
type GroupSpec = Pick<Effect, 'who' | 'other' | 'only'>;

/** "target nearby enemy minion", "target unit here", "target ally" … */
function target(np: string): TargetSpec | null {
  const m = np.match(/^target (?:(nearby|adjacent) )?(?:(enemy|allied|other) )?(unit|minion|avatar|ally|enemy)(?: (nearby|adjacent|here|at (?:this|its) location|atop this site))?$/i);
  if (!m) return null;
  const where = (m[1] || m[4] || '').toLowerCase();
  const range: Effect['range'] = where === 'adjacent' ? 'adjacent' : where === 'nearby' ? 'nearby' : where ? 'here' : 'any';
  const side = (m[2] || '').toLowerCase(), noun = m[3].toLowerCase();
  let only: Effect['only'];
  if (noun === 'avatar') only = 'avatar';
  else if (noun === 'ally') only = 'ally';
  else if (noun === 'enemy') only = 'enemy';
  else if (noun === 'minion') only = side === 'enemy' ? 'enemyMinion' : side === 'allied' ? 'allyMinion' : 'minion';
  else only = side === 'enemy' ? 'enemy' : side === 'allied' ? 'ally' : undefined;
  return { who: 'target', range, ...(only ? { only } : {}) };
}
/** "each other enemy minion here", "all units nearby", "allies here" … */
function group(np: string): GroupSpec | null {
  const m = np.match(/^(?:(?:each|all|every) )?(other )?(enemy |allied |other )?(units?|minions?|avatars?|allies|ally|enemies|enemy)(?: (here|nearby|adjacent|atop this site|at (?:this|its) location))?$/i);
  if (!m) return null;
  if (!/^(each|all|every)\b/i.test(np) && !/^(other )?(allies|enemies)/i.test(np)) return null; // a bare "minion" is not a group
  const other = !!m[1] || /other/i.test(m[2] || '');
  const side = /enemy|enemies/i.test((m[2] || '') + m[3]) ? 'enemy' : /allied|all(y|ies)/i.test((m[2] || '') + m[3]) ? 'ally' : 'any';
  const noun = m[3].toLowerCase().replace(/s$/, '').replace(/ie$/, 'y');
  const loc = (m[4] || '').toLowerCase();
  const here = loc === 'here' || loc.startsWith('at ') || loc.startsWith('atop'); const near = loc === 'nearby' || loc === 'adjacent';
  let who: Who | null = null;
  if (noun === 'avatar') who = loc ? (near ? 'nearbyAvatars' : null) : side === 'enemy' ? 'enemyAvatar' : side === 'ally' ? 'ownAvatar' : 'allAvatars';
  else who = here ? (side === 'enemy' ? 'enemiesHere' : side === 'ally' ? 'alliesHere' : 'unitsHere') : near ? (side === 'enemy' ? 'enemiesNearby' : side === 'ally' ? 'alliesNearby' : 'unitsNearby') : noun === 'minion' ? (side === 'enemy' ? 'enemyMinions' : side === 'ally' ? 'allyMinions' : 'allMinions') : null;
  // "each minion here" leaves Avatars out; "each unit here" and "each enemy here" include them
  return who ? { who, ...(other ? { other: true } : {}), ...(noun === 'minion' ? { only: 'minion' as const } : {}) } : null;
}
/** Subjects of "X gets/gains/has …" */
function subject(np: string, trigger: Trigger): (TargetSpec | GroupSpec) | null {
  const t = np.toLowerCase();
  if (/^this (minion|unit|creature|site|artifact|aura)$|^it$/.test(t)) return { who: 'self' };
  if (/^your avatar$/.test(t)) return { who: 'ownAvatar' };
  if (/^(its |the )?bearer$|^the unit carrying this$/.test(t)) return { who: 'bearer' };
  if (trigger !== 'static' && /^target /.test(t)) return target(np);
  return group(np);
}
const plainNoun = (np: string) => np.replace(/\s+/g, ' ').trim();

interface Rule { id: string; label: string; re: RegExp; build: (m: RegExpMatchArray, on: Trigger, type: CardType) => Omit<Effect, 'on'>[] | null }

/** A noun phrase for damage and removal: a target, a group, or a named Avatar. */
function victim(np: string, allowAvatar = true): TargetSpec | GroupSpec | null {
  const t = np.toLowerCase();
  if (allowAvatar) {
    if (/^(the |each )?enemy avatars?$|^the opposing avatar$|^your opponent'?s? avatar$/.test(t)) return { who: 'enemyAvatar' };
    if (/^your avatar$/.test(t)) return { who: 'ownAvatar' };
    if (/^each avatar$|^all avatars$|^both avatars$/.test(t)) return { who: 'allAvatars' };
    if (/^(this (minion|unit))$|^itself$/.test(t)) return { who: 'self' };
  }
  const tg = target(np); if (tg) return allowAvatar || tg.only !== 'avatar' ? tg : null;
  const g = group(np); if (!g) return null;
  if (!allowAvatar && ['enemyAvatar', 'ownAvatar', 'allAvatars', 'nearbyAvatars'].includes(g.who)) return null;
  return g;
}
const removal = (op: 'destroy' | 'banish') => (m: RegExpMatchArray): Omit<Effect, 'on'>[] | null => {
  const v = victim(plainNoun(m[1]), false); if (!v) return null;
  if (v.who === 'target' && !(v as TargetSpec).only) (v as TargetSpec).only = 'minion';
  if (v.who === 'target' && (v as TargetSpec).only === 'enemy') (v as TargetSpec).only = 'enemyMinion';
  if (v.who === 'target' && (v as TargetSpec).only === 'ally') (v as TargetSpec).only = 'allyMinion';
  return [{ op, ...v }];
};

export const RULES: Rule[] = [
  { id: 'avatar-site', label: 'Avatar: tap to play or draw a site', re: /^play or draw a site\.?$/i, build: () => [] },
  { id: 'damage', label: 'Deal N damage to …', re: new RegExp(`^deal ${NUM} damage to (.+?)\\.$`, 'i'),
    build: (m) => { const v = victim(plainNoun(m[2])); return v ? [{ op: 'damage', ...amount(m[1]), ...v }] : null; } },
  { id: 'takes-damage', label: '… takes N damage', re: new RegExp(`^(.+?) takes? ${NUM} damage\\.$`, 'i'),
    build: (m) => { const v = victim(plainNoun(m[1])); return v ? [{ op: 'damage', ...amount(m[2]), ...v }] : null; } },
  { id: 'destroy', label: 'Destroy / kill …', re: /^(?:destroy|kill|slay) (.+?)\.$/i, build: removal('destroy') },
  { id: 'banish', label: 'Banish …', re: /^banish (.+?)\.$/i, build: removal('banish') },
  { id: 'bounce', label: "Return … to its owner's hand", re: /^return (.+?) to (?:its|their) owner'?s'? hands?\.$/i,
    build: (m) => { const v = victim(plainNoun(m[1]), false); if (!v) return null; if (v.who === 'target' && !(v as TargetSpec).only) (v as TargetSpec).only = 'minion'; return [{ op: 'bounce', ...v }]; } },
  { id: 'tap', label: 'Tap / untap …', re: /^(tap|untap) (.+?)\.$/i,
    build: (m) => { const v = subject(plainNoun(m[2]), 'cast') ?? victim(plainNoun(m[2])); return v ? [{ op: m[1].toLowerCase() as 'tap' | 'untap', ...v }] : null; } },
  { id: 'gain-life', label: 'Gain N life', re: new RegExp(`^(?:you |your avatar )?(?:gains?|heals?) ${NUM} life\\.$`, 'i'), build: (m) => [{ op: 'heal', ...amount(m[1]), who: 'controller' }] },
  { id: 'avatars-heal', label: 'Each nearby Avatar heals N life', re: new RegExp(`^each (nearby )?avatar (?:heals|gains) ${NUM} life\\.$`, 'i'),
    build: (m) => [{ op: 'heal', ...amount(m[2]), who: m[1] ? 'nearbyAvatars' : 'allAvatars' }] },
  { id: 'lose-life', label: 'You lose N life', re: new RegExp(`^(?:you )?lose ${NUM} life\\.$`, 'i'), build: (m) => [{ op: 'loseLife', ...amount(m[1]), who: 'controller' }] },
  { id: 'opponent-loses', label: 'Opponent loses N life', re: new RegExp(`^(?:your |each )?(opponent|enemy|other player|player)s? loses? ${NUM} life\\.$`, 'i'),
    build: (m) => [{ op: 'loseLife', ...amount(m[2]), who: /^player$/i.test(m[1]) ? 'allAvatars' : 'opponent' }] },
  { id: 'draw', label: 'Draw N spells / sites / cards', re: new RegExp(`^(?:you )?draw ${NUM} (spell|site|card)s?\\.$`, 'i'),
    build: (m) => [{ op: 'draw', ...amount(m[1]), who: 'controller', ...(m[2].toLowerCase() === 'card' ? {} : { deck: m[2].toLowerCase() === 'site' ? 'atlas' as const : 'spellbook' as const }) }] },
  { id: 'discard-random', label: 'Opponent discards N at random', re: new RegExp(`^(?:your |each )?opponent discards ${NUM} (?:random )?(?:card|spell)s? at random\\.$|^(?:your |each )?opponent discards ${NUM} random (?:card|spell)s?\\.$`, 'i'),
    build: (m) => [{ op: 'discard', ...amount(m[1] ?? m[2]), who: 'opponent' }] },
  { id: 'mana', label: 'Gain mana this turn', re: new RegExp(`^(?:you )?gain ${MANA}(?: this turn)?\\.$`, 'i'), build: (m) => [{ op: 'mana', n: manaOf(m[1]), who: 'controller' }] },
  { id: 'mana-only-copy', label: 'If this is the only …, gain mana', re: new RegExp(`^if this is the only .+ you control, gain ${MANA} this turn\\.$`, 'i'),
    build: (m, on) => (on === 'genesis' ? [{ op: 'mana', n: manaOf(m[1]), who: 'controller', cond: 'onlyCopy' }] : null) },
  { id: 'power', label: '… gets / has +N power', re: /^(.+?) (?:gets?|gains?|has|have) ([+\-−]\d+) power(?: and ([+\-−]\d+) defen[cs]e)?( this turn| until the end of (?:the|this) turn)?\.$/i,
    build: (m, on) => {
      const v = subject(plainNoun(m[1]), on); if (!v) return null;
      const num = (x?: string) => (x ? parseInt(x.replace('−', '-'), 10) : 0);
      const turn = !!m[4]; if (on === 'static' && turn) return null;
      return [{ op: 'buff', ...v, atk: num(m[2]), def: m[3] ? num(m[3]) : num(m[2]), until: on === 'static' ? 'permanent' : turn ? 'turn' : 'permanent' }];
    } },
  { id: 'grant', label: '… gains / has a keyword', re: new RegExp(`^(.+?) (?:gets?|gains?|has|have) ((?:${GRANTABLE.join('|')})(?:(?:, | and |, and )(?:${GRANTABLE.join('|')}))*)( this turn| until the end of (?:the|this) turn)?\\.$`, 'i'),
    build: (m, on) => {
      const v = subject(plainNoun(m[1]), on); if (!v) return null;
      const turn = !!m[3]; if (on === 'static' && turn) return null;
      const kws = m[2].split(/, and |, | and /).map((k) => GRANTABLE.find((g) => g.toLowerCase() === k.trim().toLowerCase())!).filter(Boolean);
      return kws.map((keyword) => ({ op: 'grant' as const, ...v, keyword, until: on === 'static' ? 'permanent' as const : turn ? 'turn' as const : 'permanent' as const }));
    } },
];

/** Which ops make sense for each trigger. A static line can only change stats and keywords. */
const OK_FOR: Partial<Record<Trigger, Effect['op'][]>> = { static: ['buff', 'grant'] };

export interface ReadLine { text: string; on: Trigger | 'keywords'; effects: Effect[]; manual: string[] }
export interface Reading { effects: Effect[]; lines: ReadLine[]; manual: string[] }

const strip = (t: string) => t.replace(/\r/g, '').replace(/\([^()]*\)/g, (p) => (/^\(\d+\)$/.test(p) ? p : '')).replace(/->/g, '→').replace(/[‘’]/g, "'").replace(/[ \t]+/g, ' ');

/** Split a line's body into sentences; keeps "e.g." style abbreviations together well enough for card text. */
const sentences = (body: string) => body.split(/(?<=[.!])\s+(?=[A-Z①-⑳])/).map((x) => x.trim()).filter(Boolean).map((x) => (/[.!]$/.test(x) ? x : x + '.'));

/** Read a card's whole rules text into effects. Unread sentences become `manual` effects. */
export function readRules(type: CardType, rules: string, name = ''): Reading {
  const out: Reading = { effects: [], lines: [], manual: [] };
  const lines = strip(rules).split('\n').map((l) => l.trim()).filter(Boolean);
  lines.forEach((raw, lineNo) => {
    const line = name ? raw.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), 'this') : raw;
    if (line.split(/,\s*/).every((part) => KEYWORD_LINE.test(part.trim()))) { out.lines.push({ text: raw, on: 'keywords', effects: [], manual: [] }); return; }
    let on: Trigger; let body = line; let cost = 0; let repeat = false; let m: RegExpMatchArray | null;
    if ((m = line.match(/^(Genesis|Deathrite)\s*→\s*(.+)$/i))) { on = m[1].toLowerCase() as Trigger; body = m[2]; }
    else if ((m = line.match(/^(?:([①-⑳]|\(\d+\)|\d+)\s*,\s*)?Tap\s*→\s*(.+)$/i))) { on = 'tap'; body = m[2]; cost = m[1] ? manaOf(m[1]) : 0; }
    else if ((m = line.match(/^At the (?:start|beginning) of your turn,\s*(.+)$/i))) { on = 'startTurn'; body = m[1].replace(/^./, (c) => c.toUpperCase()); }
    else if ((m = line.match(/^At the end of your turn,\s*(.+)$/i))) { on = 'endTurn'; body = m[1].replace(/^./, (c) => c.toUpperCase()); }
    else if ((m = line.match(/^(Once per turn,\s*)?([①-⑳]|\(\d+\))\s*→\s*(.+)$/i))) { on = 'activated'; cost = manaOf(m[2]); repeat = !m[1]; body = m[3]; }
    else if ((m = line.match(/^Once (?:on your turn|per turn|each turn),\s*(?:(?:this|its|the)\s+)?(?:bearer|minion|unit|site|artifact|you)?\s*may\s+(.+)$/i))) { on = 'activated'; body = m[1].replace(/^./, (c) => c.toUpperCase()); }
    else on = type === 'Magic' ? 'cast' : 'static';
    const rl: ReadLine = { text: raw, on, effects: [], manual: [] };
    for (const sentence of sentences(body)) {
      let got: Omit<Effect, 'on'>[] | null = null; let rule = '';
      for (const r of RULES) {
        const mm = sentence.match(r.re); if (!mm) continue;
        const b = r.build(mm, on, type);
        if (b && b.every((e) => !OK_FOR[on] || OK_FOR[on]!.includes(e.op))) { got = b; rule = r.id; break; }
      }
      if (got) rl.effects.push(...got.map((e) => ({ ...e, on, line: lineNo, text: sentence, rule, auto: true, ...(cost ? { cost } : {}), ...(on === 'activated' && repeat ? { repeat } : {}) })));
      else { rl.manual.push(sentence); rl.effects.push({ on, op: 'manual', who: 'controller', line: lineNo, text: sentence, auto: true, ...(cost ? { cost } : {}) }); }
    }
    out.lines.push(rl); out.effects.push(...rl.effects); out.manual.push(...rl.manual);
  });
  return out;
}

// ---- coverage report ----
export type Coverage = 'auto' | 'partial' | 'manual' | 'plain';
export interface CardCoverage { id: string; name: string; type: CardType; status: Coverage; categories: Category[]; manual: string[]; rules: string; sets: string[] }
export interface CoverageReport {
  total: number;
  counts: Record<Coverage, number>;
  /** ability type -> cards that have it, split by whether the engine handles it */
  byCategory: { category: Category; auto: number; manual: number; cards: string[] }[];
  /** unautomated sentences with numbers and names normalized, most common first: the next phrases worth adding */
  shapes: { shape: string; count: number; category: Category; examples: string[] }[];
  cards: CardCoverage[];
}
export const shapeOf = (sentence: string) => sentence.toLowerCase().replace(/[①-⑳]/g, '①').replace(/\b\d+\b/g, 'N').replace(/\s+/g, ' ').trim();

export function coverageOf(card: CardDef): CardCoverage {
  const manual = card.effects.filter((e) => e.op === 'manual').map((e) => e.text ?? '');
  const done = card.effects.filter((e) => e.op !== 'manual');
  const cats = new Set<Category>();
  for (const e of done) cats.add(e.rule === 'avatar-site' ? 'Avatar site ability' : OP_CATEGORY[e.op]);
  for (const t of manual) cats.add(categorize(t));
  const hasText = !!strip(card.rules).split('\n').map((l) => l.trim()).filter((l) => l && !l.split(/,\s*/).every((p) => KEYWORD_LINE.test(p.trim()))).length;
  const status: Coverage = !hasText ? 'plain' : !manual.length ? 'auto' : done.length ? 'partial' : 'manual';
  return { id: card.id, name: card.name, type: card.type, status, categories: [...cats], manual, rules: card.rules, sets: [...new Set(card.printings.map((p) => p.set).filter(Boolean))] };
}

export function analyzeCards(cards: CardDef[]): CoverageReport {
  const list = cards.map(coverageOf);
  const counts: Record<Coverage, number> = { auto: 0, partial: 0, manual: 0, plain: 0 };
  const cats = new Map<Category, { auto: number; manual: number; cards: string[] }>();
  const shapes = new Map<string, { count: number; category: Category; examples: string[] }>();
  for (const [i, c] of list.entries()) {
    counts[c.status]++;
    const card = cards[i];
    const autoCats = new Set(card.effects.filter((e) => e.op !== 'manual').map((e) => (e.rule === 'avatar-site' ? 'Avatar site ability' : OP_CATEGORY[e.op]) as Category));
    for (const cat of c.categories) {
      const row = cats.get(cat) ?? { auto: 0, manual: 0, cards: [] };
      if (c.manual.some((t) => categorize(t) === cat)) row.manual++; else if (autoCats.has(cat)) row.auto++;
      row.cards.push(c.name); cats.set(cat, row);
    }
    for (const t of c.manual) {
      const k = shapeOf(t.replace(new RegExp(c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '~'));
      const row = shapes.get(k) ?? { count: 0, category: categorize(t), examples: [] };
      row.count++; if (row.examples.length < 3) row.examples.push(c.name); shapes.set(k, row);
    }
  }
  return {
    total: list.length, counts,
    byCategory: [...cats].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.auto + b.manual - (a.auto + a.manual)),
    shapes: [...shapes].map(([shape, v]) => ({ shape, ...v })).sort((a, b) => b.count - a.count),
    cards: list,
  };
}
