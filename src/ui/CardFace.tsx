import { create } from 'zustand';
import { type CardDef, ELEMENTS } from '../engine';
import { useStore } from '../store';

/** Which card the pointer is over; the right rail shows it large. */
export const useHover = create<{ card: CardDef | null; set: (c: CardDef | null) => void }>((set) => ({ card: null, set: (card) => set({ card }) }));
/** The card shown enlarged beside whatever the mouse is resting on. */
export const useZoom = create<{ card: CardDef | null; rect: DOMRect | null }>(() => ({ card: null, rect: null }));
let zoomTimer = 0; let lastTouch = 0;
const clearZoom = () => { clearTimeout(zoomTimer); if (useZoom.getState().card) useZoom.setState({ card: null, rect: null }); };
function startZoom(card: CardDef, el: Element) {
  clearTimeout(zoomTimer);
  if (Date.now() - lastTouch < 900) return; // a finger, not a cursor: long-press opens the inspector instead
  zoomTimer = window.setTimeout(() => { if (el.isConnected) useZoom.setState({ card, rect: el.getBoundingClientRect() }); }, 320);
}
/** The card opened large in the inspector sheet (long-press on touch, right-click with a mouse). */
export const useInspect = create<{ card: CardDef | null; open: (c: CardDef | null) => void }>((set) => ({ card: null, open: (card) => set({ card }) }));

// One long-press at a time. The innermost element under the finger claims it (a unit inside a site cell).
let lp: { timer: number; x: number; y: number } | null = null;
const cancelLp = () => { if (lp) { clearTimeout(lp.timer); lp = null; } };
/** After a long-press opens the inspector, swallow the click that the same touch produces. */
function swallowNextClick() {
  const stop = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
  addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', stop, { capture: true }), 700);
}
type Claimed = Event & { __lp?: boolean };

export const hoverProps = (card: CardDef | undefined) => ({
  onMouseEnter: (e: React.MouseEvent) => { if (card) { useHover.getState().set(card); startZoom(card, e.currentTarget); } },
  onMouseLeave: clearZoom,
  onFocus: () => card && useHover.getState().set(card),
  onPointerDown: (e: React.PointerEvent) => {
    clearZoom(); // pressing (to drag or click) puts the enlarged card away
    if (e.pointerType !== 'mouse') lastTouch = Date.now();
    if (!card || e.pointerType === 'mouse' || (e.nativeEvent as Claimed).__lp) return;
    (e.nativeEvent as Claimed).__lp = true;
    useHover.getState().set(card); // a tap also updates the side preview on tablets
    cancelLp();
    lp = { x: e.clientX, y: e.clientY, timer: window.setTimeout(() => { lp = null; swallowNextClick(); navigator.vibrate?.(12); useInspect.getState().open(card); }, 480) };
  },
  onPointerMove: (e: React.PointerEvent) => { if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancelLp(); },
  onPointerUp: cancelLp, onPointerCancel: cancelLp,
  onContextMenu: (e: React.MouseEvent) => { if (!card || e.defaultPrevented) return; e.preventDefault(); if ((e.nativeEvent as PointerEvent).pointerType !== 'touch') useInspect.getState().open(card); },
});

export function mainElement(c: CardDef): string {
  const e = ELEMENTS.filter((x) => c.thresholds[x] > 0);
  return e.length === 1 ? e[0] : e.length > 1 ? 'multi' : 'none';
}
export function Pips({ t }: { t: CardDef['thresholds'] }) {
  return <span className="pips">{ELEMENTS.flatMap((e) => Array.from({ length: t[e] }, (_, i) => <i key={e + i} className={`pip ${e}`} aria-label={e} />))}</span>;
}

/** A card. Shows the user's locally synced art when there is some, otherwise a drawn placeholder frame. */
export function CardFace({ card, size = 'md' }: { card: CardDef; size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' }) {
  const art = useStore((s) => s.art[card.id]);
  const wide = card.type === 'Site';
  if (art) return <div className={`card ${size} art ${wide ? 'wide' : ''}`}><img src={art} alt={card.name} draggable={false} /></div>;
  const unit = card.type === 'Minion' || card.type === 'Avatar';
  return (
    <div className={`card ${size} frame el-${mainElement(card)} ${wide ? 'wide' : ''}`}>
      <div className="card-top">
        {card.type !== 'Site' && card.type !== 'Avatar' && <span className="cost">{card.cost}</span>}
        <span className="card-name">{card.name}</span>
        <Pips t={card.thresholds} />
      </div>
      <div className="card-well"><span>{card.type}</span></div>
      {size !== 'xs' && <div className="card-type">{card.typeline || card.type}{card.subtypes.length ? ` — ${card.subtypes.join(' ')}` : ''}{size === 'xl' && card.type === 'Avatar' ? `, power ${card.attack}, life ${card.life}` : ''}</div>}
      {(size === 'md' || size === 'lg' || size === 'xl') && <div className="card-rules">{card.rules}</div>}
      {unit && !(size === 'xl' && card.type === 'Avatar') && <span className="stat">{card.type === 'Avatar' ? `${card.attack} · ♥${card.life}` : card.attack === card.defense ? card.attack : `${card.attack}/${card.defense}`}</span>}
    </div>
  );
}

/** Enlarged card that appears next to the hovered card, on the board, in hand, and in the card grids. */
export function ZoomCard() {
  const { card, rect } = useZoom();
  if (!card || !rect) return null;
  const wide = card.type === 'Site';
  const W = Math.min(wide ? 462 : 330, innerWidth - 24), H = wide ? W * 5 / 7 : W * 7 / 5, gap = 14;
  let left = rect.right + gap;
  if (left + W > innerWidth - 8) left = rect.left - gap - W;                       // no room on the right: go left
  if (left < 8) left = Math.max(8, Math.min(innerWidth - W - 8, rect.left + rect.width / 2 - W / 2)); // neither side: centre it above or below
  let top = rect.top + rect.height / 2 - H / 2;
  if (left < rect.right && left + W > rect.left) top = rect.top - gap - H > 8 ? rect.top - gap - H : rect.bottom + gap; // overlapping column: sit above, else below
  top = Math.max(8, Math.min(innerHeight - H - 8, top));
  return <div className="zoomcard" style={{ left, top, ['--zw' as string]: `${wide ? W / 1.4 : W}px` }} aria-hidden><CardFace card={card} size="xl" /></div>;
}
