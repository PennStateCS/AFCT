/** @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Stub each underlying viewer so we can assert which one the selector renders.
vi.mock('@/components/JffViewerDialog', () => ({
  default: () => <div data-testid="jff-viewer" />,
}));
vi.mock('@/components/dialogs/RegexViewerDialog', () => ({
  RegexViewerDialog: () => <div data-testid="regex-viewer" />,
}));
vi.mock('@/components/dialogs/CfgViewerDialog', () => ({
  CfgViewerDialog: () => <div data-testid="cfg-viewer" />,
}));

import { SubmissionViewerDialog } from './SubmissionViewerDialog';

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  src: '/file',
  title: 'A submission',
};

describe('SubmissionViewerDialog', () => {
  it.each(['FA', 'PDA', 'TM'])('renders the JFLAP viewer for %s', (type) => {
    render(<SubmissionViewerDialog {...baseProps} problemType={type} />);
    expect(screen.getByTestId('jff-viewer')).toBeTruthy();
  });

  it('renders the regex viewer for RE', () => {
    render(<SubmissionViewerDialog {...baseProps} problemType="RE" />);
    expect(screen.getByTestId('regex-viewer')).toBeTruthy();
  });

  it('renders the grammar viewer for CFG', () => {
    render(<SubmissionViewerDialog {...baseProps} problemType="CFG" />);
    expect(screen.getByTestId('cfg-viewer')).toBeTruthy();
  });

  it('renders nothing for an unknown or missing type', () => {
    const { container: unknown } = render(
      <SubmissionViewerDialog {...baseProps} problemType="ZZZ" />,
    );
    expect(unknown.querySelector('[data-testid]')).toBeNull();

    const { container: missing } = render(
      <SubmissionViewerDialog {...baseProps} problemType={null} />,
    );
    expect(missing.querySelector('[data-testid]')).toBeNull();
  });
});
