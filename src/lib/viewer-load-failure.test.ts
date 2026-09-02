import { describe, it, expect } from 'vitest';

import {
  failureForContent,
  failureForNetwork,
  failureForStatus,
  type ViewerLoadFailure,
} from './viewer-load-failure';

const all = (): ViewerLoadFailure[] => [
  failureForStatus(401),
  failureForStatus(403),
  failureForStatus(404),
  failureForStatus(500),
  failureForStatus(418),
  failureForNetwork(),
  failureForContent(),
];

describe('telling somebody why a machine did not open', () => {
  it('distinguishes not being allowed from the file being gone', () => {
    // Two different things to do about them: one is a question for whoever runs the course,
    // the other means the link is stale. "Something went wrong" covers neither.
    expect(failureForStatus(403).title).not.toBe(failureForStatus(404).title);
    expect(failureForStatus(403).detail).toMatch(/access/i);
    expect(failureForStatus(404).detail).toMatch(/deleted|link/i);
  });

  it('says a signed-out session is worth another try, and a refusal is not', () => {
    expect(failureForStatus(401).retryable).toBe(true);
    expect(failureForStatus(403).retryable).toBe(false);
    expect(failureForStatus(404).retryable).toBe(false);
  });

  it('treats a server fault as ours and worth trying again', () => {
    expect(failureForStatus(500).retryable).toBe(true);
    expect(failureForStatus(503).retryable).toBe(true);
    expect(failureForStatus(500).detail).toMatch(/our end/i);
  });

  it('offers a retry for a request that never got an answer', () => {
    expect(failureForNetwork().retryable).toBe(true);
    expect(failureForNetwork().detail).toMatch(/connected/i);
  });

  it('does not offer to re-read bytes that will not parse twice', () => {
    expect(failureForContent().retryable).toBe(false);
    // The one thing the reader can follow up on.
    expect(failureForContent().detail).toMatch(/student/i);
  });

  it('has something to say about a status nobody planned for', () => {
    const odd = failureForStatus(418);
    expect(odd.title.length).toBeGreaterThan(0);
    expect(odd.detail.length).toBeGreaterThan(0);
  });

  it('never shows the reader a status code or an exception', () => {
    // They cannot act on either, and a number in a message reads as a fault they caused.
    for (const failure of all()) {
      expect(`${failure.title} ${failure.detail}`).not.toMatch(/\b[45]\d\d\b|Error:|undefined/);
    }
  });

  it('writes in sentences, since these are read by people who teach', () => {
    for (const failure of all()) {
      expect(failure.title[0]).toBe(failure.title[0]?.toUpperCase());
      expect(failure.detail.trim().endsWith('.')).toBe(true);
    }
  });
});
