'use client';

import JffViewerDialog from '@/components/JffViewerDialog';
import { RegexViewerDialog } from '@/components/dialogs/RegexViewerDialog';
import { CfgViewerDialog } from '@/components/dialogs/CfgViewerDialog';

// Problem types rendered by the JFLAP (cytoscape) viewer; the rest map to their own
// dedicated viewers.
const JFF_PROBLEM_TYPES = ['FA', 'PDA', 'TM'];

type SubmissionViewerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The problem's type — selects which viewer to render. */
  problemType: string | null | undefined;
  /** URL of the file to view (submission or solution). */
  src: string;
  title?: string;
  /** Empty-string symbol for the JFLAP viewer. */
  epsSymbol?: string;
  width?: string;
  height?: string;
  showGridDefault?: boolean;
};

/**
 * Picks the right viewer dialog for a problem's type — JFLAP for FA/PDA/TM, the regex
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
      />
    );
  }

  if (type === 'RE') {
    return <RegexViewerDialog open={open} onOpenChange={onOpenChange} src={src} title={title} />;
  }

  if (type === 'CFG') {
    return <CfgViewerDialog open={open} onOpenChange={onOpenChange} src={src} title={title} />;
  }

  return null;
}
