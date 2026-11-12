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
import type { CardDef, CardType, Effect, Element, EventFilter, Trigger, Who } from './types';

export const KEYWORDS = ['Airborne', 'Burrowing', 'Charge', 'Deathrite', 'Disabled', 'Flood', 'Genesis', 'Immobile', 'Lance', 'Landbound', 'Lethal', 'Movement', 'Ranged', 'Spellcaster', 'Stealth', 'Submerge', 'Voidwalk', 'Ward', 'Waterbound'];
const KEYWORD_LINE = new RegExp(`^((?:air |earth |fire |water )?(?:${KEYWORDS.join('|')}))(\\s*\\+?\\s*\\d+)?$`, 'i');
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
  prevent: 'Protection & restrictions', destroySite: 'Sites & threshold', provide: 'Mana', summon: 'Summons & tokens', shoot: 'Damage', strike: 'Damage', mill: 'Cards', scry: 'Search & reveal', sink: 'Movement & position', teleport: 'Movement & position',
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
const SUBTYPES = ['Angel', 'Beast', 'Demon', 'Dragon', 'Dwarf', 'Faerie', 'Giant', 'Gnome', 'Goblin', 'Merfolk', 'Monster', 'Mortal', 'Ogre', 'Spirit', 'Sphinx', 'Troll', 'Undead', 'Knight', 'Royalty', 'Evil'];
const subOf = (w: string): string | null => {
  const t = w.toLowerCase().replace(/ies$/, 'y').replace(/(?<=[a-z])s$/, '').replace(/^faery$/, 'faerie');
  return SUBTYPES.find((x) => x.toLowerCase() === t || x.toLowerCase() === w.toLowerCase()) ?? null;
};

/** What a noun phrase picks out. */
type Sel = Pick<Effect, 'who' | 'range' | 'only' | 'other' | 'sub' | 'kw' | 'wounded' | 'ref' | 'siteKind'>;

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
  let range: Effect['range'] | undefined; let atTarget = false;
  const steps = t.match(/ up to (two|three) steps away$/i); if (steps) { t = t.slice(0, steps.index); range = steps[1].toLowerCase() as Effect['range']; }
  if ((m = t.match(/^(nearby|adjacent)\s+/i))) { range = m[1].toLowerCase() as Effect['range']; t = t.slice(m[0].length); }
  // trailing location
  const tail = t.match(/\s+(here|there|nearby|adjacent|(?:occupying|atop) nearby sites|atop this site|at (?:this|its) location|at its site|(?:at|atop|occupying) (?:target|a) (?:(nearby|adjacent) )?(?:land |water )?(?:location|site)(?: (nearby|adjacent))?(?: up to (two|three) steps away)?|atop target (?:(nearby|adjacent) )?site)$/i);
  if (tail) {
    t = t.slice(0, tail.index);
    const w = tail[1].toLowerCase();
    if (/target|^(at|atop|occupying) a /.test(w)) { atTarget = true; range = ((tail[2] || tail[3] || tail[4] || tail[5] || '').toLowerCase() as Effect['range']) || range || 'any'; }
    else range = /here|there|this|its/.test(w) ? 'here' : /nearby sites/.test(w) ? 'nearby' : (w as Effect['range']);
  }
  let side: 'enemy' | 'ally' | '' = '';
  if ((m = t.match(/^(enemy|allied|opposing|your)\s+/i))) { side = /enemy|opposing/i.test(m[1]) ? 'enemy' : 'ally'; t = t.slice(m[0].length); }
  let wounded = false;
  if ((m = t.match(/^wounded\s+/i))) { wounded = true; t = t.slice(m[0].length); }
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
  const filters = { ...(subs.length ? { sub: subs } : {}), ...(kw ? { kw } : {}), ...(wounded ? { wounded: true } : {}), ...(other ? { other: true } : {}) };
  const only: Effect['only'] = kind === 'avatar' ? 'avatar' : kind === 'minion' ? (side === 'enemy' ? 'enemyMinion' : side === 'ally' ? 'allyMinion' : 'minion') : side === 'enemy' ? 'enemy' : side === 'ally' ? 'ally' : undefined;
  if (atTarget) return { who: 'atTarget', range: range ?? 'any', ...(only ? { only } : {}), ...filters };
  const chosen = q === 'target' || q === 'an' || q === 'a' || q === 'another' || q === 'one';
  if (chosen) return { who: 'target', range: range ?? 'any', ...(only ? { only } : {}), ...filters };
  // a group needs each/all, a plural, or a place
  if (!q && !/s$/.test(noun) && !/ies$/.test(noun) && !range && !(subs.length && other)) return null;
  const here = range === 'here', near = range === 'nearby' || range === 'adjacent';
  let who: Who;
  if (kind === 'avatar') { if (near) who = 'nearbyAvatars'; else if (side === 'enemy') who = 'enemyAvatar'; else if (side === 'ally') who = 'ownAvatar'; else who = 'allAvatars'; return { who }; }
  if (here) who = side === 'enemy' ? 'enemiesHere' : side === 'ally' ? 'alliesHere' : 'unitsHere';
  else if (near) who = side === 'enemy' ? 'enemiesNearby' : side === 'ally' ? 'alliesNearby' : 'unitsNearby';
  else who = side === 'enemy' ? 'enemyMinions' : side === 'ally' ? 'allyMinions' : 'allMinions';
  if (!range && kind === 'unit' && !subs.length && side === '') return null; // "each unit" anywhere: Avatars too, not modelled
  return { who, ...(kind === 'minion' || (!range && kind === 'unit') ? { only: 'minion' as const } : {}), ...filters };
}
const minionOnly = (v: Sel | null): Sel | null => {
  if (!v || ['enemyAvatar', 'ownAvatar', 'allAvatars', 'nearbyAvatars'].includes(v.who) || v.only === 'avatar') return null;
  if (v.who === 'target' || v.who === 'atTarget') return { ...v, only: v.only === 'enemy' ? 'enemyMinion' : v.only === 'ally' ? 'allyMinion' : v.only ?? 'minion' };
  return v;
};

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
    build: (m) => (/random/i.test(m[0]) ? [{ op: 'discard', ...amount(m[3]), who: m[2] ? 'opponent' : 'controller' }] : null) },
  // mana and threshold
  { id: 'mana', label: 'Gain mana this turn', re: new RegExp(`^(?:you )?gain ${MANA}(?: this turn)?\\.$`, 'i'), build: (m) => [{ op: 'mana', n: manaOf(m[1]), who: 'controller' }] },
  { id: 'mana-only-copy', label: 'If this is the only …, gain mana', re: new RegExp(`^if this is the only .+ you control, gain ${MANA} this turn\\.$`, 'i'),
    build: (m, on) => (on === 'genesis' ? [{ op: 'mana', n: manaOf(m[1]), who: 'controller', cond: 'onlyCopy' }] : null) },
  { id: 'provides', label: 'Provides mana / threshold', re: /^(?:this site )?provides ((?:\([AEFW]\))*)(?:\s*(?:and|,)?\s*(?:an additional )?([①-⑳]|\(\d+\)))?( to its controller)?( this turn)?\.?$/i,
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
      const v = nounPhrase(m[1]); if (!v || (on === 'static' && (v.who === 'target' || v.who === 'atTarget'))) return null;
      if (on === 'static' && m[4]) return null;
      return [{ op: 'buff', ...v, atk: num(m[2]), def: m[3] ? num(m[3]) : num(m[2]), until: until(m[4], on) }];
    } },
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
      return per ? [{ op: 'buff', ...v, atk: +m[2], def: +m[2], until: 'permanent', per }] : null;
    } },
  { id: 'give-power', label: 'Give … +N power', re: new RegExp(`^give (.+?) ([+\\-−]\\d+) power${UNTIL}\\.$`, 'i'),
    build: (m, on) => { const v = nounPhrase(m[1]); return v && on !== 'static' ? [{ op: 'buff', ...v, atk: num(m[2]), def: num(m[2]), until: until(m[3], on) }] : null; } },
  { id: 'grant', label: '… gains / has a keyword', re: new RegExp(`^(.+?) (?:gets?|gains?|has|have) (${KW}(?:(?:, | and |, and )${KW})*)${UNTIL}\\.$`, 'i'),
    build: (m, on) => {
      const v = nounPhrase(m[1]); if (!v || (on === 'static' && (v.who === 'target' || v.who === 'atTarget'))) return null;
      if (on === 'static' && m[3]) return null;
      return kwList(m[2]).map((keyword) => ({ op: 'grant' as const, ...v, keyword, until: until(m[3], on) }));
    } },
  { id: 'give-keyword', label: 'Give … a keyword', re: new RegExp(`^give (.+?) (${KW}(?:(?:, | and |, and )${KW})*)${UNTIL}\\.$`, 'i'),
    build: (m, on) => { const v = nounPhrase(m[1]); return v && on !== 'static' ? kwList(m[2]).map((keyword) => ({ op: 'grant' as const, ...v, keyword, until: until(m[3], on) })) : null; } },
  { id: 'ward', label: 'Ward …', re: /^(?:give )?(.+?) (?:gains? )?(?:a )?ward\.$|^ward (.+?)\.$/i,
    build: (m, on) => { const v = nounPhrase(m[1] ?? m[2]); return v && on !== 'static' ? [{ op: 'grant', ...v, keyword: 'Ward', until: 'permanent' }] : null; } },
  { id: 'disable', label: 'Disable …', re: new RegExp(`^disable (.+?)${UNTIL}\\.$`, 'i'),
    build: (m, on) => { const v = minionOnly(nounPhrase(m[1], 'minion')); return v && on !== 'static' ? [{ op: 'grant', ...v, keyword: 'Disabled', until: until(m[2], on) }] : null; } },
  { id: 'bearer-spellcaster', label: 'Bearer has +N power and is a Spellcaster', re: /^(bearer|this) has ([+\-−]\d+) power and is an? (?:\w+ )?spellcaster\.$/i,
    build: (m, on) => (on === 'static' ? [{ op: 'buff', who: m[1].toLowerCase() === 'bearer' ? 'bearer' : 'self', atk: num(m[2]), def: num(m[2]), until: 'permanent' }, { op: 'grant', who: m[1].toLowerCase() === 'bearer' ? 'bearer' : 'self', keyword: 'Spellcaster', until: 'permanent' }] : null) },
  { id: 'ward-site', label: 'Ward this site', re: /^ward (?:this|its) site\.$/i, build: (m, on) => (on !== 'static' ? [{ op: 'grant', who: 'siteHere', keyword: 'Ward', until: 'permanent' }] : null) },
  { id: 'mill', label: 'Discard your top N spells', re: new RegExp(`^discard your top(?:most)? (?:${NUM} )?(spell|site)s?\\.$`, 'i'),
    build: (m) => [{ op: 'mill', ...amount(m[1] ?? 'a'), who: 'controller', deck: m[2].toLowerCase() === 'site' ? 'atlas' : 'spellbook' }] },
  { id: 'avatars-discard', label: 'Each nearby Avatar discards a random card', re: /^each (nearby )?avatar discards a random (?:card|spell)\.$/i,
    build: (m) => [{ op: 'discard', n: 1, who: m[1] ? 'nearbyAvatars' : 'allAvatars' }] },
  { id: 'draw-bottom', label: 'Draw your bottommost spell', re: /^draw your bottom(?:most)? (spell|site)\.$/i, build: (m) => [{ op: 'draw', n: 1, who: 'controller', deck: m[1].toLowerCase() === 'site' ? 'atlas' : 'spellbook', fromBottom: true }] },
  { id: 'sink', label: 'Submerge / burrow …', re: /^(submerge|burrow) (.+?)(?:, if able)?\.$/i,
    build: (m) => { const v = minionOnly(nounPhrase(m[2].replace(/ or artifacts?\b| and artifacts\b|,? minions and artifacts/gi, (x) => (/minions/i.test(x) ? ' minions' : '')), 'minion')); return v ? [{ op: 'sink', ...v, under: m[1].toLowerCase() === 'submerge' ? 'water' : 'land' }] : null; } },
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
  { id: 'first-damage', label: 'Prevent the first damage each turn', re: /^the first time .+? would take damage each turn, prevent that damage\.$/i,
    build: (m, on) => (on === 'static' ? [{ op: 'grant', who: 'self', keyword: 'Prevent first damage each turn', until: 'permanent' }] : null) },
  { id: 'destroy-site', label: 'Destroy a nearby site', re: /^destroy (?:a|target) (nearby |adjacent )?site\.$/i,
    build: (m) => [{ op: 'destroySite', who: 'atTarget', range: (m[1]?.trim() || 'any') as Effect['range'], siteKind: undefined }] },
  { id: 'lose-stealth', label: '… lose Stealth', re: /^(.+?) (?:permanently )?loses? stealth\.$/i,
    build: (m, on) => { const v = nounPhrase(m[1]); return v && on === 'static' && v.who !== 'target' ? [{ op: 'grant', ...v, keyword: 'Loses Stealth', until: 'permanent' }] : null; } },
  // deck-building rules apply when the deck is built (Decks screen), not during play
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
const OK_FOR: Partial<Record<Trigger, Effect['op'][]>> = { static: ['buff', 'grant', 'provide', 'prevent'] };

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
  // a sentence with no subject is about the card itself: "Has Airborne." "Gains +1 power this turn."
  if (/^(has|have|gains|takes) /i.test(sentence) && type !== 'Magic') return matchSentence('This ' + sentence.charAt(0).toLowerCase() + sentence.slice(1), on, type, top);
  if (/^gain [+\-−]\d+ power/i.test(sentence)) return matchSentence('This gains ' + sentence.slice(5), on, type, top);
  // ", if it's a minion" after something given to a bearer changes nothing here
  if (/, if it'?s a minion\.$/i.test(sentence)) return matchSentence(sentence.replace(/, if it'?s a minion\.$/i, '.'), on, type, top);
  // "You may X." / "May X." / "This may X.": X is optional for the player
  const may = top && sentence.match(/^(?:you |this |it |bearer )?may (.+)$/i);
  if (may) { const r = matchSentence(may[1].replace(/^./, (c) => c.toUpperCase()), on, type, false); if (r) return { got: r.got.map((e) => ({ ...e, optional: true })), rule: 'may+' + r.rule }; }
  for (const r of RULES) {
    const mm = sentence.match(r.re); if (!mm) continue;
    const b = r.build(mm, on, type);
    if (b && b.every((e) => !OK_FOR[on] || OK_FOR[on]!.includes(e.op))) return { got: b, rule: r.id };
  }
  // "A, then B." / "A and you heal 3." — both halves must read on their own
  const parts = sentence.replace(/\.$/, '').split(/,? (?:and )?then |, and (?=(?:you|deal|draw|gain|heal|untap|tap|kill|destroy|banish|summon|give|return|each|your)\b)| and (?=(?:you heal|you gain|draw|untap|tap|deal)\b)/i);
  if (parts.length > 1) {
    const all: Omit<Effect, 'on'>[] = []; const ids: string[] = [];
    for (const part of parts) { const r = matchSentence(part.trim().replace(/^./, (c) => c.toUpperCase()) + '.', on, type, false); if (!r) return null; all.push(...r.got); ids.push(r.rule); }
    return { got: all, rule: ids.join('+') };
  }
  return null;
}

const cap = (t: string) => t.replace(/^./, (c) => c.toUpperCase());
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
  lines.forEach((raw0, lineNo) => {
    let raw = raw0;
    // the card's own name means "this" — unless the name is a word used as a verb ("Teleport an ally …")
    raw = raw.replace(/^(?:\([AEFW]\))+\s*[—–-]\s*/, '');
    const line = (name ? raw.replace(new RegExp(`\\b${esc}\\b(?! (?:an?|the|target|all|each|any|your|up)\\b)`, 'g'), 'this') : raw).replace(/(^|[.!→]\s+)this\b/g, (_, a) => a + 'This');
    if (line.replace(/\.$/, '').split(/,\s*/).every((part) => KEYWORD_LINE.test(part.trim()))) { out.lines.push({ text: raw, on: 'keywords', effects: [], manual: [] }); return; }
    let on: Trigger; let body = line; let cost = 0; let repeat = false; let m: RegExpMatchArray | null; let ev: EventFilter | null = null; let sac = false;
    if ((m = line.match(/^(Genesis|Deathrite)\s*→\s*(.+)$/i))) { on = m[1].toLowerCase() as Trigger; body = m[2]; }
    else if ((m = line.match(/^(?:([①-⑳]|\(\d+\)|\d+)\s*,\s*)?Tap\s*→\s*(.+)$/i))) { on = 'tap'; body = m[2]; cost = m[1] ? manaOf(m[1]) : 0; }
    else if ((m = line.match(/^At the (?:start|beginning) of your turn,\s*(.+)$/i))) { on = 'startTurn'; body = m[1].replace(/^./, (c) => c.toUpperCase()); }
    else if ((m = line.match(/^At the end of your turn,\s*(.+)$/i))) { on = 'endTurn'; body = m[1].replace(/^./, (c) => c.toUpperCase()); }
    else if ((m = line.match(/^(Once (?:on your|per|each) turn,\s*)?([①-⑳]|\(\d+\))\s*→\s*(.+)$/i))) { on = 'activated'; cost = manaOf(m[2]); repeat = !m[1]; body = m[3]; }
    else if ((m = line.match(/^Once (?:on your turn|per turn|each turn),\s*(?:(?:this|its|the)\s+)?(?:bearer|minion|unit|site|artifact|you|this)?\s*may\s+(.+)$/i))) { on = 'activated'; body = m[1].replace(/^./, (c) => c.toUpperCase()); }
    else if ((m = line.match(/^Sacrifice this\s*→\s*(.+)$/i))) { on = 'activated'; body = m[1]; sac = true; }
    else if ((m = line.match(/^When(?:ever)? this dies,\s*(.+)$/i))) { on = 'deathrite'; body = cap(m[1]); }
    else if ((m = line.match(/^Whenever (?:this|bearer) (?:takes damage|is damaged),\s*(.+)$/i))) { on = 'damaged'; ev = { self: true }; body = cap(m[1]); }
    else if ((m = line.match(/^Whenever (?:this|bearer) attacks,\s*(.+)$/i))) { on = 'attacks'; ev = { self: true }; body = cap(m[1]); }
    else if ((m = line.match(/^Whenever (an?|another) (.+?) dies( nearby| here)?,\s*(.+)$/i)) && (ev = eventFilter(m[1], m[2], m[3]))) { on = 'dies'; body = cap(m[4]); }
    else if ((m = line.match(/^Whenever (an?|another) (.+?) enters (?:here|this site),\s*(.+)$/i)) && (ev = eventFilter(m[1], m[2], ' here'))) { on = 'enters'; body = cap(m[3]); }
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
      // "it" must have something to point back to on this line
      if (hit?.got.some((e) => e.ref) && !(ev && !ev.self) && ![...rl.effects, ...hit.got].some((e, i, arr) => e.who === 'target' && !e.ref && i < arr.findIndex((x) => x.ref))) hit = null;
      if (hit) rl.effects.push(...hit.got.map((e) => ({ ...e, on, line: lineNo, text: sentence, rule: hit!.rule, auto: true, ...(cost ? { cost } : {}), ...(on === 'activated' && repeat ? { repeat } : {}), ...(ev ? { ev } : {}), ...(sac ? { sacrifice: true } : {}) })));
      else { sentence = ss[k]; rl.manual.push(sentence); rl.effects.push({ on, op: 'manual', who: 'controller', line: lineNo, text: sentence, auto: true, ...(cost ? { cost } : {}), ...(ev ? { ev } : {}) }); }
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
