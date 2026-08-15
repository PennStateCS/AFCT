/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The three renderers are stubbed: what matters here is that each pane gets the right file
// and the right viewer for the problem type, not how cytoscape draws it.
vi.mock('@/components/JffViewerDialog', () => ({
  JffCytoscapeViewer: ({ src }: { src: string }) => <div data-testid="jff-viewer">{src}</div>,
}));
vi.mock('@/components/dialogs/CfgViewerDialog', () => ({
  CfgViewerContent: ({ src }: { src: string }) => <div data-testid="cfg-viewer">{src}</div>,
}));
vi.mock('@/components/dialogs/RegexViewerDialog', () => ({
  RegexViewerContent: ({ src }: { src: string }) => <div data-testid="re-viewer">{src}</div>,
}));

import { CompareSubmissionsDialog } from './CompareSubmissionsDialog';
import type { MatchSubmission } from '@/lib/similarity/matches';

const submission = (id: string, firstName: string, fileName: string | null): MatchSubmission => ({
  id,
  submittedAt: '2026-08-14T12:00:00.000Z',
  assignmentId: 'a1',
  fileName,
  originalFileName: `${firstName}.jff`,
  student: {
    id: `student-${id}`,
    firstName,
    lastName: 'Student',
    avatar: null,
    cropX: null,
    cropY: null,
    zoom: null,
  },
  studentGroup: null,
});

const pair = (fileNameB: string | null = 'stored-b.jff') =>
  [submission('a', 'Ada', 'stored-a.jff'), submission('b', 'Grace', fileNameB)] as [
    MatchSubmission,
    MatchSubmission,
  ];

const show = (problemType: string | null, submissions = pair()) =>
  render(
    <CompareSubmissionsDialog
      open
      onOpenChange={() => {}}
      submissions={submissions}
      problemType={problemType}
      problemTitle="Even zeros"
      formatSubmittedAt={() => '14 Aug 2026, 12:00 UTC'}
    />,
  );

describe('CompareSubmissionsDialog', () => {
  it('shows both students in one dialog, each with their own file', () => {
    show('FA');

    expect(screen.getByRole('dialog')).toHaveTextContent('Even zeros: Ada Student and Grace Student');
    const viewers = screen.getAllByTestId('jff-viewer');
    expect(viewers).toHaveLength(2);
    expect(viewers[0]).toHaveTextContent('stored-a.jff');
    expect(viewers[1]).toHaveTextContent('stored-b.jff');
  });

  it('picks the viewer the problem type is read with', () => {
    show('CFG');
    expect(screen.getAllByTestId('cfg-viewer')).toHaveLength(2);

    show('RE');
    expect(screen.getAllByTestId('re-viewer')).toHaveLength(2);
  });

  it('offers a download instead when a type has no viewer', () => {
    show('SOMETHING_NEW');

    expect(screen.queryByTestId('jff-viewer')).not.toBeInTheDocument();
    expect(screen.getAllByText(/download the files to compare them/)).toHaveLength(2);
  });

  it('says so when one side has no file rather than rendering an empty pane', () => {
    show('FA', pair(null));

    expect(screen.getByText('This submission has no file.')).toBeInTheDocument();
    expect(screen.getAllByTestId('jff-viewer')).toHaveLength(1);
  });

  it('renders nothing without a pair to compare', () => {
    const { container } = render(
      <CompareSubmissionsDialog
        open
        onOpenChange={() => {}}
        submissions={null}
        problemType="FA"
        problemTitle="Even zeros"
        formatSubmittedAt={() => ''}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
