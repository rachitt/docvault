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
  const resolvedTheme = useStore((s) => s.resolvedTheme);

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

  const isEditableDoc = view === 'doc' && currentDoc && !currentDoc.frontmatter.source;
  const deskActive = document.documentElement.classList.contains('desk');
  const defaultPageBg = deskActive ? '#f4ecd6' : resolvedTheme === 'dark' ? '#202022' : '#ffffff';
  const customPageBg = isEditableDoc ? currentDoc.frontmatter.pageBg : undefined;
  const pageBg = isEditableDoc ? (customPageBg ?? defaultPageBg) : undefined;
  const mainStyle = pageBg
    ? ({
        '--dv-page-bg': pageBg,
        ...(customPageBg ? { '--dv-page-background': customPageBg } : {}),
        backgroundColor: pageBg,
      } as React.CSSProperties)
    : undefined;

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-white" style={mainStyle}>
      {body}
    </main>
  );
}

function Empty({ label }: { label: string }): React.JSX.Element {
  return <div className="flex h-full items-center justify-center text-neutral-400">{label}</div>;
}
