import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
// index.css (Tailwind + BlockNote/Mantine styles) must load BEFORE desk.css so
// the Desk theme's editor overrides win on equal-specificity rules.
import './index.css';
import DeskApp from './desk/DeskApp';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <DeskApp />
    </ErrorBoundary>
  </StrictMode>,
);
