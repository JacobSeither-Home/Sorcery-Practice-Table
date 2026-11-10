import { create } from 'zustand';
import { type Action, type CardDef, type DeckList, type Effect, type GameState, type PlayerId, actor, apply, check, createGame, normalizeApiCards } from './engine';
import { isOfficialDeck, resolveOfficial } from './data/officialDecks';
import { db } from './data/db';
import { type ArtReport, loadArtUrls, variantBlob } from './data/artSync';
import { type Difficulty, chooseAction } from './ai/ai';
import { type Link, type Msg, deckHash, newRoomCode, openLink, stateHash } from './net/online';
import { push as logError } from './feedback/feedback';

export type Mode = 'ai' | 'hotseat' | 'online';
export interface Settings { artChoice: Record<string, string>; zoom: number; name: string; supabaseUrl: string; supabaseKey: string; reduceMotion: boolean; showLegal: boolean }
export interface Toast { id: number; text: string; keyword?: string; tone: 'info' | 'error' }
export interface Game { state: GameState; mode: Mode; difficulty: Difficulty; local: PlayerId; names: [string, string]; n: number }
export interface Online { role: 'host' | 'guest'; code: string; status: 'waiting' | 'connected' | 'closed'; note: string }

interface Store {
  ready: boolean;
  view: 'play' | 'decks' | 'library' | 'settings';
  apiRaw: unknown;
  syncedAt: string | null;
  overlays: Record<string, Effect[]>;
  custom: CardDef[];
  pool: Record<string, CardDef>;
  decks: DeckList[];
  art: Record<string, string>;
  /** cardId -> names of the images cached for it on this device (printings / alternate art) */
  artVariants: Record<string, string[]>;
  chooseArt: (cardId: string, variant: string) => Promise<void>;
  /** a running art load: visible from every screen, survives leaving Settings */
  artJob: string | null; artReport: ArtReport | null; artSyncedAt: string | null;
  runArtJob: (work: (progress: (text: string) => void) => Promise<ArtReport>) => Promise<void>;
  settings: Settings;
  game: Game | null;
  online: Online | null;
  aiThinking: boolean;
  toasts: Toast[];
  init: () => Promise<void>;
  setView: (v: Store['view']) => void;
  toast: (text: string, tone?: Toast['tone'], keyword?: string) => void;
  saveApi: (raw: unknown) => Promise<boolean>;
  setOverlay: (id: string, effects: Effect[]) => void;
  saveCustom: (c: CardDef) => void;
  deleteCustom: (id: string) => void;
  saveDeck: (d: DeckList, replace?: string) => void;
  deleteDeck: (name: string) => void;
  setSettings: (p: Partial<Settings>) => void;
  reloadArt: () => Promise<void>;
  newGame: (mode: Mode, decks: [DeckList, DeckList], difficulty: Difficulty) => void;
  host: (deck: DeckList) => void;
  join: (code: string, deck: DeckList) => void;
  leave: () => void;
  act: (a: Action) => boolean;
}

let link: Link | null = null;
let toastId = 1;
export const buildPool = (apiRaw: unknown, overlays: Record<string, Effect[]>, custom: CardDef[]) => {
  const pool: Record<string, CardDef> = {};
  if (apiRaw) for (const c of normalizeApiCards(apiRaw, overlays).cards) pool[c.id] = c;
  for (const c of custom) pool[c.id] = { ...c, effects: overlays[c.id] ?? c.effects };
  return pool;
};
const DEFAULTS: Settings = { artChoice: {}, zoom: 1, name: 'Player', supabaseUrl: '', supabaseKey: '', reduceMotion: false, showLegal: true };

export const useStore = create<Store>((set, get) => ({
  ready: false, view: 'play', apiRaw: null, syncedAt: null, overlays: {}, custom: [], pool: buildPool(null, {}, []), decks: [], art: {}, artVariants: {}, artJob: null, artReport: null, artSyncedAt: null,
  settings: DEFAULTS, game: null, online: null, aiThinking: false, toasts: [],

  init: async () => {
    const [apiRaw, syncedAt, overlays, custom, decks, settings] = await Promise.all([
      db.get<unknown>('cards:raw'), db.get<string>('cards:syncedAt'), db.get<Record<string, Effect[]>>('overlays'), db.get<CardDef[]>('custom'), db.get<DeckList[]>('decks'), db.get<Settings>('settings'),
    ]);
    set({
      apiRaw: apiRaw ?? null, syncedAt: syncedAt ?? null, overlays: overlays ?? {}, custom: custom ?? [], decks: decks ?? [],
      settings: { ...DEFAULTS, ...(settings ?? {}) }, pool: buildPool(apiRaw, overlays ?? {}, custom ?? []), ready: true,
    });
    get().reloadArt();
    db.get<string>('art:syncedAt').then((v) => set({ artSyncedAt: v ?? null }));
  },
  setView: (view) => set({ view }),
  toast: (text, tone = 'info', keyword) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone, keyword }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 7000 : 3500);
  },
  saveApi: async (raw) => {
    const syncedAt = new Date().toISOString();
    await db.set('cards:raw', raw); await db.set('cards:syncedAt', syncedAt);
    set((s) => ({ apiRaw: raw, syncedAt, pool: buildPool(raw, s.overlays, s.custom) }));
    // db.set never throws, so read back to learn whether the browser really kept it
    const kept = (await db.get<string>('cards:syncedAt')) === syncedAt && Array.isArray(await db.get('cards:raw'));
    get().reloadArt();
    return kept;
  },
  setOverlay: (id, effects) => set((s) => {
    const overlays = { ...s.overlays, [id]: effects }; // an empty list is kept: it switches off effects read from the card's text
    db.set('overlays', overlays);
    return { overlays, pool: buildPool(s.apiRaw, overlays, s.custom) };
  }),
  saveCustom: (c) => set((s) => { const custom = [...s.custom.filter((x) => x.id !== c.id), c]; db.set('custom', custom); return { custom, pool: buildPool(s.apiRaw, s.overlays, custom) }; }),
  deleteCustom: (id) => set((s) => { const custom = s.custom.filter((x) => x.id !== id); db.set('custom', custom); return { custom, pool: buildPool(s.apiRaw, s.overlays, custom) }; }),
  saveDeck: (d, replace) => set((s) => { const decks = [...s.decks.filter((x) => x.name !== d.name && x.name !== replace), d]; db.set('decks', decks); return { decks }; }),
  deleteDeck: (name) => set((s) => { const decks = s.decks.filter((x) => x.name !== name); db.set('decks', decks); return { decks }; }),
  setSettings: (p) => set((s) => { const settings = { ...s.settings, ...p }; db.set('settings', settings); return { settings }; }),
  reloadArt: async () => { const old = get().art; const { urls, variants } = await loadArtUrls(get().pool, get().settings.artChoice ?? {}); set({ art: urls, artVariants: variants }); Object.values(old).forEach((u) => URL.revokeObjectURL(u)); },
  runArtJob: async (work) => {
    if (get().artJob) return;
    set({ artJob: 'Reading files…', artReport: null });
    let last = Date.now();
    try {
      const report = await work((text) => {
        set({ artJob: text });
        if (Date.now() - last > 8000) { last = Date.now(); get().reloadArt(); } // let art appear while the load is still running
      });
      const artSyncedAt = new Date().toISOString(); await db.set('art:syncedAt', artSyncedAt);
      await get().reloadArt();
      set({ artReport: report, artSyncedAt });
      get().toast(`Art loaded: ${report.matched.toLocaleString()} cards matched.`);
    } catch (e) {
      await get().reloadArt();
      if ((e as Error).name !== 'AbortError') get().toast(`Art load stopped: ${(e as Error).message}`, 'error');
    } finally { set({ artJob: null }); }
  },
  chooseArt: async (cardId, variant) => {
    const b = await variantBlob(cardId, variant); if (!b) return;
    const old = get().art[cardId];
    get().setSettings({ artChoice: { ...(get().settings.artChoice ?? {}), [cardId]: variant } });
    set({ art: { ...get().art, [cardId]: URL.createObjectURL(b) } });
    if (old) URL.revokeObjectURL(old);
  },

  newGame: (mode, decks, difficulty) => {
    const state = createGame(get().pool, decks, (Math.random() * 2 ** 31) | 0);
    set({ game: { state, mode, difficulty, local: 0, names: mode === 'ai' ? [get().settings.name, `AI (${difficulty})`] : ['Player 1', 'Player 2'], n: 0 }, view: 'play' });
    driveAi();
  },
  host: (deck) => {
    get().leave();
    const code = newRoomCode();
    set({ online: { role: 'host', code, status: 'waiting', note: 'Waiting for the other player to join…' } });
    link = openLink('host', code, {
      open: () => set((s) => ({ online: s.online && { ...s.online, status: 'connected', note: 'Connected. Setting up…' } })),
      closed: (why) => closeOnline(why),
      msg: (m) => {
        if (m.t === 'hello') {
          const pool = get().pool; const decks: [DeckList, DeckList] = [deck, m.deck];
          const hash = deckHash(pool, decks);
          if (hash !== m.hash) { link?.send({ t: 'error', text: 'Card pools differ between the two players. Both players: run Card Sync (and share any custom cards), then try again.' }); closeOnline('Card pools differ between the two players. Both of you need the same Card Sync before playing online.'); return; }
          const seed = (Math.random() * 2 ** 31) | 0; const first: PlayerId = Math.random() < 0.5 ? 0 : 1;
          const names: [string, string] = [get().settings.name, m.name];
          link?.send({ t: 'start', seed, first, decks, hash, names });
          set({ game: { state: createGame(pool, decks, seed, first), mode: 'online', difficulty: 'easy', local: 0, names, n: 0 }, view: 'play' });
        } else onWire(m);
      },
    });
  },
  join: (code, deck) => {
    get().leave();
    code = code.trim().toUpperCase();
    set({ online: { role: 'guest', code, status: 'waiting', note: 'Connecting…' } });
    link = openLink('guest', code, {
      open: () => {
        set((s) => ({ online: s.online && { ...s.online, status: 'connected', note: 'Connected. Waiting for the host…' } }));
        // The host's deck is unknown here, so the guest sends the hash for its own deck and the host re-hashes both.
        link?.send({ t: 'hello', name: get().settings.name, deck, hash: '' });
      },
      closed: (why) => closeOnline(why),
      msg: (m) => {
        if (m.t === 'start') {
          const pool = get().pool;
          if (deckHash(pool, m.decks) !== m.hash) { closeOnline('Card pools differ between the two players. Both of you need the same Card Sync before playing online.'); return; }
          set({ game: { state: createGame(pool, m.decks, m.seed, m.first), mode: 'online', difficulty: 'easy', local: 1, names: m.names, n: 0 }, view: 'play' });
        } else onWire(m);
      },
    });
  },
  leave: () => { link?.close(); link = null; set({ online: null }); },

  act: (a) => {
    const g = get().game; if (!g) return false;
    if (g.mode !== 'hotseat' && actor(g.state) !== g.local && a.t !== 'manual') { get().toast("It is the other player's decision.", 'error'); return false; }
    const c = check(g.state, a);
    if (!c.ok) { get().toast(c.reason, 'error', c.keyword); return false; }
    commit(a);
    if (g.mode === 'online') { const ng = get().game!; link?.send({ t: 'act', n: ng.n, a, hash: stateHash(ng.state) }); }
    driveAi();
    return true;
  },
}));

function commit(a: Action) {
  const g = useStore.getState().game!;
  try { useStore.setState({ game: { ...g, state: apply(g.state, a), n: g.n + 1 } }); }
  catch (e) { logError(`engine: ${(e as Error).message} on ${JSON.stringify(a)}`); throw e; }
}
function closeOnline(why: string) {
  link?.close(); link = null;
  useStore.setState((s) => ({ online: s.online && { ...s.online, status: 'closed', note: why } }));
  useStore.getState().toast(why, 'error');
}
function onWire(m: Msg) {
  const st = useStore.getState(); const g = st.game;
  if (m.t === 'error') { closeOnline(m.text); return; }
  if (m.t !== 'act' || !g) return;
  if (m.n !== g.n + 1 || !check(g.state, m.a).ok) { closeOnline('The two tables fell out of step (a move arrived that is not legal here). The game cannot continue.'); return; }
  commit(m.a);
  if (stateHash(useStore.getState().game!.state) !== m.hash) closeOnline('The two tables disagree about the game state. Both players need the same Card Sync.');
}

let aiBusy = false;
async function driveAi() {
  if (aiBusy) return;
  aiBusy = true;
  try {
    for (;;) {
      const g = useStore.getState().game;
      if (!g || g.mode !== 'ai' || g.state.phase === 'over' || actor(g.state) === g.local) break;
      useStore.setState({ aiThinking: true });
      const t0 = performance.now();
      const a = await chooseAction(g.state, g.difficulty);
      await new Promise((r) => setTimeout(r, Math.max(0, 650 - (performance.now() - t0))));
      const now = useStore.getState().game;
      if (!now || now.state !== g.state) continue; // game was replaced or changed while thinking
      commit(a);
    }
  } catch (e) { logError(`ai: ${(e as Error).message}`); useStore.getState().toast('The AI hit an error and stopped. Details are attached if you report a problem in Settings.', 'error'); }
  finally { aiBusy = false; useStore.setState({ aiThinking: false }); }
}

/** Official precons that resolve completely against the pool, then the user's own decks. */
export const allDecks = (decks: DeckList[], pool: Record<string, CardDef>) => [...resolveOfficial(pool).filter((r) => !r.missing.length).map((r) => r.deck), ...decks];
export const isBuiltIn = isOfficialDeck;
