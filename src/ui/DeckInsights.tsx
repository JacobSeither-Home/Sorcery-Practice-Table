// Deck statistics and a sample hand for the deck builder: how the spellbook and atlas lean by element, the mana
// curve by card type, and a practice opening hand drawn the way a game starts. Nothing here is used in play.
import { useMemo, useState } from 'react';
import { type CardDef, type DeckList, ELEMENTS } from '../engine';
import { CardFace, hoverProps } from './CardFace';

const TYPES = ['Minion', 'Magic', 'Aura', 'Artifact'] as const;
// categorical slots 1-4 of the chart palette (dark steps), checked for colour-blind separation and contrast on the panel
const TYPE_COLOR: Record<(typeof TYPES)[number], string> = { Minion: '#3987e5', Magic: '#d95926', Aura: '#199e70', Artifact: '#c98500' };
const COSTS = [0, 1, 2, 3, 4, 5, 6, 7]; // 7 = "7 or more"
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export function DeckInsights({ deck, pool }: { deck: DeckList; pool: Record<string, CardDef> }) {
  const spells = deck.spellbook.map((id) => pool[id]).filter(Boolean);
  const sites = deck.atlas.map((id) => pool[id]).filter(Boolean);
  if (!spells.length && !sites.length) return null;
  return (
    <details className="panel insights">
      <summary><b>Deck stats and sample hand</b> — {spells.length} spellbook · {sites.length} atlas{deck.collection?.length ? ` · ${deck.collection.length} collection` : ''}{deck.maybe?.length ? ` · ${deck.maybe.length} maybeboard` : ''}</summary>
      <Elements spells={spells} sites={sites} />
      <ManaCurve spells={spells} />
      <SampleHand deck={deck} pool={pool} />
    </details>
  );
}

/** How the deck leans by element. These are this app's measures, defined in each tooltip. */
function Elements({ spells, sites }: { spells: CardDef[]; sites: CardDef[] }) {
  const totalCost = spells.reduce((n, c) => n + c.cost, 0);
  const totalOut = sites.reduce((n, c) => n + ELEMENTS.reduce((m, e) => m + c.thresholds[e], 0), 0);
  return (
    <div className="el-stats">
      {ELEMENTS.map((e) => {
        const need = spells.filter((c) => c.thresholds[e] > 0);
        const give = sites.filter((c) => c.thresholds[e] > 0);
        const out = sites.reduce((n, c) => n + c.thresholds[e], 0);
        const none = !need.length && !give.length;
        return (
          <div key={e} className={`el-stat ${none ? 'none' : ''}`}>
            <i className={`pip ${e}`} aria-hidden /> <b>{e[0].toUpperCase() + e.slice(1)}</b>
            <p data-tip={`Spells: share of the spellbook's cards whose threshold includes ${e}. Cost: share of the spellbook's total mana cost carried by those spells.`}>{pct(need.length, spells.length)}% spells · {pct(need.reduce((n, c) => n + c.cost, 0), totalCost)}% cost</p>
            <p data-tip={`Sites: share of the atlas's sites that provide ${e}. Output: share of all the element symbols the atlas provides that are ${e}.`}>{pct(give.length, sites.length)}% sites · {pct(out, totalOut)}% output</p>
          </div>
        );
      })}
    </div>
  );
}

/** Spells by mana cost, stacked by card type. */
function ManaCurve({ spells }: { spells: CardDef[] }) {
  const [hover, setHover] = useState<number | null>(null); const [table, setTable] = useState(false);
  const data = COSTS.map((k) => Object.fromEntries(TYPES.map((t) => [t, spells.filter((c) => c.type === t && (k === 7 ? c.cost >= 7 : c.cost === k)).length])) as Record<(typeof TYPES)[number], number>);
  const totals = data.map((r) => TYPES.reduce((n, t) => n + r[t], 0));
  const max = Math.max(4, ...totals); const step = max > 12 ? 4 : 2; const top = Math.ceil(max / step) * step;
  const W = 520, H = 200, L = 28, B = 22, T = 8, bw = (W - L) / COSTS.length; const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const present = TYPES.filter((t) => data.some((r) => r[t]));
  return (
    <div className="curve">
      <div className="curve-head"><b>Mana curve</b>
        <span className="legend">{present.map((t) => <span key={t}><i style={{ background: TYPE_COLOR[t] }} />{t}</span>)}</span>
        <button className="link" onClick={() => setTable(!table)}>{table ? 'Show the chart' : 'Show as a table'}</button></div>
      {table ? (
        <table className="curve-table"><thead><tr><th>Cost</th>{TYPES.map((t) => <th key={t}>{t}</th>)}<th>All</th></tr></thead>
          <tbody>{COSTS.map((k, i) => <tr key={k}><td>{k === 7 ? '7+' : k}</td>{TYPES.map((t) => <td key={t}>{data[i][t] || ''}</td>)}<td>{totals[i] || ''}</td></tr>)}</tbody></table>
      ) : (
        <div className="curve-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spells by mana cost, stacked by card type" onPointerLeave={() => setHover(null)}>
            {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 6} y={y(v) + 3} className="tick" textAnchor="end">{v}</text></g>)}
            {COSTS.map((k, i) => {
              const x = L + i * bw + bw * 0.18, w = bw * 0.64; let acc = 0;
              const segs = TYPES.filter((t) => data[i][t]).map((t) => { const y0 = y(acc), y1 = y(acc + data[i][t]); acc += data[i][t]; return { t, y0, y1 }; });
              return (
                <g key={k} onPointerEnter={() => setHover(i)}>
                  <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
                  {segs.map((g, j) => { const last = j === segs.length - 1; const h = Math.max(0, g.y0 - g.y1 - (j ? 2 : 0)); // 2px gap between stacked segments
                    return <path key={g.t} fill={TYPE_COLOR[g.t]} opacity={hover === null || hover === i ? 1 : 0.55}
                      d={last ? roundTop(x, g.y0 - (j ? 2 : 0) - h, w, h, 4) : `M${x},${g.y0 - (j ? 2 : 0) - h}h${w}v${h}h${-w}z`} />; })}
                  <text x={x + w / 2} y={H - 6} className="tick" textAnchor="middle">{k === 7 ? '7+' : k}</text>
                </g>
              );
            })}
          </svg>
          {hover !== null && totals[hover] > 0 && <div className="curve-tip" style={{ left: `${((L + (hover + 0.5) * bw) / W) * 100}%` }}>
            <b>Cost {hover === 7 ? '7+' : hover}: {totals[hover]} spell{totals[hover] > 1 ? 's' : ''}</b>
            {TYPES.filter((t) => data[hover][t]).map((t) => <span key={t}><i style={{ background: TYPE_COLOR[t] }} />{t} {data[hover][t]}</span>)}
          </div>}
        </div>
      )}
    </div>
  );
}
const roundTop = (x: number, y: number, w: number, h: number, r: number) => { const rr = Math.min(r, h, w / 2); return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}z`; };

function shuffled<T>(a: T[]): T[] { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
/** A practice hand drawn like a game's opening hand: three sites from the atlas and three spells from the spellbook
 *  (rulebook, setup "Step 5: Draw Starting Hand"). Then draw more of either, or click a card to discard it. */
function SampleHand({ deck, pool }: { deck: DeckList; pool: Record<string, CardDef> }) {
  const deal = () => { const sp = shuffled(deck.spellbook), at = shuffled(deck.atlas); return { sp: sp.slice(3), at: at.slice(3), hand: [...at.slice(0, 3), ...sp.slice(0, 3)] }; };
  const [st, setSt] = useState(deal);
  const key = useMemo(() => deck.spellbook.length + ':' + deck.atlas.length, [deck.spellbook.length, deck.atlas.length]);
  const [dealtFor, setDealtFor] = useState(key);
  if (dealtFor !== key) { setDealtFor(key); setSt(deal()); } // the deck changed: deal again from it
  const draw = (from: 'sp' | 'at') => setSt((x) => (x[from].length ? { ...x, [from]: x[from].slice(1), hand: [...x.hand, x[from][0]] } : x));
  return (
    <div className="sample">
      <div className="curve-head"><b>Sample hand</b><span className="note">Three sites and three spells, as a game starts. Click a card to discard it.</span></div>
      <div className="row">
        <button onClick={() => draw('sp')} disabled={!st.sp.length}>Draw a spell ({st.sp.length})</button>
        <button onClick={() => draw('at')} disabled={!st.at.length}>Draw a site ({st.at.length})</button>
        <button onClick={() => setSt(deal())}>↻ New hand</button>
      </div>
      <div className="sample-cards">{st.hand.map((id, i) => { const c = pool[id]; return c ? (
        <button key={i + ':' + id} className="look-card" onClick={() => setSt((x) => ({ ...x, hand: x.hand.filter((_, j) => j !== i) }))} {...hoverProps(c)} aria-label={`Discard ${c.name}`}><CardFace card={c} size="sm" /></button>) : null; })}
        {!st.hand.length && <p className="note">The hand is empty.</p>}</div>
    </div>
  );
}

/** The deck laid out as card pictures, the way a deck page shows it: the Avatar first, the spellbook by card type,
 *  the atlas apart from the spells, then the collection and the maybeboard. Each card shows how many copies the deck has.
 *  Clicking a card takes one copy out of that part of the deck. */
export function DeckVisual({ deck, pool, remove }: { deck: DeckList; pool: Record<string, CardDef>; remove?: (id: string, where: 'spellbook' | 'atlas' | 'collection' | 'maybe') => void }) {
  const stacks = (ids: string[]) => [...new Set(ids)].map((id) => ({ id, n: ids.filter((x) => x === id).length, c: pool[id] })).filter((x) => x.c)
    .sort((a, b) => a.c.cost - b.c.cost || a.c.name.localeCompare(b.c.name));
  const block = (key: string, title: string, ids: string[], where?: 'spellbook' | 'atlas' | 'collection' | 'maybe') => {
    const st = stacks(ids); if (!st.length) return null;
    return (
      <section key={key} className="dv-block">
        <h3>{title} <span className="dv-n">{ids.length}</span></h3>
        <div className="grid dv-grid">{st.map((x) => (
          <button key={x.id} className="gridcard" {...hoverProps(x.c)} onClick={() => where && remove?.(x.id, where)} disabled={!where || !remove}
            aria-label={`${x.n} ${x.c.name}${where && remove ? ', click to take one out' : ''}`} data-tip={where && remove ? 'Click to take one copy out' : undefined}>
            <CardFace card={x.c} size="sm" />{x.n > 1 && <span className="n">×{x.n}</span>}
          </button>))}</div>
      </section>
    );
  };
  const av = pool[deck.avatar];
  return (
    <div className="deck-visual">
      <section className="dv-block"><h3>Avatar</h3>
        {av ? <div className="grid dv-grid"><span className="gridcard" {...hoverProps(av)}><CardFace card={av} size="sm" /></span></div> : <p className="note">No Avatar yet: choose one in Add cards.</p>}</section>
      <h2 className="dv-part">Spellbook <span className="dv-n">{deck.spellbook.length}</span></h2>
      {TYPES.map((t) => block(t, t, deck.spellbook.filter((id) => pool[id]?.type === t), 'spellbook'))}
      {block('other', 'Other', deck.spellbook.filter((id) => pool[id] && !(TYPES as readonly string[]).includes(pool[id].type)), 'spellbook')}
      {!deck.spellbook.length && <p className="note">No spells yet.</p>}
      <h2 className="dv-part">Atlas <span className="dv-n">{deck.atlas.length}</span></h2>
      {block('sites', 'Sites', deck.atlas, 'atlas')}
      {!deck.atlas.length && <p className="note">No sites yet.</p>}
      {(deck.collection?.length || deck.maybe?.length) ? <h2 className="dv-part">Outside the deck</h2> : null}
      {block('collection', 'Collection', deck.collection ?? [], 'collection')}
      {block('maybe', 'Maybeboard', deck.maybe ?? [], 'maybe')}
    </div>
  );
}
