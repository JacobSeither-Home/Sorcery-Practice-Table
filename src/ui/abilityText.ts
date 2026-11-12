// Plain-language labels for abilities, shared by the card library editor and the cast pop-up.
import type { Effect, Op, Trigger, Who } from '../engine';

export const TRIGGER_LABEL: Record<Trigger, string> = {
  cast: 'When cast', genesis: 'When it enters (Genesis)', deathrite: 'When it dies (Deathrite)', tap: 'Tap → (use any time on your turn)',
  activated: 'Ability (use on your turn)', startTurn: 'At the start of your turn', endTurn: 'At the end of your turn', static: 'Always (while in the realm)',
};
export const TRIGGER_SHORT: Record<Trigger, string> = {
  cast: 'Cast', genesis: 'Genesis', deathrite: 'Deathrite', tap: 'Tap', activated: 'Ability', startTurn: 'Start of turn', endTurn: 'End of turn', static: 'Always',
};
export const OP_LABEL: Record<Op, string> = {
  damage: 'Deal damage', heal: 'Gain / heal life', loseLife: 'Lose life', draw: 'Draw cards', mana: 'Gain mana', destroy: 'Destroy', banish: 'Banish',
  bounce: "Return to owner's hand", tap: 'Tap', untap: 'Untap', buff: 'Change power', grant: 'Give a keyword', discard: 'Discard at random', manual: 'Resolve by hand',
};
export const WHO_LABEL: Record<Who, string> = {
  target: 'a chosen unit', enemyAvatar: 'the enemy Avatar', ownAvatar: 'your Avatar', enemiesHere: 'each enemy here', controller: 'you', nearbyAvatars: 'each nearby Avatar',
  opponent: 'your opponent', self: 'this unit', alliesHere: 'each ally here', unitsHere: 'each unit here', minionsHere: 'each minion here', enemiesNearby: 'each enemy nearby',
  alliesNearby: 'each ally nearby', unitsNearby: 'each unit nearby', allMinions: 'every minion', enemyMinions: 'every enemy minion', allyMinions: 'every allied minion',
  allAvatars: 'both Avatars', bearer: 'the bearer',
};
/** Which "applies to" choices make sense for an op. */
export function whoFor(op: Op): Who[] {
  if (op === 'draw' || op === 'mana' || op === 'manual') return ['controller'];
  if (op === 'discard') return ['opponent'];
  if (op === 'heal' || op === 'loseLife') return ['controller', 'opponent', 'nearbyAvatars', 'allAvatars', 'target'];
  return ['target', 'self', 'bearer', 'enemyAvatar', 'ownAvatar', 'enemiesHere', 'alliesHere', 'unitsHere', 'enemiesNearby', 'alliesNearby', 'unitsNearby', 'enemyMinions', 'allyMinions', 'allMinions'];
}
const RANGE: Record<string, string> = { here: ' here', adjacent: ' adjacent', nearby: ' nearby', any: '' };
const ONLY: Record<string, string> = { minion: 'minion', enemy: 'enemy', ally: 'ally', enemyMinion: 'enemy minion', allyMinion: 'allied minion', avatar: 'Avatar' };

/** One line describing what an effect does, for the pop-up. */
export function describe(e: Effect): string {
  const n = e.x ? 'X' : String(e.n ?? 1);
  const group = e.only === 'minion' ? WHO_LABEL[e.who].replace(/\b(enemy|ally|unit)\b/, (w) => (w === 'unit' ? 'minion' : `${w === 'ally' ? 'allied' : w} minion`)) : WHO_LABEL[e.who];
  const who = e.who === 'target' ? `target ${ONLY[e.only ?? ''] ?? 'unit'}${RANGE[e.range ?? 'any']}` : (e.other ? group.replace(/^each /, 'each other ') : group);
  switch (e.op) {
    case 'damage': return `Deal ${n} damage to ${who}`;
    case 'heal': return e.who === 'controller' ? `Gain ${n} life` : `${who[0].toUpperCase() + who.slice(1)} heals ${n}`;
    case 'loseLife': return `${e.who === 'controller' ? 'You lose' : e.who === 'opponent' ? 'Your opponent loses' : 'Each Avatar loses'} ${n} life`;
    case 'draw': return `Draw ${n} from ${e.deck === 'atlas' ? 'your atlas' : e.deck === 'spellbook' ? 'your spellbook' : 'a deck you choose'}`;
    case 'mana': return `Gain ${n} mana this turn${e.cond === 'onlyCopy' ? ' (only copy)' : ''}`;
    case 'destroy': return `Destroy ${who}`;
    case 'banish': return `Banish ${who}`;
    case 'bounce': return `Return ${who} to its owner's hand`;
    case 'tap': return `Tap ${who}`;
    case 'untap': return `Untap ${who}`;
    case 'buff': return `${who[0].toUpperCase() + who.slice(1)}: ${(e.atk ?? 0) >= 0 ? '+' : ''}${e.atk ?? 0} power${e.until === 'turn' ? ' this turn' : ''}`;
    case 'grant': return `${who[0].toUpperCase() + who.slice(1)} gains ${e.keyword}${e.until === 'turn' ? ' this turn' : ''}`;
    case 'discard': return `Your opponent discards ${n} at random`;
    case 'manual': return e.text ?? 'Resolve by hand';
  }
}
