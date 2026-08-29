/** @vitest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  THRESHOLD_KEY,
  resetCommonShareForTests,
  useCommonShare,
} from '@/lib/similarity-threshold';
import { COMMON_SHARE } from '@/lib/similarity/rarity';

/** Two separate components, the way the page uses it: the tab, and the count on its button. */
function Reader({ label }: { label: string }) {
  const [share] = useCommonShare();
  return <span data-testid={label}>{share}</span>;
}

function Writer() {
  const [, setShare] = useCommonShare();
  return (
    <button type="button" onClick={() => setShare(0.4)}>
      move
    </button>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetCommonShareForTests();
});

describe('useCommonShare', () => {
  it('starts at the default when nothing has been saved', () => {
    render(<Reader label="one" />);

    expect(screen.getByTestId('one')).toHaveTextContent(String(COMMON_SHARE));
  });

  it('gives every reader the same number, and moves them together', () => {
    render(
      <>
        <Reader label="page" />
        <Reader label="badge" />
        <Writer />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'move' }));

    // The point of the store: a badge counting at one threshold beside a page counting at
    // another is the mismatch this replaced.
    expect(screen.getByTestId('page')).toHaveTextContent('0.4');
    expect(screen.getByTestId('badge')).toHaveTextContent('0.4');
    expect(window.localStorage.getItem(THRESHOLD_KEY)).toBe('0.4');
  });

  it('picks up what the reader saved last time', () => {
    window.localStorage.setItem(THRESHOLD_KEY, '0.15');

    render(<Reader label="one" />);

    expect(screen.getByTestId('one')).toHaveTextContent('0.15');
  });

  it('ignores a saved value that is not a share', () => {
    window.localStorage.setItem(THRESHOLD_KEY, 'not a number');

    render(<Reader label="one" />);

    expect(screen.getByTestId('one')).toHaveTextContent(String(COMMON_SHARE));
  });
});
