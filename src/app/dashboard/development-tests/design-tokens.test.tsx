/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { DesignTokens } from './design-tokens';

// jsdom does no layout and applies no theme, so nothing here can prove the reference
// *looks* right; that is the point of the page and it is a human job. What these assert
// is that every section is present and wired to real shared components, so a section
// cannot silently disappear in a refactor.

describe('DesignTokens', () => {
  it('renders every token section, in order', () => {
    render(<DesignTokens />);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Core Surfaces',
      'Actions & Selection',
      'Text & Borders',
      'Form Controls',
      'Tables',
      'Status / Feedback',
      'Solid Status Colors',
      'Sidebar',
      'Data Visualization',
      'Typography Roles',
    ]);
  });

  it('pairs each core surface with its foreground token', () => {
    render(<DesignTokens />);
    for (const cls of [
      'text-foreground',
      'text-card-foreground',
      'text-popover-foreground',
      'text-muted-foreground',
      'text-accent-foreground',
    ]) {
      expect(screen.getAllByText(cls).length).toBeGreaterThan(0);
    }
  });

  it('shows tab-active as a selection state rather than a surface', () => {
    render(<DesignTokens />);
    // The swatch must not paint a background with the token: it is a foreground value.
    expect(screen.queryByText('bg-tab-active')).not.toBeInTheDocument();
    expect(screen.getByText('bg-tab-active-bg')).toBeInTheDocument();
    expect(screen.getByText('border-tab-active')).toBeInTheDocument();
  });

  it('no longer mentions tertiary, which was retired with its last consumer', () => {
    const { container } = render(<DesignTokens />);
    expect(container.textContent).not.toMatch(/tertiary/i);
  });

  it('separates a link from a primary accent', () => {
    render(<DesignTokens />);
    // Two different jobs: primary is a fill, and as text on the dark card it is 3.45:1.
    expect(screen.getByText('text-link')).toBeInTheDocument();
    expect(screen.getByText('text-link-hover')).toBeInTheDocument();
    expect(screen.getByText('Accent (not a link)')).toBeInTheDocument();
  });

  it('renders the real form controls with labels', () => {
    render(<DesignTokens />);
    expect(screen.getByLabelText('Text input')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Normal')).toBeInTheDocument();
    expect(screen.getByLabelText('Disabled')).toBeDisabled();
    expect(screen.getByLabelText('Invalid')).toHaveAttribute('aria-invalid', 'true');
    // The Select is Radix, so its trigger is a combobox rather than a labelled input.
    expect(screen.getByRole('combobox', { name: /Select/ })).toBeInTheDocument();
  });

  it('renders the token sample table', () => {
    const { container } = render(<DesignTokens />);
    const table = container.querySelector('table') as HTMLTableElement;
    expect(within(table).getByText('Alpha')).toBeInTheDocument();
    expect(within(table).getByText('Beta')).toBeInTheDocument();
    expect(within(table).getByText('Gamma')).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  });

  it('demonstrates the neutral badge and says what it is for', () => {
    const { container } = render(<DesignTokens />);
    // Scoped to the badge: "Closed" is also a row value in the table sample above.
    const badge = container.querySelector('[data-slot="badge"].bg-badge-neutral-bg');
    expect(badge).toHaveTextContent('Closed');
    expect(screen.getByText(/not a success\/warning\/error alert family/)).toBeInTheDocument();
  });

  it('shows the solid status fills', () => {
    const { container } = render(<DesignTokens />);
    for (const cls of [
      'bg-status-success-solid',
      'bg-status-warning-solid',
      'bg-status-danger-solid',
      'bg-status-info-solid',
      'bg-status-neutral-solid',
    ]) {
      expect(container.querySelector(`.${cls.replace(/\//g, '\\/')}`)).not.toBeNull();
    }
  });

  it('previews the sidebar with its own token family', () => {
    const { container } = render(<DesignTokens />);
    // Scoped to the rail: "Submissions" is also the tab-active sample.
    const rail = container.querySelector('.bg-sidebar') as HTMLElement;
    expect(rail).not.toBeNull();
    expect(within(rail).getByText('Submissions')).toBeInTheDocument();
    expect(within(rail).getByText('Course')).toBeInTheDocument();
    expect(container.querySelector('.bg-sidebar-primary')).not.toBeNull();
    expect(container.querySelector('.bg-sidebar-accent')).not.toBeNull();
  });

  it('shows six categorical hues, and no teal', () => {
    const { container } = render(<DesignTokens />);
    expect(screen.getByText('Categorical Palette')).toBeInTheDocument();
    // The copy-ready chips, not any mention of the name: the prose names chart-6 too.
    const chips = Array.from(container.querySelectorAll('code')).map((c) => c.textContent);
    for (const token of ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6']) {
      expect(chips).toContain(token);
      expect(container.querySelector(`.bg-${token}`)).not.toBeNull();
    }
    // The token and every trace of it are gone, not renamed.
    expect(chips).not.toContain('brand-teal');
    expect(container.querySelector('.bg-brand-teal')).toBeNull();
  });

  it('shows the sequential scale as a scale, and says what it is for', () => {
    const { container } = render(<DesignTokens />);
    expect(screen.getByText('Sequential Scale')).toBeInTheDocument();
    for (const n of [1, 2, 3, 4, 5]) {
      expect(container.querySelector(`.bg-chart-sequential-${n}`)).not.toBeNull();
    }
    expect(screen.getByText(/One quantity, increasing/)).toBeInTheDocument();
    // The rule that keeps the two families apart from the status family.
    expect(screen.getByText(/use the status tokens above/)).toBeInTheDocument();
  });

  it('lists the approved typography roles', () => {
    render(<DesignTokens />);
    expect(screen.getByText('text-2xl font-semibold tracking-tight')).toBeInTheDocument();
    expect(screen.getByText('text-2xs text-muted-foreground')).toBeInTheDocument();
  });
});
