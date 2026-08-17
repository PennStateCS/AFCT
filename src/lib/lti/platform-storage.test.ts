/** @vitest-environment jsdom */

/**
 * Talking to the platform's browser storage.
 *
 * This is the fallback for a browser that refuses AFCT's state cookie, which is Safari today and
 * more of Chrome tomorrow. Without it those launches fail on the state check with nothing the
 * person can do about it.
 *
 * The postMessage exchange is what is worth testing: which frame is addressed, that replies are
 * matched by `message_id` rather than by arriving next, and that no answer is treated as "this
 * platform does not do storage" rather than as an error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getData, putData, stateStorageKey, PARENT_TARGET } from './platform-storage';

type Posted = {
  message: { subject: string; message_id?: string; key?: string; value?: string | null };
  origin: string;
  via: string;
};

let posted: Posted[] = [];

/** A frame that records what it was sent and can answer as the platform would. */
const frame = (name: string) => ({
  postMessage: (message: Posted['message'], origin: string) => {
    posted.push({ message, origin, via: name });
  },
});

/** Answer the last message of a subject, the way Canvas does: on `window`, with the same id. */
const reply = (subject: string, extra: Record<string, unknown> = {}) => {
  const last = [...posted].reverse().find((p) => p.message.subject === subject);
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { subject: `${subject}.response`, message_id: last?.message.message_id, ...extra },
    }),
  );
};

beforeEach(() => {
  posted = [];
  vi.stubGlobal('window', Object.assign(window, { parent: { frames: {}, ...frame('parent') } }));
});

afterEach(() => vi.restoreAllMocks());

describe('the storage key', () => {
  it('is per launch, so two tabs do not overwrite each other', () => {
    // A single shared name has already caused this class of bug once, with the state cookie.
    expect(stateStorageKey('one')).not.toBe(stateStorageKey('two'));
    expect(stateStorageKey('one')).toContain('one');
  });
});

describe('putData', () => {
  it('sends the value and reports the platform keeping it', async () => {
    const promise = putData({
      key: 'k',
      value: 'v',
      storageTarget: PARENT_TARGET,
      platformOrigin: 'https://canvas.example.test',
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    reply('lti.put_data', { key: 'k', value: 'v' });

    expect(await promise).toBe(true);
    expect(posted[0]?.message).toMatchObject({ subject: 'lti.put_data', key: 'k', value: 'v' });
    // Required by the spec, and what tells one answer from another.
    expect(posted[0]?.message.message_id).toBeTruthy();
  });

  it('does not claim success when the platform reports an error', async () => {
    const promise = putData({ key: 'k', value: 'v', storageTarget: null, platformOrigin: null });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    reply('lti.put_data', { error: { code: 'storage_unavailable' } });

    expect(await promise).toBe(false);
  });

  it('gives up quietly when nothing answers', async () => {
    // A platform that does not do storage is the ordinary case on other LMSs, not a fault, and
    // the caller carries on to the cookie.
    vi.useFakeTimers();
    const promise = putData({ key: 'k', value: 'v', storageTarget: null, platformOrigin: null });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await promise).toBe(false);
    vi.useRealTimers();
  });
});

describe('getData', () => {
  it('returns what the platform kept', async () => {
    const promise = getData({ key: 'k', storageTarget: null, platformOrigin: null });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    reply('lti.get_data', { key: 'k', value: 'the-state' });

    expect(await promise).toBe('the-state');
  });

  it('ignores an answer to somebody else’s message', async () => {
    // Every reply lands on the same window, so without the id check a slow answer to an earlier
    // message would be read as the answer to this one.
    const promise = getData({ key: 'k', storageTarget: null, platformOrigin: null });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { subject: 'lti.get_data.response', message_id: 'someone-else', value: 'wrong' },
      }),
    );
    reply('lti.get_data', { key: 'k', value: 'right' });

    expect(await promise).toBe('right');
  });

  it('treats nothing stored as nothing stored', async () => {
    const promise = getData({ key: 'k', storageTarget: null, platformOrigin: null });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    reply('lti.get_data', { key: 'k', value: null });

    expect(await promise).toBeNull();
  });
});

describe('which frame is addressed', () => {
  it('asks the named frame at the platform origin, and the parent as a fallback', async () => {
    const named = frame('named');
    (window.parent as unknown as { frames: Record<string, unknown> }).frames = {
      post_message_forwarding: named,
    };

    void getData({
      key: 'k',
      storageTarget: 'post_message_forwarding',
      platformOrigin: 'https://canvas.example.test',
    });
    await vi.waitFor(() => expect(posted.length).toBe(2));

    // The spec's target, addressed properly rather than with a wildcard.
    expect(posted[0]).toMatchObject({ via: 'named', origin: 'https://canvas.example.test' });
    // And the parent, because the named frame is missing inside the rich content editor.
    expect(posted[1]).toMatchObject({ via: 'parent', origin: '*' });
  });

  it('asks only the parent when the platform named no frame', async () => {
    void getData({ key: 'k', storageTarget: PARENT_TARGET, platformOrigin: null });
    await vi.waitFor(() => expect(posted.length).toBe(1));

    expect(posted[0]).toMatchObject({ via: 'parent', origin: '*' });
  });
});
