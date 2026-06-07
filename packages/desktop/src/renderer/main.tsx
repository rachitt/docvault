import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DeskApp from './desk/DeskApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <DeskApp />
    </ErrorBoundary>
  </StrictMode>,
);
