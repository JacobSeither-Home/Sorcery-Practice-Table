// Engine types. The engine has no UI or browser dependencies.

export type Element = 'air' | 'earth' | 'fire' | 'water';
export const ELEMENTS: Element[] = ['air', 'earth', 'fire', 'water'];
export type CardType = 'Avatar' | 'Minion' | 'Magic' | 'Aura' | 'Artifact' | 'Site';
export type Thresholds = Record<Element, number>;
export type PlayerId = 0 | 1;
export type Region = 'surface' | 'under';
export interface Loc { c: number; r: Region }

/** Data-driven ability. Most cards are data entries, not code. */
export interface Effect {
  on: 'cast' | 'genesis' | 'deathrite';
  op: 'damage' | 'heal' | 'draw' | 'mana' | 'destroy';
  n?: number;
  /** who/what the effect applies to */
  who: 'target' | 'enemyAvatar' | 'ownAvatar' | 'enemiesHere' | 'controller';
  /** for who:'target' — how far from a spellcaster (or from the unit itself for genesis) */
  range?: 'adjacent' | 'nearby' | 'any';
  deck?: 'spellbook' | 'atlas';
}

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
}

export interface Site { inst: string | null; owner: PlayerId | null } // inst null = rubble
export interface Permanent { id: string; inst: string; owner: PlayerId; c: number; kind: 'artifact' | 'aura' }

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
}

export type Pending = {
  kind: 'defend' | 'intercept';
  by: PlayerId;
  attacker: string;
  loc: Loc;
  target: { unit?: string; site?: boolean } | null;
};

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
  | { op: 'teleport'; unit: string; c: number };

export type Action =
  | { t: 'mulligan'; cards: string[] }
  | { t: 'draw'; deck: 'spellbook' | 'atlas' }
  | { t: 'playSite'; inst: string; c: number }
  | { t: 'drawSite' }
  | { t: 'cast'; inst: string; c?: number; target?: string }
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
