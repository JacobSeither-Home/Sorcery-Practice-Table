import { useEffect, useMemo, useRef, useState } from 'react';
import { type CardDef, type CardType, type Coverage, type DeckList, type Effect, ELEMENTS, KEYWORD_HELP, codexUrl, KEYWORDS as KW_ALL, TRIGGERS, effectsFromText, makeCard } from '../engine';
import { OP_LABEL, TRIGGER_LABEL, WHO_LABEL, whoFor } from './abilityText';
import { claudePrompt, coverage, download as downloadFile, cardsCsv, coverageMarkdown, pickCardFolder, rememberedCardFolder, reportGaps, saveToCardFolder, supportsSaveFolder } from '../data/coverage';
import type { Difficulty } from '../ai/ai';
import { type Mode, allDecks, isBuiltIn, useStore } from '../store';
import { resolveOfficial } from '../data/officialDecks';
import { CARDS_URL, type SyncDiff, diffCards, fetchCards } from '../data/cardSync';
import { type ArtReport, OFFICIAL_ART_FOLDER, orderVariants, variantBlob, variantLabel, fromFileList, importArt, importZips, pickFolder, pickZips, rememberedFolder, rememberedZips, supportsFilePicker, supportsFolderPicker } from '../data/artSync';
import { artDb } from '../data/db';
import { COLLECTION_MAX, RARITIES, RARITY_LIMIT, constructedLegal, copiesOf, copyLimit, deckChecks, parseDeckText, playable } from '../data/decks';
import { type FeedbackItem, exportJson, loadLocal, pushPending, recentErrors, submit } from '../feedback/feedback';
import { CardFace, STATUS_CARDS, hoverProps } from './CardFace';
import { type AccessRow, LOCAL_ONLY, addAccess, feedbackRemote, listAccess, removeAccess, uploadCatalog, useAuth } from '../cloud/cloud';
import { Preview, TableOptions } from './Table';

declare const __APP_VERSION__: string;
const DIFF: { id: Difficulty; name: string; note: string }[] = [
  { id: 'easy', name: 'Easy', note: 'Mostly random legal moves.' },
  { id: 'medium', name: 'Medium', note: 'Picks the move that looks best right now.' },
  { id: 'hard', name: 'Hard', note: 'Looks ahead by simulating turns. Never sees your hand.' },
];

// ---------------------------------------------------------------- setup
export function Setup() {
  const { pool, decks, newGame, host, join, online, leave, syncedAt, art, setView } = useStore();
  const all = allDecks(decks, pool).filter((d) => playable(d, pool));
  const [mode, setMode] = useState<Mode>('ai');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [a, setA] = useState(all[0]?.name ?? ''); const [b, setB] = useState(all[1]?.name ?? all[0]?.name ?? '');
  const [code, setCode] = useState('');
  const deck = (n: string) => all.find((d) => d.name === n) ?? all[0];
  const apiCount = Object.values(pool).filter((c) => c.source === 'api').length;
  const Pick = ({ label, value, on }: { label: string; value: string; on: (v: string) => void }) => (
    <label className="field"><span>{label}</span><select value={value} onChange={(e) => on(e.target.value)}>{all.map((d) => <option key={d.name}>{d.name}</option>)}</select></label>
  );
  return (
    <div className="page setup">
      <section className="hero">
        <h1>Sorcery Practice Table</h1>
        <p className="lede">A table for learning Sorcery: Contested Realm. It enforces the core rules, shows which moves are legal, and says why a move is not.</p>
        <p className="status">
          {apiCount ? <>Card pool: {apiCount} cards, synced {new Date(syncedAt!).toLocaleDateString()}.</> : <>No Sorcery cards synced yet.</>}{' '}
          {Object.keys(art).length ? `Art cached for ${Object.keys(art).length} cards.` : 'No art loaded.'}{' '}
          <button className="link" onClick={() => setView('settings')}>Card Sync and Art Sync are in Settings</button>
        </p>
      </section>
      {!all.length ? (
        <section className="panel newgame">
          <h2>No decks to play with yet</h2>
          <p>{apiCount ? 'Your cards are synced. A game needs a deck for each side: an Avatar, at least 10 spells and 6 sites.' : 'A game needs cards and a deck for each side. Card Sync brings in the cards; decks are built or imported after that.'}</p>
          <div className="row">{!apiCount && <button className="primary big" onClick={() => setView('settings')}>Open Card Sync</button>}<button className={apiCount ? 'primary big' : 'big'} onClick={() => setView('decks')}>Open Decks</button></div>
        </section>
      ) : (
      <section className="panel newgame">
        <div className="seg" role="tablist">
          {([['ai', 'Against the AI'], ['hotseat', 'Two players, one screen'], ['online', 'Online with a friend']] as [Mode, string][]).map(([m, n]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); if (m !== 'online') leave(); }}>{n}</button>
          ))}
        </div>
        {mode === 'ai' && (<>
          <div className="diffs">{DIFF.map((d) => <button key={d.id} className={difficulty === d.id ? 'diff on' : 'diff'} onClick={() => setDifficulty(d.id)}><b>{d.name}</b><small>{d.note}</small></button>)}</div>
          <div className="cols"><Pick label="Your deck" value={a} on={setA} /><Pick label="AI deck" value={b} on={setB} /></div>
          <button className="primary big" onClick={() => newGame('ai', [deck(a), deck(b)], difficulty)}>Start game</button>
        </>)}
        {mode === 'hotseat' && (<>
          <div className="cols"><Pick label="Player 1 deck" value={a} on={setA} /><Pick label="Player 2 deck" value={b} on={setB} /></div>
          <p className="note">Hands are hidden while the device changes hands.</p>
          <button className="primary big" onClick={() => newGame('hotseat', [deck(a), deck(b)], difficulty)}>Start game</button>
        </>)}
        {mode === 'online' && (<>
          <Pick label="Your deck" value={a} on={setA} />
          {!online || online.status === 'closed' ? (
            <div className="cols">
              <div><button className="primary big" onClick={() => host(deck(a))}>Host a game</button><p className="note">You get a room code to send to your friend.</p></div>
              <div><label className="field"><span>Room code</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. K7M2Q" maxLength={8} /></label>
                <button className="big" disabled={code.trim().length < 4} onClick={() => join(code, deck(a))}>Join</button></div>
            </div>
          ) : (
            <div className="room">
              {online.role === 'host' && <p>Room code <strong className="code">{online.code}</strong></p>}
              <p>{online.note}</p><button onClick={leave}>Cancel</button>
            </div>
          )}
          {online?.status === 'closed' && <p className="note warn">{online.note}</p>}
          <p className="note">The two browsers connect directly. Only deck lists, the shuffle seed and moves are sent; art never is. Both players need the same card pool synced.</p>
        </>)}
      </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- shared card search
function useSearch(pool: Record<string, CardDef>, types?: CardType[]) {
  const [q, setQ] = useState(''); const [type, setType] = useState<string>(''); const [rarity, setRarity] = useState<string>('');
  const zoom = useStore((s) => s.settings.zoom ?? 1); const setSettings = useStore((s) => s.setSettings);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return Object.values(pool).filter((c) => (!types || types.includes(c.type)) && (!type || c.type === type) && (!rarity || c.rarity === rarity) && (!k || c.name.toLowerCase().includes(k) || c.rules.toLowerCase().includes(k) || c.subtypes.join(' ').toLowerCase().includes(k)))
      .sort((x, y) => x.name.localeCompare(y.name));
  }, [pool, q, type, rarity]);
  const bar = (
    <div className="searchbar">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, rules text or subtype" aria-label="Search cards" />
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Card type"><option value="">All types</option>{['Avatar', 'Site', 'Minion', 'Magic', 'Aura', 'Artifact'].map((t) => <option key={t}>{t}</option>)}</select>
      <select value={rarity} onChange={(e) => setRarity(e.target.value)} aria-label="Rarity"><option value="">All rarities</option>{RARITIES.map((r) => <option key={r} value={r}>{r} (up to {RARITY_LIMIT[r]})</option>)}</select>
      <label className="zoom" data-tip="Card size"><span aria-hidden>−</span><input type="range" min={0.6} max={3} step={0.1} value={zoom} onChange={(e) => setSettings({ zoom: Number(e.target.value) })} aria-label="Card size" /><span aria-hidden>+</span></label>
      <span className="count">{list.length.toLocaleString()} cards</span>
    </div>
  );
  return { list, bar, zoom };
}

// ---------------------------------------------------------------- decks
export function Decks() {
  const { pool, decks, saveDeck, deleteDeck, toast } = useStore();
  const [cur, setCur] = useState<DeckList | null>(null); const [orig, setOrig] = useState<string | undefined>();
  const [paste, setPaste] = useState('');
  const { list, bar, zoom } = useSearch(pool);
  const count = (id: string) => (cur ? copiesOf(cur, id) : 0);
  const [dest, setDest] = useState<'deck' | 'collection'>('deck');
  /** Adding respects the copy limit for the card's rarity, counted across spellbook, atlas and collection. */
  const add = (c: CardDef) => {
    if (!cur) return;
    if (c.type === 'Avatar') { if (dest === 'collection') toast('An Avatar cannot go in the collection.', 'error'); else setCur({ ...cur, avatar: c.id }); return; }
    const lim = copyLimit(c);
    if (count(c.id) >= lim) { toast(`${c.name} is ${c.rarity ?? 'unrated'}: a deck may hold ${lim} cop${lim === 1 ? 'y' : 'ies'}, counting the collection.`, 'error'); return; }
    if (dest === 'collection') {
      if ((cur.collection?.length ?? 0) >= COLLECTION_MAX) { toast(`The collection holds at most ${COLLECTION_MAX} cards.`, 'error'); return; }
      setCur({ ...cur, collection: [...(cur.collection ?? []), c.id] });
    } else setCur(c.type === 'Site' ? { ...cur, atlas: [...cur.atlas, c.id] } : { ...cur, spellbook: [...cur.spellbook, c.id] });
  };
  const drop = (id: string, where: 'spellbook' | 'atlas' | 'collection') => { if (!cur) return; const a = (cur[where] ?? []).slice(); a.splice(a.lastIndexOf(id), 1); setCur({ ...cur, [where]: a }); };
  const move = (id: string, from: 'spellbook' | 'atlas' | 'collection') => {
    if (!cur) return; const c = pool[id]; const a = (cur[from] ?? []).slice(); a.splice(a.lastIndexOf(id), 1);
    if (from === 'collection') setCur({ ...cur, collection: a, ...(c?.type === 'Site' ? { atlas: [...cur.atlas, id] } : { spellbook: [...cur.spellbook, id] }) });
    else if ((cur.collection?.length ?? 0) >= COLLECTION_MAX) toast(`The collection holds at most ${COLLECTION_MAX} cards.`, 'error');
    else setCur({ ...cur, [from]: a, collection: [...(cur.collection ?? []), id] });
  };
  const group = (ids: string[]) => [...new Set(ids)].map((id) => ({ id, n: ids.filter((x) => x === id).length, c: pool[id] })).sort((x, y) => (x.c?.cost ?? 0) - (y.c?.cost ?? 0) || (x.c?.name ?? '').localeCompare(y.c?.name ?? ''));
  if (!cur) return (
    <div className="page">
      <h1>Decks</h1>
      <div className="decklist">
        {!allDecks(decks, pool).length && <p className="banner">No decks yet. Build one from your card pool or import a list below.</p>}
        {resolveOfficial(pool).filter((r) => r.missing.length).map((r) => (
          <div key={r.deck.name} className="panel deckrow"><div><b>{r.deck.name}</b><small>{r.product}, official precon. Not playable yet: {r.missing.length} card name{r.missing.length > 1 ? 's are' : ' is'} not in your card pool ({r.missing.slice(0, 4).join(', ')}{r.missing.length > 4 ? '…' : ''}). A Card Sync usually fixes this.</small></div></div>
        ))}
        {allDecks(decks, pool).map((d) => (
          <div key={d.name} className="panel deckrow">
            <div><b>{d.name}</b><small>{pool[d.avatar]?.name ?? 'No avatar'}, {d.spellbook.length} spells, {d.atlas.length} sites{d.collection?.length ? `, ${d.collection.length} in collection` : ''}{isBuiltIn(d.name) ? ', official precon' : ''}</small></div>
            <span className={`legal ${constructedLegal(d, pool) ? 'ok' : ''}`} data-tip={deckChecks(d, pool).filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`).join('. ') || 'Meets every constructed-format check'}>{constructedLegal(d, pool) ? 'Constructed-legal' : `${deckChecks(d, pool).filter((c) => !c.ok).length} to fix for constructed`}</span>
            <span className="row">
              {isBuiltIn(d.name) ? <button onClick={() => { setCur({ ...d, name: d.name + ' (copy)' }); setOrig(undefined); }}>Copy and edit</button>
                : <><button onClick={() => { setCur(d); setOrig(d.name); }}>Edit</button><button onClick={() => confirm(`Delete "${d.name}"?`) && deleteDeck(d.name)}>Delete</button></>}
            </span>
          </div>
        ))}
      </div>
      <div className="row"><button className="primary" onClick={() => { setCur({ name: 'New deck', avatar: '', spellbook: [], atlas: [] }); setOrig(undefined); }}>New deck</button></div>
      <section className="panel">
        <h2>Import a list</h2>
        <p><a className="btnlink" href="https://curiosa.io/precons" target="_blank" rel="noreferrer">Official precon deck lists</a><a className="btnlink quiet" href="https://curiosa.io/decks" target="_blank" rel="noreferrer">Browse decks on Curiosa</a> Both open Curiosa.io, Erik's Curiosa's deck site, in a new tab. Copy a deck's card list there and paste it below.</p>
        <p className="note">Paste one card per line, like "4 Card Name". Names must match cards in your pool. This app does not fetch from Curiosa itself.</p>
        <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'1 Avatar Name\n4 Card Name\n3 Another Card'} />
        <div className="row"><button disabled={!paste.trim()} onClick={() => { const r = parseDeckText(paste, pool, 'Imported deck'); setCur(r.deck); setOrig(undefined); if (r.unknown.length) toast(`Not in your card pool: ${r.unknown.slice(0, 8).join(', ')}${r.unknown.length > 8 ? '…' : ''}`, 'error'); }}>Import</button></div>
      </section>
    </div>
  );
  return (
    <div className="page builder">
      <div className="builder-main">
        <div className="row head"><input className="title" value={cur.name} onChange={(e) => setCur({ ...cur, name: e.target.value })} aria-label="Deck name" />
          <button onClick={() => setCur(null)}>Cancel</button>
          <button className="primary" disabled={!cur.name.trim() || isBuiltIn(cur.name)} onClick={() => { saveDeck(cur, orig); setCur(null); toast('Deck saved.'); }}>Save deck</button></div>
        <div className="row addto">
          <span>Clicking a card adds it to</span>
          <div className="seg small" role="tablist"><button role="tab" aria-selected={dest === 'deck'} className={dest === 'deck' ? 'on' : ''} onClick={() => setDest('deck')}>the deck</button><button role="tab" aria-selected={dest === 'collection'} className={dest === 'collection' ? 'on' : ''} onClick={() => setDest('collection')}>the collection ({cur.collection?.length ?? 0}/{COLLECTION_MAX})</button></div>
        </div>
        {bar}
        <div className="grid" style={{ '--zoom': zoom } as React.CSSProperties}>{list.map((c) => {
          const n = count(c.id), lim = copyLimit(c), isAvatar = c.type === 'Avatar';
          return (
            <button key={c.id} className={`gridcard ${!isAvatar && n >= lim ? 'maxed' : ''}`} onClick={() => add(c)} {...hoverProps(c)} aria-label={`${c.name}, ${c.rarity ?? 'no rarity'}${isAvatar ? '' : `, ${n} of ${lim} in deck`}`}>
              <CardFace card={c} size="sm" />
              {!isAvatar && <span className={`rar rar-${c.rarity ?? 'none'}`} data-tip={`${c.rarity ?? 'No rarity'}: up to ${lim} cop${lim === 1 ? 'y' : 'ies'}`}>{(c.rarity ?? '?')[0]}{c.rarity === 'Elite' ? 'l' : c.rarity === 'Exceptional' ? 'x' : ''}</span>}
              {!isAvatar && n > 0 && <span className="n">{n}/{lim}</span>}{cur.avatar === c.id && <span className="n">✓</span>}
            </button>
          );
        })}</div>
      </div>
      <aside className="builder-side">
        <Preview />
        <h3>Avatar</h3><p>{pool[cur.avatar]?.name ?? <em>Click an Avatar card to choose it</em>}</p>
        {([['spellbook', 'Spellbook'], ['atlas', 'Atlas'], ['collection', 'Collection']] as const).map(([w, title]) => {
          const ids = cur[w] ?? [];
          return (<div key={w}>
            <h3>{title} ({ids.length}{w === 'spellbook' ? ' of 60 or more' : w === 'atlas' ? ' of 30 or more' : ` of up to ${COLLECTION_MAX}`})</h3>
            {w === 'collection' && <p className="note">Cards outside your decks that some cards fetch ("… from your collection"). They count toward each card's copy limit here. <a href={codexUrl('Collection')} target="_blank" rel="noreferrer">Collection in the Codex ↗</a></p>}
            <ul className="decklines">{group(ids).map((x) => { const all = count(x.id), lim = copyLimit(x.c); return (
              <li key={x.id} {...hoverProps(x.c)} className={all > lim ? 'over' : ''}>
                <span><i className={`rar rar-${x.c?.rarity ?? 'none'}`} data-tip={`${x.c?.rarity ?? 'No rarity'}: up to ${lim}`}>{(x.c?.rarity ?? '?')[0]}</i> {x.n}× {x.c?.name ?? x.id}{all > lim ? ` (${all}/${lim})` : ''}</span>
                <span className="row tight"><button onClick={() => move(x.id, w)} data-tip={w === 'collection' ? 'Move one into the deck' : 'Move one to the collection'} aria-label={w === 'collection' ? 'Move one into the deck' : 'Move one to the collection'}>{w === 'collection' ? '↑' : '↓'}</button><button onClick={() => drop(x.id, w)} aria-label="Remove one">−</button></span>
              </li>); })}</ul>
            {!ids.length && <p className="note">{w === 'collection' ? 'Empty. Switch "adds it to" above to the collection, or use ↓ on a card in the deck.' : 'Empty.'}</p>}
          </div>);
        })}
        <div className="checks"><h3>Constructed format</h3>
          <ul>{deckChecks(cur, pool).map((c) => <li key={c.label} className={c.ok ? 'ok' : 'bad'}><b>{c.ok ? '✓' : '✗'} {c.label}</b><small>{c.detail}</small></li>)}</ul>
          <p className="note">These don't block games here. A deck needs an Avatar, 10 spells and 6 sites to be playable on this table; the collection is not used during play yet.</p>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- library
const OPS = Object.keys(OP_LABEL) as Effect['op'][];
const KEYWORDS = Object.keys(KEYWORD_HELP).filter((k) => k !== 'Threshold');
const blank = (): CardDef => makeCard({ name: '', type: 'Minion', cost: 1, attack: 1, defense: 1, source: 'custom' });

export function Library() {
  const { pool, setOverlay, saveCustom, deleteCustom, toast } = useStore();
  const { list, bar, zoom } = useSearch(pool);
  const [id, setId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CardDef | null>(null);
  const card = id ? pool[id] : null;
  const setFx = (fx: Effect[]) => card && setOverlay(card.id, fx);
  const num = (v: string) => Math.max(0, parseInt(v || '0', 10) || 0);
  return (
    <div className="page builder">
      <div className="builder-main">
        <div className="row head"><h1>Card library</h1><span className="count">{Object.values(pool).filter((c) => c.source === 'api').length.toLocaleString()} synced, {Object.values(pool).filter((c) => c.source === 'custom').length} custom</span><button className="primary" onClick={() => { setDraft(blank()); setId(null); }}>Add a card</button></div>
        {bar}
        {!Object.values(pool).some((c) => c.source === 'api') && <p className="banner">No cards yet. Sorcery cards appear after a Card Sync in Settings.</p>}
        <CoveragePanel pick={(cid) => { setId(cid); setDraft(null); }} />
        <div className="grid" style={{ '--zoom': zoom } as React.CSSProperties}>{list.map((c) => <button key={c.id} className={`gridcard ${id === c.id ? 'on' : ''}`} onClick={() => { setId(c.id); setDraft(null); }} {...hoverProps(c)}><CardFace card={c} size="sm" />{c.effects.length > 0 && <span className="n" data-tip="Has automated effects">⚙</span>}</button>)}</div>
      </div>
      <aside className="builder-side">
        {draft ? (
          <form className="cardform" onSubmit={(e) => { e.preventDefault(); if (!draft.name.trim()) return; const c = makeCard({ ...draft, id: draft.id && draft.id.startsWith('custom:') ? draft.id : 'custom:' + draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), slug: undefined, movement: undefined, ranged: undefined, source: 'custom' }); saveCustom(c); setDraft(null); setId(c.id); toast(`${c.name} saved to your library.`); }}>
            <h2>{draft.id.startsWith('custom:') ? 'Edit card' : 'New card'}</h2>
            <label className="field"><span>Name</span><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
            <div className="cols">
              <label className="field"><span>Type</span><select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as CardType })}>{['Minion', 'Magic', 'Aura', 'Artifact', 'Site', 'Avatar'].map((t) => <option key={t}>{t}</option>)}</select></label>
              <label className="field"><span>Rarity</span><select value={draft.rarity ?? 'Ordinary'} onChange={(e) => setDraft({ ...draft, rarity: e.target.value })}>{['Ordinary', 'Exceptional', 'Elite', 'Unique'].map((t) => <option key={t}>{t}</option>)}</select></label>
            </div>
            <div className="cols four">
              <label className="field"><span>Cost</span><input type="number" min={0} value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: num(e.target.value) })} /></label>
              <label className="field"><span>Attack</span><input type="number" min={0} value={draft.attack} onChange={(e) => setDraft({ ...draft, attack: num(e.target.value) })} /></label>
              <label className="field"><span>Defense</span><input type="number" min={0} value={draft.defense} onChange={(e) => setDraft({ ...draft, defense: num(e.target.value) })} /></label>
              <label className="field"><span>Life</span><input type="number" min={0} value={draft.life} onChange={(e) => setDraft({ ...draft, life: num(e.target.value) })} /></label>
            </div>
            <div className="cols four">{ELEMENTS.map((el) => <label key={el} className="field"><span><i className={`pip ${el}`} /> {el}</span><input type="number" min={0} max={9} value={draft.thresholds[el]} onChange={(e) => setDraft({ ...draft, thresholds: { ...draft.thresholds, [el]: num(e.target.value) } })} /></label>)}</div>
            <p className="note">For a site, the element numbers are what it provides. For anything else, they are the threshold it needs.</p>
            <fieldset><legend>Keywords</legend><div className="chips">{KEYWORDS.map((k) => <button type="button" key={k} className={draft.keywords.includes(k) ? 'chip on' : 'chip'} data-tip={KEYWORD_HELP[k].text} onClick={() => setDraft({ ...draft, keywords: draft.keywords.includes(k) ? draft.keywords.filter((x) => x !== k) : [...draft.keywords, k] })}>{k}</button>)}</div></fieldset>
            <label className="field"><span>Rules text (write "Movement +2" or "Ranged 2" here to set the number)</span><textarea rows={3} value={draft.rules} onChange={(e) => setDraft({ ...draft, rules: e.target.value })} /></label>
            <div className="row"><button type="button" onClick={() => setDraft(null)}>Cancel</button><button className="primary" type="submit">Save card</button></div>
          </form>
        ) : card ? (<>
          <Preview />
          <div className="row"><b>{card.name}</b>{card.source === 'custom' && <><button onClick={() => setDraft(card)}>Edit</button><button onClick={() => { if (confirm(`Delete ${card.name}?`)) { deleteCustom(card.id); setId(null); } }}>Delete</button></>}</div>
          <ArtChooser card={card} />
          <h3>Automated effects</h3>
          <p className="note">Keywords run on their own. Each sentence of the card text the reader knows becomes an effect below; sentences it does not know are marked “by hand” and the cast pop-up offers the hand tools for them. Changes here apply to every copy of this card.</p>
          {(<>
            {card.effects.map((fx, i) => {
              const up = (p: Partial<Effect>) => setFx(card.effects.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div key={i} className={`fx ${fx.op === 'manual' ? 'by-hand' : ''}`}>
                  {fx.text && <p className="fx-src">“{fx.text}”</p>}
                  <select value={fx.on} onChange={(e) => up({ on: e.target.value as Effect['on'] })} aria-label="When">{TRIGGERS.map((t) => <option key={t} value={t}>{TRIGGER_LABEL[t]}</option>)}</select>
                  <select value={fx.op} onChange={(e) => { const op = e.target.value as Effect['op']; up({ op, who: whoFor(op).includes(fx.who) ? fx.who : whoFor(op)[0], ...(op === 'grant' && !fx.keyword ? { keyword: 'Airborne' } : {}), ...(op === 'buff' && fx.atk === undefined ? { atk: 1, def: 1 } : {}) }); }} aria-label="Effect">{OPS.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select>
                  {['damage', 'heal', 'loseLife', 'draw', 'mana', 'discard'].includes(fx.op) && (fx.x ? <button onClick={() => up({ x: false, n: 1 })} data-tip="The player picks the number when it resolves">X</button> : <input type="number" min={1} value={fx.n ?? 1} onChange={(e) => up({ n: Math.max(1, num(e.target.value)) })} aria-label="Amount" />)}
                  {fx.op === 'buff' && <input type="number" value={fx.atk ?? 0} onChange={(e) => up({ atk: parseInt(e.target.value || '0', 10) || 0, def: parseInt(e.target.value || '0', 10) || 0 })} aria-label="Power change" />}
                  {fx.op === 'grant' && <select value={fx.keyword ?? 'Airborne'} onChange={(e) => up({ keyword: e.target.value })} aria-label="Keyword">{KW_ALL.map((k) => <option key={k}>{k}</option>)}</select>}
                  {fx.op !== 'manual' && whoFor(fx.op).length > 1 && <select value={fx.who} onChange={(e) => up({ who: e.target.value as Effect['who'] })} aria-label="Applies to">{whoFor(fx.op).map((w) => <option key={w} value={w}>{WHO_LABEL[w]}</option>)}</select>}
                  {fx.who === 'target' && <select value={fx.range ?? 'any'} onChange={(e) => up({ range: e.target.value as Effect['range'] })} aria-label="Range"><option value="here">here</option><option value="adjacent">adjacent</option><option value="nearby">nearby</option><option value="any">anywhere</option></select>}
                  {fx.who === 'target' && <select value={fx.only ?? ''} onChange={(e) => up({ only: (e.target.value || undefined) as Effect['only'] })} aria-label="Which units"><option value="">any unit</option><option value="minion">minions</option><option value="enemy">enemies</option><option value="ally">allies</option><option value="enemyMinion">enemy minions</option><option value="allyMinion">allied minions</option><option value="avatar">Avatars</option></select>}
                  {(fx.op === 'buff' || fx.op === 'grant') && fx.on !== 'static' && <select value={fx.until ?? 'permanent'} onChange={(e) => up({ until: e.target.value as Effect['until'] })} aria-label="How long"><option value="turn">this turn</option><option value="permanent">until it leaves</option></select>}
                  {fx.op === 'draw' && <select value={fx.deck ?? ''} onChange={(e) => up({ deck: (e.target.value || undefined) as Effect['deck'] })} aria-label="Deck"><option value="spellbook">from spellbook</option><option value="atlas">from atlas</option><option value="">player chooses</option></select>}
                  {(fx.on === 'tap' || fx.on === 'activated') && <input type="number" min={0} value={fx.cost ?? 0} onChange={(e) => up({ cost: num(e.target.value) || undefined })} aria-label="Mana cost" data-tip="Mana paid to use it" />}
                  <button onClick={() => setFx(card.effects.filter((_, j) => j !== i))} aria-label="Remove effect">×</button>
                </div>
              );
            })}
            <div className="row">
              <button onClick={() => setFx([...card.effects, { on: card.type === 'Magic' ? 'cast' : 'genesis', op: 'damage', n: 1, who: 'target', range: 'nearby' }])}>Add an effect</button>
              <button className="ghost" onClick={() => setFx(effectsFromText(card.type, card.rules, card.name))} data-tip="Throw away hand-made changes and read the card text again">Read from card text</button>
            </div>
          </>)}
        </>) : <><Preview /><p className="note">Select a card to see it and set up automated effects, or add a card of your own.</p></>}
      </aside>
    </div>
  );
}

const STATUS_LABEL: Record<Coverage, string> = { auto: 'Automated', plain: 'Keywords only', partial: 'Partly automated', manual: 'By hand' };
/** What the rules engine does with each card, organized by ability type. */
function CoveragePanel({ pick }: { pick: (id: string) => void }) {
  const pool = useStore((s) => s.pool);
  const rep = useMemo(() => coverage(pool), [pool]);
  const [status, setStatus] = useState<Coverage | ''>(''); const [cat, setCat] = useState('');
  if (!rep.total) return null;
  const list = rep.cards.filter((c) => (!status || c.status === status) && (!cat || c.categories.includes(cat as never)));
  return (
    <details className="panel coverage">
      <summary><b>Rules coverage</b> — {rep.counts.auto + rep.counts.plain} of {rep.total} cards fully automated, {rep.counts.partial} partly, {rep.counts.manual} by hand</summary>
      <div className="chips">{(Object.keys(STATUS_LABEL) as Coverage[]).map((k) => <button key={k} className={status === k ? 'chip on' : 'chip'} onClick={() => setStatus(status === k ? '' : k)}>{STATUS_LABEL[k]} {rep.counts[k]}</button>)}</div>
      <table className="covtable"><thead><tr><th>Ability type</th><th>Automated</th><th>By hand</th></tr></thead><tbody>
        {rep.byCategory.map((c) => <tr key={c.category} className={cat === c.category ? 'on' : ''} onClick={() => setCat(cat === c.category ? '' : c.category)}><td>{c.category}</td><td>{c.auto}</td><td>{c.manual}</td></tr>)}
      </tbody></table>
      {rep.shapes.length > 0 && <details><summary>Most common sentences not automated yet ({rep.shapes.length})</summary><ol className="shapes">{rep.shapes.slice(0, 40).map((x) => <li key={x.shape}><b>{x.count}×</b> {x.shape} <small>{x.category} · {x.examples.join(', ')}</small></li>)}</ol></details>}
      <p className="names">{list.slice(0, 300).map((c, i) => <span key={c.id}>{i > 0 && ', '}<button className="link" onClick={() => pick(c.id)} data-tip={c.manual.join(' ') || STATUS_LABEL[c.status]}>{c.name}</button></span>)}{list.length > 300 ? ` … and ${list.length - 300} more` : ''}</p>
      <div className="row"><button className="ghost" onClick={() => { navigator.clipboard?.writeText(claudePrompt(rep, [], !LOCAL_ONLY && useAuth.getState().member)); useStore.getState().toast('Claude Code prompt copied.'); }}>Copy a Claude Code prompt for the open cards</button></div>
    </details>
  );
}

function ArtChooser({ card }: { card: CardDef }) {
  const variants = useStore((s) => s.artVariants[card.id]); const choice = useStore((s) => s.settings.artChoice?.[card.id]); const chooseArt = useStore((s) => s.chooseArt);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const ordered = useMemo(() => orderVariants(card, variants ?? []), [card, variants]);
  useEffect(() => {
    let live = true; const made: string[] = [];
    (async () => { const out: Record<string, string> = {}; for (const v of ordered) { const b = await variantBlob(card.id, v); if (b) { out[v] = URL.createObjectURL(b); made.push(out[v]); } } if (live) setUrls(out); })();
    return () => { live = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [card.id, ordered]);
  if (!variants?.length) return <p className="note">No art cached for this card on this device.</p>;
  if (variants.length === 1) return null;
  const current = ordered.includes(choice ?? '') ? choice : ordered[0];
  return (<>
    <h3>Art ({variants.length} images)</h3>
    <div className="artpick">{ordered.map((v) => (
      <button key={v} className={`${v === current ? 'on' : ''} ${card.type === 'Site' ? 'wide' : ''}`} onClick={() => chooseArt(card.id, v)} data-tip={variantLabel(card, v) + (v === ordered[0] ? ' (default)' : '')} aria-pressed={v === current}>
        {urls[v] ? <img src={urls[v]} alt={variantLabel(card, v)} /> : <span>…</span>}
      </button>
    ))}</div>
    <p className="note">The chosen image is used for this card everywhere on the table. The choice is saved to your account; the images themselves stay on each device.</p>
  </>);
}

// ---------------------------------------------------------------- settings
export function Settings() {
  const st = useStore();
  const { pool, apiRaw, syncedAt, settings, setSettings, toast } = st;
  const apiCards = useMemo(() => Object.values(pool).filter((c) => c.source === 'api'), [pool]);
  // card sync
  const [busy, setBusy] = useState(''); const [diff, setDiff] = useState<{ d: SyncDiff; raw: unknown } | null>(null); const [err, setErr] = useState('');
  // Sync shows what changed and saves in the same step, so nothing is lost by leaving the page.
  const stage = async (raw: unknown) => {
    const d = diffCards(apiRaw, raw);
    if (!d.total) { setErr('That data has no cards this app can read. Nothing was changed.'); return; }
    const kept = await st.saveApi(raw);
    setDiff({ d, raw });
    if (kept) toast(`Card pool saved: ${d.total.toLocaleString()} cards.`);
    else setErr('The cards are loaded for now, but this browser did not keep them, so they will be gone after a reload. Private windows and blocked site storage cause this.');
    await afterSync(raw);
  };
  const sync = async () => {
    setBusy('cards'); setErr(''); setDiff(null);
    try { await stage(await fetchCards()); }
    catch (e) { setErr(`${(e as Error).message || 'The request did not complete.'} If the browser blocked the request, open ${CARDS_URL} in a tab, save the page as cards.json, and use "Import cards.json".`); }
    setBusy('');
  };
  // after every sync: coverage report, copy in the cards folder, card catalog on the account, wishlist entry for new gaps
  const [post, setPost] = useState<{ open: number; fresh: number; catalog: boolean; folder: string | null; wish: boolean } | null>(null);
  const [cardFolder, setCardFolder] = useState<string | null>(null);
  useEffect(() => { rememberedCardFolder().then(setCardFolder); }, []);
  const afterSync = async (raw: unknown) => {
    const pool = useStore.getState().pool; const rep = coverage(pool); const cards = Object.values(pool).filter((c) => c.source === 'api');
    const folder = await saveToCardFolder(raw, cards, rep, true).catch(() => null);
    const catalog = await uploadCatalog(cards, rep).catch(() => false);
    const gaps = await reportGaps(rep, await feedbackRemote(), auth.email ?? (settings.name || null), catalog);
    setPost({ open: rep.counts.partial + rep.counts.manual, fresh: gaps.fresh, catalog, folder, wish: !!gaps.item });
    if (gaps.item) { setItems(await loadLocal()); toast(`${gaps.fresh} card${gaps.fresh > 1 ? 's' : ''} need rules work. A wishlist entry with a Claude Code prompt was added.`); }
  };
  const saveFolderNow = async (choose: boolean) => {
    setErr('');
    try {
      if (choose || !cardFolder) setCardFolder(await pickCardFolder());
      const pool = useStore.getState().pool; const cards = Object.values(pool).filter((c) => c.source === 'api');
      if (!apiRaw) { toast('Folder chosen. Cards are written there after the next Card Sync.'); return; }
      const name = await saveToCardFolder(apiRaw, cards, coverage(pool), true);
      toast(name ? `Saved cards.json, cards-text.csv and coverage.md to “${name}”.` : 'The browser did not allow writing to that folder.', name ? 'info' : 'error');
    } catch (e) { if ((e as Error).name !== 'AbortError') setErr((e as Error).message); }
  };
  const downloadAll = () => {
    if (!apiRaw) return; const pool = useStore.getState().pool; const cards = Object.values(pool).filter((c) => c.source === 'api'); const rep = coverage(pool);
    downloadFile('cards.json', JSON.stringify(apiRaw, null, 1)); setTimeout(() => downloadFile('cards-text.csv', cardsCsv(cards, rep), 'text/csv'), 400); setTimeout(() => downloadFile('coverage.md', coverageMarkdown(rep, new Date().toISOString()), 'text/markdown'), 800);
  };
  const printings = useMemo(() => apiCards.reduce((n, c) => n + c.printings.length, 0), [apiCards]);
  const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  // art sync
  const rep = st.artReport; const prog = st.artJob ?? ''; const artBusy = !!st.artJob;
  const [folder, setFolder] = useState<string | null>(null); const [zipNames, setZipNames] = useState<string[]>([]);
  useEffect(() => { rememberedFolder().then((f) => setFolder(f?.name ?? null)); rememberedZips().then((z) => setZipNames(z?.names ?? [])); }, [rep, artBusy]);
  const dirInput = useRef<HTMLInputElement>(null);
  const cardList = () => [...Object.values(useStore.getState().pool), ...STATUS_CARDS]; // status images in the zips are cached too
  const runZips = (get: () => Promise<File[]>) => { setErr(''); get().then((zips) => { if (zips.length) st.runArtJob((p) => importZips(zips, cardList(), p)); }).catch((e) => { if ((e as Error).name !== 'AbortError') setErr((e as Error).message); }); };
  const runArt = (get: () => Promise<Parameters<typeof importArt>[0]>) => { setErr(''); st.runArtJob(async (p) => importArt(await get(), cardList(), p)); };
  const artStats = useMemo(() => {
    const v = st.artVariants; const ids = Object.keys(v);
    const tokens = apiCards.filter((c) => c.category === 'Token');
    return { tokens: tokens.length, tokensWithArt: tokens.filter((c) => v[c.id]).length, tokensMissing: tokens.filter((c) => !v[c.id]).map((c) => c.name), withArt: apiCards.filter((c) => v[c.id]).length, images: ids.reduce((n, id) => n + v[id].length, 0), alts: ids.filter((id) => v[id].length > 1).length };
  }, [st.artVariants, apiCards]);
  // feedback
  const [items, setItems] = useState<FeedbackItem[]>([]); const [kind, setKind] = useState<'wish' | 'problem'>('wish');
  const [title, setTitle] = useState(''); const [details, setDetails] = useState(''); const [diag, setDiag] = useState(true); const [fbNote, setFbNote] = useState('');
  const auth = useAuth();
  const [access, setAccess] = useState<AccessRow[]>([]); const [newEmail, setNewEmail] = useState(''); const [newNote, setNewNote] = useState(''); const [accNote, setAccNote] = useState('');
  useEffect(() => { if (auth.admin) listAccess().then(setAccess); }, [auth.admin]);
  useEffect(() => { feedbackRemote().then((r) => r && pushPending(r).then(setItems).catch(() => undefined)); }, []);
  useEffect(() => { loadLocal().then(setItems); }, []);
  const context = () => {
    const g = st.game;
    return { version: __APP_VERSION__, userAgent: navigator.userAgent, cards: apiCards.length, syncedAt, art: Object.keys(st.art).length,
      game: g ? { mode: g.mode, difficulty: g.difficulty, turn: g.state.turn, phase: g.state.phase, log: g.state.log.slice(-25).map((l) => l.text) } : null, errors: recentErrors() };
  };
  const send = async () => {
    setFbNote('');
    const remote = await feedbackRemote();
    try { setItems(await submit({ kind, title: title.trim(), details: details.trim(), submitted_by: auth.email ?? (settings.name || null), context: diag ? context() : null }, remote)); setTitle(''); setDetails(''); setFbNote(remote ? 'Saved and sent.' : 'Saved on this device.'); }
    catch (e) { setItems(await loadLocal()); setFbNote(`Saved on this device. Sending failed: ${(e as Error).message}`); }
  };
  const download = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([exportJson(items)], { type: 'application/json' })); a.download = `sorcery-table-feedback-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };

  return (
    <div className="page settings">
      <h1>Settings</h1>
      {err && <p className="banner error" role="alert">{err}</p>}

      <section className="panel">
        <h2>Table</h2>
        <TableOptions />
      </section>
      <section className="panel">
        <h2>Card Sync</h2>
        <div className="statrow" role="status">
          <div><span className="big">{apiCards.length.toLocaleString()}</span><small>Sorcery cards on this device</small></div>
          <div><span className="big">{printings.toLocaleString()}</span><small>printings</small></div>
          <div><span className="big">{syncedAt ? ago(syncedAt) : 'never'}</span><small>{syncedAt ? `last sync, ${new Date(syncedAt).toLocaleString()}` : 'last sync'}</small></div>
        </div>
        <p>Sync makes one request to the official public API, saves the result on this device, and shows what changed. It never runs on its own.</p>
        <div className="row">
          <button className="primary" disabled={!!busy} onClick={sync}>{busy === 'cards' ? 'Requesting…' : 'Sync cards'}</button>
          <label className="filebtn">Import cards.json<input type="file" accept=".json,application/json" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setErr(''); let raw: unknown; try { raw = JSON.parse(await f.text()); } catch { setErr('That file is not valid JSON.'); return; } await stage(raw); }} /></label>
        </div>
        <div className="row folderrow">
          <span className="note">{cardFolder ? <>Cards folder: <b>{cardFolder}</b>. Each sync writes cards.json, cards-text.csv (every card's text and how it is automated) and coverage.md there.</> : 'Optional: choose a folder on this computer and each sync also writes cards.json, cards-text.csv and coverage.md there, like the art folder.'}</span>
          {supportsSaveFolder() ? <>
            <button onClick={() => saveFolderNow(true)}>{cardFolder ? 'Change folder' : 'Choose cards folder'}</button>
            {cardFolder && apiRaw ? <button onClick={() => saveFolderNow(false)}>Save to folder now</button> : null}
          </> : <button disabled={!apiRaw} onClick={downloadAll} data-tip="This browser cannot write to a folder, so the files are downloaded instead">Download card files</button>}
        </div>
        {post && (
          <p className={`note ${post.open ? 'warn' : ''}`}>
            {post.open ? `${post.open} cards are not fully automated yet (their unread sentences are resolved by hand in the cast pop-up). ` : 'Every card is automated. '}
            {post.wish ? `${post.fresh} of them are new since the last report: a wishlist entry with a Claude Code prompt was added below. ` : post.open ? 'None of them are new since the last report. ' : ''}
            {post.catalog ? 'Card text was saved to your account’s card catalog. ' : ''}
            {post.folder ? `Files written to “${post.folder}”.` : cardFolder ? 'The cards folder needs permission again: use “Save to folder now”.' : ''}
          </p>
        )}
        {diff && (
          <div className="report">
            <p>Saved. <b>{diff.d.total.toLocaleString()}</b> cards; compared with the previous copy, <b>{diff.d.added.length}</b> new, <b>{diff.d.changed.length}</b> changed, <b>{diff.d.removed.length}</b> removed.</p>
            {(['added', 'changed', 'removed'] as const).map((k) => diff.d[k].length > 0 && <details key={k}><summary>{k === 'added' ? 'New' : k === 'changed' ? 'Changed' : 'Removed'} ({diff.d[k].length})</summary><p className="names">{diff.d[k].slice(0, 400).join(', ')}{diff.d[k].length > 400 ? '…' : ''}</p></details>)}
            {diff.d.unknownFields.length > 0 && <p className="note warn">The API returned fields this app does not know yet: {diff.d.unknownFields.join(', ')}. They are kept in the stored copy and ignored by the rules engine.</p>}
            {diff.d.skipped.length > 0 && <p className="note warn">{diff.d.skipped.length} entries could not be read and were skipped: {diff.d.skipped.slice(0, 12).join(', ')}{diff.d.skipped.length > 12 ? '…' : ''}</p>}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Art Sync</h2>
        <div className="statrow" role="status">
          <div><span className="big">{artStats.withArt.toLocaleString()} of {apiCards.length.toLocaleString()}</span><small>synced cards have art</small></div>
          <div><span className="big">{artStats.images.toLocaleString()}</span><small>images on this device</small></div>
          <div><span className="big">{artStats.alts.toLocaleString()}</span><small>cards with alternate art</small></div>
          <div data-tip={artStats.tokensMissing.length ? `Without art: ${artStats.tokensMissing.join(', ')}` : 'Every token has art'}><span className="big">{artStats.tokensWithArt} of {artStats.tokens}</span><small>tokens have art (Rubble, Foot Soldier…)</small></div>
          <div><span className="big">{st.artSyncedAt ? ago(st.artSyncedAt) : 'never'}</span><small>{st.artSyncedAt ? `last art load, ${new Date(st.artSyncedAt).toLocaleString()}` : 'last art load'}</small></div>
        </div>
        <p>Art is read from zips or a folder on your own disk and kept in this browser. It is never uploaded. Large zips take several minutes; the load keeps running if you go to another screen, and art appears as it is read.</p>
        {!apiCards.length && <p className="note warn">Card Sync comes first: images are matched to synced cards by name.</p>}
        <ol className="steps">
          <li><a className="btnlink" href={OFFICIAL_ART_FOLDER} target="_blank" rel="noreferrer">Download the art zip</a> This opens the official image folder in a new tab. In Google Drive, choose "Download all"; Drive builds a zip (sometimes several) and your browser saves it, normally to Downloads.</li>
          <li>{supportsFilePicker()
            ? <button className="primary" disabled={artBusy} onClick={() => runZips(pickZips)}>Load the downloaded zip</button>
            : <label className="filebtn primary">Load the downloaded zip<input type="file" accept=".zip" multiple disabled={artBusy} onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) runZips(async () => f); }} /></label>}
            {' '}{supportsFilePicker() ? 'The file window opens in your Downloads folder. Select one zip or several at once; each load adds to what is already cached, so the zips can also be loaded one after another.' : 'Select one zip or several at once; each load adds to what is already cached.'}
            {zipNames.length > 0 && <> <button disabled={artBusy} onClick={() => runZips(async () => (await rememberedZips())!.read())}>Re-read {zipNames.length === 1 ? `"${zipNames[0]}"` : `${zipNames.length} zips`}</button></>}</li>
        </ol>
        <p className="note">A web page cannot see where a download was saved, so the zip has to be picked once. After that this browser remembers it. The zip is read on this device only.</p>
        <details><summary>Use an unzipped folder instead</summary><div className="row">
          {supportsFolderPicker() ? <>
            <button disabled={artBusy} onClick={() => runArt(pickFolder)}>Choose art folder</button>
            {folder && <button disabled={artBusy} onClick={() => runArt(async () => (await rememberedFolder())!.read())}>Re-read "{folder}"</button>}
          </> : <><button disabled={artBusy} onClick={() => dirInput.current?.click()}>Choose art folder</button>
            <input ref={dirInput} type="file" multiple hidden {...({ webkitdirectory: '' } as object)} onChange={(e) => { const f = e.target.files; if (f?.length) runArt(async () => fromFileList(f)); }} /></>}
        </div></details>
        <div className="row">
          {artStats.images > 0 && <button disabled={artBusy} onClick={async () => { if (confirm('Remove all cached art from this browser?')) { await artDb.clear(); await st.reloadArt(); useStore.setState({ artReport: null }); } }}>Clear cached art</button>}
        </div>
        {prog && <p className="banner" role="status">Loading art. {prog}</p>}
        {rep && (
          <div className="report">
            <p><b>{rep.matched}</b> cards matched from {rep.files} image files in this run. <b>{rep.alts}</b> cards now have more than one image to choose from (Card library, select a card, Art). <b>{rep.missing.length}</b> synced cards have no art; <b>{rep.unmatched.length}</b> files matched no card.</p>
            {rep.missing.length > 0 && <details><summary>Cards without art ({rep.missing.length})</summary><p className="names">{rep.missing.slice(0, 400).join(', ')}</p></details>}
            {rep.unmatched.length > 0 && <details><summary>Files that matched no card ({rep.unmatched.length})</summary><p className="names">{rep.unmatched.slice(0, 200).join(', ')}</p></details>}
            {rep.samples.length > 0 && <details><summary>Examples of file names read</summary><p className="names">{rep.samples.join(', ')}</p></details>}
            {!apiCards.length && <p className="banner error">No Sorcery cards are on this device yet, so the images had nothing to match. After a Card Sync, load the zips again.</p>}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Wishlist and problem reports</h2>
        <form className="fb" onSubmit={(e) => { e.preventDefault(); if (title.trim()) send(); }}>
          <div className="seg small"><button type="button" className={kind === 'wish' ? 'on' : ''} onClick={() => setKind('wish')}>Wish</button><button type="button" className={kind === 'problem' ? 'on' : ''} onClick={() => setKind('problem')}>Problem</button></div>
          <label className="field"><span>{kind === 'wish' ? 'What would you like the table to do?' : 'What went wrong?'}</span><input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
          <label className="field"><span>{kind === 'wish' ? 'Details' : 'What you did, what you expected, what happened'}</span><textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
          <div className="row">
            <label className="switch" data-tip="App version, browser, card pool size, the last 25 log lines of the current game, and recent errors. No art and no card data."><input type="checkbox" checked={diag} onChange={(e) => setDiag(e.target.checked)} /> Attach diagnostics</label>
            <button className="primary" type="submit">Save {kind === 'wish' ? 'wish' : 'report'}</button>
          </div>
          {fbNote && <p className="note">{fbNote}</p>}
        </form>
        <ul className="fblist">{items.map((it) => (
          <li key={it.id} className={it.kind}>
            <span className={`st ${it.status}`}>{it.status.replace('_', ' ')}</span><b>{it.kind === 'wish' ? 'Wish' : 'Problem'}: {it.title}</b>
            <small>{it.submitted_by ?? 'anonymous'}, {new Date(it.created_at).toLocaleDateString()}{it.synced ? '' : ', on this device only'}</small>
            {it.details && <p>{it.details}</p>}{it.response && <p className="resp">Response: {it.response}</p>}
          </li>
        ))}</ul>
        {!items.length && <p className="note">Nothing yet.</p>}
        <div className="row">
          <button disabled={!items.length} onClick={download}>Export as JSON</button>
          <button disabled={!items.length} onClick={() => navigator.clipboard.writeText(exportJson(items)).then(() => toast('Copied.'))}>Copy</button>
          {!LOCAL_ONLY && <button onClick={async () => { try { const r = await feedbackRemote(); if (r) { setItems(await pushPending(r)); setFbNote('Up to date.'); } } catch (e) { setFbNote((e as Error).message); } }}>Send and refresh</button>}
        </div>
      </section>

      <section className="panel">
        <h2>Account</h2>
        {LOCAL_ONLY ? <p>Local development mode: no sign-in, nothing is saved to an account.</p> : (<>
          <p>Signed in as <b>{auth.email}</b>{auth.admin ? ' (administrator)' : ''}. Your name, decks, custom cards and automated effects are saved to this account and load on any device you sign in on. {auth.sync === 'saving' ? 'Saving…' : auth.sync === 'saved' ? 'Saved.' : auth.sync === 'error' ? 'The last save did not go through; it will be retried on the next change.' : ''}</p>
          <p className="note">Synced cards and cached art stay on each device. If the table is open on two devices at once, the most recent change wins.</p>
          <div className="row"><label className="field inline"><span>Display name</span><input value={settings.name} onChange={(e) => setSettings({ name: e.target.value })} /></label><button onClick={auth.signOut}>Sign out</button></div>
        </>)}
        {auth.admin && (<>
          <h3>Who can use this table</h3>
          <p className="note">People on this list can create an account with that email address and get in. Removing an address locks that account out; their saved data is kept.</p>
          <ul className="decklines">{access.map((r) => <li key={r.email}><span>{r.email}{r.note ? ` (${r.note})` : ''}</span><button onClick={async () => { await removeAccess(r.email); setAccess(await listAccess()); }} aria-label={`Remove ${r.email}`}>Remove</button></li>)}</ul>
          {!access.length && <p className="note">Only you so far.</p>}
          <form className="row" onSubmit={async (e) => { e.preventDefault(); const err = await addAccess(newEmail, newNote); setAccNote(err ?? ''); if (!err) { setNewEmail(''); setNewNote(''); setAccess(await listAccess()); } }}>
            <label className="field inline"><span>Email</span><input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required /></label>
            <label className="field inline"><span>Note</span><input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="optional" /></label>
            <button className="primary" type="submit">Add</button>
          </form>
          {accNote && <p className="note warn">{accNote}</p>}
        </>)}
      </section>

      <section className="panel about">
        <h2>About</h2>
        <p>Unofficial fan project, not affiliated with Erik's Curiosa. Free and non-commercial. Sorcery: Contested Realm is a trademark of Erik's Curiosa Limited. Card data comes from the official public API; card art is loaded by each player from their own disk. Version {__APP_VERSION__}.</p>
        <p><a href="https://sorcerytcg.com/community-use" target="_blank" rel="noreferrer">Community Use &amp; Copyright Policy</a> · <a href="https://sorcerytcg.com/codex" target="_blank" rel="noreferrer">Codex</a></p>
      </section>
    </div>
  );
}
