import { useEffect } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { KEYWORD_HELP, codexUrl } from '../engine';
import { useStore } from '../store';
import { useAuth } from '../cloud/cloud';
import { SignIn } from './Auth';
import { Table } from './Table';
import { Decks, Library, Settings, Setup } from './Screens';

const NAV = [['play', 'Table'], ['decks', 'Decks'], ['library', 'Card library'], ['settings', 'Settings']] as const;

export function App() {
  const { ready, view, setView, game, toasts, init, artJob } = useStore();
  const auth = useAuth();
  useEffect(() => { init().then(() => useAuth.getState().init()); }, [init]);
  if (!ready || auth.status === 'loading') return <div className="boot">Opening the table…</div>;
  if (!auth.member) return <SignIn />;
  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <header className="topbar">
          <span className="brand">Sorcery Practice Table</span>
          <nav>{NAV.map(([v, n]) => <button key={v} className={view === v ? 'on' : ''} aria-current={view === v ? 'page' : undefined} onClick={() => setView(v)}>{n}{v === 'play' && game && game.state.phase !== 'over' ? <i className="live" /> : null}</button>)}</nav>
          {artJob && <button className="jobchip" onClick={() => setView('settings')} data-tip="Open Settings">Loading art. {artJob}</button>}
          <span className="unofficial">Unofficial fan project, not affiliated with Erik's Curiosa</span>
        </header>
        {view === 'play' ? (game ? <Table /> : <Setup />) : view === 'decks' ? <Decks /> : view === 'library' ? <Library /> : <Settings />}
        <div className="toasts" aria-live="assertive">
          <AnimatePresence>{toasts.map((t) => (
            <motion.div key={t.id} className={`toast ${t.tone}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
              {t.text}
              {t.keyword && KEYWORD_HELP[t.keyword] && <> <a href={codexUrl(t.keyword)} target="_blank" rel="noreferrer">{t.keyword} in the Codex</a></>}
            </motion.div>
          ))}</AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
