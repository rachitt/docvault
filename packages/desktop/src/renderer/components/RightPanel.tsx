import { useStore } from '../store';
import { Outline } from './Outline';
import { AiAssistant } from './AiAssistant';

export function RightPanel(): React.JSX.Element {
  const rightTab = useStore((s) => s.rightTab);
  const setRightTab = useStore((s) => s.setRightTab);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-[var(--dv-border)] bg-[var(--dv-sidebar)]">
      <div className="flex border-b border-[var(--dv-border)] text-sm">
        {(['outline', 'ai'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setRightTab(tab)}
            className={`flex-1 px-3 py-2.5 capitalize ${
              rightTab === tab
                ? 'border-b-2 border-[var(--dv-accent)] font-medium text-neutral-900'
                : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {tab === 'ai' ? 'AI Assistant' : 'Outline'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rightTab === 'outline' ? <Outline /> : <AiAssistant />}
      </div>
    </aside>
  );
}
