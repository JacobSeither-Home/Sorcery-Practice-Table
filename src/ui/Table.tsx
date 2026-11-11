import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  type Action, type GameState, type Loc, type PlayerId, type Unit, CELLS, COLS, ELEMENTS, KEYWORD_HELP,
  actor, attackTargets, cardOf, cell, check, codexUrl, isDisabled, isWater, other, playableSiteCells, reach, responders,
  sitesOf, summoningSick, thresholdOf, unitCard, validTargets, xy,
} from '../engine';
import { type Game, useStore } from '../store';
import { type CardDef } from '../engine';
import { PACES } from '../store';
import { CardFace, Pips, hoverProps, mainElement, useHover, useInspect } from './CardFace';
import { spring, usePace } from './pace';

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
  const [tableMenu, setTableMenu] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const settings = useStore((st) => st.settings);
  const setSettings = useStore((st) => st.setSettings);
  const aiWaiting = useStore((st) => st.aiWaiting);
  const pace = settings.pace ?? 1;
  const boardSize = settings.boardSize ?? 'fit';
  const narrow = useMedia('(max-width: 820px)');
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = scroller.current; if (el) { el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; el.scrollTop = (el.scrollHeight - el.clientHeight) / 2; } }, [boardSize]);

  // clear transient UI whenever the game state moves on
  useEffect(() => { setSel(null); setMenu(null); setPicks([]); setRemoveOrig(false); setMull([]); }, [s]);
  // hotseat: hide the hand while the device changes hands
  useEffect(() => { if (hot && !s.pending && s.phase !== 'over' && viewer !== seen) setCurtainFor(viewer); }, [hot, viewer, seen, s.pending, s.phase]);

  // ---- herald: what the opponent just did, held on screen long enough to follow ----
  const herald = useHerald(g, s, hot, pace, aiWaiting);

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

  const cellPos = (c: number) => { const i = order.indexOf(c); return [((i % COLS) + 0.5) * 100, (Math.floor(i / COLS) + 0.5) * 100] as const; };
  const opp = other(viewer);
  const openMenu = () => setTableMenu(true);
  const leaveGame = () => { if (confirm('Leave this game?')) { useStore.getState().leave(); useStore.setState({ game: null }); } };

  return (
    <div className={`table board-${boardSize}`} style={{ '--pace': pace } as React.CSSProperties}>
      <aside className="rail left">
        <PlayerPanel g={g} p={opp} manual={manual} />
        <LogPanel s={s} g={g} />
        <PlayerPanel g={g} p={viewer} manual={manual} />
      </aside>

      <main className="mat-wrap">
        <PlayerStrip g={g} p={opp} manual={manual} onLog={() => setLogOpen(true)} />
        <div className="turnbar">
          <AnimatePresence mode="wait">
            <motion.div key={s.turn + ':' + s.active + s.phase} className={`turnchip p${s.active}`} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 * pace }}>
              {s.phase === 'over' ? `${PNAME(g, s.winner!)} wins` : s.phase === 'mulligan' ? 'Opening hands' : `Turn ${s.turn} · ${PNAME(g, s.active)}`}
            </motion.div>
          </AnimatePresence>
          {herald ? <Herald h={herald} /> : <span className="hint">
            {s.phase === 'over' ? '' : !myInput ? (aiWaiting ? `${PNAME(g, who)} moved. Tap Continue for the next move.` : aiThinking ? `${PNAME(g, who)} is thinking…` : `Waiting for ${PNAME(g, who)}…`)
              : pend ? '' : s.phase === 'draw' ? 'Start of turn: draw one card from either deck.'
              : drag ? 'Drag onto a glowing square and let go.' : selCard ? (selCard.type === 'Site' ? 'Choose a glowing square for this site.' : selCard.type === 'Magic' ? (castNow ? 'Cast it with the button below.' : 'Choose a glowing target.') : sel?.k === 'hand' && sel.c !== undefined ? 'Choose a glowing target.' : 'Choose one of your sites.')
              : selUnit ? 'Green squares: move. Red squares: something to attack.' : 'Drag a card onto the realm, or tap one of your units. Hold any card to read it.'}
          </span>}
          <button className="pacechip" onClick={openMenu} aria-label="Table options: pace and board size" data-tip="Animation pace, step-through, board size">
            <span aria-hidden>⏱</span><span className="lbl">{PACES.find((x) => x.v === pace)?.label ?? 'Pace'}</span>
          </button>
          <button className="iconbtn" onClick={openMenu} aria-label="Table menu">☰</button>
        </div>

        <div className="board-scroll" ref={scroller}>
          <div className="mat" onClick={() => { setSel(null); setMenu(null); }}>
            <svg className="rune-ring" viewBox="-100 -100 200 200" aria-hidden><RuneRing /></svg>
            {order.map((c) => {
              const site = s.sites[c]; const d = site?.inst ? cardOf(s, site.inst) : undefined; const hi = hiCells.get(c);
              const [x, y] = xy(c); const mark = herald?.marks.get(c);
              return (
                <div key={c} className={`cell ${site ? (site.inst ? 'site' : 'rubble') : 'void'} ${site?.owner != null ? 'own' + site.owner : ''} ${hi ? 'hi-' + hi : ''} ${d ? 'el-' + mainElement(d) : ''} ${mark ? `mark-${mark} mp${herald!.p}` : ''} ${drag?.c === c ? (hi || (selCard?.type === 'Magic' && !hiUnits.size) ? 'drop-ok' : 'drop-no') : ''} ${menu?.c === c ? 'menu-open' : ''}`}
                  onClick={(e) => { e.stopPropagation(); clickCell(c); }} {...hoverProps(d)} data-cell={c}>
                  {d && <SiteArt id={d.id} />}
                  {d && <span className="site-flash" key={site!.inst} />}
                  {d && <div className="site-label"><span>{d.name}</span><Pips t={d.thresholds} /></div>}
                  {site && !site.inst && <div className="site-label"><span>Rubble</span></div>}
                  <span className="coord">{'ABCDE'[x]}{4 - y}</span>
                  {([other(bottomPlayer), bottomPlayer] as PlayerId[]).map((p) => (
                    <div key={p} className={`side ${p === bottomPlayer ? 'near' : 'far'}`}>
                      {s.perms.filter((m) => m.c === c && m.owner === p).map((m) => {
                        const pc = cardOf(s, m.inst); const hp = hoverProps(pc);
                        return <span key={m.id} className={`perm p${m.owner}`} {...hp} onClick={(e) => { if (manual) { e.stopPropagation(); act({ t: 'manual', op: 'destroyPerm', perm: m.id }); } }} data-tip={manual ? 'Manual: destroy' : pc.name}>{m.kind === 'aura' ? '◌' : '◆'}</span>;
                      })}
                      {(unitsByCell.get(c) ?? []).filter((u) => u.owner === p).map((u) => <UnitToken key={u.id} s={s} u={u} pace={pace} selected={selUnit?.id === u.id} target={hiUnits.has(u.id)} dropping={drag?.unit === u.id && hiUnits.has(u.id)} onClick={(e) => clickUnit(u, e)} />)}
                    </div>
                  ))}
                  {drag?.c === c && hi === 'place' && <span className="drop-label">Release to play here</span>}
                  {menu?.c === c && !narrow && (
                    <motion.div className="cellmenu" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 * pace }} onClick={(e) => e.stopPropagation()}>
                      {menu.opts.map((o, i) => <button key={i} onClick={() => act(o.action)}>{o.label}{o.hint && <small>{o.hint}</small>}</button>)}
                      <button className="ghost" onClick={() => setMenu(null)}>Cancel</button>
                    </motion.div>
                  )}
                </div>
              );
            })}
            {herald && herald.trails.length > 0 && (
              <svg key={herald.id} className={`trails mp${herald.p}`} viewBox={`0 0 ${COLS * 100} 400`} preserveAspectRatio="none" aria-hidden>
                {herald.trails.map(([a, b], i) => { const [x1, y1] = cellPos(a), [x2, y2] = cellPos(b); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} />; })}
                {herald.trails.map(([, b], i) => { const [x2, y2] = cellPos(b); return <circle key={'e' + i} cx={x2} cy={y2} r={9} />; })}
              </svg>
            )}
          </div>
        </div>

        <div className="actionbar">
          {aiWaiting && <button className="primary pulse" onClick={() => useStore.getState().aiNext()}>Continue ▸ <small>{PNAME(g, who)}'s next move</small></button>}
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

        <PlayerStrip g={g} p={viewer} manual={manual} onLog={() => setLogOpen(true)} near />
        <div className="hand" style={{ '--n': Math.max(1, me.hand.length) } as React.CSSProperties}>
          <AnimatePresence>
            {(curtainFor === null ? me.hand : []).map((inst, i) => {
              const d = cardOf(s, inst); const on = sel?.k === 'hand' && sel.inst === inst;
              const mid = (me.hand.length - 1) / 2; const hp = hoverProps(d);
              return (
                <motion.button key={inst} layout layoutId={inst} className={`handcard ${on ? 'on' : ''}`} initial={{ y: 60, opacity: 0 }} animate={{ y: on ? -22 : Math.abs(i - mid) * 3, opacity: 1, rotate: on ? 0 : (i - mid) * 1.6 }} exit={{ y: -40, opacity: 0 }}
                  whileHover={{ y: -18, rotate: 0, zIndex: 5 }} transition={spring(pace, 420, 30)} onClick={() => clickHand(inst)} {...hp}
                  onPointerMove={(e) => { hp.onPointerMove(e); if (e.pointerType === 'mouse') sheen(e); }}
                  drag={canDrag} dragSnapToOrigin dragMomentum={false} dragElastic={0} whileDrag={{ scale: 0.9, rotate: 0, zIndex: 60, opacity: 0.95, filter: 'drop-shadow(0 28px 22px rgba(0,0,0,.75))' }}
                  style={drag?.inst === inst ? { pointerEvents: 'none', zIndex: 60 } : undefined}
                  onDragStart={() => startDrag(inst)} onDrag={(_e, info) => moveDrag(inst, info.point.x - window.scrollX, info.point.y - window.scrollY)} onDragEnd={(_e, info) => dropHand(inst, info.point.x - window.scrollX, info.point.y - window.scrollY)}
                  onContextMenu={(e) => { if (manual) { e.preventDefault(); act({ t: 'manual', op: 'discard', p: viewer, inst }); } else hp.onContextMenu(e); }}>
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
          <button className="ghost" onClick={leaveGame}>Leave game</button>
        </div>
      </aside>

      {/* ---- overlays ---- */}
      <AnimatePresence>
        {menu && narrow && (
          <motion.div className="sheet-veil cellsheet" key="cellmenu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenu(null)}>
            <motion.div className="sheet" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} transition={spring(pace, 420, 34)} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose a move">
              <header><h2>{selUnit ? unitCard(s, selUnit).name : 'Choose'} → {'ABCDE'[xy(menu.c)[0]]}{4 - xy(menu.c)[1]}</h2><button className="iconbtn" onClick={() => setMenu(null)} aria-label="Close">✕</button></header>
              {menu.opts.map((o, i) => <button key={i} onClick={() => act(o.action)}>{o.label}{o.hint && <small>{o.hint}</small>}</button>)}
            </motion.div>
          </motion.div>
        )}
        {tableMenu && (
          <motion.div className="sheet-veil" key="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTableMenu(false)}>
            <motion.div className="sheet" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} transition={spring(pace, 420, 34)} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Table options">
              <header><h2>Table</h2><button className="iconbtn" onClick={() => setTableMenu(false)} aria-label="Close">✕</button></header>
              <TableOptions />
              <div className="sheet-actions">
                <button className="narrow-only" onClick={() => { setTableMenu(false); setLogOpen(true); }}>Game log</button>
                <label className="switch big"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Manual tools</label>
                <button onClick={() => useStore.getState().setView('settings')}>Report a problem or wish</button>
                <button className="danger" onClick={leaveGame}>Leave game</button>
              </div>
              <p className="fineprint">Unofficial fan project, not affiliated with Erik's Curiosa.</p>
            </motion.div>
          </motion.div>
        )}
        {logOpen && (
          <motion.div className="sheet-veil" key="log" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setLogOpen(false)}>
            <motion.div className="sheet tall" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} transition={spring(pace, 420, 34)} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Game log">
              <header><h2>Game log</h2><button className="iconbtn" onClick={() => setLogOpen(false)} aria-label="Close">✕</button></header>
              <LogPanel s={s} g={g} id="log-sheet" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
  return art ? <div className="site-art-box"><img src={art} alt="" draggable={false} /></div> : null;
}

/** Moving light on a hand card under the mouse, so it reads as a glossy physical card. */
function sheen(e: React.PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
  e.currentTarget.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
}

function UnitToken({ s, u, pace, selected, target, dropping, onClick }: { s: GameState; u: Unit; pace: number; selected: boolean; target: boolean; dropping?: boolean; onClick: (e: React.MouseEvent) => void }) {
  const d = unitCard(s, u);
  const art = useStore((st) => st.art[d.id]);
  const life = u.avatar ? s.players[u.owner].life : d.defense - u.damage;
  return (
    <motion.button layout layoutId={u.inst} className={`unit p${u.owner} ${u.avatar ? 'avatar' : ''} ${u.tapped ? 'tapped' : ''} ${selected ? 'sel' : ''} ${target ? 'tgt' : ''} ${dropping ? 'dropping' : ''} ${u.r === 'under' ? 'under' : ''} ${isDisabled(s, u) ? 'disabled' : ''}`}
      animate={{ rotate: u.tapped ? 90 : 0, scale: selected ? 1.12 : 1 }} transition={spring(pace)} onClick={onClick} {...hoverProps(d)}
      data-unit={u.id} aria-label={`${d.name}${u.tapped ? ', tapped' : ''}`}>
      <span className="unit-face">{art ? <img src={art} alt="" draggable={false} /> : <span className="unit-name">{d.name}</span>}</span>
      <motion.span key={u.damage + ':' + life} className={`badge ${u.damage ? 'hurt' : ''}`} initial={{ scale: 1.8 }} animate={{ scale: 1 }} transition={spring(pace, 500, 22)}>{u.avatar ? `♥${life}` : d.attack === d.defense && !u.damage ? d.attack : `${d.attack}/${life}`}</motion.span>
      {u.r === 'under' && <span className="under-tag">below</span>}
      {summoningSick(s, u) && <span className="sick" data-tip="Entered this turn">z</span>}
      {art && <span className="plate">{d.name}</span>}
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
        <div data-tip="Avatar life"><Num n={pl.life} className="big" /><small>life</small>{manual && <span className="pm"><button onClick={() => adj('life', -1)}>−</button><button onClick={() => adj('life', 1)}>+</button></span>}</div>
        <div data-tip="Mana this turn. Each site gives 1 at the start of your turn."><Num n={pl.mana} className="big" /><small>mana</small>{manual && <span className="pm"><button onClick={() => adj('mana', -1)}>−</button><button onClick={() => adj('mana', 1)}>+</button></span>}</div>
        <div className="thr" data-tip="Threshold: element symbols on sites you control">{ELEMENTS.map((e) => <span key={e} className={t[e] ? '' : 'zero'}><i className={`pip ${e}`} />{t[e]}</span>)}</div>
      </div>
      <footer>
        <span data-tip="Cards in hand">Hand {pl.hand.length}</span><span data-tip="Spellbook">Spells {pl.spellbook.length}</span><span data-tip="Atlas">Sites {pl.atlas.length}</span>
        <span data-tip={pl.cemetery.slice(-12).map((i) => cardOf(s, i).name).join(', ') || 'Empty'}>Cemetery {pl.cemetery.length}</span>
      </footer>
    </section>
  );
}

/** A number that flashes when it changes (life lost, mana spent), so the change is noticed. */
function Num({ n, className }: { n: number; className?: string }) {
  const prev = useRef(n); const dir = n < prev.current ? 'down' : n > prev.current ? 'up' : ''; useEffect(() => { prev.current = n; }, [n]);
  return <span key={n} className={`${className ?? ''} num ${dir}`}>{n}</span>;
}

/** Compact player plate shown above and below the board on phones and small tablets. */
function PlayerStrip({ g, p, manual, onLog, near }: { g: Game; p: PlayerId; manual: boolean; onLog: () => void; near?: boolean }) {
  const s = g.state; const pl = s.players[p]; const t = thresholdOf(s, p);
  const act = useStore((st) => st.act);
  return (
    <section className={`strip p${p} ${near ? 'near' : 'far'} ${s.active === p && s.phase !== 'over' ? 'active' : ''}`}>
      <b className="who">{g.names[p]}</b>
      {pl.deathsDoor && <span className="tag danger">death's door</span>}
      <span className="stat-l"><i className="sym" aria-hidden>♥</i><Num n={pl.life} /><small>life</small>{manual && <><button onClick={() => act({ t: 'manual', op: 'life', p, n: -1 })}>−</button><button onClick={() => act({ t: 'manual', op: 'life', p, n: 1 })}>+</button></>}</span>
      <span className="stat-m"><i className="sym" aria-hidden>✦</i><Num n={pl.mana} /><small>mana</small>{manual && <><button onClick={() => act({ t: 'manual', op: 'mana', p, n: -1 })}>−</button><button onClick={() => act({ t: 'manual', op: 'mana', p, n: 1 })}>+</button></>}</span>
      <span className="thr-s">{ELEMENTS.map((e) => t[e] ? <span key={e}><i className={`pip ${e}`} />{t[e]}</span> : null)}</span>
      <button className="counts" onClick={onLog} aria-label="Open the game log">✋{pl.hand.length} · 📖{pl.spellbook.length} · 🗺{pl.atlas.length} · 🪦{pl.cemetery.length}</button>
    </section>
  );
}

function LogPanel({ s, g, id = 'log' }: { s: GameState; g: Game; id?: string }) {
  const rows = s.log.slice(-60);
  useEffect(() => { const el = document.getElementById(id); if (el) el.scrollTop = el.scrollHeight; }, [s.log.length, id]);
  return <div id={id} className="log" aria-live="polite">{rows.map((l, i) => <p key={s.log.length - rows.length + i} className={`${l.p === null ? 'sys' : 'p' + l.p} ${l.manual ? 'man' : ''}`}>{names(g, l.text)}</p>)}</div>;
}
const names = (g: Game, text: string) => text.replace(/\bP([12])\b/g, (_, n) => g.names[Number(n) - 1]);

export function TableOptions() {
  const st = useStore((x) => x.settings); const set = useStore((x) => x.setSettings);
  const pace = st.pace ?? 1;
  return (
    <div className="options">
      <div className="opt">
        <span>Animation pace</span>
        <div className="seg">{PACES.map((x) => <button key={x.v} className={pace === x.v ? 'on' : ''} onClick={() => set({ pace: x.v })}>{x.label}</button>)}</div>
        <small>Slows every move, the opponent's turn and the move callouts.</small>
      </div>
      <div className="opt">
        <span>Opponent moves</span>
        <div className="seg">{([[false, 'Play through'], [true, 'Step one at a time']] as const).map(([v, l]) => <button key={l} className={!!st.stepOpponent === v ? 'on' : ''} onClick={() => set({ stepOpponent: v })}>{l}</button>)}</div>
        <small>Step: the AI waits after each move until you tap Continue.</small>
      </div>
      <div className="opt">
        <span>Board size</span>
        <div className="seg">{([['fit', 'Fit screen'], ['roomy', 'Roomy'], ['spacious', 'Spacious']] as const).map(([v, l]) => <button key={v} className={(st.boardSize ?? 'fit') === v ? 'on' : ''} onClick={() => set({ boardSize: v })}>{l}</button>)}</div>
        <small>Roomy and Spacious give each square room to lay units side by side; drag or scroll the board to pan.</small>
      </div>
    </div>
  );
}

// ---- herald ----
interface HeraldState { id: number; p: PlayerId; lines: string[]; marks: Map<number, 'from' | 'to' | 'hit'>; trails: [number, number][] }
let heraldN = 0;
function useHerald(g: Game, s: GameState, hot: boolean, pace: number, waiting: boolean): HeraldState | null {
  const prevRef = useRef(s); const [h, setH] = useState<HeraldState | null>(null);
  const timer = useRef<number>(0);
  useEffect(() => {
    const prev = prevRef.current; prevRef.current = s;
    if (prev === s || hot || g.n === 0 || prev.cards !== s.cards) return;
    const by = actor(prev);
    if (by === g.local) return; // your own moves: the opponent's last callout simply runs out
    const lastPrev = prev.log[prev.log.length - 1];
    const from = lastPrev ? s.log.lastIndexOf(lastPrev) + 1 : 0;
    const lines = s.log.slice(from).filter((l) => !/^Turn \d+/.test(l.text)).map((l) => names(g, l.text));
    const marks = new Map<number, 'from' | 'to' | 'hit'>(); const trails: [number, number][] = [];
    for (const u of Object.values(s.units)) {
      const pu = prev.units[u.id];
      if (!pu) marks.set(u.c, 'to');
      else if (pu.c !== u.c) { trails.push([pu.c, u.c]); if (!marks.has(pu.c)) marks.set(pu.c, 'from'); marks.set(u.c, 'to'); }
      if (pu && u.damage > pu.damage) marks.set(u.c, 'hit');
    }
    for (const pu of Object.values(prev.units)) if (!s.units[pu.id]) marks.set(pu.c, 'hit');
    s.sites.forEach((x, c) => { const px = prev.sites[c]; if (x && !px) marks.set(c, 'to'); else if (px?.inst && x && !x.inst) marks.set(c, 'hit'); });
    if (!lines.length && !marks.size) return;
    setH((old) => ({ id: ++heraldN, p: by, lines: [...(old && old.p === by ? old.lines : []), ...lines].slice(-3), marks, trails }));
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    clearTimeout(timer.current);
    if (!h || waiting) return;
    timer.current = window.setTimeout(() => setH(null), (2600 + 900 * h.lines.length) * pace);
    return () => clearTimeout(timer.current);
  }, [h, pace, waiting]);
  return h;
}

function Herald({ h }: { h: HeraldState }) {
  const lines = h.lines.slice(-2);
  return (
    <div className={`herald mp${h.p}`} aria-live="polite">
      {lines.map((l, i) => <motion.p key={h.id + ':' + l} className={i === lines.length - 1 ? 'now' : 'old'} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>{l}</motion.p>)}
    </div>
  );
}

/** Original geometric sigil under the realm: concentric rings and ticks, no game iconography. */
function RuneRing() {
  const ticks = Array.from({ length: 72 }, (_, i) => i);
  const tri = (r: number, rot: number) => [0, 1, 2].map((k) => { const a = rot + (k * 2 * Math.PI) / 3; return `${Math.cos(a) * r},${Math.sin(a) * r}`; }).join(' ');
  return (
    <g fill="none" stroke="currentColor">
      <circle r="96" strokeWidth="0.5" /><circle r="90" strokeWidth="0.3" strokeDasharray="1 2.5" />
      {ticks.map((i) => { const a = (i / 72) * Math.PI * 2; const r1 = i % 6 ? 91.5 : 88; return <line key={i} x1={Math.cos(a) * r1} y1={Math.sin(a) * r1} x2={Math.cos(a) * 95} y2={Math.sin(a) * 95} strokeWidth={i % 6 ? 0.3 : 0.6} />; })}
      <circle r="64" strokeWidth="0.4" /><polygon points={tri(64, -Math.PI / 2)} strokeWidth="0.35" /><polygon points={tri(64, Math.PI / 2)} strokeWidth="0.35" />
      <circle r="30" strokeWidth="0.3" strokeDasharray="4 3" />
    </g>
  );
}

export function Preview({ card: given }: { card?: CardDef }) {
  const hovered = useHover((h) => h.card);
  const card = given ?? hovered;
  if (!card) return <div className="preview empty"><p>Point at any card, unit or site to read it here. On touch, hold a card.</p></div>;
  const kws = [...card.keywords, ...(ELEMENTS.some((e) => card.thresholds[e]) && card.type !== 'Site' ? ['Threshold'] : [])];
  return (
    <div className="preview">
      <CardFace card={card} size="lg" />
      {card.type !== 'Site' && card.type !== 'Avatar' && <p className="meta">Cost {card.cost}{card.type === 'Minion' ? `, power ${card.attack === card.defense ? card.attack : `${card.attack} attack / ${card.defense} defense`}` : ''}</p>}
      {card.rules && <p className="rules">{card.rules}</p>}
      {card.source === 'custom' && <p className="meta">Custom card</p>}
      {card.type !== 'Site' && card.type !== 'Avatar' && card.rules && !card.effects.length && card.keywords.length === 0 && <p className="meta warn">This card's text is not automated. Use Manual tools to resolve it.</p>}
      <ul className="kw">{kws.map((k) => KEYWORD_HELP[k] && (
        <li key={k}><a href={codexUrl(k)} target="_blank" rel="noreferrer" data-tip="Open the Codex on sorcerytcg.com">{k}</a> {KEYWORD_HELP[k].text}</li>
      ))}</ul>
    </div>
  );
}

/** Large card reader: long-press on touch, right-click with a mouse. Works on every screen. */
export function Inspector() {
  const card = useInspect((x) => x.card); const close = () => useInspect.getState().open(null);
  useEffect(() => { if (!card) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [card]);
  return (
    <AnimatePresence>
      {card && (
        <motion.div className="sheet-veil inspect" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close}>
          <motion.div className="sheet" initial={{ y: 50, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 30, opacity: 0 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={card.name}>
            <header><h2>{card.name}</h2><button className="iconbtn" onClick={close} aria-label="Close">✕</button></header>
            <Preview card={card} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
export { cell, COLS };

function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const l = matchMedia(q); const f = () => setM(l.matches); l.addEventListener('change', f); f(); return () => l.removeEventListener('change', f); }, [q]);
  return m;
}
