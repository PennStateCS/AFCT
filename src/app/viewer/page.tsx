import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import QueryProvider from '@/components/providers/QueryProvider';
import SessionWatcher from '@/components/session/SessionWatcher';
import { isSafeUploadName } from '@/lib/upload-names';
import { isViewerFileKind, viewerFileSrc } from '@/lib/viewer-link';
import { ViewerActionsProvider } from '@/components/viewer/viewer-actions';
import { ViewerMenubar } from '@/components/viewer/ViewerMenubar';
import { ViewerClient } from './ViewerClient';

export const metadata: Metadata = { title: 'AFCT Viewer' };

/** The types the viewer can render, so a mangled link is refused before anything loads. */
const KNOWN_TYPES = ['FA', 'PDA', 'TM', 'RE', 'CFG'];

/** A refusal that reads as an answer rather than an error page. */
function Refusal({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-foreground mb-2 text-lg font-semibold">Nothing to show</h1>
        <p className="text-muted-foreground text-sm">{message}</p>
      </div>
    </main>
  );
}

/**
 * The standalone machine viewer, opened in its own window from a viewer dialog.
 *
 * Outside `/dashboard` on purpose: that layout supplies the sidebar and navbar, and a
 * window whose whole job is to show one machine as large as possible should have neither.
 * The providers the viewers need (theme, session, toasts) come from the root layout, so
 * the only thing this route has to re-add is the idle-session watcher, which the dashboard
 * layout would otherwise have mounted.
 *
 * It grants no access of its own. The file itself is fetched from the same route the
 * dialog uses, which authorises per file and writes the audit record; this page only
 * decides that the link is well formed and that somebody is signed in.
 *
 * `QueryProvider` is here because `SessionWatcher` reads the configured idle timeout with
 * react-query. Outside `/dashboard` nothing else supplies a query client, and the failure
 * is a blank error page rather than a missing feature, so the two belong together.
 */
export default async function ViewerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  // Same two conditions the dashboard layout applies: a session, and an account that has
  // not been marked inactive since it was issued.
  if (!session?.user?.id || session.user.inactive) {
    redirect('/login');
  }

  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const kind = first('kind');
  const file = first('file');
  const type = (first('type') ?? '').toUpperCase();

  // Each refusal names the part of the link that is wrong, because these URLs get
  // bookmarked, pasted into mail and hand-edited, and "something went wrong" would leave
  // somebody with no idea whether to blame the link or the file.
  if (!isViewerFileKind(kind)) {
    return <Refusal message="This link does not say which kind of file to open." />;
  }
  if (!isSafeUploadName(file)) {
    return <Refusal message="This link does not name a file the viewer can open." />;
  }
  if (!KNOWN_TYPES.includes(type)) {
    return <Refusal message="This link does not say what kind of machine the file holds." />;
  }

  const title = first('title') ?? file;
  const epsSymbol = first('eps');

  return (
    <QueryProvider>
      <SessionWatcher />
      {/* `min-w-0 flex-1` because the root layout's body is a flex row: a block child sizes
          to its content there and the viewer came out at roughly half the window. The same
          pattern the dashboard shell uses for its content column. */}
      <ViewerActionsProvider>
        <main className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
          <ViewerMenubar downloadHref={`${viewerFileSrc(kind, file)}?download=1`} />
          {/* A tab rather than a heading bar. It carries the white of the menu bar above it
              and the grey of the toolbar below, so it reads as the label of the thing it sits
              on rather than as a third strip stacked between them. Open at the bottom, which
              is what joins it to the toolbar. */}
          <header className="bg-card shrink-0 px-3 pt-2">
            <h1 className="bg-background inline-flex max-w-full items-center rounded-t-md border border-b-0 px-3 py-1.5 text-sm font-semibold">
              <span className="truncate" title={title}>
                {title}
              </span>
            </h1>
          </header>
          <div className="min-h-0 flex-1">
            <ViewerClient
              src={viewerFileSrc(kind, file)}
              problemType={type}
              title={title}
              epsSymbol={epsSymbol}
            />
          </div>
        </main>
      </ViewerActionsProvider>
    </QueryProvider>
  );
}
