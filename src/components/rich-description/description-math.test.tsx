/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DescriptionMath } from './DescriptionMath';

const globalWithReact = globalThis as typeof globalThis & { React?: typeof React };
globalWithReact.React = React;

/**
 * Its own file because the renderer is module state and this is the only place that wants it
 * UNLOADED: KaTeX is fetched on demand, and what a reader sees in the moment before it arrives is
 * the behaviour under test. Loading it in any other test in this file would spoil the first one.
 */
describe('DescriptionMath', () => {
  it('shows the LaTeX source first, then replaces it once the renderer arrives', async () => {
    const { container } = render(<DescriptionMath latex="n^2" displayMode={false} />);

    // Before the renderer: the source, verbatim, rather than a gap or a spinner.
    expect(screen.getByText('n^2').tagName).toBe('CODE');

    await waitFor(() => {
      expect(container.querySelector('[data-type="inline-math"]')).not.toBeNull();
    });
    expect(container.querySelector('math')).not.toBeNull();
    expect(container.querySelector('code')).toBeNull();
  });

  it('renders a display equation as a block once loaded', async () => {
    const { container } = render(<DescriptionMath latex="x" displayMode />);

    await waitFor(() => {
      expect(container.querySelector('[data-type="block-math"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-type="block-math"]')!.tagName).toBe('DIV');
  });

  it('renders on the first pass once the renderer is already in memory', () => {
    // The second equation on a page must not flash its source again: the component seeds its
    // state from the module rather than starting at "not ready" every time.
    const { container } = render(<DescriptionMath latex="y" displayMode={false} />);

    expect(container.querySelector('math')).not.toBeNull();
  });
});
