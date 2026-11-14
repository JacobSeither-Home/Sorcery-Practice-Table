// Choosing a location on the realm for an open pop-up (a spell "at target location", a site that flies, where a
// unit teleports to). The pop-up steps aside, the squares light up on the board, and a click there is the choice.
import { create } from 'zustand';

interface BoardPick { cells: number[] | null; label: string; pick: ((c: number) => void) | null; cancel: (() => void) | null }
export const useBoardPick = create<BoardPick & { start: (cells: number[], label: string, pick: (c: number) => void, cancel: () => void) => void; clear: () => void }>((set) => ({
  cells: null, label: '', pick: null, cancel: null,
  start: (cells, label, pick, cancel) => set({ cells, label, pick, cancel }),
  clear: () => set({ cells: null, label: '', pick: null, cancel: null }),
}));

/** Squares to light up on the board while the player points at an option in a pop-up (an area, a direction, a location). */
export const useBoardFocus = create<{ cells: number[]; set: (cells: number[]) => void }>((set) => ({ cells: [], set: (cells) => set({ cells }) }));
export const focusCells = (cells: number[]) => useBoardFocus.getState().set(cells);
