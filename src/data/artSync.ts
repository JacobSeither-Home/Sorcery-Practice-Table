// Art Sync: images come from a folder or zip on the user's own disk and are cached in this browser.
// Nothing is uploaded and nothing is fetched from Erik's Curiosa's CDN.
// The official image folder does not document its file naming, so matching is by normalized
// filename against printing slugs, card slugs, and card names, in that order.
import { Unzip, UnzipInflate, inflateSync } from 'fflate';
import { slugify } from '../engine/cards';
import type { CardDef } from '../engine/types';
import { artDb, db } from './db';

export interface ArtReport { matched: number; missing: string[]; unmatched: string[]; files: number; images: number; alts: number; samples: string[] }
const IMG = /\.(png|jpe?g|webp|avif)$/i;
type Entry = { name: string; blob: () => Promise<Blob> };

export const supportsFolderPicker = () => 'showDirectoryPicker' in window;

async function walk(dir: any, out: Entry[], prefix = '') {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'directory') await walk(h, out, prefix + name + '/');
    else if (IMG.test(name)) out.push({ name: prefix + name, blob: () => h.getFile() });
  }
}
export async function pickFolder(): Promise<Entry[]> {
  const dir = await (window as any).showDirectoryPicker({ id: 'sorcery-art', mode: 'read' });
  await db.set('art:folder', dir); // remembered where the browser allows it
  const out: Entry[] = []; await walk(dir, out); return out;
}
export async function rememberedFolder(): Promise<{ name: string; read: () => Promise<Entry[]> } | null> {
  const dir: any = await db.get('art:folder');
  if (!dir?.name) return null;
  return { name: dir.name, read: async () => {
    if ((await dir.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('Permission to read the folder was not granted.');
    const out: Entry[] = []; await walk(dir, out); return out;
  } };
}
export function fromFileList(files: FileList): Entry[] {
  return [...files].filter((f) => IMG.test(f.name)).map((f) => ({ name: (f as any).webkitRelativePath || f.name, blob: async () => f }));
}

// ---- zips, read as a stream so a multi-gigabyte download never has to fit in memory ----
export const OFFICIAL_ART_FOLDER = 'https://drive.google.com/drive/folders/17IrJkRGmIU9fDSTU2JQEU9JlFzb5liLJ'; // linked from api.sorcerytcg.com
export const supportsFilePicker = () => 'showOpenFilePicker' in window;
/** Opens the file dialog in the Downloads folder (where browsers put a Drive download) and remembers the choice. */
export async function pickZips(): Promise<File[]> {
  const handles: any[] = await (window as any).showOpenFilePicker({ id: 'sorcery-art-zip', startIn: 'downloads', multiple: true, types: [{ description: 'Zip archives', accept: { 'application/zip': ['.zip'] } }] });
  const old: any[] = (await db.get('art:zips')) ?? [];
  await db.set('art:zips', [...old.filter((o) => !handles.some((h) => h.name === o.name)), ...handles]);
  return Promise.all(handles.map((h) => h.getFile()));
}
export async function rememberedZips(): Promise<{ names: string[]; read: () => Promise<File[]> } | null> {
  const handles: any[] | undefined = await db.get('art:zips');
  if (!handles?.length) return null;
  return { names: handles.map((h) => h.name), read: async () => {
    for (const h of handles) if ((await h.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('Permission to read the zip was not granted.');
    return Promise.all(handles.map((h) => h.getFile()));
  } };
}
/** Read a zip through its central directory (random access with File.slice): each image is read and inflated on its
 *  own, so a multi-gigabyte zip never has to fit in memory, and zips whose entries carry their sizes only in the
 *  central directory (Google Drive's downloads, zip64) read correctly. Returns null when there is no central directory. */
export async function zipEntriesIndexed(zip: File): Promise<Entry[] | null> {
  const tail = new DataView(await zip.slice(Math.max(0, zip.size - 65557)).arrayBuffer());
  let eocd = -1; for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  let count = tail.getUint16(eocd + 10, true); let size = tail.getUint32(eocd + 12, true); let offset = tail.getUint32(eocd + 16, true);
  if (offset === 0xffffffff || count === 0xffff || size === 0xffffffff) { // zip64: the zip64 end-of-directory record says where things are
    const loc = eocd - 20; if (loc < 0 || tail.getUint32(loc, true) !== 0x07064b50) return null;
    const rec = Number(tail.getBigUint64(loc + 8, true));
    const z = new DataView(await zip.slice(rec, rec + 56).arrayBuffer()); if (z.getUint32(0, true) !== 0x06064b50) return null;
    count = Number(z.getBigUint64(32, true)); size = Number(z.getBigUint64(40, true)); offset = Number(z.getBigUint64(48, true));
  }
  const cd = new DataView(await zip.slice(offset, offset + size).arrayBuffer()); const dec = new TextDecoder();
  const out: Entry[] = []; let p = 0;
  for (let k = 0; k < count && p + 46 <= cd.byteLength; k++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true); let csize = cd.getUint32(p + 20, true); let usize = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true); let lho = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    // zip64 extra field: the 64-bit sizes / offset, in this order, for the fields set to 0xffffffff
    for (let x = p + 46 + nlen; x < p + 46 + nlen + xlen - 4;) { const id = cd.getUint16(x, true), len = cd.getUint16(x + 2, true);
      if (id === 0x0001) { let q = x + 4; if (usize === 0xffffffff) { usize = Number(cd.getBigUint64(q, true)); q += 8; } if (csize === 0xffffffff) { csize = Number(cd.getBigUint64(q, true)); q += 8; } if (lho === 0xffffffff) { lho = Number(cd.getBigUint64(q, true)); } }
      x += 4 + len; }
    p += 46 + nlen + xlen + clen;
    if (!IMG.test(name) || name.includes('__MACOSX') || (method !== 0 && method !== 8)) continue;
    const at = lho, cs = csize, m = method;
    out.push({ name, blob: async () => {
      const lh = new DataView(await zip.slice(at, at + 30).arrayBuffer());
      const start = at + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      const raw = new Uint8Array(await zip.slice(start, start + cs).arrayBuffer());
      return new Blob([(m === 0 ? raw : inflateSync(raw)) as BlobPart]);
    } });
  }
  return out;
}
async function* zipEntries(zip: File): AsyncGenerator<Entry> {
  try { const idx = await zipEntriesIndexed(zip); if (idx) { yield* idx; return; } } catch { /* fall back to streaming below */ }
  const queue: Entry[] = []; let failed: Error | null = null;
  const un = new Unzip((f) => {
    if (!IMG.test(f.name) || f.name.includes('__MACOSX')) return; // not started = skipped
    const chunks: Uint8Array[] = [];
    f.ondata = (err, data, final) => {
      if (err) { failed = new Error(`${zip.name}: ${err.message}`); return; }
      chunks.push(data);
      if (final) queue.push({ name: f.name, blob: async () => new Blob(chunks as BlobPart[]) });
    };
    f.start();
  });
  un.register(UnzipInflate);
  const reader = zip.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    try { un.push(value ?? new Uint8Array(0), done); } catch (e) { throw new Error(`${zip.name} could not be read as a zip (${(e as Error).message}).`); }
    if (failed) throw failed;
    while (queue.length) yield queue.shift()!;
    if (done) break;
  }
}

// ---- matching: every image is kept, filed under its card as one "variant" (printing / alternate art) ----
export const fileKey = (path: string) => slugify(path.split('/').pop()!.replace(IMG, ''));
const SEP = '|';
export const artKey = (cardId: string, variant: string) => cardId + SEP + variant;
export function splitKey(k: string): [string, string] { const i = k.lastIndexOf(SEP); return i < 0 ? [k, 'base'] : [k.slice(0, i), k.slice(i + 1)]; }

export interface Match { id: string; variant: string; exact: boolean }
/** Pure, unit-testable. A filename equal to a printing slug becomes that printing; anything else that names a card becomes a variant named after the file. */
export function matcher(cards: CardDef[]): (key: string) => Match | null {
  const printing = new Map<string, string>(); const exact = new Map<string, string>(); const names: [string, string][] = [];
  for (const c of cards) {
    for (const p of c.printings) printing.set(slugify(p.slug), c.id);
    exact.set(slugify(c.slug), c.id); exact.set(slugify(c.name), c.id);
    names.push([slugify(c.name), c.id]);
  }
  names.sort((x, y) => y[0].length - x[0].length); // longest card name wins
  // Printing slugs look like "004-card_name-b-s". A file that differs only in its set prefix
  // ("bet-card_name-b-s") is that printing when exactly one printing of the card ends the same way.
  const tail = (s: string) => s.slice(s.indexOf('_') + 1);
  const byId = new Map(cards.map((c) => [c.id, c]));
  return (k) => {
    const p = printing.get(k); if (p) return { id: p, variant: k, exact: true };
    const e = exact.get(k); if (e) return { id: e, variant: 'base', exact: true };
    const hit = names.find(([n]) => n.length > 2 && (`_${k}_`).includes(`_${n}_`));
    if (!hit) return null;
    const same = byId.get(hit[1])!.printings.map((x) => slugify(x.slug)).filter((s) => tail(s) === tail(k) || tail(s) === k);
    return same.length === 1 ? { id: hit[1], variant: same[0], exact: true } : { id: hit[1], variant: k, exact: false };
  };
}

export const ART_LONG_SIDE = 1100;
async function shrink(blob: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    // 1100 px on the long side keeps the enlarged hover card sharp on high-density screens (it is shown about 460 CSS px tall)
    const scale = Math.min(1, ART_LONG_SIDE / Math.max(bmp.width, bmp.height));
    const cv = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
    return await cv.convertToBlob({ type: 'image/webp', quality: 0.88 });
  } catch { return blob; }
}

async function ingest(source: AsyncIterable<Entry>, cards: CardDef[], onProgress: (text: string) => void, label: () => string): Promise<ArtReport> {
  const m = matcher(cards); const unmatched: string[] = []; const samples: string[] = []; const touched = new Set<string>(); let files = 0, stored = 0;
  for await (const e of source) {
    files++; if (samples.length < 6 && files % 37 === 1) samples.push(e.name);
    const hit = m(fileKey(e.name));
    if (!hit) { if (unmatched.length < 500) unmatched.push(e.name); continue; }
    await artDb.set(artKey(hit.id, hit.variant), await shrink(await e.blob())); stored++; touched.add(hit.id);
    if (files % 5 === 0) onProgress(`${label()}${files} images read, ${touched.size} cards matched…`);
  }
  const v = await listVariants();
  return { matched: touched.size, files, images: stored, alts: Object.values(v).filter((x) => x.length > 1).length, unmatched, samples,
    missing: cards.filter((c) => c.source === 'api' && !v[c.id]).map((c) => c.name) };
}
/** Import one or more zips image by image: match, shrink, cache, move on. Each run adds to what is already cached. */
export async function importZips(zips: File[], cards: CardDef[], onProgress: (text: string) => void): Promise<ArtReport> {
  let cur = '';
  async function* all() { for (const z of zips) { cur = z.name + ': '; yield* zipEntries(z); } }
  return ingest(all(), cards, onProgress, () => cur);
}
export async function importArt(entries: Entry[], cards: CardDef[], onProgress: (text: string) => void): Promise<ArtReport> {
  async function* all() { yield* entries; }
  return ingest(all(), cards, onProgress, () => '');
}

// ---- reading the cache ----
/** cardId -> variant names that have an image. */
export async function listVariants(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const k of await artDb.keys()) { const [id, v] = splitKey(String(k)); (out[id] ??= []).push(v); }
  return out;
}
/** Default order: the card's printings in API order with non-foil first, then a plain-named file, then the rest by name. */
export function orderVariants(card: CardDef | undefined, variants: string[]): string[] {
  const rank = (v: string) => {
    const i = card ? card.printings.findIndex((p) => slugify(p.slug) === v) : -1;
    if (i >= 0) return (/foil/i.test(card!.printings[i].finish ?? '') ? 1000 : 0) + i;
    return v === 'base' ? 2000 : 3000;
  };
  return [...variants].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
export function variantLabel(card: CardDef | undefined, v: string): string {
  const p = card?.printings.find((x) => slugify(x.slug) === v);
  if (p) return [p.set, p.finish, p.product].filter(Boolean).join(', ') || p.slug;
  return v === 'base' ? 'Unlabeled image' : v.replace(/_/g, ' ');
}
export async function variantBlob(cardId: string, variant: string): Promise<Blob | undefined> {
  return (await artDb.get(artKey(cardId, variant))) ?? (variant === 'base' ? await artDb.get(cardId) : undefined); // older caches had no variant part
}
/** One object URL per card: the chosen variant if it exists on this device, otherwise the default. */
export async function loadArtUrls(pool: Record<string, CardDef>, choice: Record<string, string>): Promise<{ urls: Record<string, string>; variants: Record<string, string[]> }> {
  const variants = await listVariants(); const urls: Record<string, string> = {};
  for (const [id, vs] of Object.entries(variants)) {
    const v = vs.includes(choice[id]) ? choice[id] : orderVariants(pool[id], vs)[0];
    const b = await variantBlob(id, v); if (b) urls[id] = URL.createObjectURL(b);
  }
  return { urls, variants };
}
