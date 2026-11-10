import { create } from 'zustand';
import { type CardDef, ELEMENTS } from '../engine';
import { useStore } from '../store';

/** Which card the pointer is over; the right rail shows it large. */
export const useHover = create<{ card: CardDef | null; set: (c: CardDef | null) => void }>((set) => ({ card: null, set: (card) => set({ card }) }));
export const hoverProps = (card: CardDef | undefined) => ({
  onMouseEnter: () => card && useHover.getState().set(card),
  onFocus: () => card && useHover.getState().set(card),
});

export function mainElement(c: CardDef): string {
  const e = ELEMENTS.filter((x) => c.thresholds[x] > 0);
  return e.length === 1 ? e[0] : e.length > 1 ? 'multi' : 'none';
}
export function Pips({ t }: { t: CardDef['thresholds'] }) {
  return <span className="pips">{ELEMENTS.flatMap((e) => Array.from({ length: t[e] }, (_, i) => <i key={e + i} className={`pip ${e}`} aria-label={e} />))}</span>;
}

/** A card. Shows the user's locally synced art when there is some, otherwise a drawn placeholder frame. */
export function CardFace({ card, size = 'md' }: { card: CardDef; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
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
      {size !== 'xs' && <div className="card-type">{card.typeline || card.type}{card.subtypes.length ? ` — ${card.subtypes.join(' ')}` : ''}</div>}
      {(size === 'md' || size === 'lg') && <div className="card-rules">{card.rules}</div>}
      {unit && <span className="stat">{card.type === 'Avatar' ? `${card.attack} · ♥${card.life}` : card.attack === card.defense ? card.attack : `${card.attack}/${card.defense}`}</span>}
    </div>
  );
}
