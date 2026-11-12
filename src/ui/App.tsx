import { useEffect } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { KEYWORD_HELP, RULE_TERMS, codexUrl } from '../engine';
import { useStore } from '../store';
import { useAuth } from '../cloud/cloud';
import { SignIn } from './Auth';
import { Inspector, Table } from './Table';
import { StatusPop, ZoomCard } from './CardFace';
import { VoidBackdrop } from './VoidBackdrop';
import { Decks, Library, Settings, Setup } from './Screens';

const NAV = [['play', 'Table'], ['decks', 'Decks'], ['library', 'Card library'], ['settings', 'Settings']] as const;

export function App() {
  const { ready, view, setView, game, toasts, init, artJob } = useStore();
  const auth = useAuth();
  const pace = useStore((s) => s.settings.pace ?? 1);
  useEffect(() => { init().then(() => useAuth.getState().init()); }, [init]);
  if (!ready || auth.status === 'loading') return <><VoidBackdrop /><div className="boot">Opening the table…</div></>;
  if (!auth.member) return <><VoidBackdrop /><SignIn /></>;
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.3 * pace }}>
      <VoidBackdrop />
      <div className="app" style={{ '--pace': pace } as React.CSSProperties}>
        <header className="topbar">
          <span className="brand"><span className="sigil" aria-hidden>✦</span><span className="full">Sorcery Practice Table</span></span>
          <nav>{NAV.map(([v, n]) => <button key={v} className={view === v ? 'on' : ''} aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>{n}{v === 'play' && game && game.state.phase !== 'over' ? <i className="live" /> : null}</button>)}</nav>
          {artJob && <button className="jobchip" onClick={() => setView('settings')} data-tip="Open Settings">Loading art. {artJob}</button>}
          <span className="unofficial">Unofficial fan project, not affiliated with Erik's Curiosa</span>
        </header>
        {view === 'play' ? (game ? <Table /> : <Setup />) : view === 'decks' ? <Decks /> : view === 'library' ? <Library /> : <Settings />}
        <Inspector />
        <ZoomCard />
        <StatusPop />
        <div className="toasts" aria-live="assertive">
          <AnimatePresence>{toasts.map((t) => (
            <motion.div key={t.id} className={`toast ${t.tone}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} role={t.tone === 'error' ? 'alert' : undefined}>
              {t.tone === 'error' && <b className="toast-head">Not allowed <button className="iconbtn toast-x" onClick={() => useStore.setState((st) => ({ toasts: st.toasts.filter((x) => x.id !== t.id) }))} aria-label="Close">✕</button></b>}
              <span>{t.text}</span>
              {t.keyword && (KEYWORD_HELP[t.keyword] || RULE_TERMS[t.keyword]) && <span className="toast-rule"><b>The rule — {t.keyword}:</b> {(KEYWORD_HELP[t.keyword] ?? RULE_TERMS[t.keyword]).text} <a href={codexUrl(t.keyword)} target="_blank" rel="noreferrer">Read it in the Codex ↗</a></span>}
            </motion.div>
          ))}</AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
