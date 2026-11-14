// Damage grids (Codex "Damage Grid"): some cards show the area they affect as a small grid of numbers on the card,
// not in their text. These were read from the card images Jacob supplied (Google Drive folder shared on 2026-11-14),
// one entry per card, and are the only per-card rules data here. No art is stored.
//
// Coordinates: [dx, dy, damage] from the grid's anchor, with dy < 0 pointing "forward" (up on the card).
// Codex "Damage Grid": a grid may be rotated and reflected unless the card says otherwise, may hang partly outside
// the realm as long as its anchor is in it, and hits units in the same region as its origin unless the card says
// otherwise (Craterize: "above or below a site").
export type GridAnchor =
  | 'caster'   // the dot is the caster (or the unit using the ability)
  | 'self'     // centred on the card's own square (a minion, an aura, a site)
  | 'target'   // centred on the location chosen earlier on the line
  | 'impact'   // centred where the projectile on the line hit
  | 'edge';    // Flame Wave: columns counted from the left or right edge of the realm
export interface Grid {
  cells: [number, number, number][];
  anchor: GridAnchor;
  /** rotate: any of the four directions; reflect: mirrored left/right only; both; fixed: as printed */
  turn: 'rotate' | 'reflect' | 'both' | 'fixed';
  /** which units: everything in the origin's region (default), units on sites in either layer, or surface units on sites */
  layers?: 'region' | 'sitesBoth' | 'sitesSurface';
  only?: 'minion' | 'enemy';
  /** not the caster / the card itself */
  other?: boolean;
  lethal?: boolean;
  /** each unit hit is also disabled until your next turn */
  disable?: boolean;
  /** several arms from the anchor, each in its own chosen cardinal direction (Burning Hands: 2) */
  arms?: number;
}
const sq3 = (c: number, e: number, k: number): [number, number, number][] => [[0, 0, c], [0, -1, e], [0, 1, e], [-1, 0, e], [1, 0, e], [-1, -1, k], [1, -1, k], [-1, 1, k], [1, 1, k]];
export const GRIDS: Record<string, Grid> = {
  'Cone of Flame': { anchor: 'caster', turn: 'rotate', cells: [[0, -1, 5], [-1, -2, 3], [0, -2, 3], [1, -2, 3], [-2, -3, 1], [-1, -3, 1], [0, -3, 1], [1, -3, 1], [2, -3, 1]] },
  Craterize: { anchor: 'target', turn: 'fixed', layers: 'sitesBoth', cells: [[-2, -2, 1], [-1, -2, 2], [0, -2, 4], [1, -2, 2], [2, -2, 1], [-2, -1, 2], [-1, -1, 4], [0, -1, 7], [1, -1, 4], [2, -1, 2], [-2, 0, 4], [-1, 0, 7], [0, 0, 10], [1, 0, 7], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 7], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
  'Major Explosion': { anchor: 'target', turn: 'fixed', cells: sq3(7, 5, 3) },
  Hellstar: { anchor: 'self', turn: 'fixed', other: true, cells: sq3(7, 5, 3) },
  Fireball: { anchor: 'impact', turn: 'fixed', cells: [[0, 0, 4], [0, -1, 2], [0, 1, 2], [-1, 0, 2], [1, 0, 2]] },
  // "flows horizontally, from one edge of the realm to the other": 7, 5, 3, 1 down every row from the chosen side edge (reflect only)
  'Flame Wave': { anchor: 'edge', turn: 'reflect', layers: 'sitesSurface', cells: [0, 1, 2, 3].flatMap((y) => [[0, y, 7], [1, y, 5], [2, y, 3], [3, y, 1]] as [number, number, number][]) },
  'Frost Breath': { anchor: 'caster', turn: 'rotate', disable: true, cells: [[0, -1, 2], [-1, -1, 1], [1, -1, 1], [0, -2, 1]] },
  // the bold square is the caster's site
  'Lava Flow': { anchor: 'caster', turn: 'rotate', layers: 'sitesBoth', other: true, cells: [[0, 0, 5], [0, -1, 4], [0, -2, 2]] },
  // "swings its tail left to right": turned, not mirrored
  'Southpaw Dyrodor': { anchor: 'self', turn: 'rotate', cells: [[-1, 0, 4], [-1, -1, 3], [0, -1, 2], [1, -1, 1]] },
  'King Krakalak': { anchor: 'self', turn: 'fixed', layers: 'sitesBoth', other: true, cells: sq3(5, 3, 3) },
  'Flame Strike': { anchor: 'caster', turn: 'rotate', cells: [[0, -1, 3], [-1, -2, 1], [0, -2, 1], [1, -2, 1]] },
  'Holy Nova': { anchor: 'caster', turn: 'fixed', only: 'enemy', cells: sq3(3, 2, 1) },
  'Wreathed in Righteousness': { anchor: 'target', turn: 'fixed', only: 'minion', cells: sq3(0, 2, 2) },
  'Burning Hands': { anchor: 'caster', turn: 'rotate', arms: 2, cells: [[0, -1, 2], [0, -2, 1]] },
  Firebreathing: { anchor: 'caster', turn: 'rotate', cells: [[0, -1, 4], [-1, -1, 1], [1, -1, 1], [0, -2, 1]] },
  'Mester Stoor Worm': { anchor: 'caster', turn: 'rotate', lethal: true, cells: [[0, -1, 1], [-1, -1, 1], [1, -1, 1], [0, -2, 1]] },
};
/** The squares a grid covers, with their damage. `dir` is "forward" for a turning grid; `flip` mirrors it; for an edge
 *  grid, flip = start from the right edge. Squares outside the realm are dropped (Codex: a grid may hang off the edge). */
export function gridSquares(g: Grid, anchor: { x: number; y: number }, dir: [number, number] = [0, -1], flip = false, cols = 5, rows = 4): { x: number; y: number; n: number }[] {
  const out: { x: number; y: number; n: number }[] = [];
  for (const [dx0, dy0, n] of g.cells) {
    if (g.anchor === 'edge') { const x = flip ? cols - 1 - dx0 : dx0; if (x >= 0 && x < cols && dy0 < rows) out.push({ x, y: dy0, n }); continue; }
    const dx1 = flip ? -dx0 : dx0;
    const [dx, dy] = dir[0] === 0 && dir[1] === -1 ? [dx1, dy0] : dir[0] === 0 && dir[1] === 1 ? [-dx1, -dy0] : dir[0] === -1 ? [dy0, -dx1] : [-dy0, dx1];
    const x = anchor.x + dx, y = anchor.y + dy;
    if (x >= 0 && y >= 0 && x < cols && y < rows) out.push({ x, y, n });
  }
  return out;
}
