/** @vitest-environment jsdom */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ViewerClient } from './ViewerClient';

// The three viewers are stubbed: this asserts the dispatch, not the rendering, which each
// viewer's own tests already cover. Each stub reports the src it was handed, so a wiring
// mistake that showed the right viewer with the wrong file cannot pass.
vi.mock('@/components/JffViewerDialog', () => ({
  JffCytoscapeViewer: ({ src }: { src: string }) => <div data-testid="jff">{src}</div>,
}));
vi.mock('@/components/dialogs/CfgViewerDialog', () => ({
  CfgViewerContent: ({ src }: { src: string }) => <div data-testid="cfg">{src}</div>,
}));
vi.mock('@/components/dialogs/RegexViewerDialog', () => ({
  RegexViewerContent: ({ src }: { src: string }) => <div data-testid="re">{src}</div>,
}));

const SRC = '/api/files/submissions/abc.jff';

describe('the standalone viewer picks the same viewer the dialog would', () => {
  it.each([
    ['FA', 'jff'],
    ['PDA', 'jff'],
    ['TM', 'jff'],
    ['RE', 're'],
    ['CFG', 'cfg'],
  ])('renders %s with the %s viewer', (type, testId) => {
    render(<ViewerClient src={SRC} problemType={type} title="answer.jff" />);
    expect(screen.getByTestId(testId)).toHaveTextContent(SRC);
  });

  it('says so plainly for a type it does not know, rather than rendering nothing', () => {
    // A blank window would look like a broken file. These links are hand-editable.
    render(<ViewerClient src={SRC} problemType="MEALY" title="answer.jff" />);
    expect(screen.getByText(/does not know how to show a MEALY file/i)).toBeInTheDocument();
    expect(screen.queryByTestId('jff')).toBeNull();
  });
});
