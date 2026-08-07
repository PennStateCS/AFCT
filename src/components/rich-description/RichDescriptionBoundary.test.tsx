/** @vitest-environment jsdom */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { RichDescriptionBoundary } from './RichDescriptionBoundary';

function Boom(): React.ReactElement {
  throw new Error('render exploded');
}

describe('RichDescriptionBoundary', () => {
  it('renders its children when nothing throws', () => {
    const { container } = render(
      <RichDescriptionBoundary fallback={<p>plain</p>}>
        <p>rich</p>
      </RichDescriptionBoundary>,
    );
    expect(container.textContent).toBe('rich');
  });

  it('shows the fallback instead of propagating a thrown render', () => {
    // React logs the caught error itself; silence both channels so the run stays readable.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { container } = render(
      <RichDescriptionBoundary fallback={<p>plain fallback</p>}>
        <Boom />
      </RichDescriptionBoundary>,
    );

    // The point of the boundary: the surrounding page survives with the words intact.
    expect(container.textContent).toBe('plain fallback');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
