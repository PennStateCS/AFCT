import { describe, it, expect } from 'vitest';
import { viewerWindowHref, viewerFileSrc, isViewerFileKind } from './viewer-link';

/**
 * The link helper is the boundary that keeps the standalone viewer from being pointed
 * anywhere. It never passes a URL through: it recognises one of the application's own file
 * routes and re-describes it as a kind and a name, or it refuses and no button appears.
 */
describe('viewerWindowHref', () => {
  const base = { problemType: 'FA', title: 'answer.jff' };

  it('builds a link for each of the three file stores', () => {
    for (const kind of ['submissions', 'problems', 'solutions']) {
      const href = viewerWindowHref({ ...base, src: `/api/files/${kind}/abc.jff` });
      expect(href).not.toBeNull();
      const params = new URLSearchParams((href as string).split('?')[1]);
      expect(params.get('kind')).toBe(kind);
      expect(params.get('file')).toBe('abc.jff');
      expect(params.get('type')).toBe('FA');
    }
  });

  it('carries the title and the epsilon symbol when they are given', () => {
    const href = viewerWindowHref({
      src: '/api/files/submissions/abc.jff',
      problemType: 'CFG',
      title: 'Ada Lovelace, Problem 2',
      epsSymbol: 'λ',
    });
    const params = new URLSearchParams((href as string).split('?')[1]);
    expect(params.get('title')).toBe('Ada Lovelace, Problem 2');
    expect(params.get('eps')).toBe('λ');
  });

  it.each([
    ['an absolute URL', 'https://example.test/api/files/submissions/abc.jff'],
    ['a protocol-relative URL', '//example.test/api/files/submissions/abc.jff'],
    ['an unknown file store', '/api/files/secrets/abc.jff'],
    ['some other route entirely', '/api/courses/1/submissions'],
    ['a nested path', '/api/files/submissions/nested/abc.jff'],
    ['an empty string', ''],
  ])('refuses %s', (_label, src) => {
    expect(viewerWindowHref({ ...base, src })).toBeNull();
  });

  it('refuses a traversal name even when the route shape looks right', () => {
    // The file route would reject this too. Refusing here as well means a button that
    // exists always leads somewhere, rather than failing at the far end.
    expect(
      viewerWindowHref({ ...base, src: '/api/files/submissions/%2e%2e%2fpasswd' }),
    ).toBeNull();
  });

  it('refuses when the problem type is missing, since the viewer would not know what to draw', () => {
    expect(viewerWindowHref({ src: '/api/files/submissions/abc.jff', problemType: null })).toBeNull();
    expect(viewerWindowHref({ src: '/api/files/submissions/abc.jff', problemType: '  ' })).toBeNull();
  });

  it('round-trips a name that needs escaping', () => {
    const href = viewerWindowHref({ ...base, src: viewerFileSrc('submissions', 'a b+c.jff') });
    const params = new URLSearchParams((href as string).split('?')[1]);
    expect(params.get('file')).toBe('a b+c.jff');
  });
});

describe('isViewerFileKind', () => {
  it('accepts only the three upload stores', () => {
    expect(isViewerFileKind('submissions')).toBe(true);
    expect(isViewerFileKind('problems')).toBe(true);
    expect(isViewerFileKind('solutions')).toBe(true);
    expect(isViewerFileKind('pfps')).toBe(false);
    expect(isViewerFileKind(undefined)).toBe(false);
  });
});

describe('the file name carried for the tab', () => {
  it('is sent separately from the composed title', () => {
    // A composed title reads "answer.jff - D Flip-Flop". The tab wants the name alone, and
    // splitting it back out would be wrong for a file name that contains the separator.
    const href = viewerWindowHref({
      src: '/api/files/solutions/abc.jff',
      problemType: 'FA',
      title: 'd - flip.jff - D Flip-Flop',
      fileName: 'd - flip.jff',
    });
    const params = new URLSearchParams((href as string).split('?')[1]);
    expect(params.get('name')).toBe('d - flip.jff');
    expect(params.get('title')).toBe('d - flip.jff - D Flip-Flop');
  });

  it('is simply absent when the caller does not know it', () => {
    const href = viewerWindowHref({
      src: '/api/files/solutions/abc.jff',
      problemType: 'FA',
      title: 'answer.jff - Problem',
    });
    expect(new URLSearchParams((href as string).split('?')[1]).get('name')).toBeNull();
  });
});
