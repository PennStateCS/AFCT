/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  contentKey: `key-${id}`,
  correct: true,
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

const pair = (fileNameB: string | null = 'stored-b.jff') => [
  submission('a', 'Ada', 'stored-a.jff'),
  submission('b', 'Grace', fileNameB),
];

const show = (problemType: string | null, submissions: MatchSubmission[] = pair()) =>
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

    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Even zeros: 2 students submitted identical work',
    );
    expect(screen.getByText('Ada Student')).toBeInTheDocument();
    expect(screen.getByText('Grace Student')).toBeInTheDocument();
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

  it('offers no picker when the match is just two students', () => {
    show('FA');

    expect(screen.queryByLabelText('Left submission')).not.toBeInTheDocument();
  });

  it('opens on the two closest together in time when a match has three', () => {
    const [ada, grace] = pair();
    const third = {
      ...submission('c', 'Kurt', 'stored-c.jff'),
      // Days later: interesting, but not the pair a reader wants first.
      submittedAt: '2026-08-17T12:00:00.000Z',
    };
    // Ada and Grace are minutes apart; the list order deliberately puts Kurt first.
    const closeGrace = { ...grace!, submittedAt: '2026-08-14T12:04:00.000Z' };

    show('FA', [third, ada!, closeGrace]);

    const viewers = screen.getAllByTestId('jff-viewer');
    expect(viewers[0]).toHaveTextContent('stored-a.jff');
    expect(viewers[1]).toHaveTextContent('stored-b.jff');
  });

  it('lets either side be swapped to anyone else in the match', async () => {
    const person = userEvent.setup();
    const [ada, grace] = pair();
    const third = submission('c', 'Kurt', 'stored-c.jff');

    show('FA', [ada!, grace!, third]);

    await person.selectOptions(screen.getByLabelText('Right submission'), 'c');

    expect(screen.getAllByTestId('jff-viewer')[1]).toHaveTextContent('stored-c.jff');
  });

  it('never offers the student already shown on the other side', () => {
    const [ada, grace] = pair();
    show('FA', [ada!, grace!, submission('c', 'Kurt', 'stored-c.jff')]);

    const left = screen.getByLabelText('Left submission') as HTMLSelectElement;
    const right = screen.getByLabelText('Right submission') as HTMLSelectElement;

    expect([...left.options].map((o) => o.textContent)).not.toContain('Grace Student');
    expect([...right.options].map((o) => o.textContent)).not.toContain('Ada Student');
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
