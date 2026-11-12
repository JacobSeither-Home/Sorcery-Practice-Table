// Engine types. The engine has no UI or browser dependencies.

export type Element = 'air' | 'earth' | 'fire' | 'water';
export const ELEMENTS: Element[] = ['air', 'earth', 'fire', 'water'];
export type CardType = 'Avatar' | 'Minion' | 'Magic' | 'Aura' | 'Artifact' | 'Site';
export type Thresholds = Record<Element, number>;
export type PlayerId = 0 | 1;
export type Region = 'surface' | 'under';
export interface Loc { c: number; r: Region }

/** When an ability happens.
 *  cast      — a magic spell resolves
 *  genesis   — the card enters the realm (minion summoned, site played, artifact/aura conjured)
 *  deathrite — the minion dies
 *  tap       — activated: the controller taps the card (or the unit carrying it) whenever they choose
 *  activated — activated without tapping, whenever the controller chooses (once per turn unless `repeat`)
 *  startTurn / endTurn — at the start / end of its controller's turn
 *  static    — always on while the card is in the realm (stat changes and granted keywords) */
export type Trigger = 'cast' | 'genesis' | 'deathrite' | 'tap' | 'activated' | 'startTurn' | 'endTurn' | 'static'
  /** reactions ("Whenever …"): a unit dies, this takes damage, this attacks, a unit enters here; `ev` narrows which */
  | 'dies' | 'damaged' | 'attacks' | 'enters';
export const TRIGGERS: Trigger[] = ['cast', 'genesis', 'deathrite', 'tap', 'activated', 'startTurn', 'endTurn', 'static', 'dies', 'damaged', 'attacks', 'enters'];
/** Which events a reaction listens to, relative to the card that has it. */
export interface EventFilter { self?: boolean; side?: 'enemy' | 'ally'; minion?: boolean; range?: 'here' | 'nearby'; sub?: string[]; other?: boolean }
export type Op =
  | 'damage' | 'heal' | 'loseLife' | 'draw' | 'mana' | 'destroy' | 'banish' | 'bounce'
  | 'tap' | 'untap' | 'buff' | 'grant' | 'discard'
  /** mana and/or threshold: static ("Provides (F)") or for this turn ("Genesis → Provides (A)(E) this turn") */
  | 'provide'
  /** put a token minion (by card name) into the realm at the ability's location */
  | 'summon'
  /** shoot a projectile from the source (or the caster) in a chosen direction */
  | 'shoot'
  /** the source unit strikes the victims with its power */
  | 'strike'
  /** put the top N cards of a deck into the cemetery ("Discard your top two spells") */
  | 'mill'
  /** look at the top card of a deck; the player may put it on the bottom */
  | 'scry'
  /** move a unit below the surface: submerge at a water site, burrow at a land site */
  | 'sink'
  /** move a unit straight to a chosen location (Choice.cell) */
  | 'teleport'
  /** a sentence the engine cannot carry out: the cast pop-up offers the hand tools for it */
  | 'manual';
export type Who =
  | 'target' | 'enemyAvatar' | 'ownAvatar' | 'enemiesHere' | 'controller' | 'nearbyAvatars'
  | 'opponent' | 'self' | 'alliesHere' | 'unitsHere' | 'minionsHere' | 'enemiesNearby' | 'alliesNearby' | 'unitsNearby'
  | 'allMinions' | 'enemyMinions' | 'allyMinions' | 'allAvatars' | 'bearer'
  /** units at a location the player chooses (Choice.cell), within `range` */
  | 'atTarget'
  /** the site this card is at: damage to it costs its controller life */
  | 'siteHere';

/** Data-driven ability. Most cards are data entries, not code. */
export interface Effect {
  on: Trigger;
  op: Op;
  n?: number;
  /** the number is chosen by the player when the ability resolves (the card says X) */
  x?: boolean;
  /** who/what the effect applies to */
  who: Who;
  /** only applies when this is the single copy of the card (by name) among the sites its controller has */
  cond?: 'onlyCopy';
  /** for who:'target' — how far from a spellcaster (or from the unit itself for genesis and activated abilities) */
  range?: 'here' | 'adjacent' | 'nearby' | 'two' | 'three' | 'any';
  deck?: 'spellbook' | 'atlas';
  /** reactions: which events trigger it */
  ev?: EventFilter;
  /** "You may …": the player can skip this part when it resolves */
  optional?: boolean;
  /** "it" / "them": the unit chosen for the previous targeted effect on the same line */
  ref?: boolean;
  /** group effects (each, all …): leave out the card's own unit */
  other?: boolean;
  /** effects read from the same line of text resolve together (an activated ability and what it does) */
  line?: number;
  /** restrict a targeted effect */
  only?: 'minion' | 'enemy' | 'ally' | 'enemyMinion' | 'allyMinion' | 'avatar';
  /** only units with one of these subtypes (Mortal, Undead, Evil …) */
  sub?: string[];
  /** only units with this keyword ("target Spellcaster minion") */
  kw?: string;
  /** only units on the surface ("aboveground", "on the surface") */
  surface?: boolean;
  /** only units with at most / at least this much power */
  maxPower?: number; minPower?: number;
  /** groups: pick this many of them at random ("a random unit at target location") */
  random?: number;
  /** shoot: how many projectiles in the chosen direction (-1: X); pierce: hits every unit along the path */
  shots?: number; pierce?: boolean;
  /** pay this much mana first; the effect does not happen if it cannot be paid */
  pay?: number;
  /** draw: from the bottom of the deck */
  fromBottom?: boolean;
  /** teleport: where to ("nearby" its own location, or any "site" surface) */
  dest?: 'nearby' | 'site';
  /** sink: which way under (Submerge = water sites, Burrowing = land sites, either when unset) */
  under?: 'water' | 'land';
  /** only wounded units (damaged this turn) */
  wounded?: boolean;
  /** provide: elements given */
  el?: Partial<Record<Element, number>>;
  /** summon: the token's card name; shoot: extra damage to each other unit where it hits */
  token?: string; splash?: number;
  /** buff: power and defense change */
  atk?: number; def?: number;
  /** grant: the keyword given */
  keyword?: string;
  /** buff/grant: how long it lasts (static abilities last while the card is in the realm) */
  until?: 'turn' | 'next' | 'permanent';
  /** activated abilities: mana paid on use */
  cost?: number;
  /** activated without tapping: may be used more than once per turn */
  repeat?: boolean;
  /** the sentence of card text this was read from (shown in the cast pop-up) */
  text?: string;
  /** id of the phrase rule that produced it (see phrases.ts) */
  rule?: string;
  /** true when this entry was read from the card's rules text instead of entered by hand */
  auto?: boolean;
}

/** One choice made in the cast pop-up for the effect at the same index. */
export interface Choice { target?: string; n?: number; deck?: 'spellbook' | 'atlas'; skip?: boolean; /** scry: put the card on the bottom */ bottom?: boolean; /** a chosen square (who: 'atTarget') */ cell?: number; /** a projectile's direction */ dir?: [number, number] }

/** Normalized card definition the engine plays with. Built from CardAPIDTO, the practice set, or custom entries. */
export interface CardDef {
  id: string;
  name: string;
  slug: string;
  type: CardType;
  rarity: string | null;
  rules: string;
  cost: number;
  attack: number;
  defense: number;
  life: number;
  thresholds: Thresholds;
  subtypes: string[];
  keywords: string[];
  /** X in "Movement +X" */
  movement: number;
  /** X in "Ranged X" (0 = not ranged) */
  ranged: number;
  typeline: string;
  printings: { slug: string; set: string; finish?: string; product?: string }[];
  source: 'api' | 'practice' | 'custom';
  /** the API's engine.category: 'Token' cards are banished when they leave the realm */
  category?: string;
  effects: Effect[];
}

export interface Unit {
  id: string;
  inst: string; // card instance id ('' never; avatars use their own instance)
  owner: PlayerId;
  c: number;
  r: Region;
  tapped: boolean;
  damage: number;
  enteredTurn: number;
  avatar: boolean;
  stealthLost: boolean;
  lance: boolean;
  /** Ward mark (Codex "Ward"): breaks instead of the unit being damaged, destroyed or targeted by the opponent */
  ward?: boolean;
  /** power/defense changes and granted keywords from abilities; `turn` = expires at the end of that turn */
  mods?: Mod[];
}
export interface Mod { atk: number; def: number; kw?: string; /** extra steps (Movement +N) */ move?: number; turn?: number; /** lasts until the start of this player's next turn */ next?: PlayerId; from: string }

export interface Site { inst: string | null; owner: PlayerId | null; tapped?: boolean; ward?: boolean } // inst null = rubble
export interface Permanent { id: string; inst: string; owner: PlayerId; c: number; kind: 'artifact' | 'aura'; /** unit id of the bearer, when a unit carries this artifact */ carrier?: string; tapped?: boolean }

export interface PlayerState {
  life: number;
  deathsDoor: boolean;
  /** turn number on which death's door was reached (immune for the rest of that turn) */
  ddTurn: number;
  mana: number;
  spellbook: string[];
  atlas: string[];
  hand: string[];
  cemetery: string[];
  avatar: string; // unit id
  mulliganDone: boolean;
  /** threshold (and mana already added) from "Provides … this turn" effects, for the turn given */
  extra?: { turn: number; th: Partial<Record<Element, number>> };
}

export type Pending = {
  kind: 'defend' | 'intercept';
  by: PlayerId;
  attacker: string;
  loc: Loc;
  target: { unit?: string; site?: boolean } | null;
};

/** Where an ability comes from on the table. */
export type Source = { unit: string } | { site: number } | { perm: string };

/** A triggered ability waiting for its controller to make choices (targets, numbers) or to skip it. */
export interface Queued {
  id: string;
  by: PlayerId;
  inst: string;
  /** indices into the card's effects that resolve together */
  fx: number[];
  loc: Loc | null;
  /** the unit/permanent/site it came from, when it is still on the table */
  src?: Source;
  /** reactions: the unit the event happened to ("it" in the card text) */
  subject?: string;
}

export interface LogEntry { turn: number; p: PlayerId | null; text: string; manual?: boolean }

export interface GameState {
  /** static, shared between clones */
  cards: Record<string, CardDef>;
  inst: Record<string, string>; // instance id -> card id
  seed: number;
  rng: number;
  turn: number;
  active: PlayerId;
  first: PlayerId;
  phase: 'mulligan' | 'draw' | 'main' | 'over';
  winner: PlayerId | null;
  players: [PlayerState, PlayerState];
  sites: (Site | null)[]; // 20 cells, null = void
  units: Record<string, Unit>;
  perms: Permanent[];
  pending: Pending | null;
  /** triggered abilities that need a decision, first one first */
  queue?: Queued[];
  /** activated abilities used this turn: `${source}:${effect index}` -> turn */
  used?: Record<string, number>;
  nextId: number;
  log: LogEntry[];
}

export type ManualOp =
  | { op: 'life'; p: PlayerId; n: number }
  | { op: 'mana'; p: PlayerId; n: number }
  | { op: 'damage'; unit: string; n: number }
  | { op: 'destroy'; unit: string }
  | { op: 'destroyPerm'; perm: string }
  | { op: 'tap'; unit: string }
  | { op: 'draw'; p: PlayerId; deck: 'spellbook' | 'atlas' }
  | { op: 'discard'; p: PlayerId; inst: string }
  | { op: 'teleport'; unit: string; c: number }
  | { op: 'buff'; unit: string; atk: number; def: number; turn: boolean }
  | { op: 'grant'; unit: string; keyword: string; turn: boolean }
  | { op: 'untap'; unit: string }
  | { op: 'banish'; unit: string }
  | { op: 'bounce'; unit: string }
  | { op: 'note'; text: string }
  /** give an artifact to a unit at its location, or (unit omitted) put it down on the site */
  | { op: 'carry'; perm: string; unit?: string };

export type Action =
  | { t: 'mulligan'; cards: string[] }
  | { t: 'draw'; deck: 'spellbook' | 'atlas' }
  | { t: 'playSite'; inst: string; c: number }
  | { t: 'drawSite' }
  | { t: 'cast'; inst: string; c?: number; target?: string; choices?: Choice[] }
  /** use an activated ability (Tap → … or similar) of a unit, site or permanent you control */
  | { t: 'ability'; src: Source; fx: number; choices?: Choice[] }
  /** resolve (or skip) the first triggered ability in the queue */
  | { t: 'trigger'; choices?: Choice[]; skip?: boolean }
  | { t: 'move'; unit: string; path: Loc[]; attack?: { unit?: string; site?: boolean } }
  | { t: 'shoot'; unit: string; dx: number; dy: number }
  | { t: 'respond'; units: string[]; removeOriginal?: boolean }
  | { t: 'endTurn' }
  | ({ t: 'manual' } & ManualOp);

export type Check = { ok: true } | { ok: false; reason: string; keyword?: string };

export interface DeckList { name: string; avatar: string; spellbook: string[]; atlas: string[] }

export const COLS = 5;
export const ROWS = 4;
export const CELLS = COLS * ROWS;
