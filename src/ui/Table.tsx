import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  type Action, hasStealth, type GameState, type Loc, type PlayerId, type Unit, CELLS, COLS, ELEMENTS, KEYWORD_HELP,
  actor, attackTargets, cardOf, cell, check, codexUrl, defenseOf, has, isDisabled, power, summonCells, isWater, other, playableSiteCells, reach, responders,
  sitesOf, summoningSick, thresholdOf, unitCard, validTargets, xy, autoSplit, strikeOf, shotCandidates, warded,
} from '../engine';
import { type Game, useStore } from '../store';
import { type CardDef } from '../engine';
import { PACES } from '../store';
import { CardFace, Pips, STATUSES, clearZoom, hoverProps, mainElement, useStatusPop, useHover, useInspect } from './CardFace';
import { spring, usePace } from './pace';
import { type CastReq, CastModal, abilityList } from './CastModal';
import { HowItWorks } from './Explain';
declare const __APP_VERSION__: string;
import { submit as submitFeedback, recentErrors } from '../feedback/feedback';
import { feedbackRemote, useAuth } from '../cloud/cloud';

type Sel = null | { k: 'hand'; inst: string; c?: number } | { k: 'unit'; id: string };
interface Opt { label: string; hint?: string; action: Action }

const PNAME = (g: Game, p: PlayerId) => g.names[p];

export function Table() {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const toast = useStore((s) => s.toast);
  const aiThinking = useStore((s) => s.aiThinking);
  const canUndo = useStore((s) => s.canUndo); const undo = useStore((s) => s.undo);
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
  const [split, setSplit] = useState<Record<string, number>>({});
  const [curtainFor, setCurtainFor] = useState<PlayerId | null>(null);
  const [seen, setSeen] = useState<PlayerId>(viewer);
  const [tableMenu, setTableMenu] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [cast, setCast] = useState<CastReq | null>(null);
  const [focusUnit, setFocusUnit] = useState<string | null>(null);
  const [abilOpen, setAbilOpen] = useState(false);
  const settings = useStore((st) => st.settings);
  const setSettings = useStore((st) => st.setSettings);
  const aiWaiting = useStore((st) => st.aiWaiting);
  const pace = settings.pace ?? 1;
  const boardSize = settings.boardSize ?? 'fit';
  const narrow = useMedia('(max-width: 820px)');
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = scroller.current; if (el) { el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; el.scrollTop = (el.scrollHeight - el.clientHeight) / 2; } }, [boardSize]);
  // Fit view: centre the board on the screen rather than on the column between the side panels, as far as the spare room allows.
  useEffect(() => {
    const el = scroller.current; const wrap = el?.parentElement; if (!el || !wrap) return;
    const place = () => {
      const mat = el.querySelector<HTMLElement>('.mat'); const bar = wrap.querySelector<HTMLElement>('.turnbar');
      if (boardSize !== 'fit' || !mat) { wrap.style.removeProperty('--shift'); wrap.style.removeProperty('--shift-bar'); return; }
      const r = el.getBoundingClientRect(); const off = window.innerWidth / 2 - (r.left + r.width / 2);
      const cap = (w: number) => { const free = Math.max(0, (r.width - w) / 2); return Math.round(Math.max(-free, Math.min(free, off))); };
      wrap.style.setProperty('--shift', `${cap(mat.offsetWidth)}px`);
      wrap.style.setProperty('--shift-bar', `${cap(bar?.offsetWidth ?? r.width)}px`);
    };
    place(); const ro = new ResizeObserver(place); ro.observe(el); window.addEventListener('resize', place);
    return () => { ro.disconnect(); window.removeEventListener('resize', place); };
  }, [boardSize, settings.infoPanel]);

  // clear transient UI whenever the game state moves on
  useEffect(() => { setSel(null); setMenu(null); setPicks([]); setRemoveOrig(false); setMull([]); setSplit(s.pending?.kind === 'allocate' ? autoSplit(s, s.pending.attacker, s.pending.foes ?? []) : {}); }, [s]);
  // a triggered ability waiting for this player opens the pop-up by itself
  const q0 = s.queue?.[0];
  useEffect(() => { if (q0 && !s.pending && (hot || q0.by === g.local) && (!cast || cast.k === 'hand')) { if (!cast) setCast({ k: 'trigger', id: q0.id }); } }, [q0?.id, cast]);
  /** Play a card from hand: straight onto the table when it has no text, through the cast pop-up when it does. */
  const play = (inst: string, c0?: number, bearer?: string) => {
    const d = cardOf(s, inst);
    // an aura sits where four squares meet: a click on the last column or row means the area just inside it
    const c = d.type === 'Aura' && c0 !== undefined ? cell(Math.min(xy(c0)[0], COLS - 2), Math.min(xy(c0)[1], 2)) : c0;
    if (d.effects.length || d.type === 'Magic') { setSel(null); setCast({ k: 'cast', inst, ...(c !== undefined ? { c } : {}), ...(bearer ? { bearer } : {}) }); return; }
    const a: Action = { t: 'cast', inst, ...(c !== undefined ? { c } : {}), ...(bearer ? { target: bearer } : {}) };
    if (explain(a)) act(a); else setSel(null);
  };
  const abilities = useMemo(() => (myInput && !s.pending && !s.queue?.length && s.phase === 'main' ? abilityList(s, who) : []), [s, myInput, who]);
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
      else if (selCard.type === 'Aura') { /* auras go on a joint between four squares: the joint markers are drawn over the realm instead */ }
      else for (const c of summonCells(s, who, selCard)) cells.set(c, 'place');
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
      if ((dx === 0) !== (dy === 0)) {
        const there = shotCandidates(s, u, dx, dy);
        // rulebook p34: when several units are where the projectile lands, the shooter chooses which it hits
        if (there.length > 1) for (const h of there) opts.push({ label: `Shoot ${unitCard(s, h).name}`, hint: `${h.owner === u.owner ? 'Your own unit · ' : ''}it lands at ${'ABCDE'[xy(h.c)[0]]}${4 - xy(h.c)[1]}; no strike back`, action: { t: 'shoot', unit: u.id, dx, dy, hit: h.id } });
        else { const a: Action = { t: 'shoot', unit: u.id, dx, dy }; if (check(s, a).ok) opts.push({ label: `Shoot${there[0] ? ' ' + unitCard(s, there[0]).name : ' in this direction'}`, hint: 'No strike back', action: a }); }
      }
    }
    return opts;
  }

  function clickCell(c: number) {
    if (!myInput || s.pending) return;
    setMenu(null);
    if (sel?.k === 'hand' && selCard) {
      if (selCard.type === 'Site') { if (explain({ t: 'playSite', inst: sel.inst, c })) act({ t: 'playSite', inst: sel.inst, c }); return; }
      if (selCard.type === 'Magic') { play(sel.inst); return; }
      if (selCard.type === 'Aura') return; // an aura is placed on a joint, not a square
      if (!summonCells(s, who, selCard).includes(c)) { explain({ t: 'cast', inst: sel.inst, c }); return; }
      play(sel.inst, c);
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
    if (sel?.k === 'hand' && selCard?.type === 'Magic') { play(sel.inst); return; }
    if (sel?.k === 'hand' && selCard?.type === 'Artifact' && u.owner === who && s.sites[u.c]?.owner === who && !selCard.effects.some((e) => e.who === 'target' && e.on === 'genesis')) {
      play(sel.inst, u.c, u.id); return; // hand the artifact to this unit
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
    if (cardOf(s, inst).type === 'Magic') { play(inst); return; } // magic goes straight to the cast pop-up
    setSel(sel?.k === 'hand' && sel.inst === inst ? null : { k: 'hand', inst });
  }

  // ---- dragging a hand card onto the realm ----
  const [drag, setDrag] = useState<{ inst: string; c: number | null; unit: string | null; j?: number | null } | null>(null);
  const [hoverJoint, setHoverJoint] = useState<number | null>(null);
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
  /** The joint (where four squares meet) nearest a point over the realm, as the engine's top-left square of that 2×2 area. */
  const jointAt = (x: number, y: number): number | null => {
    const mat = scroller.current?.querySelector<HTMLElement>('.mat'); if (!mat) return null;
    const r = mat.getBoundingClientRect(); if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const gap = parseFloat(getComputedStyle(mat).paddingLeft) || 0;
    const jx = Math.max(1, Math.min(COLS - 1, Math.round(((x - r.left - gap) / (r.width - 2 * gap)) * COLS)));
    const jy = Math.max(1, Math.min(CELLS / COLS - 1, Math.round(((y - r.top - gap) / (r.height - 2 * gap)) * (CELLS / COLS))));
    return jointCell(jx, jy);
  };
  function moveDrag(inst: string, x: number, y: number) {
    if (cardOf(s, inst).type === 'Aura') { const j = jointAt(x, y); setDrag((d) => (d && d.j === j ? d : { inst, c: null, unit: null, j })); return; }
    const u = under(x, y); setDrag((d) => (d && d.c === u.c && d.unit === u.unit ? d : { inst, ...u }));
  }
  function dropHand(inst: string, x: number, y: number) {
    const { c, unit } = under(x, y);
    setDrag(null); setTimeout(() => { dragged.current = false; }, 0);
    if (cardOf(s, inst).type === 'Aura') { const j = jointAt(x, y); if (j === null) setSel(null); else play(inst, j); return; }
    if (c === null) { setSel(null); return; } // let go outside the realm: back to hand
    const d = cardOf(s, inst);
    if (d.type === 'Site') { const a: Action = { t: 'playSite', inst, c }; if (explain(a)) act(a); else setSel(null); return; }
    if (d.type === 'Magic') { play(inst); return; }
    if (d.type === 'Artifact' && unit && s.units[unit]?.owner === who && s.sites[c]?.owner === who && !d.effects.some((e) => e.who === 'target' && e.on === 'genesis')) { play(inst, c, unit); return; } // dropped on one of your units: it carries the artifact
    if (!summonCells(s, who, d).includes(c)) { explain({ t: 'cast', inst, c }); setSel(null); return; }
    play(inst, c);
  }
  const bottomPlayer: PlayerId = flip ? 1 : 0; // whose home row is at the bottom of the screen

  const order = [...Array(CELLS).keys()]; if (flip) order.reverse();
  /** Joint jx,jy on screen (1-based, counted from the top-left) → the engine's top-left square of the four around it. */
  function jointCell(jx: number, jy: number) { const di = (jy - 1) * COLS + (jx - 1); const o = [...Array(CELLS).keys()]; if (flip) o.reverse(); return Math.min(o[di], o[di + 1], o[di + COLS], o[di + COLS + 1]); }
  const areaPos = (c: number) => { const idx = [c, c + 1, c + COLS, c + COLS + 1].map((x) => order.indexOf(x)); return { left: Math.min(...idx.map((i) => i % COLS)), top: Math.min(...idx.map((i) => Math.floor(i / COLS))) }; };
  const placingAura = myInput && !s.pending && sel?.k === 'hand' && selCard?.type === 'Aura';
  const auraAt = placingAura ? (drag ? drag.j ?? null : hoverJoint) : null;
  const rubble = useMemo(() => Object.values(s.cards).find((c) => c.name.toLowerCase() === 'rubble'), [s.cards]);
  const unitsByCell = useMemo(() => { const m = new Map<number, Unit[]>(); for (const u of Object.values(s.units)) { if (!m.has(u.c)) m.set(u.c, []); m.get(u.c)!.push(u); } return m; }, [s.units]);
  const pend = s.pending;
  const pendUnits = pend ? responders(s) : [];

  const cellPos = (c: number) => { const i = order.indexOf(c); return [((i % COLS) + 0.5) * 100, (Math.floor(i / COLS) + 0.5) * 100] as const; };
  const opp = other(viewer);
  const openMenu = () => setTableMenu(true);
  const leaveGame = () => { if (confirm('Leave this game?')) { useStore.getState().leave(); useStore.setState({ game: null }); } };

  return (
    <div className={`table board-${boardSize} ${settings.infoPanel === false ? 'no-info' : ''}`} style={{ '--pace': pace } as React.CSSProperties}>
      <ElementAura s={s} />
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
              : placingAura ? 'An aura goes on a joint where four squares meet and affects those four. Choose a glowing joint, or drag the card to one.'
              : drag ? 'Drag onto a glowing square and let go.' : selCard ? (selCard.type === 'Site' ? 'Choose a glowing square for this site.' : selCard.type === 'Magic' ? 'Opening the spell…' : 'Choose one of your sites.')
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
            {order.map((c, di) => {
              const site = s.sites[c]; const d = site?.inst ? cardOf(s, site.inst) : undefined; const hi = hiCells.get(c);
              const rub = site && !site.inst ? rubble : undefined; // Rubble is a token card in the pool: show its art and let it be read like any card
              const [x, y] = xy(c); const mark = herald?.marks.get(c);
              return (
                <div key={c} className={`cell ${site ? (site.inst ? 'site' : 'rubble') : 'void'} ${site?.owner != null ? 'own' + site.owner : ''} ${hi ? 'hi-' + hi : ''} ${d ? 'el-' + mainElement(d) : ''} ${mark ? `mark-${mark} mp${herald!.p}` : ''} ${drag?.c === c ? (hi || (selCard?.type === 'Magic' && !hiUnits.size) ? 'drop-ok' : 'drop-no') : ''} ${menu?.c === c ? 'menu-open' : ''}`}
                  onClick={(e) => { e.stopPropagation(); clickCell(c); }} {...hoverProps(d ?? rub)} data-cell={c}>
                  {d && <SiteArt id={d.id} />}
                  {rub && <SiteArt id={rub.id} upright={rub.type !== 'Site'} />}
                  {d && <span className="site-flash" key={site!.inst} />}
                  {d && <div className="site-label"><span>{d.name}</span><Pips t={d.thresholds} /></div>}
                  {site && !site.inst && <div className="site-label"><span>Rubble</span></div>}
                  <span className="coord">{'ABCDE'[x]}{4 - y}</span>
                  {([other(bottomPlayer), bottomPlayer] as PlayerId[]).map((p) => (
                    <div key={p} className={`side ${p === bottomPlayer ? 'near' : 'far'}`}>
                      {s.perms.filter((m) => m.c === c && m.owner === p && !m.carrier && m.kind !== 'aura').map((m) => {
                        const pc = cardOf(s, m.inst); const hp = hoverProps(pc);
                        return <span key={m.id} className={`perm p${m.owner}`} {...hp} onClick={(e) => { if (manual) { e.stopPropagation(); act({ t: 'manual', op: 'destroyPerm', perm: m.id }); } }} data-tip={manual ? 'Manual: destroy' : pc.name}>{m.kind === 'aura' ? '◌' : '◆'}</span>;
                      })}
                      {(unitsByCell.get(c) ?? []).filter((u) => u.owner === p).map((u) => <UnitToken key={u.id} s={s} u={u} pace={pace} selected={selUnit?.id === u.id} target={hiUnits.has(u.id) || focusUnit === u.id} dropping={drag?.unit === u.id && hiUnits.has(u.id)} onClick={(e) => clickUnit(u, e)} />)}
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
            {s.perms.filter((m) => m.kind === 'aura').map((m) => {
              // the aura's 2×2 area, drawn over the four squares it occupies
              const area = [m.c, m.c + 1, m.c + COLS, m.c + COLS + 1].map((c) => order.indexOf(c));
              const xs = area.map((i) => i % COLS), ys = area.map((i) => Math.floor(i / COLS));
              const pc = cardOf(s, m.inst); const left = Math.min(...xs), top = Math.min(...ys);
              const lasts = pc.effects.find((e) => e.op === 'lasts')?.n;
              return <div key={m.id} className={`aura-area p${m.owner}`} style={{ '--ax': left, '--ay': top } as React.CSSProperties} {...hoverProps(pc)}
                onClick={(e) => { if (manual) { e.stopPropagation(); act({ t: 'manual', op: 'destroyPerm', perm: m.id }); } }} data-tip={manual ? 'Manual: dispel' : `${pc.name}${lasts ? ` (${m.turns ?? 0} of ${lasts} turns)` : ''}`}>
                <span className="aura-name">◌ {pc.name}{lasts ? ` · ${m.turns ?? 0}/${lasts}` : ''}</span>
              </div>;
            })}
            {placingAura && auraAt !== null && (() => { const a = areaPos(auraAt); return <div className="aura-area preview" style={{ '--ax': a.left, '--ay': a.top } as React.CSSProperties} aria-hidden />; })()}
            {placingAura && Array.from({ length: (COLS - 1) * (CELLS / COLS - 1) }, (_, k) => {
              const jx = (k % (COLS - 1)) + 1, jy = Math.floor(k / (COLS - 1)) + 1; const c = jointCell(jx, jy);
              return <button key={k} className={`joint ${auraAt === c ? 'on' : ''}`} style={{ '--jx': jx, '--jy': jy } as React.CSSProperties} aria-label={`Place the aura on the joint between row ${jy} and ${jy + 1}, column ${jx} and ${jx + 1}`}
                data-tip="Place the aura here: it affects the four squares around this joint"
                onMouseEnter={() => setHoverJoint(c)} onMouseLeave={() => setHoverJoint((h) => (h === c ? null : h))}
                onClick={(e) => { e.stopPropagation(); setHoverJoint(null); play(sel!.inst, c); }} />;
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
            {selUnit && selUnit.owner === who && abilities.filter((x) => 'unit' in x.src && x.src.unit === selUnit.id).map((x) => <button key={x.fx} className="ability" disabled={!x.ok} data-tip={x.ok ? x.label : x.why} onClick={() => setCast({ k: 'ability', src: x.src, fx: x.fx })}>✦ {x.on === 'tap' ? 'Tap: ' : ''}{x.label.length > 34 ? x.label.slice(0, 32) + '…' : x.label}</button>)}
            {(abilities.length > 0 || me.cemetery.some((i) => cardOf(s, i).effects.some((e) => e.op === 'castRule' && e.fromCemetery))) && <button className="ability" onClick={() => setAbilOpen(true)} data-tip="Abilities of your units, sites and artifacts that you use when you choose">✦ Abilities ({abilities.filter((x) => x.ok).length})</button>}
            <button disabled={s.units[me.avatar].tapped || !me.atlas.length} onClick={() => act({ t: 'drawSite' })} data-tip="Avatar ability: tap to draw a site instead of playing one">Tap Avatar: draw a site</button>
            {g.mode === 'ai' && <button disabled={!canUndo} onClick={undo} data-tip={canUndo ? 'Take back your last move' : 'Nothing to take back. Moves that draw a card, pass the turn, or that the opponent has answered cannot be undone.'}>Undo</button>}
            <button className="end" onClick={() => act({ t: 'endTurn' })} data-tip="Damage on your minions clears and unspent mana is lost">End turn</button>
          </>)}
          {manual && selUnit && (<span className="manualbar">
            <b>{unitCard(s, selUnit).name}</b>
            <button onClick={() => act({ t: 'manual', op: 'damage', unit: selUnit.id, n: 1 })}>1 damage</button>
            <button onClick={() => act({ t: 'manual', op: 'tap', unit: selUnit.id })}>Tap / untap</button>
            {!selUnit.avatar && <button onClick={() => act({ t: 'manual', op: 'destroy', unit: selUnit.id })}>Destroy</button>}
            {s.perms.filter((m) => m.kind === 'artifact' && m.c === selUnit.c && !m.carrier).map((m) => <button key={m.id} onClick={() => act({ t: 'manual', op: 'carry', perm: m.id, unit: selUnit.id })}>Pick up {cardOf(s, m.inst).name}</button>)}
            {s.perms.filter((m) => m.carrier === selUnit.id).map((m) => <button key={m.id} onClick={() => act({ t: 'manual', op: 'carry', perm: m.id })}>Put down {cardOf(s, m.inst).name}</button>)}
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
        <button className="ghost hide-info" onClick={() => useStore.getState().setSettings({ infoPanel: false })} data-tip="Hide this panel and give the board the room. It comes back from the ☰ menu.">Hide panel ›</button>
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
        {abilOpen && (
          <motion.div className="sheet-veil" key="abil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAbilOpen(false)}>
            <motion.div className="sheet" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} transition={spring(pace, 420, 34)} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Abilities">
              <header><h2>Abilities</h2><button className="iconbtn" onClick={() => setAbilOpen(false)} aria-label="Close">✕</button></header>
              <p className="note">Abilities you use when you choose. Tap abilities tap the card; the others can be used once per turn.</p>
              {me.cemetery.filter((i) => cardOf(s, i).effects.some((e) => e.op === 'castRule' && e.fromCemetery)).map((i) => { const cd = cardOf(s, i); return (
                <button key={i} className="abil-row" onClick={() => { setAbilOpen(false); if (cd.type === 'Magic') play(i); else { setSel({ k: 'hand', inst: i }); toast(`Choose one of your sites for ${cd.name}.`); } }}><b>{cd.name}</b> <span>Cast it from your cemetery (costs {cd.cost})</span></button>); })}
              {abilities.map((x, i) => <button key={i} className="abil-row" disabled={!x.ok} onClick={() => { setAbilOpen(false); setCast({ k: 'ability', src: x.src, fx: x.fx }); }}><b>{x.name}</b> <span>{x.on === 'tap' ? 'Tap → ' : ''}{x.label}</span>{!x.ok && <small>{x.why}</small>}</button>)}
            </motion.div>
          </motion.div>
        )}
        {cast && <CastModal key={JSON.stringify(cast)} g={g} req={cast} close={(next) => { setCast(next ?? null); setFocusUnit(null); }} focus={setFocusUnit} />}
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
        {pend?.kind === 'allocate' && (() => {
          const atk = s.units[pend.attacker]; const total = atk ? strikeOf(s, atk) : 0; const foes = pend.foes ?? [];
          const sum = foes.reduce((n, id) => n + (split[id] ?? 0), 0);
          const set = (id: string, d: number) => setSplit({ ...split, [id]: Math.max(0, (split[id] ?? 0) + d) });
          return (
            <motion.div className="prompt" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {(hot || pend.by === g.local) && atk ? (<>
                <h3>{PNAME(g, pend.by)}: split {unitCard(s, atk).name}'s strike</h3>
                <p>It strikes once for {total} damage, shared among the {foes.length} enemies in the fight as you choose; an enemy can get 0. Each enemy strikes back as normal.
                  {' '}<a href={codexUrl('Fight')} target="_blank" rel="noreferrer">Fight ↗</a></p>
                <div className="alloc">{foes.map((id) => { const f = s.units[id]; if (!f) return null; const left = f.avatar ? null : Math.max(0, defenseOf(s, f) - f.damage);
                  return <div key={id} className="alloc-row" {...hoverProps(unitCard(s, f))}>
                    <span>{unitCard(s, f).name}{left !== null && <small> · dies at {has(s, atk, 'Lethal') ? 1 : left}</small>}</span>
                    <span className="stepper"><button onClick={() => set(id, -1)} aria-label={`1 less to ${unitCard(s, f).name}`} disabled={!(split[id] ?? 0)}>−</button><b>{split[id] ?? 0}</b><button onClick={() => set(id, 1)} aria-label={`1 more to ${unitCard(s, f).name}`} disabled={sum >= total}>+</button></span>
                  </div>; })}</div>
                <div className="row">
                  <span className="hint">{sum === total ? 'All damage assigned.' : `${total - sum} left to assign.`}</span>
                  <button className="primary" disabled={sum !== total} onClick={() => act({ t: 'allocate', split: Object.fromEntries(foes.map((id) => [id, split[id] ?? 0])) })}>Strike</button>
                </div>
              </>) : <p>Waiting for {PNAME(g, pend.by)} to split the damage…</p>}
            </motion.div>);
        })()}
        {pend && pend.kind !== 'allocate' && (
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
        <div className="veil"><div className="dialog wide opening">
          <h2>{PNAME(g, who)}: opening hand</h2>
          <p>You may take one mulligan. Select up to three cards to put on the bottom of their decks and draw the same number back.</p>
          {(['Site', 'Spell'] as const).map((kind) => {
            const row = s.players[who].hand.filter((inst) => (cardOf(s, inst).type === 'Site') === (kind === 'Site'));
            return row.length > 0 && (
              <div key={kind} className="mullgroup">
                <h3>{kind === 'Site' ? 'From your atlas' : 'From your spellbook'}</h3>
                <div className="mullrow">{row.map((inst) => (
                  <button key={inst} className={`handcard ${mull.includes(inst) ? 'out' : ''}`} aria-pressed={mull.includes(inst)} onClick={() => setMull(mull.includes(inst) ? mull.filter((x) => x !== inst) : mull.length < 3 ? [...mull, inst] : mull)}><CardFace card={cardOf(s, inst)} size="xl" /></button>
                ))}</div>
              </div>
            );
          })}
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

/** The top edge of a carried artifact, peeking out above its bearer, with its name. */
function AttachTab({ card }: { card: CardDef }) {
  const art = useStore((st) => st.art[card.id]);
  return <span className="attach-tab" style={art ? { backgroundImage: `url(${art})` } : undefined} {...hoverProps(card)}><b>{card.name}</b></span>;
}
/**
 * The void takes on the elements of the sites in play. Each element gets a glow centred on where its
 * sites are, growing and brightening with the total threshold of that element on the board.
 */
/** Very faint washes behind the whole table that strengthen as each element's threshold builds up in the realm. */
function ElementAura({ s }: { s: GameState }) {
  const total = useMemo(() => {
    const n: Record<string, number> = {};
    for (const site of Object.values(s.sites)) { if (!site?.inst) continue; const th = cardOf(s, site.inst).thresholds; for (const e of ELEMENTS) n[e] = (n[e] ?? 0) + (th[e] ?? 0); }
    return n;
  }, [s.sites]);
  return <div className="table-aura" aria-hidden>{ELEMENTS.map((e) => <i key={e} className={e} style={{ ['--i' as string]: Math.min(1, (total[e] ?? 0) / 6) }} />)}</div>;
}
function SiteArt({ id, upright }: { id: string; upright?: boolean }) {
  const art = useStore((st) => st.art[id]);
  return art ? <div className={`site-art-box ${upright ? 'upright' : ''}`}><img src={art} alt="" draggable={false} /></div> : null;
}

/** Moving light on a hand card under the mouse, so it reads as a glossy physical card. */
function sheen(e: React.PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
  e.currentTarget.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
}

function UnitToken({ s, u, pace, selected, target, dropping, onClick }: { s: GameState; u: Unit; pace: number; selected: boolean; target: boolean; dropping?: boolean; onClick: (e: React.MouseEvent) => void }) {
  const d = unitCard(s, u);
  const carried = s.perms.filter((m) => m.carrier === u.id);
  const art = useStore((st) => st.art[d.id]);
  const atk = power(s, u); const def = defenseOf(s, u); const boosted = atk !== d.attack || !!u.mods?.length;
  const life = u.avatar ? s.players[u.owner].life : def - u.damage;
  const disabled = isDisabled(s, u);
  const below = u.r === 'under' ? (isWater(s, u.c) ? 'Submerged' : 'Burrowed') : ''; const flying = !u.avatar && u.r !== 'under' && has(s, u, 'Airborne');
  const tags = [flying ? 'Airborne' : '', below, warded(s, u) ? 'Ward' : '', hasStealth(s, u) ? 'Stealth' : '', disabled ? 'Disabled' : '', u.lance ? 'Lance' : '', summoningSick(s, u) ? 'Entered this turn' : '', u.noUntap ? "Won't untap" : '', u.ctrl ? 'Controlled' : '',
    ...new Set((u.mods ?? []).map((m) => m.kw ?? '').filter(Boolean))].filter(Boolean);
  const lanceCard = u.lance ? Object.values(s.cards).find((c) => c.name === 'Lance' && c.category === 'Token') : undefined;
  return (
    <motion.button layout layoutId={u.inst} className={`unit p${u.owner} ${d.category === 'Token' ? 'token' : ''} ${u.avatar ? 'avatar' : ''} ${u.tapped ? 'tapped' : ''} ${selected ? 'sel' : ''} ${target ? 'tgt' : ''} ${dropping ? 'dropping' : ''} ${below ? 'under ' + below.toLowerCase() : ''} ${flying ? 'airborne' : ''} ${isDisabled(s, u) ? 'disabled' : ''}`}
      animate={{ rotate: u.tapped ? 90 : 0, scale: selected ? 1.12 : 1 }} transition={spring(pace)} onClick={onClick} {...hoverProps(d)}
      data-unit={u.id} aria-label={`${d.name}${u.tapped ? ', tapped' : ''}`}>
      <span className="unit-face">{art ? <img src={art} alt="" draggable={false} /> : <span className="unit-name">{d.name}</span>}</span>
      {u.avatar ? <span className="aura-ring" aria-hidden /> : null}
      {!u.avatar && <motion.span key={u.damage + ':' + life + ':' + atk} className={`badge ${u.damage ? 'hurt' : ''} ${atk > d.attack ? 'up' : atk < d.attack ? 'down' : ''}`} initial={{ scale: 1.8 }} animate={{ scale: 1 }} transition={spring(pace, 500, 22)}>{atk === def && !u.damage ? atk : `${atk}/${life}`}</motion.span>}
      {boosted && <span className="mods" data-tip={[...(u.mods ?? []).map((m) => `${m.kw ? m.kw : `${m.atk >= 0 ? '+' : ''}${m.atk} power`}${m.turn !== undefined ? ' this turn' : ''} (${m.from})`), atk !== d.attack + (u.mods ?? []).reduce((n, m) => n + m.atk, 0) ? 'boosted by a card nearby' : ''].filter(Boolean).join(', ')}>✦</span>}
      {carried.length > 0 && <span className="attached">{carried.map((m) => { const ac = cardOf(s, m.inst); return <AttachTab key={m.id} card={ac} />; })}</span>}
      {below && <span className="region-tag">{below === 'Submerged' ? '≈ Submerged' : '▼ Burrowed'}</span>}
      {flying && <span className="region-tag air">▲ Airborne</span>}
      {tags.length > 0 && <span className="tags">{tags.map((name) => { const st = STATUSES[name] ?? { tag: name.slice(0, 2), text: KEYWORD_HELP[name]?.text ?? `${name}, granted by an effect.` }; return (
        <span key={name} className={`stag st-${name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}`} aria-label={name}
          onMouseEnter={(e) => { clearZoom(); useStatusPop.setState({ name, text: st.text, card: name === 'Lance' ? lanceCard : undefined, rect: (e.currentTarget.closest('.unit') ?? e.currentTarget).getBoundingClientRect() }); }}
          onMouseLeave={() => useStatusPop.setState(null)}>{st.tag}</span>); })}</span>}
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
        <div data-tip="Mana this turn. Each site gives 1 at the start of your turn."><Num n={Math.max(0, pl.mana)} className="big" /><small>mana</small>{manual && <span className="pm"><button onClick={() => adj('mana', -1)}>−</button><button onClick={() => adj('mana', 1)}>+</button></span>}</div>
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
      <span className="stat-m"><i className="sym" aria-hidden>✦</i><Num n={Math.max(0, pl.mana)} /><small>mana</small>{manual && <><button onClick={() => act({ t: 'manual', op: 'mana', p, n: -1 })}>−</button><button onClick={() => act({ t: 'manual', op: 'mana', p, n: 1 })}>+</button></>}</span>
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
      <div className="opt wide-only">
        <span>Card panel</span>
        <div className="seg">{([[true, 'Shown'], [false, 'Hidden']] as const).map(([v, l]) => <button key={l} className={(st.infoPanel !== false) === v ? 'on' : ''} onClick={() => set({ infoPanel: v })}>{l}</button>)}</div>
        <small>The panel on the right of the table. Hovering or right-clicking a card shows the same card, so it can be hidden to give the board more room.</small>
      </div>
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
      <HowItWorks key={card.id} card={card} open={!!given} />
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
            <RuleTicket key={card.id} card={card} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
/** A rule ticket: say what a card did wrong and why, straight from the card. It lands in the problem reports (Settings → Wishlist and problems)
 *  with the card, how the app reads its text, and the last moves of the game attached. */
function RuleTicket({ card }: { card: CardDef }) {
  const [open, setOpen] = useState(false); const [what, setWhat] = useState(''); const [should, setShould] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setNote('');
    try {
      const { game: g, settings } = useStore.getState(); const email = useAuth.getState().email;
      const remote = await feedbackRemote();
      await submitFeedback({
        kind: 'problem', title: `Rule ticket: ${card.name}`,
        details: `What happened:\n${what.trim()}${should.trim() ? `\n\nWhat it should do, and why:\n${should.trim()}` : ''}`,
        submitted_by: email ?? (settings.name || null),
        context: {
          ticket: 'rule', card: { id: card.id, name: card.name, type: card.type, cost: card.cost, rules: card.rules, keywords: card.keywords },
          read_as: card.effects.map((e) => ({ on: e.on, op: e.op, who: e.who, rule: e.rule ?? null, by_hand: e.op === 'manual', text: e.text ?? null })),
          game: g ? { mode: g.mode, difficulty: g.difficulty, turn: g.state.turn, phase: g.state.phase, log: g.state.log.slice(-25).map((l) => l.text) } : null,
          errors: recentErrors(), version: __APP_VERSION__, at: new Date().toISOString(),
        },
      }, remote);
      setWhat(''); setShould(''); setNote(remote ? 'Ticket saved and sent. It is in Settings → Wishlist and problems.' : 'Ticket saved on this device. It is in Settings → Wishlist and problems.');
    } catch (e) { setNote(`Saved on this device, but not sent: ${(e as Error).message}`); }
    setBusy(false);
  };
  if (!open) return <div className="ticket"><button className="ticket-open" onClick={() => setOpen(true)} data-tip="Report that this card is not working the way it should">🎫 Rule ticket</button>{note && <small className="ticket-note">{note}</small>}</div>;
  return (
    <form className="ticket open" onSubmit={(e) => { e.preventDefault(); if (what.trim() && !busy) void send().then(() => setOpen(false)); }}>
      <strong>Rule ticket for {card.name}</strong>
      <label>What happened?<textarea value={what} onChange={(e) => setWhat(e.target.value)} rows={3} autoFocus placeholder="What the card did (or didn't do) in the app" /></label>
      <label>What should it do, and why?<textarea value={should} onChange={(e) => setShould(e.target.value)} rows={3} placeholder="How it should work, and the card text or rule that says so" /></label>
      <small className="fineprint">The card, how the app currently reads its text, and the last 25 lines of the game log go with the ticket.</small>
      <div className="row"><button type="button" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="primary" disabled={!what.trim() || busy}>{busy ? 'Sending…' : 'File ticket'}</button></div>
    </form>
  );
}
export { cell, COLS };

function useMedia(q: string) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => { const l = matchMedia(q); const f = () => setM(l.matches); l.addEventListener('change', f); f(); return () => l.removeEventListener('change', f); }, [q]);
  return m;
}
