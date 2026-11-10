import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { captureErrors } from './feedback/feedback';
import '@fontsource/cinzel/latin-500.css';
import '@fontsource/cinzel/latin-700.css';
import './ui/styles.css';

captureErrors();
createRoot(document.getElementById('root')!).render(<App />);
