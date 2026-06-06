import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { StatusBar } from './components/StatusBar';
import { MainPane } from './components/MainPane';
import { RightPanel } from './components/RightPanel';
import { CommandPalette } from './components/CommandPalette';
import { useStore } from './store';

export default function App(): React.JSX.Element {
  const refresh = useStore((s) => s.refresh);
  const setPalette = useStore((s) => s.setPalette);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);

  useEffect(() => {
    void refresh();
    const off = window.docvault.onVaultChanged(() => void refresh());
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
    };
  }, [refresh, setPalette]);

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <MainPane />
        <RightPanel />
      </div>
      <StatusBar />
      <CommandPalette />
      {loading && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center text-sm text-neutral-400">
          Loading vault…
        </div>
      )}
      {error && !loading && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-md bg-red-50 px-4 py-2 text-sm text-red-600 shadow">
          Failed to load vault: {error}
        </div>
      )}
    </div>
  );
}
