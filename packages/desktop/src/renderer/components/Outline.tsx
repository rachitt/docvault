import { useMemo } from 'react';
import { useStore } from '../store';

interface Heading {
  level: number;
  text: string;
}

/** Parse ATX headings from the current doc's markdown (skipping code fences). */
function parseHeadings(md: string): Heading[] {
  const body = md.replace(/```[\s\S]*?```/g, '');
  const out: Heading[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^(#{1,4})\s+(.+)$/);
    if (m) out.push({ level: m[1]!.length, text: m[2]!.trim() });
  }
  return out;
}

export function Outline(): React.JSX.Element {
  const currentDoc = useStore((s) => s.currentDoc);
  const headings = useMemo(() => parseHeadings(currentDoc?.content ?? ''), [currentDoc?.content]);

  if (!currentDoc) {
    return <p className="p-4 text-sm text-neutral-400">Open a document to see its outline.</p>;
  }

  return (
    <nav className="p-3 text-sm">
      <p className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase">
        On this page
      </p>
      {headings.length === 0 && <p className="px-1 text-neutral-400">No headings yet.</p>}
      {headings.map((h, i) => (
        <div
          key={i}
          className="cursor-default truncate rounded px-1 py-1 text-neutral-600 hover:bg-neutral-200/60"
          style={{ paddingLeft: `${(h.level - 1) * 12 + 4}px` }}
          title={h.text}
        >
          {h.text}
        </div>
      ))}
    </nav>
  );
}
