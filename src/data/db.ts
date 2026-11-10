// Local persistence. Everything lives in this browser's IndexedDB: card data, decks, cached art, feedback.
import { createStore, del, get, keys, set, clear } from 'idb-keyval';
const kv = createStore('spt-data', 'kv');
const art = createStore('spt-art', 'images');
export const db = {
  get: <T>(k: string) => get<T>(k, kv).catch(() => undefined),
  set: (k: string, v: unknown) => set(k, v, kv).catch(() => undefined),
  del: (k: string) => del(k, kv).catch(() => undefined),
};
export const artDb = {
  get: (k: string) => get<Blob>(k, art).catch(() => undefined),
  set: (k: string, v: Blob) => set(k, v, art),
  keys: () => keys<string>(art).catch(() => [] as string[]),
  clear: () => clear(art),
};
