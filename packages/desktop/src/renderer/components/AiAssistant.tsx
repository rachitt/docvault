import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Square } from 'lucide-react';
import { useStore } from '../store';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

const CHIPS = ['Summarize this page', 'Explain the key concepts', 'Suggest improvements'];

export function AiAssistant(): React.JSX.Element {
  const currentDoc = useStore((s) => s.currentDoc);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const reqId = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offChunk = window.docvault.ai.onChunk((id, text) => {
      if (id !== reqId.current) return;
      setMessages((m) => {
        const last = m[m.length - 1];
        if (last?.role === 'assistant') {
          return [...m.slice(0, -1), { role: 'assistant', text: last.text + text }];
        }
        return [...m, { role: 'assistant', text }];
      });
    });
    const offDone = window.docvault.ai.onDone((id, error) => {
      if (id !== reqId.current) return;
      setBusy(false);
      if (error) setMessages((m) => [...m, { role: 'assistant', text: `⚠️ ${error}` }]);
    });
    return () => {
      offChunk();
      offDone();
    };
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo(0, scroller.current.scrollHeight);
  }, [messages]);

  const ask = (raw: string): void => {
    const question = raw.trim();
    if (!question || busy) return;
    const context = currentDoc
      ? `In this DocVault vault, read the document at "${currentDoc.relPath}". ${question}`
      : question;
    const id = crypto.randomUUID();
    reqId.current = id;
    setMessages((m) => [...m, { role: 'user', text: question }]);
    setInput('');
    setBusy(true);
    void window.docvault.ai.ask(id, context);
  };

  const stop = (): void => {
    if (reqId.current) void window.docvault.ai.cancel(reqId.current);
    setBusy(false);
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="mt-2">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-700">
              <Sparkles size={16} className="text-[var(--dv-accent)]" />
              How can I help with this documentation?
            </div>
            <div className="flex flex-col gap-1.5">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  onClick={() => ask(c)}
                  className="rounded-lg border border-[var(--dv-border)] bg-white px-3 py-2 text-left text-sm text-neutral-600 hover:border-neutral-300"
                >
                  {c}
                </button>
              ))}
            </div>
            <p className="mt-3 px-1 text-[11px] text-neutral-400">
              AI assistant is not connected to a backend yet.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'self-end bg-[var(--dv-accent)] text-white'
                    : 'bg-white text-neutral-700'
                }`}
              >
                {m.text || '…'}
              </div>
            ))}
            {busy && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex items-center gap-2 self-start rounded-lg bg-white px-3 py-2 text-sm text-neutral-400">
                <Sparkles size={14} className="animate-pulse text-[var(--dv-accent)]" /> Thinking…
              </div>
            )}
          </div>
        )}
      </div>
      <div className="border-t border-[var(--dv-border)] p-2">
        <div className="flex items-end gap-1 rounded-lg border border-[var(--dv-border)] bg-white px-2 py-1">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            placeholder="Ask a question…"
            className="max-h-28 flex-1 resize-none bg-transparent py-1 text-sm outline-none"
          />
          {busy ? (
            <button onClick={stop} className="rounded p-1.5 text-red-500 hover:bg-red-50">
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={() => ask(input)}
              className="rounded p-1.5 text-[var(--dv-accent)] hover:bg-blue-50"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
