import { useStore } from '../store';
import { Editor } from './Editor';
import { SourceViewer } from './SourceViewer';
import { ListView } from './ListView';
import { Settings } from './Settings';
import { TagsView } from './TagsView';
import { SearchResults } from './SearchResults';

export function MainPane(): React.JSX.Element {
  const view = useStore((s) => s.view);
  const currentDoc = useStore((s) => s.currentDoc);

  let body: React.JSX.Element;
  if (view === 'doc' && currentDoc) {
    body = currentDoc.frontmatter.source ? (
      <SourceViewer key={currentDoc.frontmatter.id} doc={currentDoc} />
    ) : (
      <Editor key={currentDoc.frontmatter.id} doc={currentDoc} />
    );
  } else if (view === 'doc') {
    body = <Empty label="Select a document" />;
  } else if (view === 'settings') {
    body = <Settings />;
  } else if (view === 'tags') {
    body = <TagsView />;
  } else if (view === 'search') {
    body = <SearchResults />;
  } else {
    body = <ListView view={view} />;
  }

  return <main className="min-w-0 flex-1 overflow-y-auto bg-white">{body}</main>;
}

function Empty({ label }: { label: string }): React.JSX.Element {
  return <div className="flex h-full items-center justify-center text-neutral-400">{label}</div>;
}
