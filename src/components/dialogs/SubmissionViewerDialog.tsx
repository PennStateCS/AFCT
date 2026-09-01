'use client';

import JffViewerDialog from '@/components/JffViewerDialog';
import { RegexViewerDialog } from '@/components/dialogs/RegexViewerDialog';
import { CfgViewerDialog } from '@/components/dialogs/CfgViewerDialog';
import { viewerWindowHref } from '@/lib/viewer-link';

// Problem types rendered by the JFLAP (cytoscape) viewer; the rest map to their own
// dedicated viewers.
const JFF_PROBLEM_TYPES = ['FA', 'PDA', 'TM'];

type SubmissionViewerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The problem's type: selects which viewer to render. */
  problemType: string | null | undefined;
  /** URL of the file to view (submission or solution). */
  src: string;
  title?: string;
  /** Empty-string symbol (ε / λ) for the JFLAP and grammar viewers. */
  epsSymbol?: string;
  width?: string;
  height?: string;
  showGridDefault?: boolean;
};

/**
 * Picks the right viewer dialog for a problem's type: JFLAP for FA/PDA/TM, the regex
 * viewer for RE, the grammar viewer for CFG. Replaces the three near-identical
 * type-switch blocks that were copy-pasted across the assignment/submission views.
 * Renders nothing for an unknown type.
 */
export function SubmissionViewerDialog({
  open,
  onOpenChange,
  problemType,
  src,
  title,
  epsSymbol,
  width = '70vw',
  height = '70vh',
  showGridDefault,
}: SubmissionViewerDialogProps) {
  const type = problemType ?? '';
  // Null when the file is not one this viewer can build a safe link to, in which case no
  // button is offered rather than one that would fail at the far end.
  const windowHref = viewerWindowHref({ src, problemType: type, title, epsSymbol });

  if (JFF_PROBLEM_TYPES.includes(type)) {
    return (
      <JffViewerDialog
        open={open}
        onOpenChange={onOpenChange}
        src={src}
        title={title}
        width={width}
        height={height}
        showGridDefault={showGridDefault}
        epsSymbol={epsSymbol}
        windowHref={windowHref}
      />
    );
  }

  if (type === 'RE') {
    return (
      <RegexViewerDialog
        open={open}
        onOpenChange={onOpenChange}
        src={src}
        title={title}
        windowHref={windowHref}
      />
    );
  }

  if (type === 'CFG') {
    // Grammars show epsilon too, so they follow the course's notation like the others do.
    return (
      <CfgViewerDialog
        open={open}
        onOpenChange={onOpenChange}
        src={src}
        title={title}
        epsSymbol={epsSymbol}
        windowHref={windowHref}
      />
    );
  }

  return null;
}
