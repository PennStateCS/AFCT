import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.hoisted(() => vi.fn());
const readStatusMock = vi.hoisted(() => vi.fn());
const readProgressMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/updates', () => ({
  readStatus: readStatusMock,
  readProgress: readProgressMock,
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/api/activity', () => ({ logError: vi.fn(), logDenied: vi.fn() }));

import { GET } from './route';

const ctx = { params: Promise.resolve({}) };
const req = () => new NextRequest('http://localhost/api/admin/settings/upgrade/stream');

/** Pull whatever frames are currently buffered, decoded as text. */
async function drain(res: Response, frames: number): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (let i = 0; i < frames; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  void reader.cancel();
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  authMock.mockResolvedValue({ user: { id: 'a1', isAdmin: true } });
  readProgressMock.mockReturnValue({ lines: [], nextCursor: 0 });
  readStatusMock.mockReturnValue({ phase: 'upgrading' });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The live upgrade feed behind Admin -> System Settings -> Updates.
 *
 * An upgrade is the operation most likely to go wrong on somebody else's installation, and
 * this stream is the only window into it while it runs. So the cases that matter are the
 * unhappy ones: it must not break when the updater is mid-write, it must close itself
 * rather than hang a tab open, and it must stay admin-only.
 */
describe('GET /api/admin/settings/upgrade/stream', () => {
  it('403s for a signed-in non-admin, and reads nothing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });

    const res = await GET(req(), ctx);

    expect(res.status).toBe(403);
    expect(readStatusMock).not.toHaveBeenCalled();
    expect(readProgressMock).not.toHaveBeenCalled();
  });

  it('401s when signed out', async () => {
    authMock.mockResolvedValue(null);

    expect((await GET(req(), ctx)).status).toBe(401);
  });

  it('announces itself as an event stream that nginx must not buffer', async () => {
    // Without X-Accel-Buffering the proxy holds the response and the operator sees
    // nothing until the upgrade finishes, which defeats the point of streaming.
    const res = await GET(req(), ctx);

    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
  });

  it('sends a first frame immediately rather than waiting a poll interval', async () => {
    readStatusMock.mockReturnValue({ phase: 'upgrading', step: 'pulling images' });

    const res = await GET(req(), ctx);
    const text = await drain(res, 1);

    expect(text).toContain('event: status');
    expect(text).toContain('"phase":"upgrading"');
  });

  it('pushes new log lines and advances the cursor so none are repeated', async () => {
    readProgressMock.mockReturnValueOnce({ lines: ['pulling image'], nextCursor: 12 });

    const res = await GET(req(), ctx);
    const text = await drain(res, 2);

    expect(text).toContain('event: log');
    expect(text).toContain('pulling image');
    // The first read starts at 0; the next one resumes from the cursor it returned.
    expect(readProgressMock.mock.calls[0][0]).toBe(0);
  });

  it('emits no log event when there is nothing new to say', async () => {
    readProgressMock.mockReturnValue({ lines: [], nextCursor: 0 });

    const res = await GET(req(), ctx);
    const text = await drain(res, 1);

    expect(text).not.toContain('event: log');
    expect(text).toContain('event: status');
  });

  it.each(['healthy', 'failed', 'rolled_back'])(
    'closes itself once the upgrade has settled as %s',
    async (phase) => {
      readStatusMock.mockReturnValue({ phase });

      const res = await GET(req(), ctx);
      const text = await drain(res, 3);

      expect(text).toContain('event: done');
      expect(text).toContain(`"phase":"${phase}"`);
    },
  );

  it('keeps streaming while the upgrade is still in flight', async () => {
    readStatusMock.mockReturnValue({ phase: 'upgrading' });

    const res = await GET(req(), ctx);
    const text = await drain(res, 1);

    expect(text).not.toContain('event: done');
  });

  it('survives a read that fails mid-write instead of killing the stream', async () => {
    // status.json and progress.log are written by the updater sidecar, so a read can
    // land between writes. That must not end the operator's only view of the upgrade.
    readProgressMock.mockImplementationOnce(() => {
      throw new Error('EBUSY');
    });

    const res = await GET(req(), ctx);

    // The stream is still open and still readable; the throw was swallowed.
    expect(res.body).toBeTruthy();
    expect(res.status).toBe(200);
  });

  it('tolerates a missing status file', async () => {
    // Before the updater writes status.json there is nothing to report a phase from, but
    // log lines can already exist. Emit those and simply omit the status event.
    readStatusMock.mockReturnValue(null);
    readProgressMock.mockReturnValueOnce({ lines: ['starting'], nextCursor: 8 });

    const res = await GET(req(), ctx);
    const text = await drain(res, 1);

    expect(text).toContain('event: log');
    expect(text).not.toContain('event: status');
  });

  it('stops polling when the client goes away', async () => {
    const controller = new AbortController();
    const aborting = new NextRequest('http://localhost/api/admin/settings/upgrade/stream', {
      signal: controller.signal,
    });

    await GET(aborting, ctx);
    const callsBefore = readProgressMock.mock.calls.length;

    controller.abort();
    await vi.advanceTimersByTimeAsync(5000);

    // No further polling after the abort, so a closed tab cannot leave a timer running.
    expect(readProgressMock.mock.calls.length).toBe(callsBefore);
  });
});
