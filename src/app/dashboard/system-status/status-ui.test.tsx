/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Loading } from './status-ui';

/**
 * The status tabs used to show flat text while they fetched, so a tab that had to load looked
 * like a page that had stopped. They now use the same treatment as the data tables, which is
 * also the only place the spinner is defined.
 */
describe('Loading', () => {
  it('shows the shared spinner, not just text', () => {
    const { container } = render(<Loading label="Loading server status…" />);

    expect(screen.getByText('Loading server status…')).toBeInTheDocument();
    // The shared Spinner renders a decorative brand-teal wrapper around the animation. Asserting
    // on that rather than on react-spinners internals: the point is that it is the shared one.
    expect(container.querySelector('[aria-hidden="true"].text-brand-teal')).toBeInTheDocument();
  });

  /** Screen readers got nothing from the old version: it was an unlabelled div of text. */
  it('announces itself', () => {
    render(<Loading label="Loading files…" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading files…');
  });

  it('has a default for callers that do not pass a label', () => {
    render(<Loading />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
