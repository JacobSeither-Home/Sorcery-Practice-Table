// Sign-in, access list and cross-device saved data, on the app's own Supabase project.
// The publishable key below is meant to ship in the page: every table is protected by row-level
// rules that require a signed-in account on the access list (see supabase/migrations).
import { createClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import type { CardDef, DeckList, Effect } from '../engine';
import { db } from '../data/db';
import type { Remote } from '../feedback/feedback';
import { type Settings, buildPool, useStore } from '../store';

export const SUPABASE_URL = 'https://yhiqsucfqjassftcaytu.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_NWY7fmSHafnRX88xEQyl9g_OdBGF5OL';
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/** `npm run dev` with ?local in the address skips sign-in and keeps everything on the device (development only). */
export const LOCAL_ONLY = import.meta.env.DEV && new URLSearchParams(location.search).has('local');

interface Auth {
  status: 'loading' | 'out' | 'in';
  email: string | null; userId: string | null;
  member: boolean; admin: boolean; unclaimed: boolean;
  note: string; sync: 'idle' | 'saving' | 'saved' | 'error';
  init: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  claim: () => Promise<void>;
  loadAccess: () => Promise<void>;
}
interface Blob { settings?: Partial<Settings>; decks?: DeckList[]; custom?: CardDef[]; overlays?: Record<string, Effect[]> }

let applying = false; let timer: ReturnType<typeof setTimeout> | undefined; let started = false;

export const useAuth = create<Auth>((set, get) => ({
  status: 'loading', email: null, userId: null, member: false, admin: false, unclaimed: false, note: '', sync: 'idle',
  init: () => {
    if (started) return; started = true;
    if (LOCAL_ONLY) { set({ status: 'in', member: true, email: null }); return; }
    supabase.auth.onAuthStateChange((_e, session) => {
      const was = get().userId; const now = session?.user.id ?? null;
      set({ status: session ? 'in' : 'out', email: session?.user.email ?? null, userId: now, ...(session ? {} : { member: false, admin: false }) });
      if (now && now !== was) setTimeout(() => get().loadAccess()); // not inside the auth callback
    });
    useStore.subscribe((s, p) => {
      if (applying || !get().member || !get().userId) return;
      if (s.decks === p.decks && s.custom === p.custom && s.overlays === p.overlays && s.settings === p.settings) return;
      clearTimeout(timer); set({ sync: 'saving' }); timer = setTimeout(push, 1200);
    });
  },
  signIn: async (email, password) => {
    set({ note: '' });
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) set({ note: /confirm/i.test(error.message) ? 'That email address has not been confirmed yet. Open the confirmation email, then sign in.' : /invalid/i.test(error.message) ? 'That email and password do not match an account.' : error.message });
  },
  signUp: async (email, password) => {
    set({ note: '' });
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) set({ note: error.message });
    else if (!data.session) set({ note: 'Account created. A confirmation email is on its way; open its link, then sign in here.' });
  },
  signOut: async () => { await supabase.auth.signOut(); },
  claim: async () => { const { error } = await supabase.rpc('claim_admin'); if (error) set({ note: error.message }); await get().loadAccess(); },
  loadAccess: async () => {
    const { data, error } = await supabase.rpc('my_access');
    if (error) { set({ note: `The access check failed: ${error.message}` }); return; }
    set({ member: !!data?.member, admin: !!data?.admin, unclaimed: !!data?.unclaimed });
    if (data?.member) await pull();
  },
}));

function snapshot(): Blob { const s = useStore.getState(); return { settings: s.settings, decks: s.decks, custom: s.custom, overlays: s.overlays }; }
async function push() {
  const { userId } = useAuth.getState(); if (!userId) return;
  const { error } = await supabase.from('user_data').upsert({ user_id: userId, data: snapshot() });
  useAuth.setState({ sync: error ? 'error' : 'saved' });
}
/** On sign-in the saved copy wins. If this account has nothing saved yet, what is on this device is uploaded. */
async function pull() {
  const { data, error } = await supabase.from('user_data').select('data').maybeSingle();
  if (error) { useAuth.setState({ sync: 'error' }); return; }
  const b = data?.data as Blob | undefined;
  if (!b || !Object.keys(b).length) { await push(); return; }
  applying = true;
  try {
    const s = useStore.getState();
    const settings = { ...s.settings, ...(b.settings ?? {}) }, decks = b.decks ?? s.decks, custom = b.custom ?? s.custom, overlays = b.overlays ?? s.overlays;
    await Promise.all([db.set('settings', settings), db.set('decks', decks), db.set('custom', custom), db.set('overlays', overlays)]);
    useStore.setState({ settings, decks, custom, overlays, pool: buildPool(s.apiRaw, overlays, custom) });
    useAuth.setState({ sync: 'saved' });
    useStore.getState().reloadArt(); // art choices come from the account, images from this device
  } finally { applying = false; }
}

export async function feedbackRemote(): Promise<Remote | null> {
  if (LOCAL_ONLY || !useAuth.getState().member) return null;
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  return token ? { url: SUPABASE_URL, key: SUPABASE_KEY, token } : null;
}

// ---- access list (admin) ----
export interface AccessRow { email: string; note: string | null; added_at: string }
export async function listAccess(): Promise<AccessRow[]> { const { data } = await supabase.from('app_access').select('*').order('added_at'); return (data as AccessRow[]) ?? []; }
export async function addAccess(email: string, note: string): Promise<string | null> {
  const { error } = await supabase.from('app_access').insert({ email: email.trim().toLowerCase(), note: note.trim() || null });
  return error ? (error.code === '23505' ? 'That address is already on the list.' : error.message) : null;
}
export async function removeAccess(email: string) { await supabase.from('app_access').delete().eq('email', email); }
