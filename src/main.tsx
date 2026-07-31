import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles.css';

createRoot(document.querySelector<HTMLDivElement>('#app')!).render(<App />);
