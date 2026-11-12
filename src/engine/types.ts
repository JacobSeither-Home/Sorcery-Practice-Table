// Engine types. The engine has no UI or browser dependencies.

export type Element = 'air' | 'earth' | 'fire' | 'water';
export const ELEMENTS: Element[] = ['air', 'earth', 'fire', 'water'];
export type CardType = 'Avatar' | 'Minion' | 'Magic' | 'Aura' | 'Artifact' | 'Site';
export type Thresholds = Record<Element, number>;
export type PlayerId = 0 | 1;
export type Region = 'surface' | 'under';
export interface Loc { c: number; r: Region; /** an aura's location: its 2×2 area */ aura?: boolean }

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
  | 'dies' | 'damaged' | 'attacks' | 'enters' | 'kills' | 'casts';
export const TRIGGERS: Trigger[] = ['cast', 'genesis', 'deathrite', 'tap', 'activated', 'startTurn', 'endTurn', 'static', 'dies', 'damaged', 'attacks', 'enters', 'kills', 'casts'];
/** Which events a reaction listens to, relative to the card that has it. */
export interface EventFilter { self?: boolean; side?: 'enemy' | 'ally'; minion?: boolean; range?: 'here' | 'nearby'; sub?: string[]; other?: boolean; /** units without this keyword ("a non-Airborne minion") */ notKw?: string; /** casts: only magic */ magic?: boolean; /** the event's unit is an Avatar */ avatar?: boolean }
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
  /** only choose a location for the effects after it on the line ("Target nearby location.") */
  | 'choose'
  /** fill a chosen void with Rubble; or replace a chosen Rubble with the top site of your atlas */
  | 'rubble' | 'replaceRubble'
  /** flood a chosen site until this ability is used again */
  | 'flood'
  /** the units do not untap the next time they would */
  | 'noUntap'
  /** "Lasts N of your turns": dispelled at the end of its controller's Nth turn */
  | 'lasts'
  /** casting rules on the card itself: cost change ("Costs (2) less to cast if …"), where it may be cast from, and who may cast it */
  | 'castRule'
  /** choose cards from a zone (Effect.pick) */
  | 'pick'
  /** remove Ward marks from the units (and sites) it reaches */
  | 'unward'
  /** summon a random dead minion from any cemetery at a chosen location, under your control */
  | 'raise'
  /** destroy the site at a chosen square (it leaves Rubble) */
  | 'destroySite'
  /** static damage prevention for the units it reaches ("takes no damage from …", "take 1 less damage") */
  | 'prevent'
  /** a sentence the engine cannot carry out: the cast pop-up offers the hand tools for it */
  | 'manual';
export type Who =
  | 'target' | 'enemyAvatar' | 'ownAvatar' | 'enemiesHere' | 'controller' | 'nearbyAvatars'
  | 'opponent' | 'self' | 'alliesHere' | 'unitsHere' | 'minionsHere' | 'enemiesNearby' | 'alliesNearby' | 'unitsNearby'
  | 'allMinions' | 'enemyMinions' | 'allyMinions' | 'allAvatars' | 'bearer'
  /** units at a location the player chooses (Choice.cell), within `range` */
  | 'atTarget'
  /** the site this card is at: damage to it costs its controller life */
  | 'siteHere'
  /** an aura's area (Codex "Casting Auras": the four squares around its intersection): the units atop them, or the sites */
  | 'affected' | 'affectedSites';

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
  /** castRule: mana off the cost; may be cast from the cemetery (and is banished afterwards); may be cast by any ally (of these subtypes) */
  less2?: number; fromCemetery?: boolean; banishAfter?: boolean; byAlly?: boolean; bySub?: string[];
  /** only while / if this holds ("while Warded", "if you're on Death's Door", "during enemy turns" …) */
  when?: Cond;
  /** pick: the zone step */
  pick?: ZonePick;
  /** the text says "target" (Codex "Target"): Stealth and Ward apply, and the source must be in the same region. A choice without the word ("an ally") is not a target. */
  targets?: boolean;
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
  /** atTarget: only land or water sites ("target land site") */
  siteKind?: 'land' | 'water';
  /** buff: multiply by a count ("+1 power for each adjacent site") */
  per?: { kind: 'sameNearby' | 'adjacentSites' | 'wards' | 'deadSub' | 'sameInCemetery' | 'voidsInRow' | 'nearbySites'; sub?: string; el?: Element };
  /** prevent: damage removed (undefined = all of it), and which sources it applies to */
  less?: number; fromMinPower?: number; fromSub?: string[]; fromMagic?: boolean; fromElement?: string; fromSite?: string[];
  /** the number comes from the game: the (A) on spells you cast this turn, or the (F) on dead minions banished for the cost */
  amount?: 'airCastThisTurn' | 'banishedElement';
  /** use the location chosen by the previous effect on the line ("… there") */
  refCell?: boolean;
  /** leave out units with this keyword ("minions without Submerge") */
  notKw?: string;
  /** activated cost: banish all your dead minions of this element */
  banishDead?: Element;
  /** only when the Avatar's site ability played a site of this element ("If you played an earth site") */
  afterSite?: Element;
  /** pay this much mana first; the effect does not happen if it cannot be paid */
  pay?: number;
  /** draw: from the bottom of the deck */
  fromBottom?: boolean;
  /** teleport (movement): where to. Chosen: a nearby / adjacent location or any site; fixed: this card's location ("here"),
   *  the caster's, one step toward / away from this card, a random site or void, or the location of the chosen unit ("to") */
  dest?: 'nearby' | 'site' | 'adjacent' | 'here' | 'caster' | 'toward' | 'away' | 'random' | 'to';
  /** movement kind (Codex "Forced Movement"): teleport and drag move anyone; a step is the unit's own and Immobile stops it */
  move?: 'teleport' | 'drag' | 'step';
  /** only units with less power than this card ("target weaker minion") */
  weaker?: boolean;
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
  until?: 'turn' | 'next' | 'permanent' | 'hurt';
  /** activated abilities: the card itself is sacrificed as part of the cost */
  sacrifice?: boolean;
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
export interface Choice { /** cards chosen from a zone: instance ids, or "card:<id>" for a named card from the collection */ cards?: string[]; /** a card in hand (discard by choice) */ card?: string; target?: string; n?: number; deck?: 'spellbook' | 'atlas'; skip?: boolean; /** scry: put the card on the bottom */ bottom?: boolean; /** a chosen square (who: 'atTarget') */ cell?: number; /** a projectile's direction */ dir?: [number, number] }

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
  /** skips its next untap */
  noUntap?: boolean;
  /** turn on which a "the first time … would take damage each turn, prevent it" shield was used */
  shieldTurn?: number;
  /** Ward mark (Codex "Ward"): breaks instead of the unit being damaged, destroyed or targeted by the opponent */
  ward?: boolean;
  /** power/defense changes and granted keywords from abilities; `turn` = expires at the end of that turn */
  mods?: Mod[];
}
export interface Mod { atk: number; def: number; kw?: string; /** extra steps (Movement +N) */ move?: number; /** ends when the unit takes damage */ hurt?: boolean; turn?: number; /** lasts until the start of this player's next turn */ next?: PlayerId; from: string }

export interface Site { inst: string | null; owner: PlayerId | null; tapped?: boolean; ward?: boolean } // inst null = rubble
export interface Permanent { id: string; inst: string; owner: PlayerId; /** artifact: its square; aura: the top-left square of its 2×2 area */ c: number; kind: 'artifact' | 'aura'; /** "Lasts N of your turns": end-of-turn counters so far */ turns?: number; /** unit id of the bearer, when a unit carries this artifact */ carrier?: string; tapped?: boolean }

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
  /** Codex "Collection": instance ids of the cards outside the decks */
  collection?: string[];
  /** turn on which this player last lost life ("if you've lost life this turn") */
  lostTurn?: number;
  /** minions of this player that died this turn (instance ids), for "a minion that died this turn" */
  died?: { turn: number; insts: string[] };
  /** spells cast this turn (card ids), for "the sum of (A) on spells you've cast this turn" */
  cast?: { turn: number; ids: string[] };
  /** the site this player's "until you do so again" flood is on */
  flooded?: number;
  /** the element total of the cards banished for the last ability's cost */
  banished?: number;
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

export interface DeckList { name: string; avatar: string; spellbook: string[]; atlas: string[]; /** Codex "Collection": extra cards outside the decks (card ids) */ collection?: string[] }

/** A condition on an ability ("while …", "if …", "unless …", "during …"), measured from the card that has it. */
export interface Cond {
  k: 'moreLife' | 'backRow' | 'warded' | 'deathsDoor' | 'control' | 'lostLife' | 'dead' | 'atop' | 'yourTurn' | 'enemyTurn' | 'inVoid' | 'adjacentAlly' | 'noEnemiesHere';
  sub?: string; name?: string; other?: boolean; not?: boolean;
}

/** Which cards a "search / look at / return / summon from …" effect may pick. */
export interface CardFilter {
  type?: CardType[]; minion?: boolean; sub?: string[]; name?: string; same?: boolean; maxCost?: number;
  rarity?: string[]; kw?: string; diedThisTurn?: boolean; notType?: CardType[];
}
export type Zone = 'spellbook' | 'atlas' | 'hand' | 'cemetery' | 'anyCemetery' | 'collection' | 'oppHand' | 'oppSpellbook';
/** One "choose cards from a zone" step: search, look at, reveal, return, summon or cast from a zone. */
export interface ZonePick {
  zones: Zone[];
  /** only the top (or bottom) N cards of the deck */
  top?: number; fromBottom?: boolean;
  /** how many may be chosen ('all' = every match is taken) */
  take: number | 'all';
  filter?: CardFilter;
  /** where chosen cards go */
  to: 'hand' | 'summon' | 'cast' | 'bottom' | 'top' | 'banish' | 'discard' | 'none';
  /** what happens to the other cards looked at */
  rest?: 'bottom' | 'top' | 'shuffle' | 'stay' | 'banish' | 'discard';
  /** shuffle the deck afterwards */
  shuffle?: boolean;
  /** summon/cast: where (the ability's location, or a square the player chooses) */
  where?: 'here' | 'choose' | 'avatar';
  /** the chosen card is shown to everyone */
  reveal?: boolean;
}

export const COLS = 5;
export const ROWS = 4;
export const CELLS = COLS * ROWS;
