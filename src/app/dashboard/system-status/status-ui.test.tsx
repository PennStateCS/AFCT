/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Loading, TrendBadge } from './status-ui';

/**
 * The status tabs used to show flat text while they fetched, so a tab that had to load looked
 * like a page that had stopped. They now use the same treatment as the data tables, which is
 * also the only place the spinner is defined.
 */
describe('Loading', () => {
  it('shows the shared spinner, not just text', () => {
    const { container } = render(<Loading label="Loading server status…" />);

    expect(screen.getByText('Loading server status…')).toBeInTheDocument();
    // The shared Spinner renders a decorative wrapper in the primary colour around the
    // dots. Assert on that rather than on react-spinners internals: the point is that the
    // shared component is used, not which library draws it.
    expect(container.querySelector('[aria-hidden="true"].text-primary')).toBeInTheDocument();
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

/**
 * The trend badge painted every rise green and every fall red, so a server climbing towards
 * running out of memory reported it as a success and a quiet day looked like a fault. What
 * a direction means belongs to the reading, not to the badge, so the caller says.
 */
describe('TrendBadge', () => {
  const variantOf = (container: HTMLElement) => container.firstElementChild?.className ?? '';

  it('treats a rise in a bad-when-rising reading as bad', () => {
    const { container } = render(<TrendBadge delta={12} polarity="up-bad" />);

    expect(variantOf(container)).toContain('badge-danger');
    expect(screen.getByText('(up)', { exact: false })).toBeInTheDocument();
  });

  it('treats a fall in the same reading as good', () => {
    const { container } = render(<TrendBadge delta={-12} polarity="up-bad" />);

    expect(variantOf(container)).toContain('badge-success');
  });

  it('keeps a reading with no better direction neutral, whichever way it went', () => {
    const up = render(<TrendBadge delta={40} polarity="neutral" />);
    expect(variantOf(up.container)).toContain('badge-neutral');

    const down = render(<TrendBadge delta={-40} polarity="neutral" />);
    expect(variantOf(down.container)).toContain('badge-neutral');
  });

  it('defaults to neutral, so a caller that has not thought about it cannot claim a win', () => {
    const { container } = render(<TrendBadge delta={40} />);

    expect(variantOf(container)).toContain('badge-neutral');
  });

  it('reads a rise as good where rising is the good direction', () => {
    const { container } = render(<TrendBadge delta={40} polarity="up-good" />);

    expect(variantOf(container)).toContain('badge-success');
  });

  it('stays neutral when nothing has really moved', () => {
    const { container } = render(<TrendBadge delta={0.05} polarity="up-bad" />);

    expect(variantOf(container)).toContain('badge-neutral');
    expect(screen.getByText('(no change)', { exact: false })).toBeInTheDocument();
  });
});
