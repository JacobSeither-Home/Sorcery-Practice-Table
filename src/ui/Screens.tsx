import { useEffect, useMemo, useRef, useState } from 'react';
import { type CardDef, type CardType, type DeckList, type Effect, ELEMENTS, KEYWORD_HELP, makeCard } from '../engine';
import type { Difficulty } from '../ai/ai';
import { type Mode, allDecks, isPracticeDeck, useStore } from '../store';
import { CARDS_URL, type SyncDiff, diffCards, fetchCards } from '../data/cardSync';
import { type ArtReport, OFFICIAL_ART_FOLDER, orderVariants, variantBlob, variantLabel, fromFileList, importArt, importZips, pickFolder, pickZips, rememberedFolder, rememberedZips, supportsFilePicker, supportsFolderPicker } from '../data/artSync';
import { artDb } from '../data/db';
import { deckNotes, parseDeckText, playable } from '../data/decks';
import { type FeedbackItem, exportJson, loadLocal, pushPending, recentErrors, submit } from '../feedback/feedback';
import { CardFace, hoverProps } from './CardFace';
import { type AccessRow, LOCAL_ONLY, addAccess, feedbackRemote, listAccess, removeAccess, useAuth } from '../cloud/cloud';
import { Preview } from './Table';

declare const __APP_VERSION__: string;
const DIFF: { id: Difficulty; name: string; note: string }[] = [
  { id: 'easy', name: 'Easy', note: 'Mostly random legal moves.' },
  { id: 'medium', name: 'Medium', note: 'Picks the move that looks best right now.' },
  { id: 'hard', name: 'Hard', note: 'Looks ahead by simulating turns. Never sees your hand.' },
];

// ---------------------------------------------------------------- setup
export function Setup() {
  const { pool, decks, newGame, host, join, online, leave, syncedAt, art, setView } = useStore();
  const all = allDecks(decks).filter((d) => playable(d, pool));
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
          {apiCount ? <>Card pool: {apiCount} cards, synced {new Date(syncedAt!).toLocaleDateString()}.</> : <>No Sorcery cards synced yet. The built-in practice cards work without a sync.</>}{' '}
          {Object.keys(art).length ? `Art cached for ${Object.keys(art).length} cards.` : 'No art loaded.'}{' '}
          <button className="link" onClick={() => setView('settings')}>Card Sync and Art Sync are in Settings</button>
        </p>
      </section>
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
    </div>
  );
}

// ---------------------------------------------------------------- shared card search
function useSearch(pool: Record<string, CardDef>, types?: CardType[]) {
  const [q, setQ] = useState(''); const [type, setType] = useState<string>('');
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return Object.values(pool).filter((c) => (!types || types.includes(c.type)) && (!type || c.type === type) && (!k || c.name.toLowerCase().includes(k) || c.rules.toLowerCase().includes(k) || c.subtypes.join(' ').toLowerCase().includes(k)))
      .sort((x, y) => x.name.localeCompare(y.name));
  }, [pool, q, type]);
  const bar = (
    <div className="searchbar">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, rules text or subtype" aria-label="Search cards" />
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Card type"><option value="">All types</option>{['Avatar', 'Site', 'Minion', 'Magic', 'Aura', 'Artifact'].map((t) => <option key={t}>{t}</option>)}</select>
      <span className="count">{list.length} cards</span>
    </div>
  );
  return { list, bar };
}

// ---------------------------------------------------------------- decks
export function Decks() {
  const { pool, decks, saveDeck, deleteDeck, toast } = useStore();
  const [cur, setCur] = useState<DeckList | null>(null); const [orig, setOrig] = useState<string | undefined>();
  const [paste, setPaste] = useState('');
  const { list, bar } = useSearch(pool);
  const count = (id: string) => (cur ? [...cur.spellbook, ...cur.atlas].filter((x) => x === id).length : 0);
  const add = (c: CardDef) => cur && setCur(c.type === 'Avatar' ? { ...cur, avatar: c.id } : c.type === 'Site' ? { ...cur, atlas: [...cur.atlas, c.id] } : { ...cur, spellbook: [...cur.spellbook, c.id] });
  const drop = (id: string, where: 'spellbook' | 'atlas') => { if (!cur) return; const a = cur[where].slice(); a.splice(a.lastIndexOf(id), 1); setCur({ ...cur, [where]: a }); };
  const group = (ids: string[]) => [...new Set(ids)].map((id) => ({ id, n: ids.filter((x) => x === id).length, c: pool[id] })).sort((x, y) => (x.c?.cost ?? 0) - (y.c?.cost ?? 0) || (x.c?.name ?? '').localeCompare(y.c?.name ?? ''));
  if (!cur) return (
    <div className="page">
      <h1>Decks</h1>
      <div className="decklist">
        {allDecks(decks).map((d) => (
          <div key={d.name} className="panel deckrow">
            <div><b>{d.name}</b><small>{pool[d.avatar]?.name ?? 'No avatar'} · {d.spellbook.length} spells · {d.atlas.length} sites{isPracticeDeck(d.name) ? ' · built in' : ''}</small></div>
            <span className="row">
              {isPracticeDeck(d.name) ? <button onClick={() => { setCur({ ...d, name: d.name.replace('Practice: ', '') + ' (copy)' }); setOrig(undefined); }}>Copy and edit</button>
                : <><button onClick={() => { setCur(d); setOrig(d.name); }}>Edit</button><button onClick={() => confirm(`Delete "${d.name}"?`) && deleteDeck(d.name)}>Delete</button></>}
            </span>
          </div>
        ))}
      </div>
      <div className="row"><button className="primary" onClick={() => { setCur({ name: 'New deck', avatar: '', spellbook: [], atlas: [] }); setOrig(undefined); }}>New deck</button></div>
      <section className="panel">
        <h2>Import a list</h2>
        <p className="note">Paste one card per line, like "4 Card Name". Names must match cards in your pool.</p>
        <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'1 Avatar Name\n4 Card Name\n3 Another Card'} />
        <div className="row"><button disabled={!paste.trim()} onClick={() => { const r = parseDeckText(paste, pool, 'Imported deck'); setCur(r.deck); setOrig(undefined); if (r.unknown.length) toast(`Not in your card pool: ${r.unknown.slice(0, 8).join(', ')}${r.unknown.length > 8 ? '…' : ''}`, 'error'); }}>Import</button></div>
      </section>
    </div>
  );
  const notes = deckNotes(cur, pool);
  return (
    <div className="page builder">
      <div className="builder-main">
        <div className="row head"><input className="title" value={cur.name} onChange={(e) => setCur({ ...cur, name: e.target.value })} aria-label="Deck name" />
          <button onClick={() => setCur(null)}>Cancel</button>
          <button className="primary" disabled={!cur.name.trim() || isPracticeDeck(cur.name)} onClick={() => { saveDeck(cur, orig); setCur(null); toast('Deck saved.'); }}>Save deck</button></div>
        {bar}
        <div className="grid">{list.slice(0, 150).map((c) => (
          <button key={c.id} className="gridcard" onClick={() => add(c)} {...hoverProps(c)} data-tip="Add to deck"><CardFace card={c} size="sm" />{count(c.id) > 0 && <span className="n">{count(c.id)}</span>}{cur.avatar === c.id && <span className="n">✓</span>}</button>
        ))}</div>
        {list.length > 150 && <p className="note">Showing the first 150. Narrow the search to see more.</p>}
      </div>
      <aside className="builder-side">
        <Preview />
        <h3>Avatar</h3><p>{pool[cur.avatar]?.name ?? <em>Click an Avatar card to choose it</em>}</p>
        {(['spellbook', 'atlas'] as const).map((w) => (<div key={w}>
          <h3>{w === 'spellbook' ? 'Spellbook' : 'Atlas'} ({cur[w].length})</h3>
          <ul className="decklines">{group(cur[w]).map((x) => <li key={x.id} {...hoverProps(x.c)}><span>{x.n}× {x.c?.name ?? x.id}</span><button onClick={() => drop(x.id, w)} aria-label="Remove one">−</button></li>)}</ul>
        </div>))}
        {notes.length > 0 && <div className="notes"><h3>Constructed-format notes</h3><ul>{notes.map((n) => <li key={n}>{n}</li>)}</ul><p className="note">These don't block practice games. A deck needs an Avatar, 10 spells and 6 sites to be playable here.</p></div>}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- library
const OPS: Effect['op'][] = ['damage', 'heal', 'draw', 'mana', 'destroy'];
const WHO: Effect['who'][] = ['target', 'enemyAvatar', 'ownAvatar', 'enemiesHere', 'controller'];
const KEYWORDS = Object.keys(KEYWORD_HELP).filter((k) => k !== 'Threshold');
const blank = (): CardDef => makeCard({ name: '', type: 'Minion', cost: 1, attack: 1, defense: 1, source: 'custom' });

export function Library() {
  const { pool, setOverlay, saveCustom, deleteCustom, toast } = useStore();
  const { list, bar } = useSearch(pool);
  const [id, setId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CardDef | null>(null);
  const card = id ? pool[id] : null;
  const setFx = (fx: Effect[]) => card && setOverlay(card.id, fx);
  const num = (v: string) => Math.max(0, parseInt(v || '0', 10) || 0);
  return (
    <div className="page builder">
      <div className="builder-main">
        <div className="row head"><h1>Card library</h1><button className="primary" onClick={() => { setDraft(blank()); setId(null); }}>Add a card</button></div>
        {bar}
        <div className="grid">{list.slice(0, 150).map((c) => <button key={c.id} className={`gridcard ${id === c.id ? 'on' : ''}`} onClick={() => { setId(c.id); setDraft(null); }} {...hoverProps(c)}><CardFace card={c} size="sm" />{c.effects.length > 0 && <span className="n" data-tip="Has automated effects">⚙</span>}</button>)}</div>
        {list.length > 150 && <p className="note">Showing the first 150. Narrow the search to see more.</p>}
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
          <p className="note">Keywords run on their own. Effects cover simple card text so the table can resolve it for you. Anything else is resolved with Manual tools during play.</p>
          {card.source === 'practice' ? <p className="note">Built-in practice cards can't be changed.</p> : (<>
            {card.effects.map((fx, i) => {
              const up = (p: Partial<Effect>) => setFx(card.effects.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return (
                <div key={i} className="fx">
                  <select value={fx.on} onChange={(e) => up({ on: e.target.value as Effect['on'] })} aria-label="When"><option value="cast">When cast</option><option value="genesis">When it enters (Genesis)</option><option value="deathrite">When it dies (Deathrite)</option></select>
                  <select value={fx.op} onChange={(e) => up({ op: e.target.value as Effect['op'] })} aria-label="Effect">{OPS.map((o) => <option key={o} value={o}>{{ damage: 'Deal damage', heal: 'Gain life', draw: 'Draw cards', mana: 'Gain mana', destroy: 'Destroy' }[o]}</option>)}</select>
                  {fx.op !== 'destroy' && <input type="number" min={1} value={fx.n ?? 1} onChange={(e) => up({ n: Math.max(1, num(e.target.value)) })} aria-label="Amount" />}
                  {(fx.op === 'damage' || fx.op === 'destroy') && <select value={fx.who} onChange={(e) => up({ who: e.target.value as Effect['who'] })} aria-label="Applies to">{WHO.filter((w) => w !== 'controller').map((w) => <option key={w} value={w}>{{ target: 'a chosen unit', enemyAvatar: 'the enemy Avatar', ownAvatar: 'your Avatar', enemiesHere: 'each enemy at its location', controller: '' }[w]}</option>)}</select>}
                  {fx.who === 'target' && (fx.op === 'damage' || fx.op === 'destroy') && <select value={fx.range ?? 'any'} onChange={(e) => up({ range: e.target.value as Effect['range'] })} aria-label="Range"><option value="adjacent">adjacent</option><option value="nearby">nearby</option><option value="any">anywhere</option></select>}
                  {fx.op === 'draw' && <select value={fx.deck ?? 'spellbook'} onChange={(e) => up({ deck: e.target.value as Effect['deck'] })} aria-label="Deck"><option value="spellbook">from spellbook</option><option value="atlas">from atlas</option></select>}
                  <button onClick={() => setFx(card.effects.filter((_, j) => j !== i))} aria-label="Remove effect">×</button>
                </div>
              );
            })}
            <button onClick={() => setFx([...card.effects, { on: card.type === 'Magic' ? 'cast' : 'genesis', op: 'damage', n: 1, who: 'target', range: 'nearby' }])}>Add an effect</button>
          </>)}
        </>) : <><Preview /><p className="note">Select a card to see it and set up automated effects, or add a card of your own.</p></>}
      </aside>
    </div>
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
      <button key={v} className={v === current ? 'on' : ''} onClick={() => chooseArt(card.id, v)} data-tip={variantLabel(card, v) + (v === ordered[0] ? ' (default)' : '')} aria-pressed={v === current}>
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
  const stage = (raw: unknown) => { const d = diffCards(apiRaw, raw); if (!d.total) { setErr('That data has no cards this app can read. Nothing was changed.'); return; } setDiff({ d, raw }); };
  const sync = async () => {
    setBusy('cards'); setErr(''); setDiff(null);
    try { stage(await fetchCards()); }
    catch (e) { setErr(`${(e as Error).message || 'The request did not complete.'} If the browser blocked the request, open ${CARDS_URL} in a tab, save the page as cards.json, and use "Import cards.json".`); }
    setBusy('');
  };
  // art sync
  const [rep, setRep] = useState<ArtReport | null>(null); const [prog, setProg] = useState(''); const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => { rememberedFolder().then((f) => setFolder(f?.name ?? null)); }, [rep]);
  const [zipNames, setZipNames] = useState<string[]>([]);
  useEffect(() => { rememberedZips().then((z) => setZipNames(z?.names ?? [])); }, [rep]);
  const runZips = async (get: () => Promise<File[]>) => {
    setBusy('art'); setRep(null); setErr('');
    try { const zips = await get(); if (zips.length) { setProg('Reading the zip…'); const r = await importZips(zips, Object.values(pool), setProg); await st.reloadArt(); setRep(r); } }
    catch (e) { if ((e as Error).name !== 'AbortError') setErr((e as Error).message); }
    setBusy(''); setProg('');
  };
  const dirInput = useRef<HTMLInputElement>(null);
  const runArt = async (get: () => Promise<Parameters<typeof importArt>[0]>) => {
    setBusy('art'); setRep(null); setErr('');
    try { setProg('Reading files…'); const entries = await get(); const r = await importArt(entries, Object.values(pool), setProg); await st.reloadArt(); setRep(r); }
    catch (e) { if ((e as Error).name !== 'AbortError') setErr((e as Error).message); }
    setBusy(''); setProg('');
  };
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
        <h2>Card Sync</h2>
        <p>{apiCards.length ? `${apiCards.length} cards stored on this device, synced ${new Date(syncedAt!).toLocaleString()}.` : 'No cards synced yet.'} Sync makes one request to the official public API and shows what changed before saving. It never runs on its own.</p>
        <div className="row">
          <button className="primary" disabled={!!busy} onClick={sync}>{busy === 'cards' ? 'Requesting…' : 'Sync cards'}</button>
          <label className="filebtn">Import cards.json<input type="file" accept=".json,application/json" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setErr(''); try { stage(JSON.parse(await f.text())); } catch { setErr('That file is not valid JSON.'); } }} /></label>
        </div>
        {diff && (
          <div className="report">
            <p><b>{diff.d.total}</b> cards in the new data: <b>{diff.d.added.length}</b> new, <b>{diff.d.changed.length}</b> changed, <b>{diff.d.removed.length}</b> removed.</p>
            {(['added', 'changed', 'removed'] as const).map((k) => diff.d[k].length > 0 && <details key={k}><summary>{k === 'added' ? 'New' : k === 'changed' ? 'Changed' : 'Removed'} ({diff.d[k].length})</summary><p className="names">{diff.d[k].slice(0, 400).join(', ')}{diff.d[k].length > 400 ? '…' : ''}</p></details>)}
            {diff.d.unknownFields.length > 0 && <p className="note warn">The API returned fields this app does not know yet: {diff.d.unknownFields.join(', ')}. They are kept in the stored copy and ignored by the rules engine.</p>}
            {diff.d.skipped.length > 0 && <p className="note warn">{diff.d.skipped.length} entries could not be read and were skipped: {diff.d.skipped.slice(0, 12).join(', ')}{diff.d.skipped.length > 12 ? '…' : ''}</p>}
            <div className="row"><button onClick={() => setDiff(null)}>Discard</button><button className="primary" onClick={async () => { await st.saveApi(diff.raw); setDiff(null); toast('Card pool saved.'); }}>Save this card pool</button></div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Art Sync</h2>
        <p>{Object.keys(st.art).length ? `Art cached for ${Object.keys(st.art).length} cards.` : 'No art cached.'} Art is read from a zip or folder on your own disk and kept in this browser. It is never uploaded.</p>
        <ol className="steps">
          <li><a className="btnlink" href={OFFICIAL_ART_FOLDER} target="_blank" rel="noreferrer">Download the art zip</a> This opens the official image folder in a new tab. In Google Drive, choose "Download all"; Drive builds a zip (sometimes several) and your browser saves it, normally to Downloads.</li>
          <li>{supportsFilePicker()
            ? <button className="primary" disabled={!!busy} onClick={() => runZips(pickZips)}>Load the downloaded zip</button>
            : <label className="filebtn primary">Load the downloaded zip<input type="file" accept=".zip" multiple disabled={!!busy} onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) runZips(async () => f); }} /></label>}
            {' '}{supportsFilePicker() ? 'The file window opens in your Downloads folder. Select one zip or several at once; each load adds to what is already cached, so the zips can also be loaded one after another.' : 'Select one zip or several at once; each load adds to what is already cached.'}
            {zipNames.length > 0 && <> <button disabled={!!busy} onClick={() => runZips(async () => (await rememberedZips())!.read())}>Re-read {zipNames.length === 1 ? `"${zipNames[0]}"` : `${zipNames.length} zips`}</button></>}</li>
        </ol>
        <p className="note">A web page cannot see where a download was saved, so the zip has to be picked once. After that this browser remembers it. The zip is read on this device only.</p>
        <details><summary>Use an unzipped folder instead</summary><div className="row">
          {supportsFolderPicker() ? <>
            <button disabled={!!busy} onClick={() => runArt(pickFolder)}>Choose art folder</button>
            {folder && <button disabled={!!busy} onClick={() => runArt(async () => (await rememberedFolder())!.read())}>Re-read "{folder}"</button>}
          </> : <><button disabled={!!busy} onClick={() => dirInput.current?.click()}>Choose art folder</button>
            <input ref={dirInput} type="file" multiple hidden {...({ webkitdirectory: '' } as object)} onChange={(e) => { const f = e.target.files; if (f?.length) runArt(async () => fromFileList(f)); }} /></>}
        </div></details>
        <div className="row">
          {Object.keys(st.art).length > 0 && <button disabled={!!busy} onClick={async () => { if (confirm('Remove all cached art from this browser?')) { await artDb.clear(); await st.reloadArt(); setRep(null); } }}>Clear cached art</button>}
        </div>
        {prog && <p className="note">{prog}</p>}
        {rep && (
          <div className="report">
            <p><b>{rep.matched}</b> cards matched from {rep.files} image files in this run. <b>{rep.alts}</b> cards now have more than one image to choose from (Card library, select a card, Art). <b>{rep.missing.length}</b> synced cards have no art; <b>{rep.unmatched.length}</b> files matched no card.</p>
            {rep.missing.length > 0 && <details><summary>Cards without art ({rep.missing.length})</summary><p className="names">{rep.missing.slice(0, 400).join(', ')}</p></details>}
            {rep.unmatched.length > 0 && <details><summary>Files that matched no card ({rep.unmatched.length})</summary><p className="names">{rep.unmatched.slice(0, 200).join(', ')}</p></details>}
            {!apiCards.length && <p className="note warn">No Sorcery cards are synced yet, so files could only match practice or custom cards. Run Card Sync first.</p>}
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
