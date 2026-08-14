import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  workerSlot: { upsert: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  closeSlot,
  markSlotBusy,
  markSlotIdle,
  openSlot,
  purgeAbandonedSlots,
  SLOT_BEAT_MS,
  SLOT_PURGE_MS,
  touchSlot,
} from './worker-slots';

// The throttle keeps its state per slot for the life of the module, which is the point of it.
// Each test therefore takes a slot number nobody else uses, rather than trying to reset it.
let nextSlot = 100;
const aSlot = () => nextSlot++;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  prismaMock.workerSlot.deleteMany.mockResolvedValue({ count: 0 });
});

/**
 * The idle backoff exists because polling every few seconds across several loops was a lot of
 * database traffic for nothing. Beating on every pass would have put much of that straight back,
 * so the beat is throttled independently of how fast the loop runs.
 */
describe('beat throttling', () => {
  it('writes the first beat', async () => {
    await touchSlot(aSlot());

    expect(prismaMock.workerSlot.updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not write again straight away', async () => {
    const slot = aSlot();
    await touchSlot(slot);
    await touchSlot(slot);
    await touchSlot(slot);

    expect(prismaMock.workerSlot.updateMany).toHaveBeenCalledTimes(1);
  });

  it('writes again once the interval has passed', async () => {
    const slot = aSlot();
    await touchSlot(slot);
    vi.advanceTimersByTime(SLOT_BEAT_MS + 1);
    await touchSlot(slot);

    expect(prismaMock.workerSlot.updateMany).toHaveBeenCalledTimes(2);
  });

  it('throttles each slot separately', async () => {
    await touchSlot(aSlot());
    await touchSlot(aSlot());

    expect(prismaMock.workerSlot.updateMany).toHaveBeenCalledTimes(2);
  });

  /** A state change is news, so it is never throttled away. */
  it('always writes a state change', async () => {
    const slot = aSlot();
    await touchSlot(slot);
    await markSlotBusy(slot, 's1');
    await markSlotIdle(slot);

    expect(prismaMock.workerSlot.updateMany).toHaveBeenCalledTimes(3);
  });

  it('counts a state change as the slot having beaten', async () => {
    const slot = aSlot();
    await markSlotBusy(slot, 's1');
    await touchSlot(slot);

    // The busy write was itself a beat, so the touch right after it is redundant.
    expect(prismaMock.workerSlot.updateMany).toHaveBeenCalledTimes(1);
  });

  /** A retired slot number is never reused, but its throttle state should not linger either. */
  it('forgets a slot when it closes', async () => {
    const slot = aSlot();
    await touchSlot(slot);
    await closeSlot(slot);
    await touchSlot(slot);

    expect(prismaMock.workerSlot.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe('purging abandoned slots', () => {
  const NOW = new Date('2026-08-14T12:00:00.000Z');

  it('deletes only rows far past stale', async () => {
    await purgeAbandonedSlots(NOW);

    const where = prismaMock.workerSlot.deleteMany.mock.calls[0][0].where;
    expect(where.lastSeenAt.lt).toEqual(new Date(NOW.getTime() - SLOT_PURGE_MS));
  });

  /**
   * The point of the age limit: a worker running alongside this one beats far more often than
   * the purge window, so its rows can never be caught by this.
   */
  it('leaves a live slot alone', async () => {
    await purgeAbandonedSlots(NOW);

    const cutoff = prismaMock.workerSlot.deleteMany.mock.calls[0][0].where.lastSeenAt.lt;
    const liveSlotLastSeen = new Date(NOW.getTime() - SLOT_BEAT_MS);
    expect(liveSlotLastSeen.getTime()).toBeGreaterThan(cutoff.getTime());
  });

  it('reports how many it removed', async () => {
    prismaMock.workerSlot.deleteMany.mockResolvedValue({ count: 4 });

    expect(await purgeAbandonedSlots(NOW)).toBe(4);
  });

  /** Observability must never take grading down with it. */
  it('returns zero rather than throwing when the database is unhappy', async () => {
    prismaMock.workerSlot.deleteMany.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(purgeAbandonedSlots(NOW)).resolves.toBe(0);
  });
});

describe('failures never reach the caller', () => {
  it('swallows a failed beat', async () => {
    prismaMock.workerSlot.updateMany.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(touchSlot(aSlot())).resolves.toBeUndefined();
  });

  it('swallows a failed registration', async () => {
    prismaMock.workerSlot.upsert.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(openSlot(aSlot())).resolves.toBeUndefined();
  });
});
