import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

globalThis.React = React;

const authMock = vi.hoisted(() => vi.fn());
const redirectMock = vi.hoisted(() =>
  vi.fn(() => {
    // Mirror Next's redirect(): throws a control-flow error that unwinds render.
    throw new Error('NEXT_REDIRECT');
  }),
);

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/components/session/SessionWatcher', () => ({ __esModule: true, default: () => null }));
vi.mock('./ViewerClient', () => ({ ViewerClient: () => null }));

import ViewerPage from './page';

const params = (o: Record<string, string>) => Promise.resolve(o);
const signedIn = () => authMock.mockResolvedValue({ user: { id: 'u1', inactive: false } });

/** Render the returned tree to a string, which is enough to assert which branch was taken. */
async function renderPage(search: Record<string, string>) {
  const el = await ViewerPage({ searchParams: params(search) });
  const { renderToStaticMarkup } = await import('react-dom/server');
  return renderToStaticMarkup(el as React.ReactElement);
}

const GOOD = { kind: 'submissions', file: 'abc.jff', type: 'FA' };

describe('the standalone viewer page', () => {
  beforeEach(() => {
    authMock.mockReset();
    redirectMock.mockClear();
  });

  it('sends a signed-out visitor to sign in', async () => {
    authMock.mockResolvedValue(null);
    await expect(renderPage(GOOD)).rejects.toThrow('NEXT_REDIRECT');
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('sends an account deactivated since sign-in to sign in', async () => {
    // Same two conditions the dashboard layout applies. A session alone is not enough.
    authMock.mockResolvedValue({ user: { id: 'u1', inactive: true } });
    await expect(renderPage(GOOD)).rejects.toThrow('NEXT_REDIRECT');
  });

  it('renders the viewer for a well-formed link', async () => {
    signedIn();
    const html = await renderPage({ ...GOOD, title: 'Ada, Problem 2' });
    expect(html).toContain('Ada, Problem 2');
    expect(html).not.toContain('Nothing to show');
  });

  it.each([
    ['an unknown file store', { kind: 'pfps', file: 'a.jff', type: 'FA' }, /which kind of file/i],
    ['a traversal name', { kind: 'submissions', file: '../x', type: 'FA' }, /name a file/i],
    ['an unknown machine type', { kind: 'submissions', file: 'a.jff', type: 'MEALY' }, /kind of machine/i],
    ['nothing at all', {}, /which kind of file/i],
  ])('refuses %s and says which part of the link is wrong', async (_l, search, expected) => {
    // These URLs get bookmarked and hand-edited, so a refusal has to be readable.
    signedIn();
    const html = await renderPage(search as Record<string, string>);
    expect(html).toContain('Nothing to show');
    expect(html).toMatch(expected);
  });

  it('checks the session before it looks at the link at all', async () => {
    // A signed-out visitor must not learn whether a file name is valid.
    authMock.mockResolvedValue(null);
    await expect(renderPage({ kind: 'nonsense' })).rejects.toThrow('NEXT_REDIRECT');
  });
});
