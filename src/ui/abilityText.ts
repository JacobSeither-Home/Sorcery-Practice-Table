// Plain-language labels for abilities, shared by the card library editor and the cast pop-up.
import type { Effect, Op, Trigger, Who } from '../engine';

export const TRIGGER_LABEL: Record<Trigger, string> = {
  cast: 'When cast', genesis: 'When it enters (Genesis)', deathrite: 'When it dies (Deathrite)', tap: 'Tap → (use any time on your turn)',
  activated: 'Ability (use on your turn)', startTurn: 'At the start of your turn', endTurn: 'At the end of your turn', static: 'Always (while in the realm)',
  dies: 'Whenever a unit dies', damaged: 'Whenever this takes damage', attacks: 'Whenever this attacks', enters: 'Whenever a unit enters here',
  kills: 'Whenever this kills', casts: 'Whenever a spell is cast',
};
export const TRIGGER_SHORT: Record<Trigger, string> = {
  cast: 'Cast', genesis: 'Genesis', deathrite: 'Deathrite', tap: 'Tap', activated: 'Ability', startTurn: 'Start of turn', endTurn: 'End of turn', static: 'Always',
  dies: 'When a unit dies', damaged: 'When damaged', attacks: 'When it attacks', enters: 'When a unit enters',
  kills: 'When it kills', casts: 'When a spell is cast',
};
export const OP_LABEL: Record<Op, string> = {
  regenesis: 'Reactivate Genesis abilities', fight: 'Fight the unit brought here', roll: 'Roll this artifact', ongoing: 'Leave an effect until your next turn', chain: 'Chain to more targets', moveSite: 'Move this site to a nearby void', moveAura: 'Move this aura one step', damage: 'Deal damage', heal: 'Gain / heal life', loseLife: 'Lose life', draw: 'Draw cards', mana: 'Gain mana', destroy: 'Destroy', banish: 'Banish',
  bounce: "Return to owner's hand", tap: 'Tap', untap: 'Untap', buff: 'Change power', grant: 'Give a keyword', discard: 'Discard at random', manual: 'Resolve by hand',
  provide: 'Provide mana / threshold', summon: 'Summon a token', shoot: 'Shoot a projectile', strike: 'Strike', mill: 'Discard from the top of a deck',
  control: 'Gain control', castRule: 'Casting rule', lasts: 'Lasts N turns', pick: 'Choose cards from a zone', unward: 'Break Wards', raise: 'Summon a dead minion', destroySite: 'Destroy a site', choose: 'Choose a location', rubble: 'Fill a void with Rubble', replaceRubble: 'Replace Rubble with your top site', flood: 'Flood a site', noUntap: 'Skip the next untap', scry: 'Look at the top card', sink: 'Submerge / burrow', teleport: 'Teleport', prevent: 'Prevent damage',
};
export const WHO_LABEL: Record<Who, string> = {
  target: 'a chosen unit', enemyAvatar: 'the enemy Avatar', ownAvatar: 'your Avatar', enemiesHere: 'each enemy here', controller: 'you', nearbyAvatars: 'each nearby Avatar',
  opponent: 'your opponent', self: 'this unit', alliesHere: 'each ally here', unitsHere: 'each unit here', minionsHere: 'each minion here', enemiesNearby: 'each enemy nearby',
  alliesNearby: 'each ally nearby', unitsNearby: 'each unit nearby', allMinions: 'every minion', enemyMinions: 'every enemy minion', allyMinions: 'every allied minion',
  allAvatars: 'both Avatars', bearer: 'the bearer', allyUnits: 'every ally (your Avatar too)', enemyUnits: 'every enemy (their Avatar too)', alliesInBody: 'each ally in its body of water or span of land', restHereFront: 'other minions at rest here or one step in front of it', atTarget: 'each unit at a chosen location', siteHere: 'this site', affected: 'each unit in its 2×2 area', affectedSites: 'the sites in its 2×2 area', siteController: "the controller of this card's site",
};
/** Which "applies to" choices make sense for an op. */
export function whoFor(op: Op): Who[] {
  if (op === 'draw' || op === 'mana' || op === 'manual') return ['controller'];
  if (op === 'discard') return ['opponent', 'controller'];
  if (op === 'provide' || op === 'summon' || op === 'shoot') return ['controller'];
  if (op === 'heal' || op === 'loseLife') return ['controller', 'opponent', 'nearbyAvatars', 'allAvatars', 'target'];
  return ['target', 'atTarget', 'self', 'bearer', 'enemyAvatar', 'ownAvatar', 'enemiesHere', 'alliesHere', 'unitsHere', 'enemiesNearby', 'alliesNearby', 'unitsNearby', 'enemyMinions', 'allyMinions', 'allMinions'];
}
const RANGE: Record<string, string> = { here: ' here', adjacent: ' adjacent', nearby: ' nearby', two: ' up to two steps away', three: ' up to three steps away', any: '' };
const ONLY: Record<string, string> = { minion: 'minion', enemy: 'enemy', ally: 'ally', enemyMinion: 'enemy minion', allyMinion: 'allied minion', avatar: 'Avatar' };

/** One line describing what an effect does, for the pop-up. */
export function describe(e: Effect): string {
  const n = e.amount === 'airCastThisTurn' ? 'the (A) on spells you cast this turn' : e.amount === 'banishedElement' ? `the (${(e.banishDead ?? 'f')[0].toUpperCase()}) on the minions banished` : e.x ? 'X' : String(e.n ?? 1);
  const group = e.only === 'minion' ? WHO_LABEL[e.who].replace(/\b(enemy|ally|unit)\b/, (w) => (w === 'unit' ? 'minion' : `${w === 'ally' ? 'allied' : w} minion`)) : WHO_LABEL[e.who];
  const filt = [e.random && !e.refCell ? 'one at random' : '', e.surface ? 'on the surface' : '', e.wounded ? 'wounded' : '', ...(e.sub ?? []), e.kw ?? '', e.maxPower !== undefined ? `power ${e.maxPower} or less` : '', e.minPower !== undefined ? `power ${e.minPower} or more` : ''].filter(Boolean).join(', ');
  const who0 = e.ref ? 'that unit' : e.refCell ? `${e.random ? 'a random other unit' : e.only === 'minion' ? 'minions' : 'units'} there${e.notKw ? ` without ${e.notKw}` : ''}` : e.who === 'target' ? `target ${ONLY[e.only ?? ''] ?? 'unit'}${RANGE[e.range ?? 'any']}` : (e.other ? group.replace(/^each /, 'each other ') : group);
  const who = filt ? `${who0} (${filt} only)` : who0;
  switch (e.op) {
    case 'damage': return `Deal ${n} damage to ${who}`;
    case 'heal': return e.who === 'controller' ? `Gain ${n} life` : `${who[0].toUpperCase() + who.slice(1)} heals ${n}`;
    case 'loseLife': return `${e.who === 'controller' ? 'You lose' : e.who === 'opponent' ? 'Your opponent loses' : 'Each Avatar loses'} ${n} life`;
    case 'draw': if (e.fromBottom) return `Draw the bottom card of your ${e.deck === 'atlas' ? 'atlas' : 'spellbook'}`;
      return `Draw ${n} from ${e.deck === 'atlas' ? 'your atlas' : e.deck === 'spellbook' ? 'your spellbook' : 'a deck you choose'}`;
    case 'mana': return `Gain ${n} mana this turn${e.cond === 'onlyCopy' ? ' (only copy)' : ''}`;
    case 'destroy': return `Destroy ${who}`;
    case 'banish': return `Banish ${who}`;
    case 'bounce': return `Return ${who} to its owner's hand`;
    case 'tap': return `Tap ${who}`;
    case 'untap': return `Untap ${who}`;
    case 'buff': if (e.per) return `${who[0].toUpperCase() + who.slice(1)}: +${e.atk ?? 0} power for each ${({ sameNearby: 'other copy nearby', adjacentSites: 'adjacent site', nearbySites: `nearby ${e.per.el ? e.per.el + ' ' : ''}site`, wards: 'Ward in the realm', deadSub: `dead ${e.per.sub ?? 'minion'} of yours`, sameInCemetery: 'copy in your cemetery', voidsInRow: 'void in its row', bodySites: `site in its ${e.per.body === 'land' ? 'span of land' : 'body of water'}` } as Record<string, string>)[e.per.kind]}`;
      return `${who[0].toUpperCase() + who.slice(1)}: ${(e.atk ?? 0) >= 0 ? '+' : ''}${e.atk ?? 0} power${e.until === 'turn' ? ' this turn' : ''}`;
    case 'grant': if (e.keyword === 'Movement') return `${who[0].toUpperCase() + who.slice(1)} gets Movement +${e.n ?? 1}${e.until === 'turn' ? ' this turn' : ''}`;
      if (e.until === 'hurt') return `${who[0].toUpperCase() + who.slice(1)} falls asleep: disabled until it takes damage`;
      if (e.keyword && /^(Doesn|Summon to|Play to|Prevent first|Heals from|Loses Stealth|Can)/.test(e.keyword)) return `${who[0].toUpperCase() + who.slice(1)}: ${e.keyword.toLowerCase()}`;
      if (e.who === 'siteHere') return `This site ${e.keyword === 'Ward' ? 'gains a Ward' : 'is flooded (a water site)'}`;
      if (e.noEnter) return `Units ${e.noEnter.minPower !== undefined ? `with ${e.noEnter.minPower} or more power ` : ''}${e.noEnter.side === 'ally' ? "(its controller's) " : e.noEnter.side === 'enemy' ? '(enemies) ' : ''}can't enter this site${e.noEnter.ground ? ' on the ground' : ''}`;
      if (e.who === 'affectedSites') return `The sites in its 2×2 area are flooded (water sites)`;
      return `${who[0].toUpperCase() + who.slice(1)} gains ${e.keyword}${e.until === 'turn' ? ' this turn' : ''}`;
    case 'discard': if (!e.random && e.who === 'controller') return `Discard a ${e.deck === 'atlas' ? 'site' : e.deck === 'spellbook' ? 'spell' : 'card'} of your choice`;
      return `${e.who === 'controller' ? 'You discard' : 'Your opponent discards'} ${n} at random`;
    case 'provide': { const el = Object.entries(e.el ?? {}).map(([k, v]) => `${v} ${k}`).join(', '); return `Provides ${[el && `${el} threshold`, e.n ? `${e.n} mana` : ''].filter(Boolean).join(' and ')}${e.on === 'static' ? ' while in the realm' : ' this turn'}`; }
    case 'summon': return `Summon ${n === '1' ? 'a' : n} ${e.token} token${n === '1' ? '' : 's'} ${({ adjacentSites: 'to each other adjacent site', adjacentLocations: 'to each adjacent location', bordersEnemy: 'to each site you control that borders an enemy site', nearAvatar: 'to each site near your Avatar', allyMinion: "to an allied minion's location", allySite: 'to a site you choose' } as Record<string, string>)[e.places ?? ''] ?? (e.who === 'atTarget' ? 'at a location you choose' : 'here')}`;
    case 'shoot': return e.pierce ? `Shoot a piercing projectile: ${n} damage to each unit it passes` : `Shoot ${e.shots && e.shots !== 1 ? (e.shots === -1 ? 'X projectiles' : `${e.shots} projectiles`) : 'a projectile'} for ${n} damage${e.shots && e.shots !== 1 ? ' each, in one direction' : ''}${e.splash ? ` (and ${e.splash} to each other unit where it hits)` : ''}`;
    case 'strike': return `Strike ${who}`;
    case 'prevent': return `${who[0].toUpperCase() + who.slice(1)} take${e.who === 'self' ? 's' : ''} ${e.less === undefined ? 'no' : `${e.less} less`} damage${e.fromMinPower !== undefined ? ` from units with ${e.fromMinPower} or more power` : ''}${e.fromElement ? ` from ${e.fromElement} spells` : e.fromMagic ? ' from magic' : ''}${e.fromSub ? ` from ${e.fromSub.join(', ')}` : ''}${e.fromSite ? ` from ${e.fromSite.join(', ')} sites` : ''}`;
    case 'control': return `Gain control of ${who}${e.until === 'turn' ? ' this turn' : ''}`;
    case 'castRule': return e.less2 ? `Costs ${e.less2} less to cast${e.when ? ' when its condition holds' : ''}` : e.fromCemetery ? `May be cast from your cemetery${e.banishAfter ? ' (then it is banished)' : ''}` : e.byAlly ? `May be cast by ${e.bySub?.length ? `an allied ${e.bySub.join(' or ')}` : 'any ally'}` : 'Casting rule';
    case 'lasts': return `Lasts ${e.n} of your turns, then it is dispelled`;
    case 'pick': { const pk = e.pick!; const f = pk.filter ?? {};
      const what = [f.rarity?.join('/'), f.kw ? `with ${f.kw}` : '', f.sub?.join('/'), f.name ?? (f.same ? 'another copy of this card' : f.minion ? 'minion' : f.type ? f.type.join('/').toLowerCase() : 'card'), f.maxCost !== undefined ? `costing ${f.maxCost} or less` : '', f.diedThisTurn ? 'that died this turn' : ''].filter(Boolean).join(' ');
      const from = pk.top ? `the ${pk.fromBottom ? 'bottom' : 'top'} ${pk.top} of your ${pk.zones[0]}` : pk.zones.map((z) => ({ oppHand: "the opponent's hand", anyCemetery: 'any cemetery' } as Record<string, string>)[z] ?? `your ${z}`).join(' or ');
      const n = pk.take === 'all' ? 'every' : pk.take === 0 ? '' : pk.take === 1 ? 'a' : `up to ${pk.take}`;
      const to = { hand: 'put into your hand', summon: 'summon', cast: 'cast (paying its cost)', bottom: 'put on the bottom', top: 'put on top', banish: 'banish', discard: 'discard', none: 'look' }[pk.to];
      return pk.take === 0 ? `Look at ${from}` : `From ${from}: ${to} ${n} ${what}${pk.where === 'choose' ? ' at a location you choose' : pk.where === 'avatar' ? " at your Avatar's location" : pk.to === 'summon' || pk.to === 'cast' ? ' here' : ''}${pk.rest && pk.rest !== 'stay' ? `; the rest go ${pk.rest === 'shuffle' ? 'back (shuffled)' : `to the ${pk.rest}`}` : ''}${pk.shuffle ? '; then shuffle' : ''}`; }
    case 'unward': return `Break the Wards of ${who}`;
    case 'raise': return 'Summon a random dead minion (from any cemetery) at a location you choose';
    case 'choose': return `Choose a location${RANGE[e.range ?? 'any']}`;
    case 'rubble': return `${e.afterSite ? `After you play an ${e.afterSite} site: ` : ''}fill a void adjacent to you with Rubble`;
    case 'replaceRubble': return 'Replace an adjacent Rubble with the top site of your atlas';
    case 'flood': return 'Flood a site near water (until you flood another)';
    case 'noUntap': return 'Those minions do not untap the next time they would';
    case 'destroySite': return `Destroy a site you choose${RANGE[e.range ?? 'any']} (it leaves Rubble)`;
    case 'scry': return `Look at the top card of your ${e.deck === 'atlas' ? 'atlas' : 'spellbook'}; you may put it on the bottom`;
    case 'sink': return `${e.under === 'water' ? 'Submerge' : e.under === 'land' ? 'Burrow' : 'Submerge or burrow'} ${who}`;
    case 'moveAura': return 'Move this aura one step, to a neighbouring joint';
    case 'regenesis': return `Your nearby ${e.sub?.join('/') ?? 'site'}s do their Genesis again`;
    case 'fight': return 'It fights the unit it dragged here (you may skip this)';
    case 'roll': return `Push it: it rolls as far as it can in the direction you choose, dealing ${e.n} damage to each other unit along its path`;
    case 'ongoing': return `Until your next turn: ${(e.fx ?? []).map((x) => describe({ ...x, on: 'static' } as Effect)).join('; ')}`;
    case 'chain': return `Any number of times, pay ${e.pay ?? 0} mana to hit one more new unit nearby the previous one the same way`;
    case 'moveSite': return 'This site flies to a nearby void, with everything atop and under it';
    case 'teleport': {
      const verb = e.move === 'step' ? 'takes a step' : e.move === 'drag' ? 'is dragged' : 'teleports';
      const subj = e.who === 'self' ? 'This' : who[0].toUpperCase() + who.slice(1);
      const where = ({ here: "to this card's location", caster: "to the caster's location", toward: 'one step closer to this card', away: 'one step away from this card', random: 'to a random site or void', to: '', adjacent: 'to an adjacent location you choose', site: 'to the surface of a site you choose', nearby: 'to a nearby location you choose' } as Record<string, string>)[e.dest ?? 'nearby'];
      if (e.dest === 'to') return `This flies to ${who}`;
      return `${subj} ${verb} ${where}`;
    }
    case 'teleport-old' as never: return `Teleport ${who} to ${e.dest === 'site' ? 'the surface of a site you choose' : 'a nearby location you choose'}`;
    case 'mill': return `Discard the top ${n} of your ${e.deck === 'atlas' ? 'atlas' : 'spellbook'}`;
    case 'manual': return e.text ?? 'Resolve by hand';
  }
  return e.text ?? e.op;
}
