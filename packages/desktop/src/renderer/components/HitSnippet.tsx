import type { UnifiedHit } from '../../shared/ipc';
import { Snippet } from './Snippet';

/**
 * Render the best available preview for a search hit, adapting to the search
 * mode that produced it:
 *  - FTS hits carry a `snippet` with «matched» markers → highlight via Snippet.
 *  - Semantic/hybrid hits carry a best `passage` (and a heading `breadcrumb`);
 *    we show the breadcrumb as context above the passage text. A hybrid hit
 *    sourced from the FTS leg still has a marked snippet, so that wins.
 */
export function HitSnippet({ hit }: { hit: UnifiedHit }): React.JSX.Element {
  const hasMarkedSnippet = !!hit.snippet && hit.snippet.includes('«');
  if (hasMarkedSnippet) return <Snippet text={hit.snippet!} />;

  // Semantic/hybrid passage. The stored passage is breadcrumb-prefixed, so strip
  // a leading breadcrumb line to avoid showing it twice when we render the
  // breadcrumb separately.
  const breadcrumb = hit.breadcrumb?.trim();
  let passage = hit.passage ?? hit.snippet ?? '';
  if (breadcrumb && passage.startsWith(breadcrumb)) {
    passage = passage.slice(breadcrumb.length).replace(/^\s+/, '');
  }

  return (
    <span>
      {breadcrumb && (
        <span className="mb-0.5 block truncate text-[11px] font-medium text-neutral-400">
          {breadcrumb}
        </span>
      )}
      <span className="line-clamp-3">{passage}</span>
    </span>
  );
}
