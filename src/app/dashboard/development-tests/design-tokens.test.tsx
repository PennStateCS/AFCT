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

  it('documents tertiary as legacy rather than listing it in the palette', () => {
    render(<DesignTokens />);
    expect(screen.getByText('Legacy / specialized')).toBeInTheDocument();
    expect(screen.getByText('tertiary')).toBeInTheDocument();
    expect(screen.queryByText('bg-tertiary')).not.toBeInTheDocument();
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

  it('states the chart-only rule for the retained teal', () => {
    render(<DesignTokens />);
    expect(screen.getByText('bg-brand-teal')).toBeInTheDocument();
    expect(
      screen.getByText(/retained for categorical and data visualization only/),
    ).toBeInTheDocument();
  });

  it('lists the approved typography roles', () => {
    render(<DesignTokens />);
    expect(screen.getByText('text-2xl font-semibold tracking-tight')).toBeInTheDocument();
    expect(screen.getByText('text-2xs text-muted-foreground')).toBeInTheDocument();
  });
});
