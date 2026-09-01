/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import {
  readViewState,
  writeViewState,
  clearViewState,
  viewStateFits,
  type ViewerViewState,
} from './viewer-view-state';

const STATE: ViewerViewState = {
  v: 1,
  zoom: 1.75,
  pan: { x: -40, y: 12 },
  positions: { q0: { x: 0, y: 0 }, q1: { x: 100, y: 24 } },
  honorPositions: true,
};

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('remembering how a machine was being looked at', () => {
  it('comes back exactly as it went in', () => {
    writeViewState('submissions:a.jff', STATE);
    expect(readViewState('submissions:a.jff')).toEqual(STATE);
  });

  it('keeps one file apart from another', () => {
    writeViewState('submissions:a.jff', STATE);
    expect(readViewState('submissions:b.jff')).toBeNull();
  });

  it('forgets on request, which is what closing a tab does', () => {
    writeViewState('submissions:a.jff', STATE);
    clearViewState('submissions:a.jff');
    expect(readViewState('submissions:a.jff')).toBeNull();
  });

  it('reads nothing without a key, which is every viewer in a dialog', () => {
    writeViewState(null, STATE);
    expect(window.sessionStorage.length).toBe(0);
    expect(readViewState(null)).toBeNull();
  });
});

describe('refusing an entry that is not ours', () => {
  const bad: [string, unknown][] = [
    ['not JSON at all', undefined],
    ['an older shape', { ...STATE, v: 0 }],
    ['a zoom of zero, which would blank the canvas', { ...STATE, zoom: 0 }],
    ['a zoom that is not a number', { ...STATE, zoom: 'big' }],
    ['a missing pan', { ...STATE, pan: null }],
    ['a pan carrying NaN', { ...STATE, pan: { x: Number.NaN, y: 0 } }],
    ['a position that is not a point', { ...STATE, positions: { q0: 'over there' } }],
    ['a layout flag that is not a flag', { ...STATE, honorPositions: 'yes' }],
  ];

  it.each(bad)('ignores %s', (_label, value) => {
    // The key is in the reader's own storage and editable, and an entry written by an older
    // version outlives the code that wrote it. Either way the answer is to open at the fit.
    window.sessionStorage.setItem(
      'afct.viewer.view.submissions:a.jff',
      value === undefined ? '{oops' : JSON.stringify(value),
    );
    expect(readViewState('submissions:a.jff')).toBeNull();
  });
});

describe('when storage itself refuses', () => {
  it('says nothing was remembered rather than throwing', () => {
    // Private browsing, or a browser set to block site data. The viewer still has to open.
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    // Prove the stub is in force first, or every assertion below would hold anyway.
    expect(() => window.sessionStorage.getItem('anything')).toThrow();

    expect(() => writeViewState('k', STATE)).not.toThrow();
    expect(readViewState('k')).toBeNull();
    expect(() => clearViewState('k')).not.toThrow();
  });
});

describe('matching an arrangement to the machine on screen', () => {
  it('accepts one whose states are all present', () => {
    expect(viewStateFits(STATE, ['q0', 'q1', 'q2'])).toBe(true);
  });

  it('refuses one naming a state this machine does not have', () => {
    // The guard against putting one machine's arrangement onto another: the states that
    // happened to share a name would move and the rest would not, which is worse than a fit.
    expect(viewStateFits(STATE, ['q0'])).toBe(false);
  });
});
