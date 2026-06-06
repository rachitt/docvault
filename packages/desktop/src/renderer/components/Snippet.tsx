import { Fragment } from 'react';

/**
 * Render an FTS5 `snippet()` string, turning the «matched term» markers the
 * index emits into highlighted <mark> spans. Splitting on the marker pair keeps
 * the surrounding context intact while emphasising what actually matched.
 */
export function Snippet({ text }: { text: string }): React.JSX.Element {
  // Split keeping the «…» groups: odd indices are the highlighted matches.
  const parts = text.split(/«([^»]*)»/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-amber-200/70 px-0.5 text-neutral-900 dark:bg-amber-300/30 dark:text-amber-100">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
