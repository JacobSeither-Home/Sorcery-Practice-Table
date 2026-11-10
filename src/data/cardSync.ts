// Card Sync: ONE manual request to the official public API, a diff against the stored copy, then save.
// Never called on load. The API asks consumers to synchronize occasionally and keep their own copy.
import { normalizeApiCards } from '../engine/cards';
export const CARDS_URL = 'https://api.sorcerytcg.com/api/cards';

export interface SyncDiff { added: string[]; changed: string[]; removed: string[]; total: number; unknownFields: string[]; skipped: string[] }
type Raw = Record<string, unknown>;
const keyOf = (c: Raw) => String(c?.id ?? c?.slug ?? c?.name ?? '');
const nameOf = (c: Raw) => String(c?.name ?? keyOf(c));

export async function fetchCards(): Promise<unknown> {
  const res = await fetch(CARDS_URL, { headers: { accept: 'application/json' } });
  if (res.status === 429) throw new Error('The card API is rate limiting requests (30 per minute). Wait a minute and sync again.');
  if (!res.ok) throw new Error(`The card API answered ${res.status} ${res.statusText}.`);
  return res.json();
}
export function diffCards(oldRaw: unknown, newRaw: unknown): SyncDiff {
  const o = new Map<string, Raw>(), n = new Map<string, Raw>();
  if (Array.isArray(oldRaw)) for (const c of oldRaw) if (c && typeof c === 'object') o.set(keyOf(c), c);
  if (Array.isArray(newRaw)) for (const c of newRaw) if (c && typeof c === 'object') n.set(keyOf(c), c);
  const added: string[] = [], changed: string[] = [], removed: string[] = [];
  for (const [k, c] of n) { const prev = o.get(k); if (!prev) added.push(nameOf(c)); else if (JSON.stringify(prev) !== JSON.stringify(c)) changed.push(nameOf(c)); }
  for (const [k, c] of o) if (!n.has(k)) removed.push(nameOf(c));
  const rep = normalizeApiCards(newRaw);
  return { added, changed, removed, total: rep.cards.length, unknownFields: rep.unknownFields, skipped: rep.skipped };
}
