import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { captureErrors } from './feedback/feedback';
import './ui/styles.css';

captureErrors();
createRoot(document.getElementById('root')!).render(<App />);
