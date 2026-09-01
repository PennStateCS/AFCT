'use client';

import { JffCytoscapeViewer } from '@/components/JffViewerDialog';
import { CfgViewerContent } from '@/components/dialogs/CfgViewerDialog';
import { RegexViewerContent } from '@/components/dialogs/RegexViewerDialog';

/** Problem types drawn by the JFLAP (cytoscape) viewer; the rest have their own. */
const JFF_PROBLEM_TYPES = ['FA', 'PDA', 'TM'];

/**
 * The standalone viewer's contents.
 *
 * Deliberately the same three components the dialogs use, rather than a second rendering
 * path: the dialog and this window must never disagree about what a machine looks like.
 * All three were already exported apart from their dialog chrome, which is what makes a
 * separate window this small a change.
 */
export function ViewerClient({
  src,
  problemType,
  title,
  epsSymbol,
}: {
  src: string;
  problemType: string;
  title: string;
  epsSymbol?: string;
}) {
  if (JFF_PROBLEM_TYPES.includes(problemType)) {
    return (
      <JffCytoscapeViewer
        src={src}
        title={title}
        fill
        epsSymbol={epsSymbol}
        showGridDefault
        honorPositionsDefault
      />
    );
  }

  if (problemType === 'RE') {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <RegexViewerContent src={src} />
      </div>
    );
  }

  if (problemType === 'CFG') {
    return (
      <div className="mx-auto w-full max-w-3xl p-6">
        <CfgViewerContent src={src} epsSymbol={epsSymbol} />
      </div>
    );
  }

  return (
    <p className="text-muted-foreground p-6 text-sm">
      This viewer does not know how to show a {problemType} file.
    </p>
  );
}
