// Online play between two friends. Peer-to-peer (WebRTC data channel) through PeerJS; the public
// PeerJS broker is only used to introduce the two browsers. Only deck lists (card ids), the shuffle
// seed and moves travel over the wire. Art and card text are never sent: both players need the
// same card pool synced locally, which is checked with a hash before the game starts.
import Peer, { type DataConnection } from 'peerjs';
import type { Action, CardDef, DeckList, GameState, PlayerId } from '../engine/types';

export type Msg =
  | { t: 'hello'; name: string; deck: DeckList; hash: string }
  | { t: 'start'; seed: number; first: PlayerId; decks: [DeckList, DeckList]; hash: string; names: [string, string] }
  | { t: 'act'; n: number; a: Action; hash: string }
  | { t: 'error'; text: string };

export function deckHash(cards: Record<string, CardDef>, decks: DeckList[]): string {
  const ids = [...new Set(decks.flatMap((d) => [d.avatar, ...d.spellbook, ...d.atlas]))].sort();
  const sig = ids.map((id) => { const c = cards[id]; return c ? [id, c.type, c.cost, c.attack, c.defense, c.life, Object.values(c.thresholds), c.keywords, c.movement, c.ranged, c.effects] : [id, 'MISSING']; });
  return hash(JSON.stringify(sig));
}
export function stateHash(s: GameState): string {
  return hash(JSON.stringify([s.turn, s.active, s.phase, s.players.map((p) => [p.life, p.mana, p.hand, p.spellbook.length, p.atlas.length]), s.sites, Object.values(s.units).map((u) => [u.id, u.c, u.r, u.tapped, u.damage])]));
}
function hash(str: string): string { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

const PREFIX = 'sorcery-practice-table-';
export const newRoomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');

export interface Link { send: (m: Msg) => void; close: () => void }
export function openLink(role: 'host' | 'guest', code: string, on: { open: () => void; msg: (m: Msg) => void; closed: (why: string) => void }): Link {
  const peer = role === 'host' ? new Peer(PREFIX + code) : new Peer();
  let conn: DataConnection | null = null;
  const wire = (c: DataConnection) => {
    conn = c;
    c.on('open', on.open);
    c.on('data', (d) => on.msg(d as Msg));
    c.on('close', () => on.closed('The other player disconnected.'));
    c.on('error', (e) => on.closed(String(e)));
  };
  peer.on('error', (e) => on.closed(e.type === 'unavailable-id' ? 'That room code is already in use.' : e.type === 'peer-unavailable' ? 'No game found with that room code.' : `Connection error: ${e.type}`));
  if (role === 'host') peer.on('connection', (c) => { if (conn) c.close(); else wire(c); });
  else peer.on('open', () => wire(peer.connect(PREFIX + code, { reliable: true })));
  return { send: (m) => conn?.send(m), close: () => { conn?.close(); peer.destroy(); } };
}
