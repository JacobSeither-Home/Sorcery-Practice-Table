// Art Sync: images come from a folder or zip on the user's own disk and are cached in this browser.
// Nothing is uploaded and nothing is fetched from Erik's Curiosa's CDN.
// The official image folder does not document its file naming, so matching is by normalized
// filename against printing slugs, card slugs, and card names, in that order.
import { unzip } from 'fflate';
import { slugify } from '../engine/cards';
import type { CardDef } from '../engine/types';
import { artDb, db } from './db';

export interface ArtReport { matched: number; missing: string[]; unmatched: string[]; files: number }
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
export async function fromZip(file: File): Promise<Entry[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const files = await new Promise<Record<string, Uint8Array>>((res, rej) => unzip(buf, { filter: (f) => IMG.test(f.name) && !f.name.includes('__MACOSX') }, (e, d) => (e ? rej(e) : res(d))));
  return Object.entries(files).map(([name, data]) => ({ name, blob: async () => new Blob([data as BlobPart]) }));
}

export const fileKey = (path: string) => slugify(path.split('/').pop()!.replace(IMG, ''));

/** Pure matching step, unit-testable: file keys -> card ids. */
export function matchArt(fileKeys: string[], cards: CardDef[]): { byCard: Map<string, number>; unmatched: number[] } {
  const exact = new Map<string, string>(); const names: [string, string][] = [];
  for (const c of cards) {
    for (const p of c.printings) exact.set(slugify(p.slug), c.id);
    exact.set(slugify(c.slug), c.id); exact.set(slugify(c.name), c.id);
    names.push([slugify(c.name), c.id]);
  }
  names.sort((a, b) => b[0].length - a[0].length);
  const byCard = new Map<string, number>(); const unmatched: number[] = [];
  fileKeys.forEach((k, i) => {
    let id = exact.get(k);
    if (!id) { const hit = names.find(([n]) => n.length > 2 && (`_${k}_`).includes(`_${n}_`)); id = hit?.[1]; }
    if (!id) unmatched.push(i); else if (!byCard.has(id) || exact.get(k) === id && fileKeys[byCard.get(id)!].length > k.length) byCard.set(id, i);
  });
  return { byCard, unmatched };
}

async function shrink(blob: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
    const cv = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
    return await cv.convertToBlob({ type: 'image/webp', quality: 0.82 });
  } catch { return blob; }
}

export async function importArt(entries: Entry[], cards: CardDef[], onProgress: (done: number, total: number) => void): Promise<ArtReport> {
  const { byCard, unmatched } = matchArt(entries.map((e) => fileKey(e.name)), cards);
  let done = 0;
  for (const [id, i] of byCard) { await artDb.set(id, await shrink(await entries[i].blob())); onProgress(++done, byCard.size); }
  const have = new Set(await artDb.keys());
  return { matched: byCard.size, files: entries.length, unmatched: unmatched.map((i) => entries[i].name), missing: cards.filter((c) => c.source === 'api' && !have.has(c.id)).map((c) => c.name) };
}
export async function loadArtUrls(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of await artDb.keys()) { const b = await artDb.get(k); if (b) out[k] = URL.createObjectURL(b); }
  return out;
}
