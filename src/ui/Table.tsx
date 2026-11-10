import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  type Action, type GameState, type Loc, type PlayerId, type Unit, CELLS, COLS, ELEMENTS, KEYWORD_HELP,
  actor, attackTargets, cardOf, cell, check, codexUrl, isDisabled, isWater, other, playableSiteCells, reach, responders,
  sitesOf, summoningSick, thresholdOf, unitCard, validTargets, xy,
} from '../engine';
import { type Game, useStore } from '../store';
import { CardFace, Pips, hoverProps, mainElement, useHover } from './CardFace';

type Sel = null | { k: 'hand'; inst: string; c?: number } | { k: 'unit'; id: string };
interface Opt { label: string; hint?: string; action: Action }

const PNAME = (g: Game, p: PlayerId) => g.names[p];

export function Table() {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const toast = useStore((s) => s.toast);
  const aiThinking = useStore((s) => s.aiThinking);
  const s = g.state;
  const who = actor(s);
  const hot = g.mode === 'hotseat';
  const viewer: PlayerId = hot ? (s.pending ? s.active : who) : g.local;
  const myInput = s.phase !== 'over' && (hot || who === g.local);
  const flip = !hot && g.local === 1;

  const [sel, setSel] = useState<Sel>(null);
  const [menu, setMenu] = useState<{ c: number; opts: Opt[] } | null>(null);
  const [manual, setManual] = useState(false);
  const [mull, setMull] = useState<string[]>([]);
  const [picks, setPicks] = useState<string[]>([]);
  const [removeOrig, setRemoveOrig] = useState(false);
  const [curtainFor, setCurtainFor] = useState<PlayerId | null>(null);
  const [seen, setSeen] = useState<PlayerId>(viewer);

  // clear transient UI whenever the game state moves on
  useEffect(() => { setSel(null); setMenu(null); setPicks([]); setRemoveOrig(false); setMull([]); }, [s]);
  // hotseat: hide the hand while the device changes hands
  useEffect(() => { if (hot && !s.pending && s.phase !== 'over' && viewer !== seen) setCurtainFor(viewer); }, [hot, viewer, seen, s.pending, s.phase]);

  const me = s.players[viewer];
  const selUnit = sel?.k === 'unit' ? s.units[sel.id] : undefined;
  const selCard = sel?.k === 'hand' ? cardOf(s, sel.inst) : undefined;

  // ---- legal-move highlights (teaching aid) ----
  const { cells: hiCells, units: hiUnits } = useMemo(() => {
    const cells = new Map<number, 'go' | 'hit' | 'place'>(); const units = new Set<string>();
    if (!myInput || s.pending) return { cells, units };
    if (selCard && sel?.k === 'hand') {
      const needs = selCard.effects.some((e) => e.who === 'target' && e.on === (selCard.type === 'Magic' ? 'cast' : 'genesis'));
      if (selCard.type === 'Site') { if (!s.units[me.avatar].tapped) for (const c of playableSiteCells(s, who)) cells.set(c, 'place'); }
      else if (selCard.type === 'Magic') { if (needs) for (const id of validTargets(s, who, selCard)) units.add(id); }
      else if (sel.c === undefined) for (const c of sitesOf(s, who)) cells.set(c, 'place');
      else if (needs) for (const id of validTargets(s, who, selCard, { c: sel.c, r: 'surface' })) units.add(id);
    }
    if (selUnit) {
      for (const path of reach(s, selUnit).values()) {
        const end: Loc = path.length ? path[path.length - 1] : { c: selUnit.c, r: selUnit.r };
        const hits = attackTargets(s, selUnit, end);
        if (hits.length) cells.set(end.c, 'hit'); else if (path.length && !cells.has(end.c)) cells.set(end.c, 'go');
      }
    }
    return { cells, units };
  }, [s, sel, myInput]);

  const explain = (a: Action) => { const r = check(s, a); if (!r.ok) toast(r.reason, 'error', r.keyword); return r.ok; };

  function unitOptions(u: Unit, c: number): Opt[] {
    const opts: Opt[] = [];
    for (const path of reach(s, u).values()) {
      const end: Loc = path.length ? path[path.length - 1] : { c: u.c, r: u.r };
      if (end.c !== c) continue;
      const where = end.r === 'under' ? (isWater(s, c) ? ' underwater' : ' underground') : '';
      const verb = path.length ? (end.c === u.c ? (end.r === 'under' ? `Go${where}` : 'Surface') : `Move here${where}`) : '';
      for (const t of attackTargets(s, u, end)) {
        const name = t.site ? 'the site' : unitCard(s, s.units[t.unit!]).name;
        opts.push({ label: `${path.length ? (end.c === u.c ? verb + ', attack ' : `Move${where}, attack `) : 'Attack '}${name}`, hint: t.site ? `${PNAME(g, other(u.owner))} loses ${unitCard(s, u).attack} life if nobody defends` : 'Both units strike at once', action: { t: 'move', unit: u.id, path, attack: t } });
      }
      if (path.length) opts.push({ label: verb, action: { t: 'move', unit: u.id, path } });
    }
    if (unitCard(s, u).ranged) {
      const [ux, uy] = xy(u.c), [cx, cy] = xy(c);
      const dx = Math.sign(cx - ux), dy = Math.sign(cy - uy);
      if ((dx === 0) !== (dy === 0)) { const a: Action = { t: 'shoot', unit: u.id, dx, dy }; if (check(s, a).ok) opts.push({ label: 'Shoot in this direction', hint: 'No strike back', action: a }); }
    }
    return opts;
  }

  function clickCell(c: number) {
    if (!myInput || s.pending) return;
    setMenu(null);
    if (sel?.k === 'hand' && selCard) {
      if (selCard.type === 'Site') { if (explain({ t: 'playSite', inst: sel.inst, c })) act({ t: 'playSite', inst: sel.inst, c }); return; }
      if (selCard.type === 'Magic') return;
      const needs = selCard.effects.some((e) => e.who === 'target' && e.on === 'genesis');
      if (needs && s.sites[c]?.owner === who) { setSel({ ...sel, c }); toast(`Now choose a target for ${selCard.name}.`); return; }
      if (explain({ t: 'cast', inst: sel.inst, c })) act({ t: 'cast', inst: sel.inst, c });
      return;
    }
    if (selUnit) {
      const opts = unitOptions(selUnit, c);
      if (!opts.length) { explain({ t: 'move', unit: selUnit.id, path: [{ c, r: selUnit.r }] }); return; }
      if (opts.length === 1) act(opts[0].action); else setMenu({ c, opts });
    }
  }
  function clickUnit(u: Unit, e: React.MouseEvent) {
    e.stopPropagation();
    if (manual) { setMenu(null); setSel({ k: 'unit', id: u.id }); return; }
    if (!myInput || s.pending) return;
    if (sel?.k === 'hand' && selCard && (selCard.type === 'Magic' || sel.c !== undefined)) {
      const a: Action = { t: 'cast', inst: sel.inst, c: sel.c, target: u.id };
      if (explain(a)) act(a); return;
    }
    if (sel?.k === 'hand') { clickCell(u.c); return; }
    if (u.owner === who && !(selUnit && selUnit.id !== u.id && hiCells.get(u.c) === 'hit')) {
      if (selUnit?.id === u.id) { clickCell(u.c); return; }
      setMenu(null); setSel({ k: 'unit', id: u.id });
      const why = u.tapped ? `${unitCard(s, u).name} is tapped.` : summoningSick(s, u) ? `${unitCard(s, u).name} entered this turn. It can act next turn (summoning sickness).` : isDisabled(s, u) ? `${unitCard(s, u).name} is disabled.` : '';
      if (why) toast(why);
      return;
    }
    clickCell(u.c);
  }
  function clickHand(inst: string) {
    if (dragged.current) return; // the click that ends a drag
    if (!myInput || s.pending || s.phase !== 'main') { if (s.phase === 'draw' && myInput) toast('Draw a card first: choose your spellbook or atlas.'); return; }
    setMenu(null);
    setSel(sel?.k === 'hand' && sel.inst === inst ? null : { k: 'hand', inst });
  }

  // ---- dragging a hand card onto the realm ----
  const [drag, setDrag] = useState<{ inst: string; c: number | null; unit: string | null } | null>(null);
  const dragged = useRef(false);
  const under = (x: number, y: number) => {
    let c: number | null = null, unit: string | null = null;
    for (const el of document.elementsFromPoint(x, y) as HTMLElement[]) {
      if (unit === null && el.dataset?.unit) unit = el.dataset.unit;
      if (el.dataset?.cell !== undefined) { c = Number(el.dataset.cell); break; }
    }
    return { c, unit };
  };
  const canDrag = myInput && !s.pending && s.phase === 'main';
  function startDrag(inst: string) { dragged.current = true; setMenu(null); setSel({ k: 'hand', inst }); setDrag({ inst, c: null, unit: null }); }
  function moveDrag(inst: string, x: number, y: number) { const u = under(x, y); setDrag((d) => (d && d.c === u.c && d.unit === u.unit ? d : { inst, ...u })); }
  function dropHand(inst: string, x: number, y: number) {
    const { c, unit } = under(x, y);
    setDrag(null); setTimeout(() => { dragged.current = false; }, 0);
    if (c === null) { setSel(null); return; } // let go outside the realm: back to hand
    const d = cardOf(s, inst);
    if (d.type === 'Site') { const a: Action = { t: 'playSite', inst, c }; if (explain(a)) act(a); else setSel(null); return; }
    if (d.type === 'Magic') {
      const needs = d.effects.some((e) => e.who === 'target' && e.on === 'cast');
      if (needs && !unit) { toast(`Drop ${d.name} on the unit it should target.`); return; } // stays selected, targets keep glowing
      const a: Action = needs ? { t: 'cast', inst, target: unit! } : { t: 'cast', inst };
      if (explain(a)) act(a); else setSel(null); return;
    }
    if (d.effects.some((e) => e.who === 'target' && e.on === 'genesis') && s.sites[c]?.owner === who) { setSel({ k: 'hand', inst, c }); toast(`Now choose a target for ${d.name}.`); return; }
    const a: Action = { t: 'cast', inst, c };
    if (explain(a)) act(a); else setSel(null);
  }
  const bottomPlayer: PlayerId = flip ? 1 : 0; // whose home row is at the bottom of the screen

  const order = [...Array(CELLS).keys()]; if (flip) order.reverse();
  const unitsByCell = useMemo(() => { const m = new Map<number, Unit[]>(); for (const u of Object.values(s.units)) { if (!m.has(u.c)) m.set(u.c, []); m.get(u.c)!.push(u); } return m; }, [s.units]);
  const pend = s.pending;
  const pendUnits = pend ? responders(s) : [];
  const castNow = selCard && selCard.type === 'Magic' && !selCard.effects.some((e) => e.who === 'target' && e.on === 'cast');

  return (
    <div className="table">
      <aside className="rail left">
        <PlayerPanel g={g} p={other(viewer)} manual={manual} />
        <LogPanel s={s} g={g} />
        <PlayerPanel g={g} p={viewer} manual={manual} />
      </aside>

      <main className="mat-wrap">
        <div className="turnbar">
          <AnimatePresence mode="wait">
            <motion.div key={s.turn + ':' + s.active + s.phase} className={`turnchip p${s.active}`} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {s.phase === 'over' ? `${PNAME(g, s.winner!)} wins` : s.phase === 'mulligan' ? 'Opening hands' : `Turn ${s.turn} — ${PNAME(g, s.active)}`}
            </motion.div>
          </AnimatePresence>
          <span className="hint">
            {s.phase === 'over' ? '' : !myInput ? (aiThinking ? `${PNAME(g, who)} is thinking…` : `Waiting for ${PNAME(g, who)}…`)
              : pend ? '' : s.phase === 'draw' ? 'Start of turn: draw one card from either deck.'
              : drag ? 'Drag onto a glowing square and let go.' : selCard ? (selCard.type === 'Site' ? 'Choose a glowing square for this site.' : selCard.type === 'Magic' ? (castNow ? 'Cast it with the button below.' : 'Choose a glowing target.') : sel?.k === 'hand' && sel.c !== undefined ? 'Choose a glowing target.' : 'Choose one of your sites.')
              : selUnit ? 'Green squares: move. Red squares: something to attack.' : 'Drag a card from your hand onto the realm, or select one of your units.'}
          </span>
        </div>

        <div className="mat" onClick={() => { setSel(null); setMenu(null); }}>
          {order.map((c) => {
            const site = s.sites[c]; const d = site?.inst ? cardOf(s, site.inst) : undefined; const hi = hiCells.get(c);
            const [x, y] = xy(c);
            return (
              <div key={c} className={`cell ${site ? (site.inst ? 'site' : 'rubble') : 'void'} ${site?.owner != null ? 'own' + site.owner : ''} ${hi ? 'hi-' + hi : ''} ${d ? 'el-' + mainElement(d) : ''} ${drag?.c === c ? (hi || (selCard?.type === 'Magic' && !hiUnits.size) ? 'drop-ok' : 'drop-no') : ''}`}
                onClick={(e) => { e.stopPropagation(); clickCell(c); }} {...hoverProps(d)} data-cell={c}>
                {d && <SiteArt id={d.id} />}
                {d && <span className="site-flash" key={site!.inst} />}
                {d && <div className="site-label"><span>{d.name}</span><Pips t={d.thresholds} /></div>}
                {site && !site.inst && <div className="site-label"><span>Rubble</span></div>}
                {!site && <span className="void-label">void</span>}
                <span className="coord">{'ABCDE'[x]}{4 - y}</span>
                {([other(bottomPlayer), bottomPlayer] as PlayerId[]).map((p) => (
                  <div key={p} className={`side ${p === bottomPlayer ? 'near' : 'far'}`}>
                    {s.perms.filter((m) => m.c === c && m.owner === p).map((m) => (
                      <span key={m.id} className={`perm p${m.owner}`} {...hoverProps(cardOf(s, m.inst))} onClick={(e) => { if (manual) { e.stopPropagation(); act({ t: 'manual', op: 'destroyPerm', perm: m.id }); } }} data-tip={manual ? 'Manual: destroy' : cardOf(s, m.inst).name}>{m.kind === 'aura' ? '◌' : '◆'}</span>
                    ))}
                    {(unitsByCell.get(c) ?? []).filter((u) => u.owner === p).map((u) => <UnitToken key={u.id} s={s} u={u} selected={selUnit?.id === u.id} target={hiUnits.has(u.id)} dropping={drag?.unit === u.id && hiUnits.has(u.id)} onClick={(e) => clickUnit(u, e)} />)}
                  </div>
                ))}
                {drag?.c === c && hi === 'place' && <span className="drop-label">Release to play here</span>}
                {menu?.c === c && (
                  <motion.div className="cellmenu" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} onClick={(e) => e.stopPropagation()}>
                    {menu.opts.map((o, i) => <button key={i} onClick={() => act(o.action)}>{o.label}{o.hint && <small>{o.hint}</small>}</button>)}
                  </motion.div>
                )}
              </div>
            );
          })}
        </div>

        <div className="actionbar">
          {myInput && !pend && s.phase === 'draw' && (<>
            <button className="primary" disabled={!me.spellbook.length} onClick={() => act({ t: 'draw', deck: 'spellbook' })} data-tip="Spells: minions, magic, auras, artifacts">Draw a spell ({me.spellbook.length})</button>
            <button className="primary" disabled={!me.atlas.length} onClick={() => act({ t: 'draw', deck: 'atlas' })} data-tip="Sites give mana and threshold">Draw a site ({me.atlas.length})</button>
          </>)}
          {myInput && !pend && s.phase === 'main' && (<>
            {castNow && sel?.k === 'hand' && <button className="primary" onClick={() => { const a: Action = { t: 'cast', inst: sel.inst }; if (explain(a)) act(a); }}>Cast {selCard!.name}</button>}
            <button disabled={s.units[me.avatar].tapped || !me.atlas.length} onClick={() => act({ t: 'drawSite' })} data-tip="Avatar ability: tap to draw a site instead of playing one">Tap Avatar: draw a site</button>
            <button className="end" onClick={() => act({ t: 'endTurn' })} data-tip="Damage on your minions clears and unspent mana is lost">End turn</button>
          </>)}
          {manual && selUnit && (<span className="manualbar">
            <b>{unitCard(s, selUnit).name}</b>
            <button onClick={() => act({ t: 'manual', op: 'damage', unit: selUnit.id, n: 1 })}>1 damage</button>
            <button onClick={() => act({ t: 'manual', op: 'tap', unit: selUnit.id })}>Tap / untap</button>
            {!selUnit.avatar && <button onClick={() => act({ t: 'manual', op: 'destroy', unit: selUnit.id })}>Destroy</button>}
          </span>)}
        </div>

        <div className="hand">
          <AnimatePresence>
            {(curtainFor === null ? me.hand : []).map((inst, i) => {
              const d = cardOf(s, inst); const on = sel?.k === 'hand' && sel.inst === inst;
              const mid = (me.hand.length - 1) / 2;
              return (
                <motion.button key={inst} layout layoutId={inst} className={`handcard ${on ? 'on' : ''}`} initial={{ y: 60, opacity: 0 }} animate={{ y: on ? -22 : Math.abs(i - mid) * 3, opacity: 1, rotate: on ? 0 : (i - mid) * 1.6 }} exit={{ y: -40, opacity: 0 }}
                  whileHover={{ y: -18, rotate: 0, zIndex: 5 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }} onClick={() => clickHand(inst)} {...hoverProps(d)}
                  drag={canDrag} dragSnapToOrigin dragMomentum={false} dragElastic={0} whileDrag={{ scale: 0.86, rotate: 0, zIndex: 60, opacity: 0.92 }}
                  style={drag?.inst === inst ? { pointerEvents: 'none', zIndex: 60 } : undefined}
                  onDragStart={() => startDrag(inst)} onDrag={(_e, info) => moveDrag(inst, info.point.x - window.scrollX, info.point.y - window.scrollY)} onDragEnd={(_e, info) => dropHand(inst, info.point.x - window.scrollX, info.point.y - window.scrollY)}
                  onContextMenu={(e) => { if (manual) { e.preventDefault(); act({ t: 'manual', op: 'discard', p: viewer, inst }); } }}>
                  <CardFace card={d} size="sm" />
                </motion.button>
              );
            })}
          </AnimatePresence>
        </div>
      </main>

      <aside className="rail right">
        <Preview />
        <div className="tools">
          <label className="switch" data-tip="For card text the app does not automate: adjust life and mana, damage or destroy units, right-click a hand card to discard. Everything manual is marked in the log."><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Manual tools</label>
          <button className="ghost" onClick={() => useStore.getState().setView('settings')}>Report a problem or wish</button>
          <button className="ghost" onClick={() => { if (confirm('Leave this game?')) { useStore.getState().leave(); useStore.setState({ game: null }); } }}>Leave game</button>
        </div>
      </aside>

      {/* ---- overlays ---- */}
      <AnimatePresence>
        {pend && (
          <motion.div className="prompt" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {(hot || pend.by === g.local) ? (<>
              <h3>{PNAME(g, pend.by)}: {pend.kind === 'defend' ? 'defend?' : 'intercept?'}</h3>
              <p>{unitCard(s, s.units[pend.attacker]).name} {pend.kind === 'defend' ? `is attacking ${pend.target?.site ? 'your site' : unitCard(s, s.units[pend.target!.unit!]).name}` : 'moved into a square with your untapped units'} at {'ABCDE'[xy(pend.loc.c)[0]]}{4 - xy(pend.loc.c)[1]}.
                {pend.kind === 'defend' ? ' Untapped units in reach may tap, move there and join the fight.' : ' They may tap to fight it.'}</p>
              <div className="chips">{pendUnits.map((id) => <button key={id} className={picks.includes(id) ? 'chip on' : 'chip'} {...hoverProps(unitCard(s, s.units[id]))} onClick={() => setPicks(picks.includes(id) ? picks.filter((x) => x !== id) : [...picks, id])}>{unitCard(s, s.units[id]).name}</button>)}</div>
              {pend.kind === 'defend' && pend.target?.unit && picks.length > 0 && <label className="switch"><input type="checkbox" checked={removeOrig} onChange={(e) => setRemoveOrig(e.target.checked)} /> Take {unitCard(s, s.units[pend.target.unit]).name} out of the fight</label>}
              <div className="row">
                <button onClick={() => act({ t: 'respond', units: [] })}>{pend.kind === 'defend' ? 'No defenders' : 'Let it pass'}</button>
                <button className="primary" disabled={!picks.length} onClick={() => act({ t: 'respond', units: picks, removeOriginal: removeOrig })}>{pend.kind === 'defend' ? 'Defend' : 'Intercept'}</button>
              </div>
            </>) : <p>Waiting for {PNAME(g, pend.by)} to decide whether to {pend.kind}…</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {s.phase === 'mulligan' && curtainFor === null && (hot || who === g.local) && (
        <div className="veil"><div className="dialog wide">
          <h2>{PNAME(g, who)}: opening hand</h2>
          <p>You may take one mulligan. Select up to three cards to put on the bottom of their decks and draw the same number back.</p>
          <div className="mullrow">{s.players[who].hand.map((inst) => (
            <button key={inst} className={`handcard ${mull.includes(inst) ? 'out' : ''}`} {...hoverProps(cardOf(s, inst))} onClick={() => setMull(mull.includes(inst) ? mull.filter((x) => x !== inst) : mull.length < 3 ? [...mull, inst] : mull)}><CardFace card={cardOf(s, inst)} size="sm" /></button>
          ))}</div>
          <div className="row"><button className="primary" onClick={() => act({ t: 'mulligan', cards: mull })}>{mull.length ? `Mulligan ${mull.length} card${mull.length > 1 ? 's' : ''}` : 'Keep this hand'}</button></div>
        </div></div>
      )}
      {curtainFor !== null && s.phase !== 'over' && (
        <div className="veil solid"><div className="dialog">
          <h2>Pass the device to {PNAME(g, curtainFor)}</h2>
          <p>The other hand is hidden.</p>
          <div className="row"><button className="primary" onClick={() => { setSeen(curtainFor); setCurtainFor(null); }}>I'm {PNAME(g, curtainFor)} — show my hand</button></div>
        </div></div>
      )}
      {s.phase === 'over' && (
        <div className="veil"><motion.div className="dialog" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
          <h2>{PNAME(g, s.winner!)} wins</h2>
          <p>{s.log[s.log.length - 2]?.text}</p>
          <div className="row"><button className="primary" onClick={() => { useStore.getState().leave(); useStore.setState({ game: null }); }}>Back to setup</button></div>
        </motion.div></div>
      )}
    </div>
  );
}

function SiteArt({ id }: { id: string }) {
  const art = useStore((st) => st.art[id]);
  return art ? <img className="site-art" src={art} alt="" draggable={false} /> : null;
}

function UnitToken({ s, u, selected, target, dropping, onClick }: { s: GameState; u: Unit; selected: boolean; target: boolean; dropping?: boolean; onClick: (e: React.MouseEvent) => void }) {
  const d = unitCard(s, u);
  const art = useStore((st) => st.art[d.id]);
  const life = u.avatar ? s.players[u.owner].life : d.defense - u.damage;
  return (
    <motion.button layout layoutId={u.inst} className={`unit p${u.owner} ${u.avatar ? 'avatar' : ''} ${selected ? 'sel' : ''} ${target ? 'tgt' : ''} ${dropping ? 'dropping' : ''} ${u.r === 'under' ? 'under' : ''} ${isDisabled(s, u) ? 'disabled' : ''}`}
      animate={{ rotate: u.tapped ? 90 : 0, scale: selected ? 1.12 : 1 }} transition={{ type: 'spring', stiffness: 380, damping: 28 }} onClick={onClick} {...hoverProps(d)}
      data-unit={u.id} aria-label={`${d.name}${u.tapped ? ', tapped' : ''}`}>
      {art ? <img src={art} alt="" draggable={false} /> : <span className="unit-name">{d.name}</span>}
      <motion.span key={u.damage + ':' + life} className={`badge ${u.damage ? 'hurt' : ''}`} initial={{ scale: 1.7 }} animate={{ scale: 1 }}>{u.avatar ? `♥${life}` : d.attack === d.defense && !u.damage ? d.attack : `${d.attack}/${life}`}</motion.span>
      {u.r === 'under' && <span className="under-tag">below</span>}
      {summoningSick(s, u) && <span className="sick" data-tip="Entered this turn">z</span>}
    </motion.button>
  );
}

function PlayerPanel({ g, p, manual }: { g: Game; p: PlayerId; manual: boolean }) {
  const s = g.state; const pl = s.players[p]; const t = thresholdOf(s, p);
  const act = useStore((st) => st.act);
  const adj = (op: 'life' | 'mana', n: number) => act({ t: 'manual', op, p, n });
  return (
    <section className={`player p${p} ${s.active === p ? 'active' : ''}`}>
      <header><b>{g.names[p]}</b>{s.active === p && s.phase !== 'over' && <span className="tag">turn</span>}{pl.deathsDoor && <span className="tag danger" data-tip="At 0 life. The next damage after this turn is a death blow. Cannot gain life.">death's door</span>}</header>
      <div className="stats">
        <div data-tip="Avatar life"><span className="big">{pl.life}</span><small>life</small>{manual && <span className="pm"><button onClick={() => adj('life', -1)}>−</button><button onClick={() => adj('life', 1)}>+</button></span>}</div>
        <div data-tip="Mana this turn. Each site gives 1 at the start of your turn."><span className="big">{pl.mana}</span><small>mana</small>{manual && <span className="pm"><button onClick={() => adj('mana', -1)}>−</button><button onClick={() => adj('mana', 1)}>+</button></span>}</div>
        <div className="thr" data-tip="Threshold: element symbols on sites you control">{ELEMENTS.map((e) => <span key={e} className={t[e] ? '' : 'zero'}><i className={`pip ${e}`} />{t[e]}</span>)}</div>
      </div>
      <footer>
        <span data-tip="Cards in hand">Hand {pl.hand.length}</span><span data-tip="Spellbook">Spells {pl.spellbook.length}</span><span data-tip="Atlas">Sites {pl.atlas.length}</span>
        <span data-tip={pl.cemetery.slice(-12).map((i) => cardOf(s, i).name).join(', ') || 'Empty'}>Cemetery {pl.cemetery.length}</span>
      </footer>
    </section>
  );
}

function LogPanel({ s, g }: { s: GameState; g: Game }) {
  const rows = s.log.slice(-60);
  useEffect(() => { const el = document.getElementById('log'); if (el) el.scrollTop = el.scrollHeight; }, [s.log.length]);
  return <div id="log" className="log" aria-live="polite">{rows.map((l, i) => <p key={s.log.length - rows.length + i} className={`${l.p === null ? 'sys' : 'p' + l.p} ${l.manual ? 'man' : ''}`}>{l.text.replace(/\bP([12])\b/g, (_, n) => g.names[Number(n) - 1])}</p>)}</div>;
}

export function Preview() {
  const card = useHover((h) => h.card);
  if (!card) return <div className="preview empty"><p>Point at any card, unit or site to read it here.</p></div>;
  const kws = [...card.keywords, ...(ELEMENTS.some((e) => card.thresholds[e]) && card.type !== 'Site' ? ['Threshold'] : [])];
  return (
    <div className="preview">
      <CardFace card={card} size="lg" />
      {card.type !== 'Site' && card.type !== 'Avatar' && <p className="meta">Cost {card.cost}{card.type === 'Minion' ? `, power ${card.attack === card.defense ? card.attack : `${card.attack} attack / ${card.defense} defense`}` : ''}</p>}
      {card.rules && <p className="rules">{card.rules}</p>}
      {card.source !== 'api' && <p className="meta">{card.source === 'practice' ? 'Practice card (original placeholder, not a Sorcery card)' : 'Custom card'}</p>}
      {card.type !== 'Site' && card.type !== 'Avatar' && card.rules && !card.effects.length && card.keywords.length === 0 && <p className="meta warn">This card's text is not automated. Use Manual tools to resolve it.</p>}
      <ul className="kw">{kws.map((k) => KEYWORD_HELP[k] && (
        <li key={k}><a href={codexUrl(k)} target="_blank" rel="noreferrer" data-tip="Open the Codex on sorcerytcg.com">{k}</a> {KEYWORD_HELP[k].text}</li>
      ))}</ul>
    </div>
  );
}
export { cell, COLS };
