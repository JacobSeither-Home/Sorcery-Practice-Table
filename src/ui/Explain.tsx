// "How this card works": what the table does with each part of a card, and the rule terms it uses,
// each with a short reminder and a link to its Codex entry. Collapsed until the player opens it.
import { useState } from 'react';
import { type CardDef, type Effect, type Trigger, explainTerms } from '../engine';
import { TRIGGER_SHORT, describe } from './abilityText';

const WHEN: Record<Trigger, string> = {
  cast: 'Happens when you cast it.',
  genesis: 'Genesis: happens once, as it enters the realm.',
  deathrite: 'Deathrite: happens when it dies.',
  tap: 'Tap ability: use it on your turn by tapping the card (✦ Abilities). Minions that arrived this turn cannot tap unless they have Charge.',
  activated: 'Activated ability: use it on your turn from ✦ Abilities, once per turn unless the card says otherwise.',
  startTurn: 'Happens at the start of your turn, after your cards untap.',
  endTurn: 'Happens at the end of your turn, before damage clears.',
  static: 'Always on while the card is in the realm.',
  dies: 'Reaction: happens on its own whenever a unit it watches dies.',
  damaged: 'Reaction: happens on its own whenever this takes damage.',
  attacks: 'Reaction: happens on its own whenever this attacks.',
  enters: 'Reaction: happens on its own whenever a unit it watches enters its location.',
  kills: 'Reaction: happens on its own whenever this kills a unit (the unit that struck or dealt the damage gets the kill).',
  casts: 'Reaction: happens on its own whenever the spellcaster it watches casts a spell.',
  stops: 'Reaction: happens on its own when it, or the unit carrying it, ends a move.',
};

/** One line per ability group, saying what the table does with it. */
function lines(card: CardDef): { on: Trigger; parts: Effect[] }[] {
  const out: { on: Trigger; parts: Effect[] }[] = [];
  card.effects.forEach((e, i) => {
    const key = e.line ?? i; const last = out[out.length - 1];
    if (last && last.on === e.on && (last.parts[0].line ?? -1) === key) last.parts.push(e); else out.push({ on: e.on, parts: [e] });
  });
  return out;
}

export function HowItWorks({ card, open: start = false }: { card: CardDef; open?: boolean }) {
  const [open, setOpen] = useState(start);
  const terms = explainTerms(card.rules, card.keywords);
  const groups = lines(card);
  if (!groups.length && !terms.length) return null;
  return (
    <div className={`howto ${open ? 'open' : ''}`}>
      <button className="ghost howto-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} How this card works</button>
      {open && <>
        {groups.length > 0 && <ul className="howto-lines">{groups.map((g, i) => (
          <li key={i}>
            <span className="trig">{TRIGGER_SHORT[g.on]}</span> <span className="when">{WHEN[g.on]}</span>
            {g.parts.map((e, j) => <p key={j} className={e.op === 'manual' ? 'by-hand' : 'auto'}>
              {e.op === 'manual'
                ? <>✋ “{e.text}” — the table does not do this automatically. The cast pop-up opens the hand tools so you can do it yourself; the change is marked in the log.</>
                : <>✓ {describe(e)}{e.cost ? `, costs ${e.cost} mana` : ''}{e.optional ? ' (optional: you can skip it in the pop-up)' : ''} — the table does this for you{e.who === 'target' || e.x || (e.op === 'draw' && !e.deck) ? ' after you choose' : ''}.</>}
            </p>)}
          </li>
        ))}</ul>}
        {terms.length > 0 && <dl className="howto-terms">{terms.map((t) => (
          <div key={t.term}><dt><a href={t.url} target="_blank" rel="noreferrer" data-tip="Opens the Codex entry on sorcerytcg.com">{t.term} ↗</a></dt><dd>{t.text}</dd></div>
        ))}</dl>}
        <p className="fineprint">Reminders are in our own words. The Codex links are the official rules.</p>
      </>}
    </div>
  );
}
