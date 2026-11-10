// Wishlist + problem reports. Same shape as the archMGMT `wishlist` table (kind, title, details,
// status, response, submitted_by, priority) plus a `context` blob with diagnostics.
// Entries are always kept locally. If a Supabase project URL and publishable key are entered in
// Settings, entries are also sent there and statuses/responses are read back.
import { db } from '../data/db';

export const STATUSES = ['new', 'under_review', 'approved', 'planned', 'in_progress', 'complete', 'infeasible', 'duplicate'] as const;
export interface FeedbackItem {
  id: string; kind: 'wish' | 'problem'; title: string; details: string; status: (typeof STATUSES)[number];
  response: string | null; submitted_by: string | null; priority: number | null; created_at: string;
  context: Record<string, unknown> | null; synced?: boolean;
}
export interface Remote { url: string; key: string }

const errors: string[] = [];
export function captureErrors() {
  window.addEventListener('error', (e) => push(`${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => push(`Unhandled: ${String((e as PromiseRejectionEvent).reason?.message ?? (e as PromiseRejectionEvent).reason)}`));
}
export function push(msg: string) { errors.push(`${new Date().toISOString()} ${msg}`); if (errors.length > 30) errors.shift(); }
export const recentErrors = () => errors.slice();

const headers = (r: Remote) => ({ apikey: r.key, authorization: `Bearer ${r.key}`, 'content-type': 'application/json' });
const table = (r: Remote) => `${r.url.replace(/\/+$/, '')}/rest/v1/wishlist`;

export async function loadLocal(): Promise<FeedbackItem[]> { return (await db.get<FeedbackItem[]>('feedback')) ?? []; }
const saveLocal = (items: FeedbackItem[]) => db.set('feedback', items);

export async function submit(item: Omit<FeedbackItem, 'id' | 'status' | 'response' | 'created_at' | 'priority'>, remote: Remote | null): Promise<FeedbackItem[]> {
  const full: FeedbackItem = { ...item, id: crypto.randomUUID(), status: 'new', response: null, priority: null, created_at: new Date().toISOString(), synced: false };
  const items = [full, ...(await loadLocal())];
  await saveLocal(items);
  return remote ? pushPending(remote) : items;
}
/** Send unsynced entries, then read statuses and responses back. */
export async function pushPending(remote: Remote): Promise<FeedbackItem[]> {
  let items = await loadLocal();
  for (const it of items.filter((x) => !x.synced)) {
    const { synced: _s, ...row } = it;
    const res = await fetch(table(remote), { method: 'POST', headers: { ...headers(remote), prefer: 'return=minimal' }, body: JSON.stringify(row) });
    if (!res.ok && res.status !== 409) throw new Error(`Feedback server answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    it.synced = true;
  }
  const res = await fetch(`${table(remote)}?select=*&order=created_at.desc`, { headers: headers(remote) });
  if (res.ok) {
    const rows = (await res.json()) as FeedbackItem[];
    const ids = new Set(rows.map((r) => r.id));
    items = [...rows.map((r) => ({ ...r, synced: true })), ...items.filter((x) => !ids.has(x.id))];
  }
  await saveLocal(items);
  return items;
}
export function exportJson(items: FeedbackItem[]): string { return JSON.stringify({ app: 'sorcery-practice-table', exported_at: new Date().toISOString(), items }, null, 2); }
