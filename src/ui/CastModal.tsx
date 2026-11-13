// The spell-casting pop-up. It opens when a card with rules text is played, when the player uses an
// activated ability (Tap → …), and when a triggered ability (Deathrite, start of turn …) needs a decision.
// It lists what the card will do, collects the choices (targets, X, which deck), plays a casting
// animation, then sends one action to the engine. Sentences the engine does not automate get a
// second step: the hand tools, which change life, mana, cards and units through logged manual actions.
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, Reorder, motion } from 'motion/react';
import {
  type Action, type CardDef, type Choice, type Effect, type GameState, type Loc, type PlayerId, type Source, type Trigger,
  type ManualOp, KEYWORDS, KEYWORD_HELP, RULE_TERMS, actor, codexUrl, auraArea, auraSteps, cardOf, casterOrigins, cellsFor, pickOptions, shotDirs, teleportCells, check, effectsOn, needsChoice, other, sourceOf, targetsFor, unitCard, xy,
} from '../engine';
import { type Game, useStore } from '../store';
import { CardFace, hoverProps, mainElement } from './CardFace';
import { TRIGGER_SHORT, describe } from './abilityText';
import { usePace } from './pace';
import { HowItWorks } from './Explain';

export type CastReq =
  | { k: 'cast'; inst: string; c?: number; bearer?: string }
  | { k: 'ability'; src: Source; fx: number }
  | { k: 'trigger'; id: string }
  /** after an action: only the hand tools for the sentences that were not automated */
  | { k: 'hand'; inst: string; lines: string[]; title: string };

const sq = (c: number) => `${'ABCDE'[xy(c)[0]]}${4 - xy(c)[1]}`;

interface Plan { d: CardDef; p: PlayerId; on: Trigger; idx: number[]; origins: Loc[]; self?: string; verb: string; title: string }
function plan(s: GameState, req: CastReq): Plan | null {
  if (req.k === 'cast') {
    if (!s.inst[req.inst]) return null;
    const d = cardOf(s, req.inst); const p = Number(req.inst[0]) as PlayerId; const on: Trigger = d.type === 'Magic' ? 'cast' : 'genesis';
    const verb = d.type === 'Magic' ? 'Cast' : d.type === 'Minion' ? 'Summon' : 'Conjure';
    return { d, p, on, idx: effectsOn(d, on), origins: d.type === 'Magic' ? casterOrigins(s, p) : [{ c: req.c ?? 0, r: 'surface' }], verb, title: `${verb} ${d.name}${req.c !== undefined && d.type !== 'Magic' ? ` at ${sq(req.c)}` : ''}` };
  }
  if (req.k === 'ability') {
    const src = sourceOf(s, req.src); if (!src) return null;
    const d = cardOf(s, src.inst); const e = d.effects[req.fx]; if (!e) return null;
    return { d, p: src.owner, on: e.on, idx: effectsOn(d, e.on, req.fx), origins: [src.loc], self: src.unit?.id, verb: e.on === 'tap' ? 'Tap and invoke' : 'Invoke', title: `${d.name}: ${TRIGGER_SHORT[e.on]} ability` };
  }
  if (req.k === 'trigger') {
    const q = s.queue?.find((x) => x.id === req.id); if (!q) return null;
    const d = cardOf(s, q.inst); const on = d.effects[q.fx[0]].on;
    return { d, p: q.by, on, idx: q.fx, origins: q.loc ? [q.loc] : casterOrigins(s, q.by), self: q.src && 'unit' in q.src ? q.src.unit : undefined, verb: 'Resolve', title: `${d.name}: ${TRIGGER_SHORT[on]}` };
  }
  const d = cardOf(s, req.inst);
  return { d, p: Number(req.inst[0]) as PlayerId, on: 'cast', idx: [], origins: [], verb: '', title: req.title };
}

export function CastModal({ g, req, close, focus }: { g: Game; req: CastReq; close: (next?: CastReq) => void; focus: (unit: string | null) => void }) {
  const s = g.state; const act = useStore((st) => st.act); const toast = useStore((st) => st.toast); const pace = usePace();
  const pl = useMemo(() => plan(s, req), [req]); // fixed when the pop-up opens; the state moves on under it
  const [choices, setChoices] = useState<Choice[]>([]);
  const [phase, setPhase] = useState<'choose' | 'casting'>('choose');
  const [why, setWhy] = useState(''); const [whyKw, setWhyKw] = useState<string | undefined>();
  useEffect(() => { if (!pl) close(); }, [pl]);
  // pick the only possible target and sensible defaults straight away
  useEffect(() => {
    if (!pl || req.k === 'hand') return;
    const c: Choice[] = [];
    for (const i of pl.idx) {
      const e = pl.d.effects[i];
      if (e.who === 'target' && !e.ref) { const t = targetsFor(s, pl.p, pl.d, i, pl.origins, pl.self); if (t.length === 1) c[i] = { target: t[0] }; }
      if (e.op === 'shoot') { const dirs = shotDirs(s, pl.p, pl.origins[0] ?? { c: 0, r: 'surface' }); if (dirs.length === 1) c[i] = { ...(c[i] ?? {}), dir: dirs[0] }; }
      if (e.x) c[i] = { ...(c[i] ?? {}), n: 1 };
      if (e.op === 'draw' && !e.deck) c[i] = { ...(c[i] ?? {}), deck: 'spellbook' };
    }
    setChoices(c);
  }, [pl]);
  if (!pl) return null;
  const { d } = pl; const el = mainElement(d);
  const set = (i: number, p: Partial<Choice>) => setChoices((c) => { const n = c.slice(); n[i] = { ...(n[i] ?? {}), ...p }; return n; });
  const manualLines = req.k === 'hand' ? req.lines : pl.idx.filter((i) => d.effects[i].op === 'manual').map((i) => d.effects[i].text ?? '');
  const others = req.k === 'cast' && d.type !== 'Magic' ? d.effects.filter((e) => e.on !== pl.on) : [];

  const action = (): Action | null => {
    const ch = choices.length ? choices : undefined;
    if (req.k === 'cast') return { t: 'cast', inst: req.inst, ...(req.c !== undefined ? { c: req.c } : {}), ...(req.bearer && !pl.idx.some((i) => d.effects[i].who === 'target') ? { target: req.bearer } : {}), ...(ch ? { choices: ch } : {}) };
    if (req.k === 'ability') return { t: 'ability', src: req.src, fx: req.fx, ...(ch ? { choices: ch } : {}) };
    if (req.k === 'trigger') return { t: 'trigger', ...(ch ? { choices: ch } : {}) };
    return null;
  };
  const go = () => {
    const a = action(); if (!a) return;
    const r = check(s, a); if (!r.ok) { setWhy(r.reason); setWhyKw(r.keyword); return; }
    setPhase('casting'); focus(null);
    setTimeout(() => {
      if (!act(a)) { setPhase('choose'); return; }
      close(manualLines.length ? { k: 'hand', inst: req.k === 'cast' ? req.inst : (req.k === 'ability' ? sourceOf(s, req.src)!.inst : s.queue!.find((x) => x.id === (req as { id: string }).id)!.inst), lines: manualLines, title: `${d.name}: resolve by hand` } : undefined);
    }, useStore.getState().settings.reduceMotion ? 0 : 900 * pace);
  };
  const skip = () => { if (act({ t: 'trigger', skip: true })) close(); };
  const mine = req.k === 'hand' || g.mode === 'hotseat' || actor(s) === g.local;

  return (
    <motion.div className={`spell-veil el-${el} ${phase}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 * pace }}
      onClick={() => req.k !== 'trigger' && phase === 'choose' && close()} style={{ '--sp': `var(--${el}, var(--brass))` } as React.CSSProperties}>
      <div className="spell-sigil" aria-hidden><Sigil /></div>
      <motion.div className="spell-card" role="dialog" aria-label={pl.title} onClick={(e) => e.stopPropagation()}
        initial={{ y: 30, scale: 0.94, opacity: 0 }} animate={phase === 'casting' ? { y: -40, scale: 1.04, opacity: 0 } : { y: 0, scale: 1, opacity: 1 }}
        transition={phase === 'casting' ? { duration: 0.85 * pace, ease: [0.4, 0, 0.2, 1] } : { type: 'spring', stiffness: 260 / pace, damping: 24 }}>
        <div className="spell-art"><CardFace card={d} size="md" /></div>
        <div className="spell-body">
          <h2>{pl.title}</h2>
          {req.k === 'hand' ? <p className="spell-sub">This part of the card is not automated. Use the tools below to carry it out; each change is marked in the log.</p>
            : <p className="spell-sub">{req.k === 'trigger' ? `${TRIGGER_SHORT[pl.on]} ability. Choose, then resolve it or let it pass.` : pl.idx.length ? 'What happens:' : d.rules ? 'Nothing here needs a choice.' : 'This card has no rules text.'}</p>}

          {req.k !== 'hand' && <ol className="incant">
            {pl.idx.map((i) => <Line key={i} s={s} pl={pl} i={i} e={d.effects[i]} c={choices[i]} set={(p) => set(i, p)} focus={focus} />)}
          </ol>}
          {others.length > 0 && <div className="spell-other"><b>Its other abilities</b>{others.map((e, i) => <p key={i}><span className="trig">{TRIGGER_SHORT[e.on]}</span> {describe(e)}{e.op === 'manual' ? <em> (by hand)</em> : ''}</p>)}</div>}
          {manualLines.length > 0 && req.k === 'hand' && <HandTools g={g} lines={manualLines} p={pl.p} />}
          {why && phase === 'choose' && <div className="spell-why" role="alert"><b>Not allowed:</b> {why}
            {whyKw && (KEYWORD_HELP[whyKw] || RULE_TERMS[whyKw]) && <p className="toast-rule"><b>The rule — {whyKw}:</b> {(KEYWORD_HELP[whyKw] ?? RULE_TERMS[whyKw]).text} <a href={codexUrl(whyKw)} target="_blank" rel="noreferrer">Read it in the Codex ↗</a></p>}</div>}
          <HowItWorks card={d} />

          <div className="spell-actions">
            {req.k === 'hand' ? <button className="primary cast-btn" onClick={() => close()}>Done</button> : mine ? <>
              {req.k === 'trigger' ? <button onClick={skip}>Let it pass</button> : <button onClick={() => close()}>Cancel</button>}
              <button className="primary cast-btn" disabled={phase !== 'choose'} onClick={go}><span aria-hidden>✦</span> {pl.verb}</button>
            </> : <p className="spell-sub">Waiting for the other player…</p>}
          </div>
        </div>
      </motion.div>
      <AnimatePresence>{phase === 'casting' && <motion.div className="spell-burst" initial={{ scale: 0.2, opacity: 0.9 }} animate={{ scale: 2.4, opacity: 0 }} transition={{ duration: 0.9 * pace }} aria-hidden />}</AnimatePresence>
    </motion.div>
  );
}

/** One ability line, with whatever choice it needs. */
function Line({ s, pl, i, e, c, set, focus }: { s: GameState; pl: Plan; i: number; e: Effect; c?: Choice; set: (p: Partial<Choice>) => void; focus: (u: string | null) => void }) {
  const targets = e.who === 'target' && !e.ref ? targetsFor(s, pl.p, pl.d, i, pl.origins, pl.self) : [];
  const cells = e.who === 'atTarget' && !e.refCell ? cellsFor(s, pl.d, i, pl.origins) : [];
  const dirs = e.op === 'shoot' ? shotDirs(s, pl.p, pl.origins[0] ?? { c: 0, r: 'surface' }) : [];
  const DIR: Record<string, string> = { '0,-1': '↑ Up', '0,1': '↓ Down', '-1,0': '← Left', '1,0': '→ Right' };
  return (
    <li className={e.op === 'manual' ? 'by-hand' : needsChoice(e) ? 'choose' : 'auto'}>
      <span className="glyph" aria-hidden>{e.op === 'manual' ? '✋' : needsChoice(e) ? '◈' : '✓'}</span>
      <div>
        <span className="what" style={c?.skip ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{describe(e)}</span>
        {e.optional && <button className={`maybe ${c?.skip ? '' : 'on'}`} onClick={() => set({ skip: !c?.skip })} aria-pressed={!c?.skip} data-tip="The card says you may: choose whether this part happens">{c?.skip ? 'Skipped — do it' : 'You may: skip it'}</button>}
        {e.op === 'manual' && <small> — not automated: the hand tools open after it resolves</small>}
        {e.who === 'atTarget' && !e.refCell && (cells.length ? <div className="chips targets">{cells.map((cl) => {
          const here = Object.values(s.units).filter((u) => u.c === cl); const on = c?.cell === cl;
          return <button key={cl} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => set({ cell: cl })} onPointerEnter={() => here[0] && focus(here[0].id)} onPointerLeave={() => focus(null)}>{sq(cl)}<small> {here.length ? here.map((u) => unitCard(s, u).name).join(', ') : s.sites[cl]?.inst ? cardOf(s, s.sites[cl]!.inst!).name : 'empty'}</small></button>;
        })}</div> : <small className="none"> — no location in range</small>)}
        {e.op === 'pick' && e.pick && (() => {
          const opts = pickOptions(s, pl.p, pl.d, e); const pk = e.pick!; const chosen = c?.cards ?? [];
          const max = pk.take === 'all' ? opts.length : pk.take;
          const ZONE: Record<string, string> = { spellbook: 'spellbook', atlas: 'atlas', hand: 'hand', cemetery: 'cemetery', collection: 'collection', oppHand: "opponent's hand", oppSpellbook: "opponent's spellbook", anyCemetery: 'cemetery' };
          if (pk.take === 'all') return <small> — {opts.length ? `${opts.length} match${opts.length === 1 ? 'es' : ''}: ${opts.map((o) => s.cards[o.cardId].name).join(', ')}` : 'nothing matches'}</small>;
          if (!opts.length) return <small className="none"> — nothing there matches</small>;
          // Looking at the top of a deck: the cards are laid out in deck order and, when the card says
          // "in any order", can be dragged into a new one. The left end is the top of the deck.
          const fromTop = !!pk.top && opts.every((o) => o.inst);
          const canOrder = fromTop && max === 0 && (pk.rest ?? 'stay') === 'stay' && opts.length > 1;
          if (canOrder) {
            const byKey = new Map(opts.map((o) => [o.key, o]));
            const order = (c?.order?.length === opts.length && c.order.every((k) => byKey.has(k)) ? c.order : opts.map((o) => o.key));
            return <div className="lookrow">
              <small>Drag the cards into the order you want them back on the deck.</small>
              <div className="deck-ends"><b>◀ Top of the deck</b><span>drawn first</span><i /><span>drawn later</span><b>Deeper in the deck ▶</b></div>
              <Reorder.Group as="div" axis="x" values={order} onReorder={(v) => set({ order: v as string[] })} className="look-cards">
                {order.map((k, n) => { const cd = s.cards[byKey.get(k)!.cardId]; return (
                  <Reorder.Item as="div" key={k} value={k} className="look-card drag" whileDrag={{ scale: 1.06, zIndex: 5 }} {...hoverProps(cd)}>
                    <span className="ord">{n === 0 ? 'Top' : n === order.length - 1 ? `${n + 1} (last of these)` : n + 1}</span><CardFace card={cd} size="md" />
                  </Reorder.Item>); })}
              </Reorder.Group>
            </div>;
          }
          return <div className={`lookrow ${opts.length > 8 ? 'many' : ''}`}>
            <small>{max === 0 ? 'You see:' : `Choose up to ${max}:`}{fromTop ? ' (left is the top of the deck)' : ''}</small>
            <div className="look-cards">{opts.map((o) => { const on = chosen.includes(o.key); const cd = s.cards[o.cardId];
              return <button key={o.key} className={`look-card ${on ? 'on' : ''}`} aria-pressed={on} disabled={max === 0} {...hoverProps(cd)}
                onClick={() => set({ cards: on ? chosen.filter((k) => k !== o.key) : [...chosen, o.key].slice(-max) })}><CardFace card={cd} size={opts.length > 8 ? 'sm' : 'md'} /><span className="from">{ZONE[o.zone] ?? o.zone}{o.owner !== pl.p ? ' (theirs)' : ''}</span></button>; })}</div>
          </div>;
        })()}
        {e.op === 'discard' && !e.random && e.who === 'controller' && (() => {
          const hand = s.players[pl.p].hand.filter((x) => (pl.d && x !== (pl as { inst?: string }).inst) && (e.deck === 'atlas' ? cardOf(s, x).type === 'Site' : e.deck === 'spellbook' ? cardOf(s, x).type !== 'Site' : true));
          return hand.length ? <div className="chips targets"><small>Discard:</small>{hand.map((x) => <button key={x} className={`chip ${c?.card === x ? 'on' : ''}`} onClick={() => set({ card: x })}>{cardOf(s, x).name}</button>)}</div> : <small className="none"> — nothing to discard</small>;
        })()}
        {e.op === 'scry' && (() => { const top = s.players[pl.p][e.deck ?? 'spellbook'][0]; return top ? <div className="lookrow"><small>Only you see this. It is the top card of your {e.deck ?? 'spellbook'}.</small>
          <div className="look-cards"><div className="look-card" {...hoverProps(cardOf(s, top))}><CardFace card={cardOf(s, top)} size="md" /></div>
            <span className="xpick col"><button className={!c?.bottom ? 'on' : ''} onClick={() => set({ bottom: false })}>▲ Leave it on top</button><button className={c?.bottom ? 'on' : ''} onClick={() => set({ bottom: true })}>▼ Put it on the bottom</button></span></div></div> : <small className="none"> — the deck is empty</small>; })()}
        {e.op === 'moveAura' && !c?.skip && pl.origins[0] && <div className="chips targets"><small>Move it to cover:</small>{auraSteps(pl.origins[0].c).map((cl) => { const a = auraArea(cl);
          return <button key={cl} className={`chip ${c?.cell === cl ? 'on' : ''}`} onClick={() => set({ cell: cl })} data-tip={`The joint between ${a.map(sq).join(', ')}`}>{sq(a[0])}–{sq(a[3])}<small> {a.map(sq).join(' ')}</small></button>; })}</div>}
        {e.op === 'teleport' && (c?.target || e.who === 'self') && (!e.dest || ['nearby', 'site', 'adjacent', 'toward', 'away'].includes(e.dest)) && (() => { const mover = c?.target ? s.units[c.target] : pl.self ? s.units[pl.self] : undefined; const tc = teleportCells(s, e, mover, pl.origins[0]); return tc.length ? <div className="chips targets"><small>Where to:</small>{tc.map((cl) => <button key={cl} className={`chip ${c?.cell === cl ? 'on' : ''}`} onClick={() => set({ cell: cl })}>{sq(cl)}<small> {s.sites[cl]?.inst ? cardOf(s, s.sites[cl]!.inst!).name : 'void'}</small></button>)}</div> : <small className="none"> — nowhere to go</small>; })()}
        {e.op === 'shoot' && (dirs.length ? <span className="xpick">{dirs.map((dv) => <button key={dv.join()} className={c?.dir?.join() === dv.join() ? 'on' : ''} onClick={() => set({ dir: dv })}>{DIR[dv.join()]}</button>)}</span> : <small className="none"> — nothing in a straight line to hit</small>)}
        {e.who === 'target' && !e.ref && (targets.length ? <div className="chips targets">{targets.map((id) => {
          const u = s.units[id]; const on = c?.target === id;
          return <button key={id} className={`chip p${u.owner} ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => set({ target: id })} onPointerEnter={() => focus(id)} onPointerLeave={() => focus(null)}>
            {unitCard(s, u).name}<small> {u.owner === pl.p ? 'yours' : 'enemy'} · {sq(u.c)}{u.r === 'under' ? ' below' : ''}</small></button>;
        })}</div> : <small className="none"> — nothing in range to target</small>)}
        {e.x && <span className="xpick"><button onClick={() => set({ n: Math.max(0, (c?.n ?? 1) - 1) })} aria-label="Less">−</button><b>X = {c?.n ?? 1}</b><button onClick={() => set({ n: (c?.n ?? 1) + 1 })} aria-label="More">+</button></span>}
        {e.op === 'draw' && !e.deck && <span className="xpick">{(['spellbook', 'atlas'] as const).map((k) => <button key={k} className={(c?.deck ?? 'spellbook') === k ? 'on' : ''} onClick={() => set({ deck: k })}>{k === 'spellbook' ? 'Spellbook' : 'Atlas'}</button>)}</span>}
      </div>
    </li>
  );
}

/** The hand tools: everything a card's unautomated sentence could ask for, as logged manual actions. */
export function HandTools({ g, lines, p }: { g: Game; lines: string[]; p: PlayerId }) {
  const s = useStore((st) => st.game?.state) ?? g.state; const act = useStore((st) => st.act);
  const [unit, setUnit] = useState<string | null>(null); const [kw, setKw] = useState('Airborne'); const [turn, setTurn] = useState(true);
  const u = unit ? s.units[unit] : undefined;
  const m = (a: ManualOp) => act({ t: 'manual', ...a });
  return (
    <div className="handtools">
      <div className="quotes">{lines.map((t, i) => <blockquote key={i}>“{t}”</blockquote>)}</div>
      <div className="ht-players">{([p, other(p)] as PlayerId[]).map((q) => (
        <div key={q} className={`ht-player p${q}`}>
          <b>{g.names[q]}</b>
          <span>♥ {s.players[q].life}<button onClick={() => m({ op: 'life', p: q, n: -1 })} aria-label="Lose 1 life">−</button><button onClick={() => m({ op: 'life', p: q, n: 1 })} aria-label="Gain 1 life">+</button></span>
          <span>✦ {s.players[q].mana}<button onClick={() => m({ op: 'mana', p: q, n: -1 })} aria-label="1 less mana">−</button><button onClick={() => m({ op: 'mana', p: q, n: 1 })} aria-label="1 more mana">+</button></span>
          <span><button onClick={() => m({ op: 'draw', p: q, deck: 'spellbook' })}>Draw spell</button><button onClick={() => m({ op: 'draw', p: q, deck: 'atlas' })}>Draw site</button></span>
        </div>
      ))}</div>
      <div className="chips">{Object.values(s.units).map((x) => <button key={x.id} className={`chip p${x.owner} ${unit === x.id ? 'on' : ''}`} onClick={() => setUnit(unit === x.id ? null : x.id)}>{unitCard(s, x).name}<small> {sq(x.c)}</small></button>)}</div>
      {u ? <div className="ht-unit">
        <b>{unitCard(s, u).name}</b>
        <button onClick={() => m({ op: 'damage', unit: u.id, n: 1 })}>1 damage</button>
        <button onClick={() => m({ op: 'buff', unit: u.id, atk: 1, def: 1, turn })}>+1 power</button>
        <button onClick={() => m({ op: 'buff', unit: u.id, atk: -1, def: -1, turn })}>−1 power</button>
        <span className="kw"><select value={kw} onChange={(e) => setKw(e.target.value)} aria-label="Keyword">{KEYWORDS.filter((k) => !['Genesis', 'Deathrite'].includes(k)).map((k) => <option key={k}>{k}</option>)}</select><button onClick={() => m({ op: 'grant', unit: u.id, keyword: kw, turn })}>Give</button></span>
        <label className="switch"><input type="checkbox" checked={turn} onChange={(e) => setTurn(e.target.checked)} /> this turn only</label>
        <button onClick={() => m({ op: u.tapped ? 'untap' : 'tap', unit: u.id })}>{u.tapped ? 'Untap' : 'Tap'}</button>
        {!u.avatar && <><button onClick={() => { m({ op: 'bounce', unit: u.id }); setUnit(null); }}>To hand</button><button onClick={() => { m({ op: 'banish', unit: u.id }); setUnit(null); }}>Banish</button><button className="danger" onClick={() => { m({ op: 'destroy', unit: u.id }); setUnit(null); }}>Destroy</button></>}
      </div> : <p className="spell-sub">Choose a unit above to change it.</p>}
    </div>
  );
}

/** Two counter-rotating rings of runes. */
function Sigil() {
  const runes = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
  return (
    <svg viewBox="-100 -100 200 200">
      <g className="ring outer">
        <circle r="92" /><circle r="80" />
        {[...runes].map((ch, i) => { const a = (i / runes.length) * Math.PI * 2; return <text key={i} x={Math.cos(a) * 86} y={Math.sin(a) * 86 + 3} transform={`rotate(${(a * 180) / Math.PI + 90} ${Math.cos(a) * 86} ${Math.sin(a) * 86})`}>{ch}</text>; })}
      </g>
      <g className="ring inner">
        <circle r="62" /><polygon points={[0, 1, 2, 3, 4].map((k) => { const a = (k * 4 * Math.PI) / 5 - Math.PI / 2; return `${Math.cos(a) * 60},${Math.sin(a) * 60}`; }).join(' ')} />
        <circle r="24" />
      </g>
    </svg>
  );
}

/** Activated abilities a player can use now (for the Abilities list on the table). */
export function abilityList(s: GameState, p: PlayerId): { src: Source; fx: number; name: string; label: string; ok: boolean; why: string; on: Trigger }[] {
  const out: { src: Source; fx: number; name: string; label: string; ok: boolean; why: string; on: Trigger }[] = [];
  const srcs: { src: Source; inst: string }[] = [
    ...Object.values(s.units).filter((u) => u.owner === p).map((u) => ({ src: { unit: u.id } as Source, inst: u.inst })),
    ...s.perms.filter((m) => m.owner === p).map((m) => ({ src: { perm: m.id } as Source, inst: m.inst })),
    ...s.sites.map((st, c) => (st?.inst && st.owner === p ? { src: { site: c } as Source, inst: st.inst } : null)).filter((x): x is { src: Source; inst: string } => !!x),
  ];
  for (const { src, inst } of srcs) {
    const d = cardOf(s, inst); const seen = new Set<string>();
    d.effects.forEach((e, i) => {
      if (e.on !== 'tap' && e.on !== 'activated') return;
      const key = `${e.on}:${e.line ?? i}`; if (seen.has(key)) return; seen.add(key);
      const idx = effectsOn(d, e.on, i); const so = sourceOf(s, src)!;
      const ch: Choice[] = [];
      for (const k of idx) {
        const t = targetsFor(s, p, d, k, [so.loc], so.unit?.id); if (t.length) ch[k] = { target: t[0] };
        const cl = cellsFor(s, d, k, [so.loc]); if (cl.length) ch[k] = { ...(ch[k] ?? {}), cell: cl[0] };
        if (d.effects[k].op === 'shoot') { const dv = shotDirs(s, p, so.loc); if (dv.length) ch[k] = { ...(ch[k] ?? {}), dir: dv[0] }; }
      }
      const r = check(s, { t: 'ability', src, fx: i, choices: ch });
      out.push({ src, fx: i, name: d.name, label: idx.map((k) => describe(d.effects[k])).join(' · '), ok: r.ok, why: r.ok ? '' : r.reason, on: e.on });
    });
  }
  return out;
}
