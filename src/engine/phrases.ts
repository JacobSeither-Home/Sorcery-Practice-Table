// The card-text reader. Every card's rules text is split into lines and sentences, and each sentence is
// matched against the phrase rules below. A sentence that matches becomes an Effect the engine carries
// out; a sentence that does not becomes a `manual` entry, which the cast pop-up shows next to the hand
// tools so the player can resolve it. Nothing here is per-card: a new set is covered automatically as
// long as its cards use phrasing these rules already know. `analyzeCards` reports what is and is not
// covered, grouped by ability type, so new phrasing shows up after a Card Sync.
//
// Source of the phrasing: the rules text of every card in GET https://api.sorcerytcg.com/api/cards, read
// on 2026-11-12 (1,100 cards), and the Codex at https://sorcerytcg.com/codex for what the words mean
// (nearby, adjacent, here, heal, Ward, projectile …). `node tests/coverage.mjs cards.json` reports what
// is still by hand.
import type { CardDef, CardFilter, CardType, Cond, Effect, Element, EventFilter, Thresholds, Trigger, Who, Zone, ZonePick } from './types';

export const KEYWORDS = ['Airborne', 'Burrowing', 'Charge', 'Deathrite', 'Disabled', 'Flood', 'Genesis', 'Immobile', 'Lance', 'Landbound', 'Lethal', 'Movement', 'Ranged', 'Spellcaster', 'Stealth', 'Submerge', 'Voidwalk', 'Ward', 'Waterbound'];
const EL_WORD = '(?:air|earth|fire|water)';
const KEYWORD_LINE = new RegExp(`^((?:${EL_WORD}(?: and ${EL_WORD})? |non-(?:air|earth|fire|water|ordinary) )?(?:${KEYWORDS.join('|')}))(\\s*\\+?\\s*\\d+)?$`, 'i');
/** "Fire Spellcaster" → "Spellcaster (fire)": a spellcaster limited to spells of an element (rulebook p34 "Spellcaster";
 *  Codex "Spellcaster"). "Earth and Water" → "(earth+water)", "Non-fire" → "(not fire)", "Non-Ordinary" → "(not Ordinary)". */
export function limitedSpellcaster(prefix: string): string | null {
  const p = prefix.trim().toLowerCase(); if (!p) return null;
  const non = p.match(/^non-(\w+)$/); if (non) return `Spellcaster (not ${non[1] === 'ordinary' ? 'Ordinary' : non[1]})`;
  const els = p.split(/ and /); return els.every((x) => /^(air|earth|fire|water)$/.test(x)) ? `Spellcaster (${els.join('+')})` : null;
}
const LIMITED_SC = new RegExp(`^(${EL_WORD}(?: and ${EL_WORD})?|non-(?:air|earth|fire|water|ordinary)) spellcaster$`, 'i');
const GRANTABLE = KEYWORDS.filter((k) => !['Deathrite', 'Genesis', 'Flood', 'Movement', 'Ranged'].includes(k));

export type Category =
  | 'Damage' | 'Removal' | 'Life' | 'Cards' | 'Mana' | 'Power boosts' | 'Keyword grants' | 'Tap / untap'
  | 'Avatar site ability'
  // categories for sentences the reader does not automate (by what they talk about)
  | 'Summons & tokens' | 'Search & reveal' | 'Movement & position' | 'Sites & threshold' | 'Costs & mana rules'
  | 'Combat rules' | 'Reactions (whenever …)' | 'Conditions (if …)' | 'Protection & restrictions' | 'Other';

export const OP_CATEGORY: Record<Effect['op'], Category> = {
  ongoing: 'Keyword grants',
  chain: 'Damage',
  moveSite: 'Movement & position',
  damage: 'Damage', destroy: 'Removal', banish: 'Removal', bounce: 'Removal', heal: 'Life', loseLife: 'Life',
  draw: 'Cards', discard: 'Cards', mana: 'Mana', buff: 'Power boosts', grant: 'Keyword grants', tap: 'Tap / untap', untap: 'Tap / untap', manual: 'Other',
  prevent: 'Protection & restrictions', control: 'Movement & position', moveAura: 'Movement & position', castRule: 'Costs & mana rules', lasts: 'Other', pick: 'Search & reveal', unward: 'Protection & restrictions', raise: 'Summons & tokens', destroySite: 'Sites & threshold', choose: 'Other', rubble: 'Sites & threshold', replaceRubble: 'Sites & threshold', flood: 'Sites & threshold', noUntap: 'Tap / untap', provide: 'Mana', summon: 'Summons & tokens', shoot: 'Damage', strike: 'Damage', mill: 'Cards', scry: 'Search & reveal', sink: 'Movement & position', teleport: 'Movement & position',
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
/** Mana in card text: ① .. ⑳ (U+2460..), "(1)", or "1 mana" */
const MANA = '([\\u2460-\\u2473]|\\(\\d+\\)|\\d+ mana)';
const manaOf = (w: string) => (/^[①-⑳]$/.test(w) ? w.charCodeAt(0) - 0x245f : parseInt(w.replace(/\D/g, ''), 10));
/** Element symbols in card text: (A) air, (E) earth, (F) fire, (W) water */
const EL: Record<string, Element> = { A: 'air', E: 'earth', F: 'fire', W: 'water' };
const elementsOf = (t: string) => { const o: Partial<Record<Element, number>> = {}; for (const m of t.matchAll(/\(([AEFW])\)/g)) o[EL[m[1]]] = (o[EL[m[1]]] ?? 0) + 1; return o; };

/** Subtypes and umbrella words that narrow a noun ("Undead allies", "target nearby Giant"). From the API's subtype list. */
const SUBTYPES = ['Angel', 'Beast', 'Demon', 'Dragon', 'Dwarf', 'Faerie', 'Giant', 'Gnome', 'Goblin', 'Merfolk', 'Monster', 'Mortal', 'Ogre', 'Spirit', 'Sphinx', 'Troll', 'Undead', 'Knight', 'Royalty', 'Evil', 'Desert', 'River', 'Tower', 'Village', 'Weapon', 'Armor', 'Relic', 'Device', 'Document', 'Instruments', 'Monument', 'Potion', 'Automaton'];
const subOf = (w: string): string | null => {
  const t = w.toLowerCase().replace(/ies$/, 'y').replace(/(?<=[a-z])s$/, '').replace(/^faery$/, 'faerie');
  return SUBTYPES.find((x) => x.toLowerCase() === t || x.toLowerCase() === w.toLowerCase()) ?? null;
};

/** What a noun phrase picks out. */
type Sel = Pick<Effect, 'who' | 'range' | 'only' | 'other' | 'sub' | 'kw' | 'wounded' | 'ref' | 'siteKind' | 'targets' | 'weaker'>;

/**
 * The noun-phrase grammar for units in card text:
 *   [each|all|every|target|an|a|another] [other] [nearby|adjacent] [enemy|allied|opposing] [wounded]
 *   [Subtype…|Keyword] [unit(s)|minion(s)|ally|allies|enemy|enemies|Avatar(s)|Subtype(s)]
 *   [here|there|nearby|adjacent|atop this site|at its location|at target [nearby|adjacent] location/site]
 * A target is chosen by the player; "an ally" and "another ally" are chosen too (range anywhere).
 */
function nounPhrase(np: string, mode: 'unit' | 'minion' = 'unit'): Sel | null {
  let t = np.replace(/\s+/g, ' ').trim().replace(/[.,]$/, '');
  let maxPower: number | undefined, minPower: number | undefined, surface = false, rnd = 0;
  let pm: RegExpMatchArray | null; let siteKind: 'land' | 'water' | undefined;
  if ((pm = t.match(/ (?:target|a) (land|water) site/i))) { siteKind = pm[1].toLowerCase() as 'land' | 'water'; t = t.replace(` ${pm[1]} site`, ' site'); }
  if ((pm = t.match(/ with (\d+) or (less|more) power/i))) { if (pm[2].toLowerCase() === 'less') maxPower = +pm[1]; else minPower = +pm[1]; t = t.replace(pm[0], ''); }
  if ((pm = t.match(/ (?:on the surface|aboveground|above ground)$/i))) { surface = true; t = t.slice(0, pm.index); }
  if ((pm = t.match(/^(?:each |all )?(?:aboveground|surface) /i))) { surface = true; t = (/^(each|all)/i.test(pm[0]) ? pm[0].split(' ')[0] + ' ' : '') + t.slice(pm[0].length); }
  if ((pm = t.match(/^(?:a|one|another) random /i))) { rnd = 1; t = (/^another/i.test(pm[0]) ? 'each other ' : 'each ') + t.slice(pm[0].length); }
  const extra = { ...(siteKind ? { siteKind } : {}), ...(maxPower !== undefined ? { maxPower } : {}), ...(minPower !== undefined ? { minPower } : {}), ...(surface ? { surface: true } : {}), ...(rnd ? { random: rnd } : {}) };
  const r0 = nounPhrase0(t, mode);
  if (!r0) return null;
  if (rnd && (r0.who === 'target' || r0.who === 'self')) return null;
  return { ...r0, ...extra } as Sel;
}
function nounPhrase0(np: string, mode: 'unit' | 'minion'): Sel | null {
  let t = np;
  const tl = t.toLowerCase();
  if (/^(this|itself|this (minion|unit))$/.test(tl)) return { who: 'self' };
  if (/^(it|them|that (minion|unit|ally|enemy))$/.test(tl)) return { who: 'target', ref: true } as Sel;
  if (/^(its |the )?bearer$/.test(tl)) return { who: 'bearer' };
  if (/^your avatar$|^you$/.test(tl)) return { who: 'ownAvatar' };
  if (/^(the |each )?enemy avatars?$|^the opposing avatar$|^your opponent'?s? avatar$|^opposing avatars?$/.test(tl)) return { who: 'enemyAvatar' };
  if (/^(each|every|all|both) avatars?$/.test(tl)) return { who: 'allAvatars' };
  if (/^(each )?nearby avatars?$/.test(tl)) return { who: 'nearbyAvatars' };
  let m = t.match(/^(each|all|every|target|an|a|another|one)\s+/i);
  const q = m ? m[1].toLowerCase() : ''; if (m) t = t.slice(m[0].length);
  let other = q === 'another';
  if ((m = t.match(/^other\s+/i))) { other = true; t = t.slice(m[0].length); }
  let range: Effect['range'] | undefined; let atTarget = false; let aff = false;
  const steps = t.match(/ up to (two|three) steps away$/i); if (steps) { t = t.slice(0, steps.index); range = steps[1].toLowerCase() as Effect['range']; }
  if ((m = t.match(/^(nearby|adjacent)\s+/i))) { range = m[1].toLowerCase() as Effect['range']; t = t.slice(m[0].length); }
  // trailing location
  if ((m = t.match(/\s+(?:at|atop|occupying|in) affected (?:sites|locations|squares)$/i)) || (m = t.match(/^affected\s+/i))) { aff = true; t = m.index === 0 ? t.slice(m[0].length) : t.slice(0, m.index); }
  const tail = t.match(/\s+(here|there|nearby|adjacent|(?:occupying|atop) nearby sites|atop this site|at (?:this|its) location|at its site|(?:at|atop|occupying) (?:target|a) (?:(nearby|adjacent) )?(?:land |water )?(?:location|site)(?: (nearby|adjacent))?(?: up to (two|three) steps away)?|atop target (?:(nearby|adjacent) )?site)$/i);
  if (tail) {
    t = t.slice(0, tail.index);
    const w = tail[1].toLowerCase();
    if (/target|^(at|atop|occupying) a /.test(w)) { atTarget = true; range = ((tail[2] || tail[3] || tail[4] || tail[5] || '').toLowerCase() as Effect['range']) || range || 'any'; }
    else range = /here|there|this|its/.test(w) ? 'here' : /nearby sites/.test(w) ? 'nearby' : (w as Effect['range']);
  }
  let side: 'enemy' | 'ally' | '' = '';
  if ((m = t.match(/^(enemy|allied|opposing|your)\s+/i))) { side = /enemy|opposing/i.test(m[1]) ? 'enemy' : 'ally'; t = t.slice(m[0].length); }
  let wounded = false; let weaker = false;
  if ((m = t.match(/^wounded\s+/i))) { wounded = true; t = t.slice(m[0].length); }
  if ((m = t.match(/^weaker\s+(?:(enemy|allied)\s+)?/i))) { weaker = true; t = t.slice(m[0].length); if (m[1]) side = /enemy/i.test(m[1]) ? 'enemy' : 'ally'; }
  const words = t.split(' ');
  const noun = words.pop()!.toLowerCase();
  const subs: string[] = []; let kw: string | undefined;
  for (const w of words) {
    if (/^(or|and)$/i.test(w)) continue;
    const sb = subOf(w.replace(/,$/, '')); if (sb) { subs.push(sb); continue; }
    const k = KEYWORDS.find((x) => x.toLowerCase() === w.toLowerCase()); if (k) { kw = k; continue; }
    return null; // a word we do not understand (Unique, Elite, Ordinary …): leave the sentence for the hand tools
  }
  let kind: 'unit' | 'minion' | 'avatar';
  if (/^units?$/.test(noun)) kind = 'unit';
  else if (/^minions?$/.test(noun)) kind = 'minion';
  else if (/^avatars?$/.test(noun)) kind = 'avatar';
  else if (/^all(y|ies)$/.test(noun)) { kind = 'unit'; side = 'ally'; }
  else if (/^enem(y|ies)$/.test(noun)) { kind = 'unit'; side = 'enemy'; }
  else { const sb = subOf(noun); if (!sb) return null; subs.push(sb); kind = 'minion'; }
  if (mode === 'minion' && kind === 'unit') kind = 'minion';
  const filters = { ...(weaker ? { weaker: true } : {}), ...(subs.length ? { sub: subs } : {}), ...(kw ? { kw } : {}), ...(wounded ? { wounded: true } : {}), ...(other ? { other: true } : {}) };
  const only: Effect['only'] = kind === 'avatar' ? 'avatar' : kind === 'minion' ? (side === 'enemy' ? 'enemyMinion' : side === 'ally' ? 'allyMinion' : 'minion') : side === 'enemy' ? 'enemy' : side === 'ally' ? 'ally' : undefined;
  if (aff) return { who: 'affected', ...(only ? { only } : {}), ...filters };
  if (atTarget) return { who: 'atTarget', range: range ?? 'any', targets: /target/i.test(np), ...(only ? { only } : {}), ...filters };
  const chosen = q === 'target' || q === 'an' || q === 'a' || q === 'another' || q === 'one';
  if (chosen) return { who: 'target', range: range ?? 'any', targets: q === 'target', ...(only ? { only } : {}), ...filters };
  // a group needs each/all, a plural, or a place
  if (!q && !/s$/.test(noun) && !/ies$/.test(noun) && !range && !(subs.length && other)) return null;
  const here = range === 'here', near = range === 'nearby' || range === 'adjacent';
  let who: Who;
  if (kind === 'avatar') { if (near) who = 'nearbyAvatars'; else if (side === 'enemy') who = 'enemyAvatar'; else if (side === 'ally') who = 'ownAvatar'; else who = 'allAvatars'; return { who }; }
  if (here) who = side === 'enemy' ? 'enemiesHere' : side === 'ally' ? 'alliesHere' : 'unitsHere';
  else if (near) who = side === 'enemy' ? 'enemiesNearby' : side === 'ally' ? 'alliesNearby' : 'unitsNearby';
  else if (kind === 'unit' && side && !subs.length) return { who: side === 'enemy' ? 'enemyUnits' : 'allyUnits', ...filters }; // "each ally": Avatar included (rulebook p32 "Ally")
  else who = side === 'enemy' ? 'enemyMinions' : side === 'ally' ? 'allyMinions' : 'allMinions';
  if (!range && kind === 'unit' && !subs.length && side === '') return null; // "each unit" anywhere: Avatars too, not modelled
  return { who, ...(kind === 'minion' || (!range && kind === 'unit') ? { only: 'minion' as const } : {}), ...filters };
}
const minionOnly = (v: Sel | null): Sel | null => {
  if (!v || ['enemyAvatar', 'ownAvatar', 'allAvatars', 'nearbyAvatars'].includes(v.who) || v.only === 'avatar') return null;
  if (v.who === 'target' || v.who === 'atTarget') return { ...v, only: v.only === 'enemy' ? 'enemyMinion' : v.only === 'ally' ? 'allyMinion' : v.only ?? 'minion' };
  return v;
};


// ---- choosing cards from zones (search, look at, reveal, return, collection) ----
const RARITIES = ['Ordinary', 'Exceptional', 'Elite', 'Unique'];
const TYPE_WORDS: Record<string, CardType[]> = { minion: ['Minion'], magic: ['Magic'], artifact: ['Artifact'], aura: ['Aura'], site: ['Site'], spell: ['Minion', 'Magic', 'Artifact', 'Aura'], card: [] };
/** "an Exceptional Mortal", "up to three Beasts", "another Brother Knight", "an artifact that costs ① or less" → how many, and which cards. */
export function cardFilter(text: string, self = ''): { count: number | 'all'; filter: CardFilter } | null {
  let t = text.trim().replace(/[.,]$/, ''); const f: CardFilter = {}; let count: number | 'all' = 1; let m: RegExpMatchArray | null;
  if ((m = t.match(/^(?:all|any number of|every) /i))) { count = 'all'; t = t.slice(m[0].length); }
  else if ((m = t.match(/^up to (\w+) /i))) { count = WORDNUM[m[1].toLowerCase()] ?? +m[1]; t = t.slice(m[0].length); }
  else if ((m = t.match(/^(a|an|one|any|another)\s+/i))) { if (/another/i.test(m[1])) f.same = true; t = t.slice(m[0].length); }
  else if ((m = t.match(/^(two|three|four|five|six|seven|\d+)(?: different)?\s+/i))) { count = WORDNUM[m[1].toLowerCase()] ?? +m[1]; t = t.slice(m[0].length); }
  if ((m = t.match(/ that died this turn$/i))) { f.diedThisTurn = true; t = t.slice(0, m.index); }
  if ((m = t.match(new RegExp(`(?: that costs?| with mana cost) ${MANA} or less$`, 'i')))) { f.maxCost = manaOf(m[1]); t = t.slice(0, m.index); }
  if ((m = t.match(new RegExp(`(?: with (\\w+) and mana cost ${MANA} or less)$`, 'i')))) { f.kw = KEYWORDS.find((k) => k.toLowerCase() === m![1].toLowerCase()); f.maxCost = manaOf(m[2]); t = t.slice(0, m.index); if (!f.kw) return null; }
  if (/^dead minions?$/i.test(t)) { f.minion = true; return { count, filter: f }; }
  const words = t.split(' '); const last = words[words.length - 1].toLowerCase().replace(/s$/, '').replace(/ie$/, 'y');
  if (f.same && (words.join(' ').toLowerCase() === self.toLowerCase() || /^this$/i.test(t))) return { count, filter: { ...f, same: true } };
  if (TYPE_WORDS[last] || subOf(words[words.length - 1])) {
    for (const w of words.slice(0, -1)) {
      const r = RARITIES.find((x) => x.toLowerCase() === w.toLowerCase()); if (r) { (f.rarity ??= []).push(r); continue; }
      const sb = subOf(w); if (sb) { (f.sub ??= []).push(sb); continue; }
      const kw = KEYWORDS.find((k) => k.toLowerCase() === w.toLowerCase()); if (kw) { f.kw = kw; continue; }
      if (/^(different|other)$/i.test(w)) continue;
      return null;
    }
    if (TYPE_WORDS[last]) { if (TYPE_WORDS[last].length) f.type = TYPE_WORDS[last]; if (last === 'spell') f.notType = ['Site']; }
    else { (f.sub ??= []).push(subOf(words[words.length - 1])!); f.minion = true; }
    return { count, filter: f };
  }
  // otherwise it names a card ("two Hellhounds", "a Ghoul", "Horrible Hybrids")
  if (!/^[A-Z][\w'’-]*(?: (?:of|the|and|[A-Z][\w'’-]*))*$/.test(t)) return null;
  f.same = false; f.name = t.replace(/’/g, "'"); return { count, filter: f };
}
const ZONE_WORDS: Record<string, Zone> = { hand: 'hand', cemetery: 'cemetery', spellbook: 'spellbook', atlas: 'atlas' };
const zonesOf = (t: string): Zone[] | null => { const z = t.toLowerCase().split(/, or |, and |, | or | and /).map((w) => ZONE_WORDS[w.trim()]); return z.every(Boolean) ? (z as Zone[]) : null; };
const pickFx = (pick: ZonePick, optional: boolean, extra: Partial<Effect> = {}): Omit<Effect, 'on'> => ({ op: 'pick', who: 'controller', pick, ...(optional ? { optional: true } : {}), ...extra });
/**
 * Read one search / look-at / return / collection sentence (and the sentences after it that finish it:
 * "Shuffle if needed.", "Put the rest at the bottom …"). Returns the effect and how many sentences it used.
 */
function readPick(ss: string[], k: number, self: string): { fx: Omit<Effect, 'on'>; used: number } | null {
  const t = ss[k]; let m: RegExpMatchArray | null; let used = 1;
  const next = (re: RegExp) => { const n = ss[k + used]; if (n && re.test(n)) { used++; return n.match(re); } return null; };
  const shuffleNext = () => !!next(/^(?:Shuffle(?: if needed| your spellbook| afterward)?|Then shuffle)\.$/i);
  // Search your <zones> for <cards>, (reveal it,) and put it into your hand / summon it here|nearby.
  if ((m = t.match(/^(you may )?search your ([a-z, ]+?) for (.+?)(?:, reveal (?:it|them),)?,? (?:and )?(put (?:it|them) (?:in|into) your hand|summon (?:it|them) (here|nearby|there))(?:, then shuffle(?: afterward)?)?\.$/i))) {
    const zones = zonesOf(m[2]); const cf = cardFilter(m[3], self); if (!zones || !cf) return null;
    const summon = /^summon/i.test(m[4]);
    const sh = /then shuffle/i.test(t) || shuffleNext();
    return { fx: pickFx({ zones, take: cf.count, filter: cf.filter, to: summon ? 'summon' : 'hand', where: summon ? (m[5]?.toLowerCase() === 'nearby' ? 'choose' : 'here') : undefined, shuffle: sh || zones.includes('spellbook'), reveal: !summon }, !!m[1], summon && m[5]?.toLowerCase() === 'nearby' ? { who: 'atTarget', range: 'nearby' } : {}), used };
  }
  // Search your top N spells (for a minion to discard). + You may summon/reveal and draw … from among them. + Put the rest at the bottom.
  if ((m = t.match(/^search your top (\w+) (spells|sites)(?: for (.+?) to discard)?\.$/i))) {
    const n = WORDNUM[m[1].toLowerCase()] ?? +m[1]; const zone: Zone = /site/i.test(m[2]) ? 'atlas' : 'spellbook';
    let pick: ZonePick | null = null; let optional = false;
    if (m[3]) { const cf = cardFilter(m[3], self); if (!cf) return null; pick = { zones: [zone], top: n, take: cf.count, filter: cf.filter, to: 'discard' }; }
    else {
      const f = next(/^(You may )?(summon|reveal and draw|draw|put) (.+?) from among them(?: into your hand)?(?: to each other adjacent site)?(?:, then shuffle)?\.$/i);
      if (!f) return null;
      const cf = cardFilter(f[3], self); if (!cf) return null; optional = !!f[1];
      pick = { zones: [zone], top: n, take: cf.count, filter: cf.filter, to: /summon/i.test(f[2]) ? 'summon' : 'hand', where: 'here', reveal: true, rest: /then shuffle/i.test(f[0]) ? 'shuffle' : 'stay' };
    }
    if (next(/^(?:Put the rest (?:at|on) the bottom(?: of your (?:spellbook|atlas))?(?: in (?:a random|any) order)?|Bottom the rest)\.$/i)) pick.rest = 'bottom';
    else if (next(/^(?:Then )?shuffle\.$/i)) pick.rest = 'shuffle';
    return { fx: pickFx(pick, optional), used };
  }
  // Look at your next / top / bottom N spells. + Put one in your hand and the rest on the bottom … / Put three on the bottom … / Put one on top … / Put them back in any order.
  if ((m = t.match(/^look at your (next|top|topmost|bottom) (\w+) (spells|sites)\.$/i))) {
    const n = WORDNUM[m[2].toLowerCase()] ?? +m[2]; const zone: Zone = /site/i.test(m[3]) ? 'atlas' : 'spellbook'; const bottom = /bottom/i.test(m[1]);
    let f: RegExpMatchArray | null;
    if ((f = next(/^Put (\w+) (?:in|into) your hand and the rest (?:on|at) the bottom(?: of your (?:spellbook|atlas))?(?: in any order)?\.$/i)))
      return { fx: pickFx({ zones: [zone], top: n, fromBottom: bottom, take: WORDNUM[f[1].toLowerCase()] ?? 1, to: 'hand', rest: 'bottom' }, false), used };
    if ((f = next(/^Put (\w+) on the bottom(?: of your (?:spellbook|atlas))?\.$/i)))
      return { fx: pickFx({ zones: [zone], top: n, fromBottom: bottom, take: WORDNUM[f[1].toLowerCase()] ?? 1, to: 'bottom', rest: 'stay' }, false), used };
    if ((f = next(/^Put (\w+) on top(?: of your (?:spellbook|atlas))?\.$/i)))
      return { fx: pickFx({ zones: [zone], top: n, fromBottom: bottom, take: WORDNUM[f[1].toLowerCase()] ?? 1, to: 'top', rest: 'stay' }, false), used };
    if (next(/^Put them back in any order\.$/i)) return { fx: pickFx({ zones: [zone], top: n, take: 0, to: 'none', rest: 'stay' }, false), used };
    return null;
  }
  // (You may) return a minion (that died this turn) from your cemetery to your hand.
  if ((m = t.match(/^(you may )?return (.+?) from your cemetery to your hand\.$/i))) {
    const cf = cardFilter(m[2], self); if (!cf) return null;
    return { fx: pickFx({ zones: ['cemetery'], take: cf.count, filter: cf.filter, to: 'hand' }, !!m[1]), used };
  }
  // (You may) summon <cards> from <your|a|any> cemetery <here|to its location|to a nearby location>.
  if ((m = t.match(/^(you may |each player may )?summon (.+?) from (your|a|any|their) cemetery (here|there|to (?:its|this|her|his|her) location|to (?:this|that) site|to a nearby location)\.$/i)) || (m = t.match(/^(you may )?summon (a dead minion) ()(here|there)\.$/i))) {
    const cf = cardFilter(m[2], self); if (!cf) return null;
    const near = /nearby/i.test(m[4]);
    return { fx: pickFx({ zones: [m[3] && /your|their/i.test(m[3]) ? 'cemetery' : 'anyCemetery'], take: cf.count, filter: { ...cf.filter, ...(cf.filter.type ? {} : { minion: true }) }, to: 'summon', where: near ? 'choose' : 'here' }, !!m[1], near ? { who: 'atTarget', range: 'nearby' } : {}), used };
  }
  // (You may) cast / summon <named card> from your collection <to this site | here | to your Avatar's location>.
  if ((m = t.match(/^(you may )?(cast|summon) (.+?) from your collection (to this site|here|there|to this location|to (?:this|its) location|to your avatar's location)\.$/i))) {
    const cf = cardFilter(m[3], self); if (!cf) return null;
    return { fx: pickFx({ zones: ['collection'], take: cf.count, filter: cf.filter, to: m[2].toLowerCase() === 'cast' ? 'cast' : 'summon', where: /avatar/i.test(m[4]) ? 'avatar' : 'here' }, !!m[1]), used };
  }
  // Reveal your next N spells, then summon all X from among them to this site. + Put the rest on the bottom …
  if ((m = t.match(/^reveal your (?:next|top) (\w+) spells, then summon all (.+?) from among them (?:to this site|here)\.$/i))) {
    const cf = cardFilter(m[2].replace(/^/, 'all '), self); if (!cf) return null;
    const pick: ZonePick = { zones: ['spellbook'], top: WORDNUM[m[1].toLowerCase()] ?? +m[1], take: 'all', filter: cf.filter, to: 'summon', where: 'here', reveal: true, rest: 'stay' };
    if (next(/^Put the rest (?:at|on) the bottom(?: of your spellbook)?(?: in (?:a random|any) order)?\.$/i)) pick.rest = 'bottom';
    return { fx: pickFx(pick, false), used };
  }
  // Reveal your topmost spell. + If it's a minion, you may summon it here.
  if (/^reveal your top(?:most)? spell\.$/i.test(t)) {
    const f = next(/^If it'?s an? (minion|magic|artifact|aura), you may summon it here\.$/i);
    if (!f) return null;
    return { fx: pickFx({ zones: ['spellbook'], top: 1, take: 1, filter: { type: [cap(f[1].toLowerCase()) as CardType] }, to: 'summon', where: 'here', reveal: true, rest: 'stay' }, true), used };
  }
  // Target opponent reveals their hand. + You may banish a card from it. / Look at each opponent's hand.
  if ((m = t.match(/^(?:target opponent reveals their hand|look at (?:each|your) opponent'?s'? hand)( and banishes a card)?\.$/i))) {
    const f = next(/^You may banish a card from it\.$/i);
    return { fx: pickFx({ zones: ['oppHand'], take: f || m[1] ? 1 : 0, to: f || m[1] ? 'banish' : 'none' }, !!f), used };
  }
  return null;
}

interface Rule { id: string; label: string; re: RegExp; build: (m: RegExpMatchArray, on: Trigger, type: CardType) => Omit<Effect, 'on'>[] | null }
const KW = `(?:${GRANTABLE.join('|')})`;
const UNTIL = '( this turn| until the end of (?:the|this) turn| until your next turn)?';
const until = (w: string | undefined, on: Trigger): Effect['until'] => (on === 'static' ? 'permanent' : !w ? 'permanent' : /next/.test(w) ? 'next' : 'turn');
const num = (x?: string) => (x ? parseInt(x.replace('−', '-'), 10) : 0);
const kwList = (t: string) => t.split(/, and |, | and /).map((k) => GRANTABLE.find((g) => g.toLowerCase() === k.trim().toLowerCase())).filter((k): k is string => !!k);

export const RULES: Rule[] = [
  { id: 'avatar-site', label: 'Avatar: tap to play or draw a site', re: /^play or draw a site\.?$/i, build: () => [] },
  // damage
  { id: 'damage', label: 'Deal N damage to …', re: new RegExp(`^deal ${NUM} damage to (.+?)\\.$`, 'i'),
    build: (m) => { if (/^this site$/i.test(m[2])) return [{ op: 'damage', ...amount(m[1]), who: 'siteHere' }]; const v = nounPhrase(m[2]); return v ? [{ op: 'damage', ...amount(m[1]), ...v }] : null; } },
  { id: 'takes-damage', label: '… takes N damage', re: new RegExp(`^(.+?) takes? ${NUM} damage\\.$`, 'i'),
    build: (m) => { const v = nounPhrase(m[1]); return v ? [{ op: 'damage', ...amount(m[2]), ...v }] : null; } },
  { id: 'strike', label: 'Strike …', re: /^(?:this |it )?strikes? (.+?)\.$/i,
    build: (m, on, type) => { if (type === 'Site' || type === 'Aura') return null; const v = nounPhrase(m[1]); return v && v.who !== 'self' ? [{ op: 'strike', ...v }] : null; } },
  { id: 'shoot', label: 'Shoot a projectile that deals N damage', re: new RegExp(`^shoot (?:a|one) (?:${NUM}-damage )?projectile(?: that deals ${NUM} damage)?\\.$`, 'i'),
    build: (m) => { const n = m[1] ?? m[2]; return n ? [{ op: 'shoot', ...amount(n), who: 'controller' }] : null; } },
  // removal
  { id: 'destroy', label: 'Destroy / kill …', re: /^(?:destroy|kill|slay) (.+?)\.$/i, build: (m) => { const v = minionOnly(nounPhrase(m[1], 'minion')); return v ? [{ op: 'destroy', ...v }] : null; } },
  { id: 'banish', label: 'Banish …', re: /^banish (.+?)\.$/i, build: (m) => { const v = minionOnly(nounPhrase(m[1], 'minion')); return v ? [{ op: 'banish', ...v }] : null; } },
  { id: 'bounce', label: "Return … to its owner's hand", re: /^return (.+?) to (?:its|their) owner'?s'? hands?\.$/i, build: (m) => { const v = minionOnly(nounPhrase(m[1], 'minion')); return v ? [{ op: 'bounce', ...v }] : null; } },
  { id: 'tap', label: 'Tap / untap …', re: /^(tap|untap) (.+?)\.$/i, build: (m) => { const v = nounPhrase(m[2]); return v ? [{ op: m[1].toLowerCase() as 'tap' | 'untap', ...v }] : null; } },
  // life
  { id: 'gain-life', label: 'You heal / gain N life', re: new RegExp(`^(?:you |your avatar )?(?:gains?|heals?) ${NUM}(?: life)?\\.$`, 'i'), build: (m) => [{ op: 'heal', ...amount(m[1]), who: 'controller' }] },
  { id: 'heal-unit', label: 'Heal …', re: new RegExp(`^(?:fully )?heal (.+?)(?: by ${NUM})?\\.$`, 'i'), build: (m) => { const v = nounPhrase(m[1]); return v && m[2] ? [{ op: 'heal', ...amount(m[2]), ...v }] : null; } },
  { id: 'avatars-heal', label: 'Each nearby Avatar heals N', re: new RegExp(`^each (nearby )?avatar (?:heals|gains) ${NUM}(?: life)?\\.$`, 'i'), build: (m) => [{ op: 'heal', ...amount(m[2]), who: m[1] ? 'nearbyAvatars' : 'allAvatars' }] },
  { id: 'lose-life', label: 'You lose N life', re: new RegExp(`^(?:you )?lose ${NUM} life\\.$`, 'i'), build: (m) => [{ op: 'loseLife', ...amount(m[1]), who: 'controller' }] },
  { id: 'opponent-loses', label: 'Opponent loses N life', re: new RegExp(`^(?:your |each )?(opponents?|enemy|other players?|players?)s? loses? ${NUM} life\\.$`, 'i'),
    build: (m) => [{ op: 'loseLife', ...amount(m[2]), who: /^players?$/i.test(m[1]) ? 'allAvatars' : 'opponent' }] },
  // cards
  { id: 'draw', label: 'Draw N spells / sites / cards', re: new RegExp(`^(?:you (?:may )?)?draw ${NUM} (spell|site|card)s?\\.$`, 'i'),
    build: (m) => [{ op: 'draw', ...amount(m[1]), who: 'controller', ...(m[2].toLowerCase() === 'card' ? {} : { deck: m[2].toLowerCase() === 'site' ? 'atlas' as const : 'spellbook' as const }) }] },
  { id: 'opponent-draws', label: 'Your opponent draws', re: new RegExp(`^(?:your |each )?opponent draws ${NUM} (spell|site)s?\\.$`, 'i'),
    build: (m) => [{ op: 'draw', ...amount(m[1]), who: 'opponent', deck: m[2].toLowerCase() === 'site' ? 'atlas' : 'spellbook' }] },
  { id: 'discard-random', label: 'Discard at random', re: new RegExp(`^(?:(your |each )?(opponent) |you )?discards? ${NUM} (?:random )?(?:card|spell)s?(?: at random)?\\.$`, 'i'),
    build: (m) => (/random/i.test(m[0]) ? [{ op: 'discard', ...amount(m[3]), who: m[2] ? 'opponent' : 'controller', random: 1 }] : null) },
  { id: 'discard-choose', label: 'Discard a spell / site / card (you choose)', re: /^discard (?:a|one) (spell|site|card)\.$/i,
    build: (m) => [{ op: 'discard', n: 1, who: 'controller', ...(m[1].toLowerCase() === 'card' ? {} : { deck: m[1].toLowerCase() === 'site' ? 'atlas' as const : 'spellbook' as const }) }] },
  // mana and threshold
  { id: 'mana', label: 'Gain mana this turn', re: new RegExp(`^(?:you )?gain ${MANA}(?: this turn)?\\.$`, 'i'), build: (m) => [{ op: 'mana', n: manaOf(m[1]), who: 'controller' }] },
  { id: 'mana-only-copy', label: 'If this is the only …, gain mana', re: new RegExp(`^if this is the only .+ you control, gain ${MANA} this turn\\.$`, 'i'),
    build: (m, on) => (on === 'genesis' ? [{ op: 'mana', n: manaOf(m[1]), who: 'controller', cond: 'onlyCopy' }] : null) },
  { id: 'provides-mana-first', label: 'Provides an additional ① and (E)(F)…', re: new RegExp(`^(?:this site |this )?provides? (?:an additional )?${MANA} and ((?:\\([AEFW]\\))+)\\.$`, 'i'),
    build: (m, on) => (on === 'static' ? [{ op: 'provide', who: 'controller', n: manaOf(m[1]), el: elementsOf(m[2]) }] : null) },
  { id: 'provides', label: 'Provides mana / threshold', re: /^(?:this site |this )?provides? ((?:\([AEFW]\))*)(?:\s*(?:and|,)?\s*(?:an additional )?([①-⑳]|\(\d+\)))?( to its controller)?( this turn)?\.?$/i,
    build: (m, on) => {
      const el = elementsOf(m[1] ?? ''); const n = m[2] ? manaOf(m[2]) : 0;
      if (!Object.keys(el).length && !n) return null;
      if (on === 'static' && m[4]) return null;
      if (on !== 'static' && !m[4]) return null;
      return [{ op: 'provide', who: 'controller', ...(Object.keys(el).length ? { el } : {}), ...(n ? { n } : {}) }];
    } },
  // power and keywords
  { id: 'power', label: '… gets / has +N power', re: new RegExp(`^(?:give )?(.+?) (?:gets?|gains?|has|have|\\+)? ?([+\\-−]\\d+) power(?: and ([+\\-−]\\d+) defen[cs]e)?${UNTIL}\\.$`, 'i'),
    build: (m, on) => {
      const v = nounPhrase(m[1]); if (!v || (on === 'static' && ((v.who === 'target' && !v.ref) || v.who === 'atTarget'))) return null;
      if (on === 'static' && m[4]) return null;
      return [{ op: 'buff', ...v, atk: num(m[2]), def: m[3] ? num(m[3]) : num(m[2]), until: until(m[4], on) }];
    } },
  // rulebook p12 "Bodies of Water & Land"
  { id: 'allies-in-body', label: 'Other allies occupying this body of water have +N power', re: /^(other )?allies (?:occupying|in) this(?:'s)? (body of water|span of land) have \+(\d+) power\.$/i,
    build: (m, on) => (on === 'static' ? [{ op: 'buff', who: 'alliesInBody', ...(m[1] ? { other: true } : {}), atk: +m[3], def: +m[3], until: 'permanent' }] : null) },
  { id: 'heal-body', label: 'Each ally heals the number of sites in its body of water', re: /^each ally heals an amount equal to the number of sites in its body of water\.$/i,
    build: (_m, on) => (on !== 'static' ? [{ op: 'heal', who: 'allyUnits', amount: 'victimBody' }] : null) },
  { id: 'power-per', label: '… has +N power for each …', re: /^(.+?) (?:has|have) \+(\d+) power for each (.+?)\.$/i,
    build: (m, on) => {
      if (on !== 'static') return null;
      const v = nounPhrase(m[1]); if (!v || (v.who !== 'self' && v.who !== 'ownAvatar' && v.who !== 'bearer')) return null;
      const w = m[3].toLowerCase(); let per: Effect['per'] | null = null; let mm: RegExpMatchArray | null;
      if (/^other this nearby$/.test(w)) per = { kind: 'sameNearby' };
      else if (/^adjacent site$/.test(w)) per = { kind: 'adjacentSites' };
      else if ((mm = w.match(/^nearby (?:(air|earth|fire|water) )?site$/))) per = { kind: 'nearbySites', ...(mm[1] ? { el: mm[1] as Element } : {}) };
      else if (/^ward in the realm$/.test(w)) per = { kind: 'wards' };
      else if ((mm = w.match(/^of your dead (\w+)$/))) { const sb = subOf(mm[1]); per = sb ? { kind: 'deadSub', sub: sb } : /^minions$/.test(mm[1]) ? { kind: 'deadSub' } : null; }
      else if (/^this in your cemetery$/.test(w)) per = { kind: 'sameInCemetery' };
      else if (/^void in (?:their|its|this's) row$/.test(w)) per = { kind: 'voidsInRow' };
      else if ((mm = w.match(/^site in (?:her|his|their|its|this's) (body of water|span of land)$/))) per = { kind: 'bodySites', body: mm[1] === 'body of water' ? 'water' : 'land' }; // rulebook p12
      return per ? [{ op: 'buff', ...v, atk: +m[2], def: +m[2], until: 'permanent', per }] : null;
    } },
  { id: 'has-list', label: '… has +N power, a keyword, and …', re: /^(.+?) (?:has|have|gains?|gets?) ((?:[^,]+, )*[^,]+?,? and [^,]+?)( this turn| until your next turn)?\.$/i,
    build: (m, on) => {
      const v = nounPhrase(m[1]); if (!v || (on === 'static' && ((v.who === 'target' && !v.ref) || v.who === 'atTarget'))) return null;
      const items = m[2].split(/, and |, | and /).map((x) => x.trim()); if (items.length < 2) return null;
      const out: Omit<Effect, 'on'>[] = [];
      for (const it of items) {
        let mm: RegExpMatchArray | null;
        if ((mm = it.match(/^([+\-−]\d+) power$/i))) out.push({ op: 'buff', ...v, atk: num(mm[1]), def: num(mm[1]), until: until(m[3], on) });
        else if ((mm = it.match(/^(ranged|movement) \+?(\d+)$/i))) out.push({ op: 'grant', ...v, keyword: cap(mm[1].toLowerCase()), n: +mm[2], until: until(m[3], on) });
        else { const k = GRANTABLE.concat(['Ranged']).find((g) => g.toLowerCase() === it.toLowerCase()); if (!k) return null; out.push({ op: 'grant', ...v, keyword: k, until: until(m[3], on) }); }
      }
      return out;
    } },
  { id: 'give-power', label: 'Give … +N power', re: new RegExp(`^give (.+?) ([+\\-−]\\d+) power${UNTIL}\\.$`, 'i'),
    build: (m, on) => { const v = nounPhrase(m[1]); return v && on !== 'static' ? [{ op: 'buff', ...v, atk: num(m[2]), def: num(m[2]), until: until(m[3], on) }] : null; } },
  { id: 'grant', label: '… gains / has a keyword', re: new RegExp(`^(.+?) (?:gets?|gains?|has|have) (${KW}(?:(?:, | and |, and )${KW})*)${UNTIL}\\.$`, 'i'),
    build: (m, on) => {
      const v = nounPhrase(m[1]); if (!v || (on === 'static' && ((v.who === 'target' && !v.ref) || v.who === 'atTarget'))) return null;
      if (on === 'static' && m[3]) return null;
      return kwList(m[2]).map((keyword) => ({ op: 'grant' as const, ...v, keyword, until: until(m[3], on) }));
    } },
  { id: 'give-keyword', label: 'Give … a keyword', re: new RegExp(`^give (.+?) (${KW}(?:(?:, | and |, and )${KW})*)${UNTIL}\\.$`, 'i'),
    build: (m, on) => { const v = nounPhrase(m[1]); return v && on !== 'static' ? kwList(m[2]).map((keyword) => ({ op: 'grant' as const, ...v, keyword, until: until(m[3], on) })) : null; } },
  { id: 'ward', label: 'Ward …', re: /^(?:give )?(.+?) (?:gains? )?(?:a )?ward\.$|^ward (.+?)\.$/i,
    build: (m, on) => { const v = nounPhrase(m[1] ?? m[2]); return v && on !== 'static' ? [{ op: 'grant', ...v, keyword: 'Ward', until: 'permanent' }] : null; } },
  { id: 'disable', label: 'Disable …', re: new RegExp(`^disable (.+?)${UNTIL}\\.$`, 'i'),
    build: (m, on) => { const v = minionOnly(nounPhrase(m[1], 'minion')); return v && on !== 'static' ? [{ op: 'grant', ...v, keyword: 'Disabled', until: until(m[2], on) }] : null; } },
  { id: 'bearer-spellcaster', label: 'Bearer has +N power and is a (Fire …) Spellcaster', re: /^(bearer|this) has ([+\-−]\d+) power and is an? (?:((?:air|earth|fire|water)(?: and (?:air|earth|fire|water))?|non-\w+) )?spellcaster\.$/i,
    build: (m, on) => { const kw = m[3] ? limitedSpellcaster(m[3]) : 'Spellcaster'; return on === 'static' && kw ? [{ op: 'buff', who: m[1].toLowerCase() === 'bearer' ? 'bearer' : 'self', atk: num(m[2]), def: num(m[2]), until: 'permanent' }, { op: 'grant', who: m[1].toLowerCase() === 'bearer' ? 'bearer' : 'self', keyword: kw, until: 'permanent' }] : null; } },
  { id: 'ward-site', label: 'Ward this site', re: /^ward (?:this|its) site\.$/i, build: (m, on) => (on !== 'static' ? [{ op: 'grant', who: 'siteHere', keyword: 'Ward', until: 'permanent' }] : null) },
  { id: 'mill', label: 'Discard your top N spells', re: new RegExp(`^discard your top(?:most)? (?:${NUM} )?(spell|site)s?\\.$`, 'i'),
    build: (m) => [{ op: 'mill', ...amount(m[1] ?? 'a'), who: 'controller', deck: m[2].toLowerCase() === 'site' ? 'atlas' : 'spellbook' }] },
  { id: 'avatars-discard', label: 'Each nearby Avatar discards a random card', re: /^each (nearby )?avatar discards a random (?:card|spell)\.$/i,
    build: (m) => [{ op: 'discard', n: 1, who: m[1] ? 'nearbyAvatars' : 'allAvatars', random: 1 }] },
  { id: 'draw-bottom', label: 'Draw your bottommost spell', re: /^draw your bottom(?:most)? (spell|site)\.$/i, build: (m) => [{ op: 'draw', n: 1, who: 'controller', deck: m[1].toLowerCase() === 'site' ? 'atlas' : 'spellbook', fromBottom: true }] },
  { id: 'sink', label: 'Submerge / burrow …', re: /^(submerge|burrow) (.+?)(?:, if able)?\.$/i,
    build: (m) => { const v = minionOnly(nounPhrase(m[2].replace(/ or artifacts?\b| and artifacts\b|,? minions and artifacts/gi, (x) => (/minions/i.test(x) ? ' minions' : '')), 'minion')); return v ? [{ op: 'sink', ...v, under: m[1].toLowerCase() === 'submerge' ? 'water' : 'land' }] : null; } },
  { id: 'lure', label: 'Lure / force … to step closer', re: /^(?:lure|force|tempt) (.+?) (?:to|into) (?:take a step|taking a step|step) (closer|towards? (?:her|him|this|this one|it|them))\.$/i,
    build: (m) => { const v = minionOnly(nounPhrase(m[1], 'minion')); return v ? [{ op: 'teleport', ...v, move: 'step', dest: 'toward' }] : null; } },
  { id: 'make-step', label: 'Make it step closer / away', re: /^make (?:it|them) (?:take a )?step (closer|away)\.$/i,
    build: (m) => [{ op: 'teleport', who: 'target', ref: true, move: 'step', dest: m[1].toLowerCase() === 'away' ? 'away' : 'toward' }] },
  { id: 'teleport-here', label: 'Teleport / drag … to this location', re: /^(teleport|drag|pull)s? (?:in )?(.+?)(?: from an adjacent site)? to (this location|here|its location|the caster'?s location|your location)(?:, ignoring regions)?\.$|^(drag)s? in (.+?)\.$/i,
    build: (m) => { const v = nounPhrase(m[2] ?? m[5]); if (!v || v.who === 'self') return null; const dest = /caster/i.test(m[3] ?? '') ? 'caster' : 'here'; return [{ op: 'teleport', ...v, move: /teleport/i.test(m[1] ?? '') ? 'teleport' : 'drag', dest }]; } },
  { id: 'teleport-all', label: 'Teleport any number of … to …', re: /^teleport (?:any number of|all) (.+?) (here|to the caster'?s location|to this location)\.$/i,
    build: (m) => { const v = nounPhrase('all ' + m[1]); return v && v.who !== 'target' ? [{ op: 'teleport', ...v, move: 'teleport', dest: /caster/i.test(m[2]) ? 'caster' : 'here' }] : null; } },
  { id: 'aura-step', label: 'Move this aura one step', re: /^move (?:this|it) one step\.$/i, build: (_m, _on, type) => (type === 'Aura' ? [{ op: 'moveAura', who: 'self' }] : null) },
  { id: 'teleport-random', label: 'Teleport to a random site or void', re: /^(?:this )?teleports? (?:this )?to the top of a random site or void\.$/i, build: () => [{ op: 'teleport', who: 'self', move: 'teleport', dest: 'random' }] },
  { id: 'teleport-self-nearby', label: 'Teleport to another nearby location', re: /^(?:this )?(?:may )?teleports? to (?:another|a) nearby location(?: or void)?\.$/i, build: () => [{ op: 'teleport', who: 'self', move: 'teleport', dest: 'nearby' }] },
  { id: 'take-step', label: '… takes a step', re: /^(.+?) (?:may )?takes? a step\.$/i,
    build: (m) => { const v = nounPhrase(m[1]); return v && (v.who === 'self' || v.who === 'target') ? [{ op: 'teleport', ...v, move: 'step', dest: 'adjacent' }] : null; } },
  { id: 'fly-to', label: 'Fly to … (to Ward / strike it)', re: /^fly to (.+?)(?: to (ward|strike) it)?\.$/i,
    build: (m) => { const v = nounPhrase(m[1]); if (!v || v.who !== 'target') return null; const fx: Omit<Effect, 'on'>[] = [{ op: 'teleport', ...v, move: 'teleport', dest: 'to' }]; if (m[2]) fx.push(m[2].toLowerCase() === 'ward' ? { op: 'grant', who: 'target', ref: true, keyword: 'Ward', until: 'permanent' } : { op: 'strike', who: 'target', ref: true }); return fx; } },
  { id: 'teleport', label: 'Teleport an ally …', re: /^(?:teleport (an? ally|an allied minion|target (?:allied )?minion|target ally) to (?:the surface of )?(?:target|a) site|(an? ally|an allied minion) teleports to a location (?:it'?s|it is) nearby)\.$/i,
    build: (m) => { const v = nounPhrase(m[1] ?? m[2]); return v?.who === 'target' ? [{ op: 'teleport', ...v, dest: m[1] ? 'site' : 'nearby' }] : null; } },
  { id: 'give-movement', label: 'Give … Movement +N', re: new RegExp(`^give (.+?) movement \\+(\\d+)${UNTIL}\\.$`, 'i'),
    build: (m, on) => { const v = nounPhrase(m[1]); return v && on !== 'static' ? [{ op: 'grant', ...v, keyword: 'Movement', n: +m[2], until: until(m[3], on) }] : null; } },
  { id: 'site-flooded', label: 'This site is flooded', re: /^this site is flooded\.$/i, build: (m, on) => (on === 'static' ? [{ op: 'grant', who: 'siteHere', keyword: 'Flood', until: 'permanent' }] : null) },
  { id: 'reminder', label: 'Reminder sentence (nothing to do)', re: /^(?:it|this) is a water site\.$|^they'?re water sites\.$/i, build: () => [] },
  { id: 'passive-flags', label: 'Passive rules on itself', re: /^(?:this )?(doesn'?t strike back while defending|may be summoned to any site|you may play this site to any corner|immediately heals from damage that doesn'?t kill it|the first time this would take damage each turn, prevent that damage)\.$/i,
    build: (m, on) => {
      if (on !== 'static') return null;
      const t = m[1].toLowerCase();
      const kw = /strike back/.test(t) ? "Doesn't strike back while defending" : /summoned to any site/.test(t) ? 'Summon to any site' : /any corner/.test(t) ? 'Play to any corner' : /first time/.test(t) ? 'Prevent first damage each turn' : 'Heals from damage that does not kill it';
      return [{ op: 'grant', who: 'self', keyword: kw, until: 'permanent' }];
    } },
  { id: 'lance-token', label: 'Acquire a Lance token', re: /^(?:this )?acquires? a lance(?: token)?\.$/i, build: () => [{ op: 'grant', who: 'self', keyword: 'Lance', until: 'permanent' }] },
  { id: 'first-strike-attacking', label: 'Strikes first while attacking', re: /^(?:this )?strikes first while attacking\.$/i, build: (m, on) => (on === 'static' ? [{ op: 'grant', who: 'self', keyword: 'Strikes first while attacking', until: 'permanent' }] : null) },
  { id: 'site-controller-life', label: "The controller of this's site heals / loses N life", re: /^the controller of (?:this'?s?|its) site (heals|loses) (\d+)(?: life)?\.$/i,
    build: (m) => [{ op: /heal/i.test(m[1]) ? 'heal' : 'loseLife', n: +m[2], who: 'siteController' }] },
  // rulebook p34 "Moves Freely": a step whose start and end meet the condition costs no step
  // rulebook p28 "When Sites Move": everything atop and under it moves with it
  { id: 'site-fly', label: 'This site flies to a nearby void', re: /^(?:this site )?(?:may )?fly to a nearby void\.$/i,
    build: (_m, on) => (on !== 'static' ? [{ op: 'moveSite', who: 'siteHere', dest: 'nearbyVoid' }] : null) },
  { id: 'chain', label: 'Any number of times, spend ② to also target a new unit nearby the previous one', re: /^any number of times, you may spend ([①-⑳]|\(\d+\)) to additionally target a new (unit|minion) nearby the previous one\.$/i,
    build: (m, on) => (on !== 'static' ? [{ op: 'chain', who: 'controller', range: 'nearby', targets: true, pay: manaOf(m[1]), ...(m[2].toLowerCase() === 'minion' ? { only: 'minion' as const } : {}) }] : null) },
  // follow-up actions (the engine offers them right after the triggering action)
  { id: 'step-after-shot', label: 'After a ranged strike, this may take a step', re: /^immediately after performing a ranged strike, this may take a step\.$/i,
    build: (_m, on) => (on === 'static' ? [{ op: 'grant', who: 'self', keyword: 'Steps after shooting', until: 'permanent' }] : null) },
  { id: 'shoot-while-moving', label: 'During basic movement, this may shoot from along its path', re: /^during basic movement, this may perform a ranged strike from any location along (?:their|its|the) path\.$/i,
    build: (_m, on) => (on === 'static' ? [{ op: 'grant', who: 'self', keyword: 'Shoots while moving', until: 'permanent' }] : null) },
  // Codex "Can't be Modified"
  { id: 'cant-modify', label: "Can't be modified (except by Wards)", re: /^(?:this )?can'?t be modified(, except by wards)?\.$/i,
    build: (m, on) => (on === 'static' ? [{ op: 'grant', who: 'self', keyword: m[1] ? "Can't be modified except by Wards" : "Can't be modified", until: 'permanent' }] : null) },
  { id: 'site-fixed', label: "Can't be moved, destroyed, or modified (a site)", re: /^(?:this )?can'?t be moved, destroyed, or modified\.$/i,
    build: (_m, on, type) => (on === 'static' && type === 'Site' ? [{ op: 'grant', who: 'siteHere', keyword: "Can't be moved, destroyed, or modified", until: 'permanent' }] : null) },
  { id: 'range-plus', label: 'Ranged units atop this site have +N range', re: /^ranged units (?:atop this site|here) have \+(\d+) range\.$/i,
    build: (m, on) => (on === 'static' ? [{ op: 'buff', who: 'unitsHere', surface: true, kw: 'Ranged', atk: 0, def: 0, rangePlus: +m[1], until: 'permanent' }] : null) },
  { id: 'forward-only', label: 'Can only move themselves forward', re: /^(?:this )?can only move (?:themselves|itself) forward\.$/i,
    build: (_m, on) => (on === 'static' ? [{ op: 'grant', who: 'self', keyword: 'Moves only forward', until: 'permanent' }] : null) },
  // Codex "Ongoing Effect": "Until your next turn, units are Immobile while they occupy nearby sites."
  { id: 'until-next-ongoing', label: 'Until your next turn, … (an ongoing effect)', re: /^until your next turn, (.+)\.$/i,
    build: (m, on, type) => {
      if (on === 'static') return null;
      // "units are Immobile while they occupy nearby sites" → "units nearby are Immobile"
      const body = cap(m[1].replace(/^(.+?) (are|is) (.+?) while they occupy (nearby sites|this site|here)$/i, (_x, who, verb, what, w) => `${who} ${/nearby/i.test(w) ? 'nearby' : 'here'} ${verb} ${what}`)) + '.';
      const r = matchSentence(body, 'static', type, false);
      return r && r.got.every((e) => (e.op === 'grant' || e.op === 'buff') && e.who !== 'target' && e.who !== 'self') ? [{ op: 'ongoing', who: 'controller', fx: r.got }] : null;
    } },
  { id: 'void-gate', label: 'Minions here can traverse the void, gaining Voidwalk until leaving it', re: /^minions here can traverse the void, gaining voidwalk until leaving it\.$/i,
    build: (_m, on) => (on === 'static' ? [{ op: 'grant', who: 'minionsHere', keyword: 'Voidwalk', until: 'permanent' }, { op: 'grant', who: 'siteHere', keyword: 'Void gate', until: 'permanent' }] : null) },
  { id: 'move-freely-away', label: '(Airborne) minions atop this move freely away', re: /^(airborne )?minions atop this (?:site )?move freely away\.$/i,
    build: (m, on) => (on === 'static' ? [{ op: 'grant', who: 'siteHere', keyword: 'Moves freely away', until: 'permanent', ...(m[1] ? { kw: 'Airborne' } : {}) }] : null) },
  { id: 'no-enter', label: "… can't enter this site", re: /^(units with (\d+) or more power|allies|enemies|enemy units|minions) can'?t (?:enter|move to) (?:this site|here)( on the ground)?( if there'?s already a minion atop)?\.$/i,
    build: (m, on) => (on === 'static' ? [{ op: 'grant', who: 'siteHere', keyword: 'No entry', until: 'permanent', noEnter: { ...(m[2] ? { minPower: +m[2] } : {}), ...(/^allies/i.test(m[1]) ? { side: 'ally' as const } : /^enem/i.test(m[1]) ? { side: 'enemy' as const } : {}), ...(m[4] ? { occupied: true } : {}), ...(m[3] ? { ground: true } : {}) } }] : null) },
  { id: 'gain-control', label: 'Gain control of …', re: /^gain control of (.+?)( this turn)?( and untap it)?\.$/i,
    build: (m) => { const v = minionOnly(nounPhrase(m[1], 'minion')); if (!v) return null; const fx: Omit<Effect, 'on'>[] = [{ op: 'control', ...v, until: m[2] ? 'turn' : 'permanent' }]; if (m[3]) fx.push({ op: 'untap', who: 'target', ref: true }); return fx; } },
  { id: 'summon-token-each', label: 'Summon a token to each … site', re: new RegExp(`^summon ${NUM} (foot soldier|skeleton|frog)(?: tokens?)? (?:token )?to (each other adjacent site|each adjacent location|each (?:site you control|allied site) that borders an enemy site|each site near your avatar|an allied site|an allied minion)\\.$`, 'i'),
    build: (m) => { const w = m[3].toLowerCase(); const places = /adjacent location/.test(w) ? 'adjacentLocations' : /adjacent/.test(w) ? 'adjacentSites' : /borders/.test(w) ? 'bordersEnemy' : /avatar/.test(w) ? 'nearAvatar' : /allied minion/.test(w) ? 'allyMinion' : 'allySite';
      return [{ op: 'summon', ...amount(m[1]), token: m[2].replace(/\b\w/g, (c) => c.toUpperCase()), places, ...(places === 'allyMinion' ? { who: 'target' as const, only: 'allyMinion' as const, range: 'any' as const } : places === 'allySite' ? { who: 'atTarget' as const, range: 'any' as const } : { who: 'controller' as const }) }]; } },
  { id: 'lasts', label: 'Lasts N of your turns', re: /^lasts (\w+) of your turns\.$/i, build: (m, on) => (on === 'static' ? [{ op: 'lasts', who: 'self', n: WORDNUM[m[1].toLowerCase()] ?? +m[1] }] : null) },
  { id: 'affected-flooded', label: 'Affected sites are flooded', re: /^affected (?:\w+ )?sites are flooded\.$/i, build: (m, on) => (on === 'static' ? [{ op: 'grant', who: 'affectedSites', keyword: 'Flood', until: 'permanent' }] : null) },
  { id: 'first-damage', label: 'Prevent the first damage each turn', re: /^the first time .+? would take damage each turn, prevent that damage\.$/i,
    build: (m, on) => (on === 'static' ? [{ op: 'grant', who: 'self', keyword: 'Prevent first damage each turn', until: 'permanent' }] : null) },
  { id: 'destroy-site', label: 'Destroy a nearby site', re: /^destroy (?:a|target) (nearby |adjacent )?site\.$/i,
    build: (m) => [{ op: 'destroySite', who: 'atTarget', range: (m[1]?.trim() || 'any') as Effect['range'], siteKind: undefined }] },
  { id: 'after-site-rubble', label: 'If you played an earth site, fill a void with Rubble', re: /^if you played an? (air|earth|fire|water) site, fill a void adjacent to you with rubble\.$/i,
    build: (m) => [{ op: 'rubble', who: 'atTarget', range: 'adjacent', afterSite: m[1].toLowerCase() as Element }] },
  { id: 'replace-rubble', label: 'Replace an adjacent Rubble with your top site', re: /^replace an adjacent rubble with the top(?:most)? site of your atlas\.$/i,
    build: () => [{ op: 'replaceRubble', who: 'atTarget', range: 'adjacent' }] },
  { id: 'choose-location', label: 'Target a location', re: /^target (?:a )?(nearby |adjacent )?location(?: up to (two|three) steps away)?\.$/i, build: (m) => [{ op: 'choose', who: 'atTarget', range: (m[1]?.trim() || m[2]?.toLowerCase() || 'any') as Effect['range'], targets: true }] },
  { id: 'damage-air-cast', label: 'Damage equal to the (A) on spells cast this turn', re: /^deal damage to another random unit there equal to the sum of \((A|E|F|W)\) on spells you'?ve cast this turn\.$/i,
    build: (m) => (m[1] === 'A' ? [{ op: 'damage', who: 'atTarget', refCell: true, random: 1, other: true, amount: 'airCastThisTurn' }] : null) },
  { id: 'flood-near-water', label: 'Flood a site near your body of water', re: /^flood a site near your body of water until you do so again\.$/i, build: () => [{ op: 'flood', who: 'atTarget', range: 'any' }] },
  { id: 'tap-without', label: 'Tap minions without a keyword there', re: /^tap minions without (\w+) there\.$/i,
    build: (m) => { const k = KEYWORDS.find((x) => x.toLowerCase() === m[1].toLowerCase()); return k ? [{ op: 'tap', who: 'atTarget', refCell: true, only: 'minion', notKw: k }] : null; } },
  { id: 'lose-keyword', label: '… lose a keyword', re: new RegExp(`^(.+?) (?:permanently )?loses? (${KEYWORDS.join('|')})\\.$`, 'i'),
    build: (m, on) => { const v = nounPhrase(m[1]); const k = KEYWORDS.find((x) => x.toLowerCase() === m[2].toLowerCase()); return v && k && on === 'static' && v.who !== 'target' ? [{ op: 'grant', ...v, keyword: 'Loses ' + k, until: 'permanent' }] : null; } },
  { id: 'protection', label: "… can't be targeted / damaged / attacked / moved / destroyed", re: /^(.+?) can'?t be ((?:targeted|damaged|attacked|intercepted|moved by force|moved|destroyed|banished|immobilized|disabled|modified)(?:(?:, | or |, or )(?:targeted|damaged|attacked|intercepted|moved by force|moved|destroyed|banished|immobilized|disabled|modified))*)( by magic)?\.$/i,
    build: (m, on) => {
      if (on !== 'static') return null;
      const t = m[1].toLowerCase(); const siteToo = /^this site and minions here$/.test(t);
      const v = siteToo ? { who: 'self' as const } : nounPhrase(m[1]); if (!v || v.who === 'target') return null;
      const out: Omit<Effect, 'on'>[] = [];
      for (const w0 of m[2].split(/, or |, | or /)) {
        const w = w0.trim().toLowerCase(); const magic = !!m[3];
        const kw = w === 'targeted' ? (magic ? "Can't be targeted by magic" : null) : w === 'damaged' ? (magic ? "Can't be damaged by magic" : 'Immune to damage') : w === 'attacked' ? "Can't be attacked"
          : w === 'moved by force' || w === 'moved' ? "Can't be moved by force" : w === 'destroyed' ? "Can't be destroyed" : w === 'banished' ? "Can't be banished" : null; // intercepted, modified, immobilized, disabled: not enforced yet, so the sentence stays by hand
        if (kw === null) return null;
        out.push({ op: 'grant', ...v, keyword: siteToo ? 'Protects this site from attacks' : kw, until: 'permanent' });
      }
      return out;
    } },
  { id: 'immune', label: 'Immune to fire damage / Lethal', re: /^(?:this is |(.+?) (?:are|is) )?immune to (fire|water|air|earth) damage\.$|^(?:this is |(.+?) (?:are|is) )?immune to (lethal|damage|death blows)\.$/i,
    build: (m, on) => { if (on !== 'static') return null; const who = m[1] ?? m[3]; const v = who ? nounPhrase(who) : { who: 'self' as const }; if (!v || v.who === 'target') return null; const kw = m[2] ? `Immune to ${m[2].toLowerCase()} damage` : /lethal/i.test(m[4]) ? 'Immune to Lethal' : /damage/i.test(m[4]) ? 'Immune to damage' : null; return kw ? [{ op: 'grant', ...v, keyword: kw, until: 'permanent' }] : null; } },
  { id: 'cant-act', label: "… can't untap / attack / defend", re: /^(.+?) can'?t (untap|attack|attack or defend|defend)\.$/i,
    build: (m, on) => { const v = nounPhrase(m[1]); if (!v || on !== 'static' || v.who === 'target') return null; const w = m[2].toLowerCase(); return (w === 'attack or defend' ? ["Can't attack", "Can't defend"] : [w === 'untap' ? "Can't untap" : w === 'attack' ? "Can't attack" : "Can't defend"]).map((keyword) => ({ op: 'grant' as const, ...v, keyword, until: 'permanent' as const })); } },
  { id: 'lose-and-are', label: '… lose X and are Y', re: new RegExp(`^(.+?) loses? (${KEYWORDS.join('|')}) and (?:are|is) (${KEYWORDS.join('|')})\\.$`, 'i'),
    build: (m, on) => { const v = nounPhrase(m[1]); const a = KEYWORDS.find((x) => x.toLowerCase() === m[2].toLowerCase()), b = KEYWORDS.find((x) => x.toLowerCase() === m[3].toLowerCase()); return v && a && b && on === 'static' && v.who !== 'target' ? [{ op: 'grant', ...v, keyword: 'Loses ' + a, until: 'permanent' }, { op: 'grant', ...v, keyword: b, until: 'permanent' }] : null; } },
  { id: 'are-keyword', label: '… are Spellcasters / are disabled', re: new RegExp(`^(.+?) (?:is|are) (?:an? )?(${KEYWORDS.join('|')}|spellcasters|disabled)\\.$`, 'i'),
    build: (m, on) => { const v = nounPhrase(m[1]); const w = m[2].toLowerCase().replace(/s$/, ''); const k = KEYWORDS.find((x) => x.toLowerCase() === w); return v && k && on === 'static' && v.who !== 'target' && v.who !== 'self' ? [{ op: 'grant', ...v, keyword: k, until: 'permanent' }] : null; } },
  { id: 'break-wards', label: 'Break nearby Wards', re: /^break (nearby|adjacent|all) wards\.$/i,
    build: (m) => [{ op: 'unward', who: m[1].toLowerCase() === 'all' ? 'allMinions' : 'unitsNearby' }] },
  { id: 'fully-heal', label: 'Fully heal …', re: /^fully heal (.+?)\.$/i, build: (m) => { const v = nounPhrase(m[1]); return v ? [{ op: 'heal', n: 99, ...v }] : null; } },
  { id: 'bearer-number', label: 'Bearer has Ranged N / Movement +N', re: /^(bearer|this) has (ranged|movement) \+?(\d+)\.$/i,
    build: (m, on) => (on === 'static' ? [{ op: 'grant', who: m[1].toLowerCase() === 'bearer' ? 'bearer' : 'self', keyword: m[2].toLowerCase() === 'ranged' ? 'Ranged' : 'Movement', n: +m[3], until: 'permanent' }] : null) },
  { id: 'have-additional', label: 'You have an additional (E)(F)(W)(A)', re: /^you have an additional ((?:\([AEFW]\))+)\.$/i,
    build: (m, on) => (on === 'static' ? [{ op: 'provide', who: 'controller', el: elementsOf(m[1]) }] : null) },
  { id: 'summon-anywhere', label: 'Summon N tokens (you choose where)', re: new RegExp(`^summon ${NUM} (foot soldier|skeleton|frog)(?: token)?s?(?: tokens?)?\\.$`, 'i'),
    build: (m) => [{ op: 'summon', ...amount(m[1]), who: 'atTarget', range: 'any', token: m[2].replace(/\b\w/g, (c) => c.toUpperCase()) }] },
  { id: 'raise-dead', label: 'Summon a random dead minion', re: /^summon a random dead minion\.$/i, build: () => [{ op: 'raise', who: 'atTarget', range: 'any' }] },
  { id: 'cost-less', label: 'Costs (N) less to cast if …', re: new RegExp(`^costs? ${MANA} less to cast(?: if (.+?))?\\.$`, 'i'),
    build: (m) => { if (!m[2]) return [{ op: 'castRule', who: 'self', less2: manaOf(m[1]) }]; const w = condOf(m[2]); return w ? [{ op: 'castRule', who: 'self', less2: manaOf(m[1]), when: w }] : null; } },
  { id: 'cast-from-cemetery', label: 'May be cast from your cemetery', re: /^(?:you )?may (?:be )?cast(?: this(?: spell)?)? from your cemetery(, banishing it afterward)?\.$/i,
    build: (m) => [{ op: 'castRule', who: 'self', fromCemetery: true, ...(m[1] ? { banishAfter: true } : {}) }] },
  { id: 'cast-by-ally', label: 'May be cast by any ally / an allied X', re: /^may be cast by (?:any ally|an allied (\w+)(?: or (\w+))?)\.$/i,
    build: (m) => { const subs = [m[1], m[2]].filter(Boolean).map((x) => subOf(x!)); if (subs.some((x) => !x)) return null; return [{ op: 'castRule', who: 'self', byAlly: true, ...(subs.length ? { bySub: subs as string[] } : {}) }]; } },
  // deck-building rules apply when the deck is built (Decks screen), not during play
  // "may include any number of" is enforced by the deck builder (src/data/decks.ts copyLimit); "can't / must contain" is shown, not enforced
  { id: 'deckbuilding', label: 'Deck-building rule', re: /^your (?:spellbook|atlas|deck) (?:may include any number of|can'?t contain|must contain) .+\.$/i, build: () => [] },
  { id: 'prevent', label: 'Takes no / less damage (from …)', re: /^(.+?) takes? (no|(\d+) less) damage(?: from (.+?))?\.$/i,
    build: (m, on) => {
      if (on !== 'static') return null;
      const v = nounPhrase(m[1]); if (!v || v.who === 'target' || v.who === 'atTarget') return null;
      const f: Partial<Effect> = m[3] ? { less: +m[3] } : {};
      if (m[4]) {
        const src = m[4].toLowerCase(); let mm: RegExpMatchArray | null;
        if ((mm = src.match(/^units with (\d+) or more power$/))) f.fromMinPower = +mm[1];
        else if ((mm = src.match(/^(fire|water|air|earth) spells$/))) { f.fromElement = mm[1]; f.fromMagic = true; }
        else if (/^magic$|^spells$/.test(src)) f.fromMagic = true;
        else if ((mm = src.match(/^(deserts|rivers|towers|villages)$/))) f.fromSite = [mm[1].replace(/s$/, '').replace(/^./, (c) => c.toUpperCase())];
        else { const subs = src.split(/, and |, | and | or /).map((w) => subOf(w.trim())); if (!subs.length || subs.some((x) => !x)) return null; f.fromSub = subs as string[]; }
      }
      return [{ op: 'prevent', ...v, ...f }];
    } },
  // restrictions on itself
  { id: 'cant', label: "Can't defend / intercept", re: /^(?:this )?can'?t (defend or intercept|defend|intercept|move to defend)\.$/i,
    build: (m, on) => (on === 'static' ? (/defend or intercept/i.test(m[1]) ? ["Can't defend", "Can't intercept"] : [m[1].toLowerCase() === 'defend' ? "Can't defend" : m[1].toLowerCase() === 'intercept' ? "Can't intercept" : "Can't move to defend"]).map((keyword) => ({ op: 'grant' as const, who: 'self' as const, keyword, until: 'permanent' as const })) : null) },
  // tokens
  { id: 'summon-token', label: 'Summon a … token here', re: new RegExp(`^summon ${NUM} (foot soldier|skeleton|frog|bruin|tawny)(?: token)?s?(?: tokens?)? (?:here|there|to (?:its|this) location|at (?:its|this) location)\\.$`, 'i'),
    build: (m) => [{ op: 'summon', ...amount(m[1]), who: 'controller', token: m[2].replace(/\b\w/g, (c) => c.toUpperCase()) }] },
];

/** Which ops make sense for each trigger. A static line can only change stats, keywords, prevention and what a card provides. */
const OK_FOR: Partial<Record<Trigger, Effect['op'][]>> = { static: ['buff', 'grant', 'provide', 'prevent', 'lasts', 'castRule'] };

export interface ReadLine { text: string; on: Trigger | 'keywords'; effects: Effect[]; manual: string[] }
export interface Reading { effects: Effect[]; lines: ReadLine[]; manual: string[] }

/** Normalize card text: reminder text in parentheses is dropped, but symbols such as (A) (F) (1) (X) are kept. */
const strip = (t: string) => t.replace(/\r/g, '').replace(/\([^()]*\)/g, (p) => (/^\((\d+|[AEFWX])\)$/.test(p) ? p : '')).replace(/->/g, '→').replace(/[‘’]/g, "'").replace(/[ \t]+/g, ' ');

/** Split a line's body into sentences. */
const sentences = (body: string) => body.split(/(?<=[.!])\s+(?=[A-Z①-⑳(])/).map((x) => x.trim()).filter(Boolean).map((x) => (/[.!]$/.test(x) ? x : x + '.'));

function matchSentence(sentence: string, on: Trigger, type: CardType, top = true): { got: Omit<Effect, 'on'>[]; rule: string } | null {
  // "This shoot a projectile." (plural card names): the verb without its subject
  const plural = sentence.match(/^this (shoot|strike|deal|draw|gain|heal|untap|tap|summon|kill|destroy|banish) (.+)$/i);
  if (plural) return matchSentence(cap(plural[1]) + ' ' + plural[2], on, type, top);
  // "You may pay ① to X." — X costs mana and is optional
  const pay = sentence.match(new RegExp(`^(?:you may )?pay ${MANA} to (.+)$`, 'i'));
  if (pay) { const r = matchSentence(cap(pay[2]), on, type, false); if (r) return { got: r.got.map((e, i) => ({ ...e, ...(i === 0 ? { pay: manaOf(pay[1]) } : {}), ...(/^you may/i.test(sentence) ? { optional: true } : {}) })), rule: 'pay+' + r.rule }; }
  // conditions: "X while Warded." "If you're on Death's Door, X." "X unless adjacent to an allied Spellcaster."
  let cm: RegExpMatchArray | null;
  if (top && ((cm = sentence.match(/^(?:if|while) ([^,]+), (.+)$/i)) || (cm = sentence.match(/^(.+?),? (?:while|if|unless|during) (.+?)\.$/i)))) {
    const lead = /^(?:if|while) /i.test(sentence);
    const condText = lead ? cm[1] : cm[2]; const body = lead ? cap(cm[2]) : cm[1] + '.';
    const w = condOf(condText, /\bunless\b/i.test(sentence) && !lead, /\bduring\b/i.test(sentence) && !lead);
    if (w) { const r = matchSentence(body, on, type, false); if (r) return { got: r.got.map((e) => ({ ...e, when: w })), rule: 'cond+' + r.rule }; }
  }
  // a bare keyword on a permanent: "Disabled." (after a condition was taken off)
  const bare = sentence.match(new RegExp(`^(${KEYWORDS.join('|')})\\.$`, 'i'));
  if (bare && on === 'static') return { got: [{ op: 'grant', who: 'self', keyword: KEYWORDS.find((k) => k.toLowerCase() === bare[1].toLowerCase())!, until: 'permanent' }], rule: 'bare-keyword' };
  // wrappers that do not change what happens: "When it arrives, …", "… on arrival", "… if it is untapped"
  let w: RegExpMatchArray | null;
  if ((w = sentence.match(/^(?:when it arrives|upon arrival|on arrival), (.+)$/i))) return matchSentence(cap(w[1]), on, type, top);
  if ((w = sentence.match(/^(.+?) (?:on arrival|upon arrival|when it arrives|if (?:it is|it's) untapped|if able)\.$/i))) return matchSentence(w[1] + '.', on, type, top);
  // a sentence with no subject is about the card itself: "Has Airborne." "Gains +1 power this turn."
  if (/^can'?t (be |untap|attack|defend)|^is immune/i.test(sentence) && type !== 'Magic') return matchSentence('This ' + sentence.charAt(0).toLowerCase() + sentence.slice(1), on, type, top);
  if (/^(has|have|gains|takes) /i.test(sentence) && type !== 'Magic') return matchSentence('This ' + sentence.charAt(0).toLowerCase() + sentence.slice(1), on, type, top);
  if (/^gain [+\-−]\d+ power/i.test(sentence)) return matchSentence('This gains ' + sentence.slice(5), on, type, top);
  // ", if it's a minion": only a minion bearer gets it, an Avatar bearer does not (rulebook p5: Avatars never leave the surface)
  if (/, if it'?s a minion\.$/i.test(sentence)) { const r = matchSentence(sentence.replace(/, if it'?s a minion\.$/i, '.'), on, type, top); return r ? { got: r.got.map((e) => ({ ...e, only: 'minion' as const })), rule: r.rule + '+minion' } : null; }
  // "You may X." / "May X." / "This may X.": X is optional for the player
  const may = top && sentence.match(/^(?:you |this |it |bearer )?may (.+)$/i);
  if (may) { const r = matchSentence(may[1].replace(/^./, (c) => c.toUpperCase()), on, type, false); if (r) return { got: r.got.map((e) => ({ ...e, optional: true })), rule: 'may+' + r.rule }; }
  for (const r of RULES) {
    const mm = sentence.match(r.re); if (!mm) continue;
    const b = r.build(mm, on, type);
    if (b && b.every((e) => !OK_FOR[on] || OK_FOR[on]!.includes(e.op))) return { got: b, rule: r.id };
  }
  // "A, then B." / "A and you heal 3." — both halves must read on their own
  const parts = sentence.replace(/\.$/, '').split(/,? (?:and )?then |, and (?=(?:you|deal|draw|gain|heal|untap|tap|kill|destroy|banish|summon|give|return|each|your)\b)| and (?=(?:you heal|you gain|draw|untap|tap|deal|make|may)\b)/i);
  if (parts.length > 1) {
    const all: Omit<Effect, 'on'>[] = []; const ids: string[] = [];
    for (const part of parts) {
      // "…, then you may X": that half is the player's option
      const opt = part.trim().match(/^you may (.+)$/i); const text = (opt ? opt[1] : part.trim()).replace(/^./, (c) => c.toUpperCase()) + '.';
      const r = matchSentence(text, on, type, false); if (!r) return null;
      all.push(...(opt ? r.got.map((e) => ({ ...e, optional: true })) : r.got)); ids.push((opt ? 'may+' : '') + r.rule);
    }
    return { got: all, rule: ids.join('+') };
  }
  return null;
}

const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());
/** The conditions the reader understands. Null when the wording is not one of them. */
function condOf(t0: string, unless = false, during = false): Cond | null {
  const t = t0.trim().toLowerCase().replace(/’/g, "'"); let m: RegExpMatchArray | null; let w: Cond | null = null;
  if (during) { if (/^(enemy|opponents?'?s?|your opponent'?s?) turns?$/.test(t)) w = { k: 'enemyTurn' }; else if (/^your turns?$/.test(t)) w = { k: 'yourTurn' }; }
  else if (/^(?:it'?s |this is |in )?(?:in )?your back row$/.test(t)) w = { k: 'backRow' };
  else if (/^you have more life than (?:each|your) opponents?$/.test(t)) w = { k: 'moreLife' };
  else if (/^(?:this is |it'?s )?warded$/.test(t)) w = { k: 'warded' };
  else if (/^(?:you'?re|you are) on death'?s door$/.test(t)) w = { k: 'deathsDoor' };
  else if (/^you'?ve lost life this turn$/.test(t)) w = { k: 'lostLife' };
  else if (/^(?:this is |it'?s )?in the void$/.test(t)) w = { k: 'inVoid' };
  else if (/^there are no enemies here$/.test(t)) w = { k: 'noEnemiesHere' };
  else if ((m = t.match(/^you control (another|an?) (\w+)$/))) { const sb = subOf(m[2]); if (sb) w = { k: 'control', sub: sb, ...(m[1] === 'another' ? { other: true } : {}) }; }
  else if ((m = t.match(/^there are dead (\w+)$/))) { const sb = subOf(m[1]); w = sb ? { k: 'dead', sub: sb } : { k: 'dead', name: cap(m[1]) }; }
  else if ((m = t.match(/^(?:this is |it'?s )?atop an? (\w+)$/))) { const sb = subOf(m[1]) ?? cap(m[1].replace(/s$/, '')); w = { k: 'atop', sub: sb }; }
  else if ((m = t.match(/^adjacent to an allied (\w+)$/))) { const sb = subOf(m[1]) ?? KEYWORDS.find((k) => k.toLowerCase() === m![1]); if (sb) w = { k: 'adjacentAlly', sub: sb }; }
  if (w && unless) w.not = true;
  return w;
}
/** "Whenever a nearby allied minion dies" → which deaths count. Null when a word is not understood. */
function eventFilter(q: string, np: string, where?: string): EventFilter | null {
  const sel = nounPhrase(`${q.toLowerCase() === 'another' ? 'another' : 'an'} ${np}`); if (!sel) return null;
  const f: EventFilter = {};
  if (sel.only === 'minion' || sel.only === 'enemyMinion' || sel.only === 'allyMinion') f.minion = true;
  if (sel.only === 'enemy' || sel.only === 'enemyMinion') f.side = 'enemy';
  if (sel.only === 'ally' || sel.only === 'allyMinion') f.side = 'ally';
  if (sel.only === 'avatar') return null;
  if (sel.sub) f.sub = sel.sub;
  if (sel.other) f.other = true;
  const w = (where ?? '').trim().toLowerCase() || (sel.range && sel.range !== 'any' ? sel.range : '');
  if (w === 'here') f.range = 'here'; else if (w === 'nearby' || w === 'adjacent') f.range = 'nearby';
  return f;
}
/** Read a card's whole rules text into effects. Unread sentences become `manual` effects. */
export function readRules(type: CardType, rules: string, name = ''): Reading {
  const out: Reading = { effects: [], lines: [], manual: [] };
  const lines = strip(rules).split('\n').map((l) => l.trim()).filter(Boolean);
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const needs = new Map<number, Partial<Thresholds>>();
  lines.forEach((raw0, lineNo) => {
    let raw = raw0;
    // "(A)(A)(A) — …": the ability needs that threshold (rulebook p18: symbols to the left of abilities)
    const sym = raw.match(/^((?:\([AEFW]\))+)\s*[—–-]\s*/);
    if (sym) { const t: Partial<Thresholds> = {}; for (const ch of sym[1].match(/[AEFW]/g)!) { const el = ({ A: 'air', E: 'earth', F: 'fire', W: 'water' } as const)[ch as 'A']; t[el] = (t[el] ?? 0) + 1; } needs.set(lineNo, t); }
    // the card's own name means "this" — unless the name is a word used as a verb ("Teleport an ally …")
    raw = raw.replace(/^(?:\([AEFW]\))+\s*[—–-]\s*/, '');
    const line = (name ? raw.replace(new RegExp(`\\b${esc}\\b(?! (?:an?|the|target|all|each|any|your|up)\\b)`, 'g'), 'this') : raw).replace(/(^|[.!→]\s+)this\b/g, (_, a) => a + 'This');
    const parts = line.replace(/\.$/, '').split(/,\s*/);
    const PASSIVE: Record<string, string> = { "can't defend": "Can't defend", "can't intercept": "Can't intercept", "can't attack sites": "Can't attack sites", "can't move to defend": "Can't move to defend", "can't attack or defend": "Can't attack", "immune to fire damage": 'Immune to fire damage' };
    const readable = (x: string) => !KEYWORD_LINE.test(x.trim()) && !PASSIVE[x.trim().toLowerCase().replace('’', "'")] && !!matchSentence(cap(x.trim()) + '.', 'static', type);
    if (parts.length > 1 && type !== 'Magic' && parts.every((x) => KEYWORD_LINE.test(x.trim()) || readable(x)) && parts.some(readable)) {
      const fx = parts.filter(readable).flatMap((x) => matchSentence(cap(x.trim()) + '.', 'static', type)!.got.map((e) => ({ ...e, on: 'static' as const, line: lineNo, text: x.trim(), rule: 'keyword-line', auto: true })));
      out.lines.push({ text: raw, on: 'static', effects: fx, manual: [] }); out.effects.push(...fx); return;
    }
    if (parts.length > 1 && parts.every((x) => KEYWORD_LINE.test(x.trim()) || PASSIVE[x.trim().toLowerCase().replace('’', "'")]) && parts.some((x) => PASSIVE[x.trim().toLowerCase().replace('’', "'")])) {
      const fx = parts.filter((x) => PASSIVE[x.trim().toLowerCase().replace('’', "'")]).map((x) => ({ on: 'static' as const, op: 'grant' as const, who: 'self' as const, keyword: PASSIVE[x.trim().toLowerCase().replace('’', "'")], until: 'permanent' as const, line: lineNo, text: x.trim(), rule: 'keyword-passive', auto: true }));
      out.lines.push({ text: raw, on: 'static', effects: fx, manual: [] }); out.effects.push(...fx); return;
    }
    if (line.replace(/\.$/, '').split(/,\s*/).every((part) => KEYWORD_LINE.test(part.trim()))) {
      // a limited spellcaster in the keyword line ("Airborne, Fire Spellcaster") keeps its limit as a static grant
      const fx = parts.map((x) => x.trim().match(LIMITED_SC)).filter(Boolean).map((mm) => ({ on: 'static' as const, op: 'grant' as const, who: 'self' as const, keyword: limitedSpellcaster(mm![1])!, until: 'permanent' as const, line: lineNo, text: mm![0], rule: 'limited-spellcaster', auto: true }));
      out.lines.push({ text: raw, on: fx.length ? 'static' : 'keywords', effects: fx, manual: [] }); out.effects.push(...fx); return;
    }
    let on: Trigger; let body = line; let cost = 0; let repeat = false; let m: RegExpMatchArray | null; let ev: EventFilter | null = null; let sac = false; let banishDead: Element | undefined; let both = false; let eachTurn = false; let discardCost = '';
    if ((m = line.match(/^Genesis\s*&\s*Deathrite\s*→\s*(.+)$/i))) { on = 'genesis'; body = m[1]; both = true; }
    else if ((m = line.match(/^(Genesis|Deathrite)\s*→\s*(.+)$/i))) { on = m[1].toLowerCase() as Trigger; body = m[2]; }
    else if ((m = line.match(/^(?:([①-⑳]|\(\d+\)|\d+)\s*,\s*)?Tap\s*→\s*(.+)$/i))) { on = 'tap'; body = m[2]; cost = m[1] ? manaOf(m[1]) : 0; }
    else if ((m = line.match(/^At the (?:start|beginning) of your turn,\s*(.+)$/i))) { on = 'startTurn'; body = m[1].replace(/^./, (c) => c.toUpperCase()); }
    else if ((m = line.match(/^At the end of your turn,\s*(.+)$/i))) { on = 'endTurn'; body = m[1].replace(/^./, (c) => c.toUpperCase()); }
    else if ((m = line.match(/^At the (end|start) of each (?:player's )?turn,\s*(.+)$/i))) { on = m[1].toLowerCase() === 'end' ? 'endTurn' : 'startTurn'; body = cap(m[2]); eachTurn = true; }
    else if ((m = line.match(/^(Once (?:on your|per|each) turn,\s*)?([①-⑳]|\(\d+\))\s*→\s*(.+)$/i))) { on = 'activated'; cost = manaOf(m[2]); repeat = !m[1]; body = m[3]; }
    else if ((m = line.match(/^Once (?:on your turn|per turn|each turn),\s*(?:(?:this|its|the)\s+)?(?:bearer|minion|unit|site|artifact|you|this)?\s*may\s+(.+)$/i))) { on = 'activated'; body = m[1].replace(/^./, (c) => c.toUpperCase()); }
    else if ((m = line.match(/^(Dies|Untaps|Gains (\w+)) at the end of your turn\.$/i))) { on = 'endTurn'; body = /^dies/i.test(m[1]) ? 'Kill this.' : /^untaps/i.test(m[1]) ? 'Untap this.' : `This gains ${m[2]}.`; }
    else if ((m = line.match(/^Sacrifice this\s*→\s*(.+)$/i))) { on = 'activated'; body = m[1]; sac = true; }
    else if ((m = line.match(/^Discard an? (spell|site|card)\s*→\s*(.+)$/i))) { on = 'activated'; body = m[2]; repeat = true; discardCost = m[1].toLowerCase(); }
    else if ((m = line.match(/^Tap, Banish all your dead (air|earth|fire|water) minions\s*→\s*(.+)$/i))) { on = 'tap'; body = m[2]; banishDead = m[1].toLowerCase() as Element; }
    else if ((m = line.match(/^When(?:ever)? this dies,\s*(.+)$/i))) { on = 'deathrite'; body = cap(m[1]); }
    else if ((m = line.match(/^Whenever (?:this|bearer) (?:takes damage|is damaged),\s*(.+)$/i))) { on = 'damaged'; ev = { self: true }; body = cap(m[1]); }
    else if ((m = line.match(/^When(?:ever)? this is struck,\s*(.+)$/i))) { on = 'damaged'; ev = { self: true }; body = cap(m[1]); }
    else if ((m = line.match(/^Whenever (?:this|bearer) (?:attacks and )?kills (?:an? (?:enemy|minion|unit)|an enemy minion),\s*(.+)$/i))) { on = 'kills'; ev = { self: true }; body = cap(m[1]); }
    else if ((m = line.match(/^(?:Whenever|After) (this|bearer|an? (?:nearby |enemy )?avatar|an enemy|your opponent|an opponent) casts? (?:a |an )?(spell|magic(?: spell)?),\s*(.+)$/i))) { on = 'casts'; ev = /this|bearer/i.test(m[1]) ? { self: true } : { ...( /enemy|opponent/i.test(m[1]) ? { side: 'enemy' as const } : {}), ...(/avatar/i.test(m[1]) ? { avatar: true } : {}), ...(/nearby/i.test(m[1]) ? { range: 'nearby' as const } : {}) }; if (/magic/i.test(m[2])) ev.magic = true; body = cap(m[3]); }
    else if ((m = line.match(/^Whenever (?:this|bearer) attacks,\s*(.+)$/i))) { on = 'attacks'; ev = { self: true }; body = cap(m[1]); }
    else if ((m = line.match(/^Whenever (an?|another) (.+?) dies( nearby| here)?,\s*(.+)$/i)) && (ev = eventFilter(m[1], m[2], m[3]))) { on = 'dies'; body = cap(m[4]); }
    else if ((m = line.match(/^When(?:ever)? (an?|another) (non-(\w+) )?(.+?) enters (?:or leaves )?(?:here|this site|its site),\s*(.+)$/i)) && (ev = eventFilter(m[1], m[4], ' here'))) { on = 'enters'; if (m[3]) ev.notKw = KEYWORDS.find((k) => k.toLowerCase() === m![3].toLowerCase()); body = cap(m[5]); }
    else on = type === 'Magic' ? 'cast' : 'static';
    const rl: ReadLine = { text: raw, on, effects: [], manual: [] };
    const ss = sentences(body);
    for (let k = 0; k < ss.length; k++) {
      let sentence = ss[k];
      // "Shoot a projectile." + "It deals N damage on impact[, and M damage to each other unit at that location]."
      const imp = ss[k + 1]?.match(/^It deals (\d+) damage(?: on impact)?(?:,? and (\d+) damage to each other unit (?:at|there|at that location)[^.]*)?\.$/i);
      const many = sentence.match(new RegExp(`^shoot ${NUM} projectiles in the same direction, one at a time\\.$`, 'i'));
      const each = ss[k + 1]?.match(/^Each deals (\d+) damage\.$/i);
      if (many && each) {
        const a = amount(many[1]);
        rl.effects.push({ on, op: 'shoot', who: 'controller', n: +each[1], shots: a.x ? -1 : a.n, ...(a.x ? { x: true } : {}), line: lineNo, text: `${sentence} ${ss[k + 1]}`, rule: 'shoot-many', auto: true, ...(cost ? { cost } : {}) });
        k++; continue;
      }
      const pierce = ss[k + 1]?.match(/^Deal (\d+) damage to each hit unit\.$/i);
      if (/^shoot a piercing projectile\.$/i.test(sentence) && pierce) {
        rl.effects.push({ on, op: 'shoot', who: 'controller', n: +pierce[1], pierce: true, line: lineNo, text: `${sentence} ${ss[k + 1]}`, rule: 'shoot-pierce', auto: true, ...(cost ? { cost } : {}) });
        k++; continue;
      }
      const pk = readPick(ss, k, name);
      if (pk) { rl.effects.push({ ...pk.fx, on, line: lineNo, text: ss.slice(k, k + pk.used).join(' '), rule: 'pick', auto: true, ...(cost ? { cost } : {}), ...(sac ? { sacrifice: true } : {}) }); k += pk.used - 1; continue; }
      if (/^They don'?t untap the next time they would\.$/i.test(sentence)) {
        const prev = [...rl.effects].reverse().find((e) => e.op === 'tap' && e.refCell);
        if (prev) { rl.effects.push({ ...prev, op: 'noUntap', text: sentence, rule: 'no-untap' }); continue; }
      }
      const sum = ss[k + 1]?.match(/^It deals damage equal to (?:to )?the sum of their \(([AEFW])\)\.$/i);
      if (/^shoot a projectile\.$/i.test(sentence) && sum && banishDead) {
        rl.effects.push({ on, op: 'shoot', who: 'controller', amount: 'banishedElement', line: lineNo, text: `${sentence} ${ss[k + 1]}`, rule: 'shoot-banished', auto: true, banishDead });
        k++; continue;
      }
      if (/^Fall asleep\.$/i.test(sentence) && /^this is disabled until hurt\.$/i.test(ss[k + 1] ?? '')) {
        rl.effects.push({ on, op: 'grant', who: 'self', keyword: 'Disabled', until: 'hurt', line: lineNo, text: `${sentence} ${ss[k + 1]}`, rule: 'sleep', auto: true });
        k++; continue;
      }
      const look = sentence.match(/^Look at your (?:next|top(?:most)?) (spell|site)\.$/i);
      if (look && /^You may put it on the bottom of your (spellbook|atlas)\.$/i.test(ss[k + 1] ?? '')) {
        rl.effects.push({ on, op: 'scry', n: 1, who: 'controller', deck: look[1].toLowerCase() === 'site' ? 'atlas' : 'spellbook', line: lineNo, text: `${sentence} ${ss[k + 1]}`, rule: 'scry', auto: true });
        k++; continue;
      }
      if (/^(?:this )?shoots? a projectile\.$/i.test(sentence) && imp) {
        rl.effects.push({ on, op: 'shoot', who: 'controller', n: +imp[1], ...(imp[2] ? { splash: +imp[2] } : {}), line: lineNo, text: `${sentence} ${ss[k + 1]}`, rule: 'shoot-impact', auto: true, ...(cost ? { cost } : {}) });
        k++; continue;
      }
      let hit = matchSentence(sentence, on, type);
      // in a reaction about the card itself ("When this is struck, destroy it"), "it" is the card
      if (hit && on === 'static' && hit.got.some((e) => e.ref)) hit = { ...hit, got: hit.got.map((e) => (e.ref ? { ...e, who: 'self' as const, ref: undefined, only: undefined, range: undefined, targets: undefined } : e)) };
      if (hit && ev?.self) hit = { ...hit, got: hit.got.map((e) => (e.ref ? { ...e, who: 'self' as const, ref: undefined, only: undefined, range: undefined } : e)) };
      // "it" must have something to point back to on this line
      if (hit?.got.some((e) => e.ref) && !(ev && !ev.self) && ![...rl.effects, ...hit.got].some((e, i, arr) => e.who === 'target' && !e.ref && i < arr.findIndex((x) => x.ref))) hit = null;
      if (hit) rl.effects.push(...hit.got.map((e) => ({ ...e, on, line: lineNo, text: sentence, rule: hit!.rule, auto: true, ...(cost ? { cost } : {}), ...(on === 'activated' && repeat ? { repeat } : {}), ...(ev ? { ev } : {}), ...(sac ? { sacrifice: true } : {}), ...(banishDead ? { banishDead } : {}), ...(eachTurn ? { eachTurn: true } : {}) })));
      else { sentence = ss[k]; rl.manual.push(sentence); rl.effects.push({ on, op: 'manual', who: 'controller', line: lineNo, text: sentence, auto: true, ...(cost ? { cost } : {}), ...(ev ? { ev } : {}) }); }
    }
    // "Discard a spell → …": the discard is the cost, paid first (the ability can't be used without a card to discard)
    if (discardCost) rl.effects.unshift({ on, op: 'discard', who: 'controller', n: 1, ...(discardCost === 'spell' ? { deck: 'spellbook' as const } : discardCost === 'site' ? { deck: 'atlas' as const } : {}), isCost: true, repeat: true, line: lineNo, text: `Discard a ${discardCost}`, rule: 'discard-cost', auto: true });
    if (both) rl.effects.push(...rl.effects.map((e) => ({ ...e, on: 'deathrite' as const })));
    out.lines.push(rl); out.effects.push(...rl.effects); out.manual.push(...rl.manual);
  });
  if (needs.size) out.effects = out.effects.map((e) => (e.line !== undefined && needs.has(e.line) ? { ...e, need: needs.get(e.line) } : e));
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
