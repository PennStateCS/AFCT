import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import SessionWatcher from '@/components/session/SessionWatcher';
import { isSafeUploadName } from '@/lib/upload-names';
import { isViewerFileKind, viewerFileSrc } from '@/lib/viewer-link';
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
    <>
      <SessionWatcher />
      <main className="flex h-screen flex-col overflow-hidden">
        <header className="shrink-0 border-b px-4 py-3">
          <h1 className="text-foreground text-sm font-semibold break-words">{title}</h1>
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
    </>
  );
}
